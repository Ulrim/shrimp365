"""FastAPI application entrypoint (shrimp365 통합판).

Startup (lifespan): 스키마 확인 → 브로드캐스터(Redis 또는 인프로세스) 기동 →
활성 카메라 스트림 자동 시작.

이 서비스는 shrimp365 웹 컨테이너에서만 부른다. 외부에 직접 노출하지 않는다
(docker-compose 에서 포트를 호스트에 매핑하지 않는 이유).
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import kiosk
from app.api.mjpeg import router as mjpeg_router
from app.api.v1.router import api_router
from app.api.websocket.stream import router as ws_router
from app.config import (
    auto_start_streams_active,
    settings,
    simulation_mode_active,
    simulation_mode_reason,
)
from app.database import init_db
from app.services import snapshot_sender, sync_service
from app.version import VERSION as APP_VERSION
from app.services.broadcaster import broadcaster
from app.services.camera_manager import camera_manager
from app.services.pairing import ensure_device_key, load_device_key, pairing_state

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


async def _start_cameras() -> int:
    if not auto_start_streams_active():
        return 0
    started = await camera_manager.auto_start_active_cameras()
    logger.info("Auto-started %d camera stream(s)", started)
    return started


#: 연결 코드를 못 받았을 때 다시 시도하는 간격(초). 점점 늘리고 5분에서 멈춘다.
#:
#: 전원을 넣은 직후에는 와이파이가 아직 안 붙어 있는 일이 흔하다. 한 번 실패하고
#: 멈추면 화면 없는 장비는 재부팅 말고는 길이 없고, 화면이 있어도 사람이 와서
#: 버튼을 눌러 줘야 한다 — 설치하고 전원만 넣으면 된다는 말이 거짓이 된다.
PAIR_RETRY_SECONDS = (10, 20, 40, 80, 160, 300)


async def _pair_then_count(version: str) -> None:
    """연결될 때까지 다시 시도하고, 승인되면 그 자리에서 세기 시작한다.

    승인 뒤에 다시 시작하게 두면 현장에서 그 사실을 알 길이 없다 — 화면은
    "연결됨"인데 개체수는 영영 0 이다.

    여기서 터지는 것은 **이 안에서 끝낸다.** 뒤에서 도는 작업의 예외는
    아무도 보지 않다가 서비스를 내릴 때 되살아나 "Application shutdown
    failed" 로 끝난다 — 진짜 원인(그물·DNS·인증서)과 아무 상관 없어 보이는
    자리에서. 연결에 실패해도 세는 일과 화면은 계속 돌아야 한다.
    """
    attempt = 0
    while True:
        key = None
        try:
            key = await ensure_device_key(version)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - 그물 밖의 일은 무엇이든 터진다
            logger.error(
                "연결을 진행하지 못했습니다: %s: %s\n"
                "  개체수 측정과 장비 화면은 계속 돕니다.",
                type(exc).__name__,
                exc,
            )
            pairing_state.failed(f"{type(exc).__name__}: {exc}")

        if key:
            # 승인되자마자 내 카메라를 받아 온다. 맞춤 주기(30초)를 기다리게 두면
            # 화면은 "연결됨"인데 개체수는 한참 0 이라, 사람은 실패한 줄 안다.
            if sync_service.enabled():
                with contextlib.suppress(Exception):
                    await sync_service.pull_assignment()
            await _start_cameras()
            return

        if pairing_state.status == "expired":
            # 코드는 받았는데 15분 안에 아무도 입력하지 않은 경우다. 그물
            # 문제가 아니므로 기다릴 이유가 없다 — 새 코드를 바로 받아 화면에
            # 띄운다. 농장 사람이 한참 뒤에 와도 유효한 코드를 보게 된다.
            attempt, delay = 0, 1.0
        else:
            delay = PAIR_RETRY_SECONDS[min(attempt, len(PAIR_RETRY_SECONDS) - 1)]
            attempt += 1
        await pairing_state.wait_before_retry(delay)


@asynccontextmanager
async def lifespan(app: FastAPI):
    reason = simulation_mode_reason()
    if reason is None:
        logger.info(
            "Starting shrimp365 vision service — 실제 모델로 추론합니다 (%s)",
            settings.model_path,
        )
    else:
        # 조용히 넘어가면 가짜 개체수가 실제 DB 에 쌓이고 경보도 그 값으로
        # 울린다. 로그를 훑기만 해도 걸리도록 눈에 띄게 적는다.
        logger.warning(
            "=" * 68
            + "\n  [시뮬레이션 모드] 이 서비스가 내보내는 개체수는 가짜입니다."
            + "\n  이유: %s"
            + "\n  카메라를 실제로 세려면 위 문제를 고치고 다시 시작하세요:"
            + "\n      sudo systemctl restart shrimp365-vision"
            + "\n" + "=" * 68,
            reason,
        )
    # 바깥 길(터널)을 안 깐 장비에서는 이 둘이 비어 있는 것이 정상이다.
    # 오류가 아니라 "아직 안 쓰는 기능" 이므로 그렇게 적는다 — 빨간 ERROR 가
    # 뜨면 설치가 잘못된 줄 알고 멀쩡한 것을 뒤지게 된다.
    if not settings.vision_service_key or not settings.stream_secret:
        logger.info(
            "끊김 없는 영상(MJPEG)은 꺼져 있습니다(터널 미설정). "
            "개체수 측정·기록·장비 화면은 그대로 돕니다.\n"
            "  웹에서는 이 장비가 15초마다 올리는 수조 사진이 대신 보입니다 — "
            "대개 이것으로 충분하고, 깔 것이 없습니다.\n"
            "  초 단위 영상까지 필요하면 docs/VISION_DEPLOY.md §3-5 를 따라 "
            "터널을 깔고 VISION_SERVICE_KEY·VISION_STREAM_SECRET 을 채우세요."
        )
    await init_db()
    await broadcaster.start()
    camera_manager.start_watchdog()

    # 로컬 기록을 서버와 맞추는 일. DATABASE_URL 을 직접 준 배포(도커·서버)
    # 에서는 DB 가 이미 원본이므로 돌리지 않는다.
    sync_task = None
    if sync_service.enabled():
        sync_task = asyncio.create_task(sync_service.run(), name="sync")
        logger.info(
            "측정값은 기기 키로 %s 에 올립니다(장비에 DB 비밀번호를 두지 않습니다).",
            settings.shrimp365_internal_url,
        )

    # 수조 사진을 서버로 밀어 올리는 일. 영상(MJPEG)은 브라우저가 장비로
    # 들어오는 연결이라 농장 공유기가 막지만, 사진은 개체수와 같은 방향으로
    # 나가므로 공유기를 그대로 두고 쓸 수 있다(snapshot_sender 머리말).
    snapshot_task = None
    if snapshot_sender.enabled():
        snapshot_task = asyncio.create_task(
            snapshot_sender.run(), name="snapshot"
        )
        logger.info(
            "수조 사진을 %.0f초마다 올립니다 — 공유기 뒤에서도 웹에서 보입니다.",
            settings.snapshot_interval_seconds,
        )

    # 장비 터치스크린. 127.0.0.1 전용 포트에 따로 띄운다 — 이 포트를 터널로
    # 내보내면 인증 없는 영상이 바깥에 열린다(app/kiosk.py 머리말).
    kiosk_task = None
    if settings.kiosk_enabled:
        kiosk_task = asyncio.create_task(kiosk.serve(), name="kiosk")

    # 기기 키가 있으면(= 이미 연결된 장비) 바로 세기 시작한다.
    #
    # 없으면 페어링을 **뒤에서** 돌린다. 예전에는 여기서 기다렸는데, 승인까지
    # 최대 15분을 붙들고 있어 그동안 화면도 /health 도 뜨지 않았다. 그런데
    # 코드를 보여 주는 것이 바로 그 화면이다 — 연결하려면 화면이 필요하고,
    # 화면은 연결이 끝나야 뜨는 교착이었다. 승인되면 그 자리에서 카메라를
    # 시작하므로 다시 시작할 필요도 없다.
    pairing_task = None
    if load_device_key():
        await ensure_device_key(app.version)  # settings.device_key 를 채운다
        await _start_cameras()
    else:
        logger.warning(
            "아직 수조에 연결되지 않은 장비입니다 — 연결 코드를 받는 중입니다.\n"
            "  장비 화면(터치스크린)이나 이 로그에 6자리 코드가 뜹니다."
        )
        pairing_task = asyncio.create_task(
            _pair_then_count(app.version), name="pairing"
        )
        pairing_state.adopt(pairing_task)

    yield

    for task in (pairing_task, sync_task, snapshot_task, kiosk_task):
        if task is not None:
            task.cancel()
            # CancelledError 만 삼키면 모자란다. 이미 다른 예외로 끝난 작업을
            # await 하면 그 예외가 여기서 되살아나 종료 자체가 실패한다.
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await task
    await camera_manager.stop_all()
    await broadcaster.stop()


app = FastAPI(
    title="shrimp365 Vision Service",
    version=APP_VERSION,
    description="비전센서·AI 기반 비접촉 흰다리새우 개체수 모니터링 (내부 전용)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)  # /ws/stream/{camera_id}
app.include_router(mjpeg_router)  # /stream/{camera_id}


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    """Liveness probe used by Docker / nginx upstream checks."""
    return {
        "status": "ok",
        "mode": "simulation" if simulation_mode_active() else "production",
    }
