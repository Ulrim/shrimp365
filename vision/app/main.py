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


async def _pair_then_count(version: str) -> None:
    """연결을 기다렸다가, 승인되면 그 자리에서 세기 시작한다.

    승인 뒤에 다시 시작하게 두면 현장에서 그 사실을 알 길이 없다 — 화면은
    "연결됨"인데 개체수는 영영 0 이다.
    """
    key = await ensure_device_key(version)
    if key:
        await _start_cameras()


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
    if not settings.vision_service_key:
        logger.error(
            "VISION_SERVICE_KEY 가 비어 있습니다 — /api/v1 의 모든 요청이 401 로 거부됩니다."
        )
    if not settings.stream_secret:
        logger.error(
            "VISION_STREAM_SECRET 이 비어 있습니다 — 영상·실시간 연결이 전부 거부됩니다."
        )
    await init_db()
    await broadcaster.start()
    camera_manager.start_watchdog()

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

    for task in (pairing_task, kiosk_task):
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    await camera_manager.stop_all()
    await broadcaster.stop()


app = FastAPI(
    title="shrimp365 Vision Service",
    version="1.0.0",
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
