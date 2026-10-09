"""장비 터치스크린 화면 — 라즈베리파이 공식 7인치(800×480) 기준.

크로미움을 키오스크 모드로 이 페이지에 붙여 두면 비전 장비 자체가 하나의
계기판이 된다. 수질 센서 파이(raspberry-pi/webui.py)와 같은 틀이라 두 장비의
사용감이 같다 — 색·글자 크기·페어링 흐름을 그쪽에 맞췄다.

화면 원칙 (수질 쪽과 같다)
  · 기본 화면은 **항상 지금 세는 개체수**다. 서버에 연결됐든 아니든, 인터넷이
    있든 없든 눈앞의 값이 먼저다. 값이 정말 급한 순간이 회선이 죽었을 때다.
  · 페어링 코드는 **버튼을 눌렀을 때만** 뜬다. 아직 연결하지 않은 장비도
    카메라로는 멀쩡히 쓸 수 있어야 한다.
  · 시뮬레이션 모드면 **화면에 숨기지 않고 알린다.** 로그에만 적으면 가짜
    개체수를 진짜로 믿고 쓴다.

**왜 본 서비스(8000)가 아니라 별도 포트인가.** 이 화면은 영상과 페어링 코드를
인증 없이 보여 준다 — 장비 앞에 선 사람만 볼 수 있다는 전제다. 본 서비스는
Cloudflare 터널로 바깥에 열리므로, 같은 포트에 얹으면 그 전제가 깨져 카메라
id 하나로 남의 수조를 들여다볼 수 있다. 그래서 127.0.0.1 전용 포트에 따로
띄우고, 루프백이 아닌 주소에는 뜨지 않도록 아래에서 막는다.
"""
from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import socket
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse, Response

from app.config import settings, simulation_mode_active, simulation_mode_reason
from app.services import tuning
from app.services.camera_manager import camera_manager
from app.services.pairing import pairing_state
from app.services.reporter import reporter
from app.services.stream_service import frame_store
from app.services.sync_service import backlog as sync_backlog
from app.services.sync_service import enabled as sync_enabled
from app.version import VERSION

logger = logging.getLogger(__name__)

#: 서버에 보고하는 프로그램 버전. 값은 app/version.py 한 곳에서만 정한다
#: (원격 업데이트가 VERSION 파일을 바꾸면 그대로 따라간다).
AGENT_VERSION = VERSION

#: 추이 그래프용 표본. 5초 간격 × 360 = 30분.
_SAMPLE_INTERVAL_SECONDS = 5
_HISTORY_POINTS = 360

#: (unix 초, 개체수). 화면을 아무도 보지 않아도 쌓는다 — 보러 왔을 때 이미
#: 그려져 있어야 쓸모가 있다.
_history: deque[tuple[float, int]] = deque(maxlen=_HISTORY_POINTS)


def _current_camera() -> uuid.UUID | None:
    """이 장비가 맡고 있는 카메라. CSI 는 보드당 하나라 사실상 단일이다."""
    running = list(camera_manager._processors)  # noqa: SLF001 - 같은 패키지 내부
    return running[0] if running else None


def sample_once() -> None:
    """지금 개체수를 추이 표본에 한 번 넣는다."""
    cam = _current_camera()
    if cam is None:
        return
    latest = frame_store.latest_count(cam)
    if latest is not None:
        _history.append((time.time(), latest.count))


async def _sampler() -> None:
    while True:
        await asyncio.sleep(_SAMPLE_INTERVAL_SECONDS)
        with contextlib.suppress(Exception):  # 표본 수집이 서비스를 멈추면 안 된다
            sample_once()


def update_state() -> dict | None:
    """마지막 원격 업데이트 결과. 없으면 None.

    **SSH 없이 "이 장비가 올라갔나" 를 확인할 유일한 길이다.** 업데이터는
    농장에 아무도 없을 때 한밤중에 돌고, 실패하면 조용히 이전 버전으로
    되돌린다 — 그 사실이 어딘가에 남지 않으면 아무도 모른다.

    업데이터(deploy/updater.py)가 적는 자리를 그대로 읽는다. 서로 다른 곳을
    보면 화면은 영영 비어 있고, 그 증상의 원인은 보이지 않는다.
    """
    path = Path(settings.device_state_path).with_name("update-result.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return {
        "status": str(data.get("status") or ""),
        "version": str(data.get("version") or ""),
        "message": str(data.get("message") or "")[:300],
        "at": data.get("at") if isinstance(data.get("at"), int) else None,
    }


def build_state() -> dict:
    """화면이 1초에 한 번 받아 가는 전부."""
    cam = _current_camera()
    processor = camera_manager.processor(cam) if cam else None
    latest = frame_store.latest_count(cam) if cam else None

    age = None
    if latest is not None:
        now = datetime.now(latest.timestamp.tzinfo)
        age = max(0, int((now - latest.timestamp).total_seconds()))

    return {
        "version": AGENT_VERSION,
        "camera": (
            {
                "id": str(cam),
                "name": processor.camera.name if processor else None,
                "status": processor.status if processor else "stopped",
                "type": processor.camera.camera_type if processor else None,
            }
            if cam
            else None
        ),
        "count": None if latest is None else latest.count,
        "count_age": age,
        "confidence": None if latest is None else latest.confidence_avg,
        # 먹이망 격자로 축척을 잡아 두었을 때만 나온다. 안 잡았으면 None —
        # 자를 대지 않고 길이를 지어내지 않는다.
        "length_cm": None if latest is None else latest.length_cm,
        "history": [[int(ts), c] for ts, c in _history],
        # 가짜 값을 진짜처럼 보여 주지 않는다.
        "simulation": simulation_mode_active(),
        "simulation_reason": simulation_mode_reason(),
        # 추측하지 않는다 — 한 번도 보고하지 않았으면 None 그대로 보낸다.
        #
        # 어느 쪽을 보는지가 구성에 따라 다르다. 서버로 올리는 구성(기본)에서는
        # 로컬 DB 쓰기가 언제나 성공하므로 그것으로는 회선 상태를 알 수 없다 —
        # 실제로 shrimp365 에 닿았는지는 reporter 만 안다.
        "server_ok": reporter.last_ok if sync_enabled() else camera_manager.last_report_ok,
        # 못 올려 보관 중인 개체수. 끊긴 동안 "값이 사라지는 중"이 아니라는
        # 것을 농장에서 눈으로 확인할 수 있어야 한다. 장비 안의 DB 에 실제로
        # 남아 있는 수다 — 메모리에 든 수가 아니라 재부팅을 넘기는 수다.
        "pending_uploads": sync_backlog() if sync_enabled() else 0,
        "pairing": pairing_state.snapshot(),
        "public_url": settings.vision_public_url or None,
        # 마지막 원격 업데이트 결과. 되돌려진 장비를 농장에서 눈으로 알아볼
        # 수 있어야 한다 — 그러지 못하면 옛 버전으로 도는 파이가 조용히 남는다.
        "update": update_state(),
        "model": settings.model_path.rsplit("/", 1)[-1],
        "conf_threshold": settings.confidence_threshold,
    }


@asynccontextmanager
async def _lifespan(app: FastAPI):  # pragma: no cover - 수명주기
    """추이 표본 수집을 화면과 함께 띄우고 함께 내린다."""
    sampler = asyncio.create_task(_sampler(), name="kiosk-sampler")
    try:
        yield
    finally:
        sampler.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sampler


def create_app() -> FastAPI:
    app = FastAPI(
        title="shrimp365 vision kiosk",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=_lifespan,
    )

    @app.get("/", response_class=HTMLResponse)
    async def page() -> HTMLResponse:
        return HTMLResponse(PAGE_HTML)

    @app.get("/favicon.ico")
    async def favicon() -> Response:
        # 크로미움이 매번 요청한다. 없으면 콘솔에 404 가 쌓이고, 키오스크에서는
        # 그 404 가 유일한 오류 신호여야 할 자리를 차지한다.
        return Response(status_code=204)

    @app.get("/api/state")
    async def state() -> JSONResponse:
        # 화면은 1초마다 묻는다. 캐시가 끼면 멈춘 값을 보게 된다.
        return JSONResponse(build_state(), headers={"Cache-Control": "no-store"})

    @app.get("/frame.jpg")
    async def frame() -> Response:
        cam = _current_camera()
        jpeg = frame_store.latest_frame(cam) if cam else None
        if jpeg is None:
            return Response(status_code=204)  # 아직 프레임이 없다
        return Response(
            jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"}
        )

    @app.post("/api/pair/start")
    async def pair_start() -> JSONResponse:
        started = pairing_state.start(AGENT_VERSION)
        return JSONResponse({"started": started, "pairing": pairing_state.snapshot()})

    @app.get("/api/tuning")
    async def tuning_get() -> JSONResponse:
        cam = _current_camera()
        if cam is None:
            return JSONResponse({"camera": None})
        t = tuning.get(cam)
        return JSONResponse({
            "camera": str(cam),
            "roi": list(t.roi) if t.roi else None,
            "min_conf": t.min_conf,
            "base_conf": settings.confidence_threshold,
            "px_per_cm": list(t.px_per_cm) if t.px_per_cm else None,
            "cell_cm": list(tuning.MESH_CELL_CM),
        })

    @app.post("/api/tuning")
    async def tuning_set(body: dict) -> JSONResponse:
        """화면에서 그은 네모와 고른 신뢰도를 저장한다. 다음 프레임부터 적용된다."""
        cam = _current_camera()
        if cam is None:
            return JSONResponse({"error": "카메라가 없습니다."}, status_code=409)
        roi = body.get("roi")
        box = None
        if isinstance(roi, list) and len(roi) == 4:
            with contextlib.suppress(TypeError, ValueError):
                box = tuple(float(v) for v in roi)  # type: ignore[assignment]
        conf = body.get("min_conf")
        with contextlib.suppress(TypeError, ValueError):
            conf = float(conf) if conf is not None else None
        # 축척은 "격자 몇 칸을 덮었나" 로 받는다. 픽셀 값을 그대로 받으면
        # 화면 크기가 바뀔 때마다 틀어진다.
        px = None
        cal = body.get("calibration")
        if isinstance(cal, dict):
            with contextlib.suppress(TypeError, ValueError):
                px = tuning.scale_from_cells(
                    (float(cal["w_px"]), float(cal["h_px"])),
                    (int(cal["cells_x"]), int(cal["cells_y"])),
                )
        elif body.get("px_per_cm") is None and "calibration" in body:
            px = None  # 명시적으로 지우기
        else:
            px = tuning.get(cam).px_per_cm  # 안 보냈으면 그대로 둔다

        saved = tuning.save(cam, tuning.Tuning(roi=box, min_conf=conf, px_per_cm=px))
        t = tuning.get(cam)
        return JSONResponse({
            "saved": saved,
            "roi": list(t.roi) if t.roi else None,
            "min_conf": t.min_conf,
            "px_per_cm": list(t.px_per_cm) if t.px_per_cm else None,
        })

    @app.post("/api/pair/cancel")
    async def pair_cancel() -> JSONResponse:
        cancelled = pairing_state.cancel()
        return JSONResponse({"cancelled": cancelled, "pairing": pairing_state.snapshot()})

    return app


def _is_loopback(host: str) -> bool:
    if host in ("localhost",):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


async def serve() -> None:
    """키오스크 화면을 띄운다. 루프백이 아니면 뜨지 않는다.

    설정 실수로 0.0.0.0 에 붙으면 인증 없는 영상과 페어링 코드가 그대로
    바깥에 열린다. 그 경우는 조용히 열어 주는 것보다 안 뜨는 쪽이 낫다.
    """
    if not _is_loopback(settings.kiosk_host):
        logger.error(
            "장비 화면을 띄우지 않았습니다 — KIOSK_HOST 가 루프백이 아닙니다(%s).\n"
            "  이 화면은 인증 없이 영상과 연결 코드를 보여 주므로 127.0.0.1 전용입니다.\n"
            "  바깥에서 보려면 www.shrimp365.kr 의 개체수 화면을 쓰세요.",
            settings.kiosk_host,
        )
        return

    import uvicorn  # noqa: PLC0415 - 본 서비스가 이미 들고 있는 의존성

    # 포트를 **먼저** 직접 잡는다. uvicorn 에 맡기면 bind 실패 때 sys.exit(3) 을
    # 불러 프로세스 전체가 죽는다 — 화면 포트가 겹쳤다고 개체수 세는 일이
    # 멈추면 안 된다. 화면은 있으면 좋은 것이고, 계수가 본업이다.
    try:
        sock = socket.socket(socket.AF_INET6 if ":" in settings.kiosk_host else socket.AF_INET)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((settings.kiosk_host, settings.kiosk_port))
        sock.listen(16)
    except OSError as exc:
        logger.error(
            "장비 화면을 띄우지 못했습니다 (%s:%s) — %s\n"
            "  개체수 측정은 그대로 계속됩니다. 포트를 바꾸려면 KIOSK_PORT 를 고치세요.",
            settings.kiosk_host,
            settings.kiosk_port,
            exc,
        )
        return

    config = uvicorn.Config(
        create_app(),
        log_level="warning",  # 1초마다 오는 요청 로그로 journal 을 채우지 않는다
        access_log=False,
    )
    logger.info(
        "장비 화면: http://%s:%s (터치스크린용)", settings.kiosk_host, settings.kiosk_port
    )
    try:
        await uvicorn.Server(config).serve(sockets=[sock])
    except SystemExit as exc:  # uvicorn 은 기동 실패를 sys.exit 로 알린다
        logger.error("장비 화면이 멈췄습니다(%s). 개체수 측정은 계속됩니다.", exc)
    finally:
        with contextlib.suppress(OSError):
            sock.close()


PAGE_HTML = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800,height=480,initial-scale=1">
<title>Shrimp365 개체수</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden}
  body{
    background:#0B1120;color:#E8EDF7;
    font:500 16px/1.4 system-ui,-apple-system,"Noto Sans CJK KR",
         "Noto Sans KR","Nanum Gothic",sans-serif;
    display:flex;flex-direction:column;
    -webkit-user-select:none;user-select:none;
  }
  header{
    display:flex;align-items:center;gap:10px;
    padding:9px 16px;border-bottom:1px solid #22304C;background:#111A2E;flex:0 0 auto;
  }
  .mark{width:24px;height:24px;border-radius:6px;background:#1E40AF;
    display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:13px}
  .brand{font-weight:800;letter-spacing:-.02em;font-size:16px}
  .ver{font-size:11px;color:#64748B;font-weight:600;flex:0 0 auto}
  .chips{margin-left:auto;display:flex;align-items:center;gap:6px}
  .chip{
    font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;
    border:1px solid #22304C;color:#94A3B8;white-space:nowrap;flex:0 0 auto;
  }
  .chip.on{border-color:#10B981;color:#10B981}
  .chip.off{border-color:#D97706;color:#F59E0B}
  .chip.bad{border-color:#DC2626;color:#F87171}

  main{flex:1;display:flex;gap:11px;padding:10px 16px;min-height:0}

  /* 왼쪽 — 개체수가 가장 크다 */
  .left{flex:0 0 300px;display:flex;flex-direction:column;gap:9px;min-height:0}
  .cell{
    background:#111A2E;border:1px solid #22304C;border-radius:14px;
    padding:10px 18px;display:flex;flex-direction:column;justify-content:center;
  }
  .count{flex:1;min-height:0}
  .k{font-size:15px;color:#94A3B8;font-weight:600}
  .v{font:800 76px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;
     margin-top:6px;letter-spacing:-.03em}
  .v small{font-size:22px;font-weight:600;color:#94A3B8;margin-left:7px}
  .v.stale{color:#64748B}
  .v.none{color:#475569;font-size:40px}
  .sub{margin-top:6px;font-size:12.5px;color:#64748B;font-weight:600}

  /* 추이 */
  .trend{flex:0 0 92px}
  .trend svg{width:100%;height:46px;margin-top:4px;display:block}

  /* 오른쪽 — 영상 */
  .right{flex:1;display:flex;flex-direction:column;gap:9px;min-width:0}
  .cam{
    flex:1;min-height:0;background:#111A2E;border:1px solid #22304C;border-radius:14px;
    overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;
  }
  .cam img{width:100%;height:100%;object-fit:contain;display:block}
  .cam .empty{color:#475569;font-size:14px;font-weight:600;text-align:center;
    padding:0 20px;line-height:1.7}
  /* 설치 직후 처음 보는 화면. 무엇을 해야 하는지가 가장 커야 한다 —
     구석의 작은 버튼으로는 아무도 연결을 시작하지 않는다. */
  .cta{text-align:center;padding:0 24px}
  .cta h2{font-size:19px;font-weight:800;color:#E8EDF7;margin-bottom:7px}
  .cta p{font-size:13.5px;color:#94A3B8;line-height:1.7;margin-bottom:17px}
  .cta button{font-size:15px;padding:14px 30px;min-height:50px}
  .camfoot{flex:0 0 auto;display:flex;align-items:center;gap:9px}
  .camname{font-size:13px;color:#94A3B8;font-weight:600;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .camname b{color:#E8EDF7}
  button{
    font:700 13px/1 inherit;padding:11px 15px;min-height:42px;border-radius:10px;
    border:1px solid #22304C;background:#16223C;color:#CBD5E1;cursor:pointer;flex:0 0 auto;
  }
  button:active{background:#1E2B4A}
  button.primary{border-color:#1E40AF;background:#1E40AF;color:#fff}
  .spacer{margin-left:auto}

  /* 업데이트가 되돌려졌을 때의 표시. 시뮬레이션 경고만큼 크게 띄우지는
     않는다 — 장비는 멀쩡히 돌고 있고(이전 버전으로), 측정도 계속된다. */
  .warn{color:#FBBF24;font-weight:700}

  /* 시뮬레이션 경고 띠 — 숨기지 않는다 */
  .simbar{
    flex:0 0 auto;margin:0 16px 10px;padding:9px 14px;border-radius:12px;
    border:1px solid #D97706;background:#D9770620;
    display:flex;align-items:center;gap:11px;
  }
  .simbar .t{font-size:13.5px;font-weight:800;color:#FBBF24;flex:0 0 auto}
  .simbar .r{font-size:12px;color:#CBD5E1;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}

  /* 덮개 화면 (페어링) */
  .overlay{
    position:fixed;inset:0;background:#0B1120;z-index:30;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:0 40px;text-align:center;
  }
  .overlay h1{font-size:27px;font-weight:800;margin-bottom:7px}
  .overlay p{color:#93A4BF;font-size:15px;margin-bottom:16px;line-height:1.6}
  .code{
    font:800 62px/1 ui-monospace,monospace;letter-spacing:.14em;
    color:#60A5FA;margin:2px 0 14px;
  }
  .steps{text-align:left;font-size:13.5px;color:#CBD5E1;line-height:2;
    margin-bottom:16px;max-width:560px}
  .steps b{color:#fff}
  .ttl{font-size:12px;color:#64748B;font-weight:700;margin-bottom:14px}
  .orow{display:flex;gap:9px}

  /* 범위 설정 — 화면 위에 네모를 긋는다 */
  .tune{position:fixed;inset:0;background:#0B1120;z-index:40;display:flex;
    flex-direction:column;padding:10px 14px;gap:8px}
  .tune .th{display:flex;align-items:center;gap:10px;flex:0 0 auto}
  .tune .th b{font-size:16px}
  .tune .th span{font-size:12.5px;color:#93A4BF}
  .tune .stage{position:relative;flex:1 1 auto;min-height:0;
    display:flex;align-items:center;justify-content:center;background:#000;
    border-radius:10px;overflow:hidden;touch-action:none}
  .tune .stage img{max-width:100%;max-height:100%;display:block;
    -webkit-user-select:none;user-select:none;-webkit-user-drag:none}
  /* 바깥은 어둡게 덮어, 세는 영역이 한눈에 보이게 한다 */
  .tune .shade{position:absolute;background:rgba(2,6,23,.66);pointer-events:none}
  .tune .calbox{position:absolute;border:2px dashed #FBBF24;pointer-events:none}
  .tune .box{position:absolute;border:2px solid #34D399;pointer-events:none;
    box-shadow:0 0 0 9999px rgba(2,6,23,0)}
  .tune .tf{display:flex;align-items:center;gap:9px;flex:0 0 auto}
  .tune .tf label{font-size:12.5px;color:#93A4BF}
  .tune input[type=range]{flex:1 1 auto;height:34px}
  .tune .cv{font:800 15px/1 ui-monospace,monospace;color:#60A5FA;min-width:46px;
    text-align:right}
</style>
</head>
<body>

<header>
  <div class="mark">🦐</div>
  <div class="brand">Shrimp365</div>
  <div class="ver" id="ver"></div>
  <div class="chips" id="chips"></div>
</header>

<main>
  <div class="left">
    <div class="cell count">
      <div class="k">현재 개체수</div>
      <div class="v none" id="count">—</div>
      <div class="sub" id="countsub"></div>
    </div>
    <div class="cell trend">
      <div class="k" style="font-size:13px">최근 30분</div>
      <svg id="spark" viewBox="0 0 280 46" preserveAspectRatio="none"></svg>
    </div>
  </div>

  <div class="right">
    <div class="cam" id="cam">
      <div class="empty" id="camempty">카메라가 아직 시작되지 않았습니다</div>
    </div>
    <div class="camfoot">
      <div class="camname" id="camname"></div>
      <div class="spacer"></div>
      <button id="tunebtn" onclick="openTune()">범위 설정</button>
      <button id="pairbtn" onclick="startPair()">기기 연결</button>
    </div>
  </div>
</main>

<div id="simbar"></div>
<div id="overlay"></div>

<script>
function esc(s){ return String(s==null?"":s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

var imgOn = false;
// "live"(영상) 또는 "empty"(안내 문구). HTML 이 안내 문구로 시작하므로 empty.
var camMode = "empty";

function drawSpark(points){
  var svg = document.getElementById("spark");
  if (!points || points.length < 2) { svg.innerHTML = ""; return; }
  var vals = points.map(function(p){ return p[1]; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (hi === lo) { hi = lo + 1; }
  var n = points.length;
  var d = "";
  for (var i = 0; i < n; i++) {
    var x = 26 + (i / (n - 1)) * 254;  // 왼쪽 26px 은 최대·최소 눈금 자리
    var y = 44 - ((vals[i] - lo) / (hi - lo)) * 40;
    d += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  svg.innerHTML =
    '<path d="' + d + '" fill="none" stroke="#60A5FA" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
    '<text x="0" y="10" fill="#475569" font-size="9" font-weight="700">' + hi + '</text>' +
    '<text x="0" y="44" fill="#475569" font-size="9" font-weight="700">' + lo + '</text>';
}

function render(d){
  // 버전은 머리말에 둔다. 아래 카메라 줄은 이름이 길면 말줄임으로 잘려,
  // 정작 봐야 할 때 안 보인다(그 줄에 붙였다가 화면에서 확인하고 옮겼다).
  var vtxt = "v" + esc(d.version);
  // 되돌려졌거나 거부된 경우만 덧붙인다. 잘 올라간 것까지 적으면 늘 무언가
  // 떠 있게 되어, 정작 문제가 생겼을 때 눈에 띄지 않는다.
  if (d.update && (d.update.status === "rolled_back" || d.update.status === "rejected")) {
    vtxt += ' <span class="warn">· 업데이트 '
         + (d.update.status === "rolled_back" ? "되돌림" : "거부됨") + '</span>';
  }
  document.getElementById("ver").innerHTML = vtxt;

  // ── 상태 칩 ──
  var chips = "";
  if (d.simulation) chips += '<span class="chip bad">시뮬레이션</span>';
  if (d.camera) {
    var cls = d.camera.status === "running" ? "on" : "off";
    var label = d.camera.status === "running" ? "촬영 중"
              : d.camera.status === "offline" ? "신호 없음" : "정지";
    chips += '<span class="chip ' + cls + '">' + label + '</span>';
  } else {
    chips += '<span class="chip off">카메라 없음</span>';
  }
  if (d.pairing.linked) {
    // 끊긴 동안 보관 건수를 함께 보여 준다 — 값이 사라지는 중이 아니라는
    // 것을 농장에서 눈으로 확인할 수 있어야 한다.
    var slabel = d.server_ok === false ? "서버 끊김" : "연결됨";
    if (d.server_ok === false && d.pending_uploads > 0)
      slabel += " · " + d.pending_uploads + "건 보관";
    chips += '<span class="chip ' + (d.server_ok === false ? "off" : "on") + '">' +
      slabel + '</span>';
  } else {
    chips += '<span class="chip off">미연결</span>';
  }
  document.getElementById("chips").innerHTML = chips;

  // ── 개체수 ──
  var el = document.getElementById("count");
  if (d.count == null) {
    el.className = "v none"; el.textContent = "—";
    document.getElementById("countsub").textContent =
      d.camera ? "첫 측정을 기다리고 있습니다" : "수조에 연결하면 셉니다";
  } else {
    // 값이 오래되면 지금 값인 것처럼 보이지 않게 흐리게 둔다.
    var stale = d.count_age != null && d.count_age > 30;
    el.className = "v" + (stale ? " stale" : "");
    el.innerHTML = esc(d.count) + '<small>마리</small>';
    var bits = [];
    if (d.count_age != null) bits.push(stale ? (d.count_age + "초 전 값") : "방금");
    if (d.confidence != null) bits.push("신뢰도 " + Math.round(d.confidence * 100) + "%");
    // 길이 기준(먹이망 격자)을 잡아 두었을 때만 나온다. "추정" 을 붙이는 것은
    // 상자에서 잰 값이라 자를 댄 값이 아니기 때문이다 — 비스듬히 누운 새우는
    // 상자가 몸보다 커서 최대 두께만큼 길게 나온다.
    if (d.length_cm != null) bits.push("추정 체장 " + d.length_cm.toFixed(1) + "cm");
    document.getElementById("countsub").textContent = bits.join(" · ");
  }

  drawSpark(d.history);

  // ── 영상 ──
  // 프레임이 생긴 뒤에 <img> 를 붙인다. 먼저 붙이면 204 응답 때문에
  // 깨진 이미지 아이콘이 뜬다.
  var cam = document.getElementById("cam");
  if (d.camera && d.camera.status === "running") {
    if (camMode !== "live") {
      cam.innerHTML = '<img id="live" alt="">';
      camMode = "live"; imgOn = true;
      pollFrame();
    }
  } else {
    // 왜 문구까지 비교하나: 처음 그릴 때 camMode 는 이미 "empty" 다(HTML 에
    // 자리글이 박혀 있다). 모드만 보면 "연결되지 않았습니다" 로 바꿀 기회가
    // 영영 없어, 연결 전 장비에 엉뚱한 안내가 그대로 남는다.
    var msg = d.camera ? "카메라에서 신호가 오지 않습니다"
                       : "이 장비는 아직 수조에 연결되지 않았습니다";
    var cur = document.getElementById("camempty");
    if (camMode !== "empty" || !cur || cur.getAttribute("data-msg") !== msg) {
      var inner;
      if (!d.pairing.linked) {
        // 설치 직후. 다음에 할 일을 화면 한가운데에 둔다.
        inner = '<div class="cta" id="camempty" data-msg="' + esc(msg) + '">' +
          '<h2>이 카메라를 수조에 연결하세요</h2>' +
          '<p>아래 버튼을 누르면 6자리 코드가 나옵니다.<br>' +
          'Shrimp365에 그 코드를 넣으면 연결이 끝납니다.</p>' +
          '<button class="primary" onclick="startPair()">기기 연결 시작</button></div>';
      } else {
        inner = '<div class="empty" id="camempty" data-msg="' + esc(msg) + '">' +
          esc(msg) + '</div>';
      }
      cam.innerHTML = inner;
      camMode = "empty"; imgOn = false;
    }
  }

  var nm = "";
  if (d.camera && d.camera.name) nm = '<b>' + esc(d.camera.name) + '</b>';
  if (d.pairing.tank_name) nm += (nm ? " · " : "") + esc(d.pairing.tank_name);
  if (!nm) nm = '시리얼 ' + esc(d.pairing.serial);
  nm += ' · ' + esc(d.model);
  document.getElementById("camname").innerHTML = nm;

  document.getElementById("pairbtn").textContent =
    d.pairing.linked ? "기기 재연결" : "기기 연결";

  // ── 시뮬레이션 경고 ──
  document.getElementById("simbar").innerHTML = d.simulation
    ? '<div class="simbar"><div class="t">⚠ 이 개체수는 가짜입니다</div>' +
      '<div class="r">' + esc(d.simulation_reason || "") + '</div></div>'
    : "";

  renderOverlay(d.pairing, d.public_url);
}

function renderOverlay(p, url){
  var o = document.getElementById("overlay");
  var host = (url || "www.shrimp365.kr").replace(/^https?:\\/\\//, "").replace(/\\/$/, "");

  if (p.status === "idle" || p.status === "linked") { o.innerHTML = ""; return; }

  if (p.status === "requesting") {
    o.innerHTML = '<div class="overlay"><h1>연결 코드를 받는 중…</h1>' +
      '<p>잠시만 기다려 주세요</p></div>';
    return;
  }
  if (p.status === "failed") {
    o.innerHTML = '<div class="overlay"><h1>연결 코드를 받지 못했습니다</h1>' +
      '<p>' + esc(p.error || "") + '</p>' +
      '<div class="orow"><button class="primary" onclick="startPair()">다시 시도</button>' +
      '<button onclick="cancelPair()">닫기</button></div></div>';
    return;
  }
  if (p.status === "expired") {
    o.innerHTML = '<div class="overlay"><h1>코드가 만료되었습니다</h1>' +
      '<p>15분이 지나면 코드를 다시 받아야 합니다</p>' +
      '<div class="orow"><button class="primary" onclick="startPair()">새 코드 받기</button>' +
      '<button onclick="cancelPair()">닫기</button></div></div>';
    return;
  }
  // waiting
  var mm = "", s = p.expires_in;
  if (s != null) {
    mm = Math.floor(s / 60) + "분 " + String(s % 60).padStart(2, "0") + "초 남음";
  }
  o.innerHTML = '<div class="overlay">' +
    '<h1>이 카메라를 수조에 연결해 주세요</h1>' +
    '<p>Shrimp365에 로그인한 뒤 아래 코드를 입력하세요</p>' +
    '<div class="code">' + esc((p.code || "").split("").join(" ")) + '</div>' +
    '<div class="ttl">' + esc(mm) + '</div>' +
    '<div class="steps">' +
      '1. 휴대폰이나 PC 에서 <b>' + esc(host) + '</b> 접속<br>' +
      '2. 로그인 → <b>개체수</b> → <b>설정</b><br>' +
      '3. <b>카메라 연결</b> → 위 6자리 코드 입력<br>' +
      '4. 이 카메라를 붙일 <b>수조</b> 선택' +
    '</div>' +
    '<div class="orow"><button onclick="cancelPair()">취소</button></div></div>';
}

// ── 범위 설정 ────────────────────────────────────────────────────────────
// 모델은 클래스가 "새우" 하나뿐이라 수조 바깥의 철망·배관까지 센다. 카메라가
// 고정되어 있으므로 셀 영역을 한 번만 그으면 그 뒤로는 손댈 일이 없다.
// 웹이 아니라 **이 화면**에 둔 이유는 간단하다 — 영상이 여기에만 있다.
var tuneBox = null;      // [x1,y1,x2,y2] 비율 — 세는 범위
var tuneCal = null;      // [x1,y1,x2,y2] 비율 — 격자를 덮은 네모
var tuneDrag = null;
var tuneConf = null;
var tuneMode = "roi";    // "roi" 또는 "cal"
var tuneCells = [1, 1];  // 격자 몇 칸을 덮었나
var tuneCellCm = [8, 7.5];
var tuneScale = null;

function openTune(){
  fetch("/api/tuning").then(function(r){ return r.json(); }).then(function(d){
    if(!d.camera){ alert("카메라가 아직 없습니다."); return; }
    tuneBox = d.roi;
    tuneConf = d.min_conf == null ? d.base_conf : d.min_conf;
    tuneScale = d.px_per_cm;
    tuneCellCm = d.cell_cm || [8, 7.5];
    tuneCal = null; tuneMode = "roi"; tuneCells = [1, 1];
    drawTune();
  });
}
function closeTune(){
  var el = document.getElementById("tune");
  if(el) el.remove();
  tuneDrag = null;
}
function drawTune(){
  var el = document.getElementById("tune");
  if(!el){
    el = document.createElement("div");
    el.id = "tune"; el.className = "tune";
    document.body.appendChild(el);
    el.innerHTML =
      '<div class="th"><b id="tmode">세는 범위</b>' +
      '<span id="thelp"></span>' +
      '<div style="flex:1"></div>' +
      '<button id="tswap" onclick="swapTune()"></button>' +
      '<button onclick="clearTune()">지우기</button>' +
      '<button onclick="closeTune()">닫기</button>' +
      '<button class="primary" onclick="saveTune()">저장</button></div>' +
      '<div class="stage" id="tstage"><img id="timg" alt=""></div>' +
      '<div class="tf" id="trow"></div>';
    var stage = el.querySelector("#tstage");
    stage.addEventListener("pointerdown", tuneDown);
    stage.addEventListener("pointermove", tuneMove);
    stage.addEventListener("pointerup", tuneUp);
    stage.addEventListener("pointercancel", tuneUp);
  }
  el.querySelector("#timg").src = "/frame.jpg?t=" + Date.now();
  renderTuneRow();
  paintTune();
}
/** 머리말과 아래칸을 지금 모드에 맞게 다시 그린다. */
function renderTuneRow(){
  var el = document.getElementById("tune");
  if(!el) return;
  var cal = tuneMode === "cal";
  el.querySelector("#tmode").textContent = cal ? "길이 기준 잡기" : "세는 범위";
  el.querySelector("#thelp").textContent = cal
    ? "먹이망 격자를 손가락으로 덮고, 덮은 칸 수를 적으세요."
    : "수조 안쪽을 손가락으로 그으세요. 바깥은 세지 않습니다.";
  el.querySelector("#tswap").textContent = cal ? "범위 설정으로" : "길이 기준 잡기";
  var row = el.querySelector("#trow");
  if(cal){
    row.innerHTML =
      '<label>덮은 칸</label>' +
      '<input id="tcx" type="number" min="1" max="20" style="width:64px">' +
      '<span style="color:#64748B">× 세로</span>' +
      '<input id="tcy" type="number" min="1" max="20" style="width:64px">' +
      '<span style="color:#64748B">칸 (한 칸 ' + tuneCellCm[0] +
        ' × ' + tuneCellCm[1] + ' cm)</span>' +
      '<div style="flex:1"></div><div class="cv" id="tscale"></div>';
    row.querySelector("#tcx").value = tuneCells[0];
    row.querySelector("#tcy").value = tuneCells[1];
    row.querySelector("#tcx").addEventListener("input", calcScale);
    row.querySelector("#tcy").addEventListener("input", calcScale);
    calcScale();
  } else {
    row.innerHTML =
      '<label>최소 신뢰도</label>' +
      '<input type="range" id="tconf" min="0.2" max="0.9" step="0.05">' +
      '<div class="cv" id="tconfv"></div>';
    var sl = row.querySelector("#tconf");
    sl.value = tuneConf;
    row.querySelector("#tconfv").textContent = Number(tuneConf).toFixed(2);
    sl.addEventListener("input", function(){
      tuneConf = parseFloat(sl.value);
      document.getElementById("tconfv").textContent = tuneConf.toFixed(2);
    });
  }
}
function swapTune(){
  tuneMode = tuneMode === "cal" ? "roi" : "cal";
  renderTuneRow();
  paintTune();
}
/** 덮은 네모와 칸 수로 1 cm 가 몇 픽셀인지 미리 보여 준다. */
function calcScale(){
  var el = document.getElementById("tune");
  var cx = parseInt((el.querySelector("#tcx")||{}).value, 10);
  var cy = parseInt((el.querySelector("#tcy")||{}).value, 10);
  tuneCells = [cx > 0 ? cx : 1, cy > 0 ? cy : 1];
  var out = el.querySelector("#tscale");
  if(!tuneCal || !out){ if(out) out.textContent = "—"; return; }
  var img = document.getElementById("timg");
  // 화면에 그려진 크기가 아니라 **원본 프레임 픽셀**로 환산해야 한다.
  var nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
  var wpx = (tuneCal[2]-tuneCal[0]) * nw, hpx = (tuneCal[3]-tuneCal[1]) * nh;
  var sx = wpx / (tuneCells[0] * tuneCellCm[0]);
  var sy = hpx / (tuneCells[1] * tuneCellCm[1]);
  out.textContent = sx.toFixed(1) + " / " + sy.toFixed(1) + " px·cm";
}
/** 이미지가 실제로 그려진 사각형. 레터박스(남는 여백)를 빼야 좌표가 맞는다. */
function imgRect(){
  var img = document.getElementById("timg");
  var s = document.getElementById("tstage").getBoundingClientRect();
  var r = img.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
}
function paintTune(){
  var el = document.getElementById("tune");
  if(!el) return;
  var old = el.querySelectorAll(".box,.shade,.calbox");
  for(var i=0;i<old.length;i++) old[i].remove();
  var r = imgRect();
  // 기준 네모는 어느 모드에서나 보여 준다 — 범위를 그을 때도 어디를 쟀는지
  // 보여야 "저 격자 기준으로 재는구나" 가 전달된다.
  if(tuneCal){
    var c = document.createElement("div");
    c.className = "calbox";
    c.style.left=(r.x + tuneCal[0]*r.w)+"px"; c.style.top=(r.y + tuneCal[1]*r.h)+"px";
    c.style.width=((tuneCal[2]-tuneCal[0])*r.w)+"px";
    c.style.height=((tuneCal[3]-tuneCal[1])*r.h)+"px";
    document.getElementById("tstage").appendChild(c);
  }
  if(!tuneBox) return;
  var x1 = r.x + tuneBox[0]*r.w, y1 = r.y + tuneBox[1]*r.h;
  var x2 = r.x + tuneBox[2]*r.w, y2 = r.y + tuneBox[3]*r.h;
  var stage = document.getElementById("tstage");
  function shade(l,t,w,h){
    if(w<=0||h<=0) return;
    var d = document.createElement("div");
    d.className = "shade";
    d.style.left=l+"px"; d.style.top=t+"px"; d.style.width=w+"px"; d.style.height=h+"px";
    stage.appendChild(d);
  }
  shade(r.x, r.y, r.w, y1-r.y);
  shade(r.x, y2, r.w, r.y+r.h-y2);
  shade(r.x, y1, x1-r.x, y2-y1);
  shade(x2, y1, r.x+r.w-x2, y2-y1);
  var b = document.createElement("div");
  b.className = "box";
  b.style.left=x1+"px"; b.style.top=y1+"px";
  b.style.width=(x2-x1)+"px"; b.style.height=(y2-y1)+"px";
  stage.appendChild(b);
}
function tunePos(e){
  var r = imgRect();
  var s = document.getElementById("tstage").getBoundingClientRect();
  var x = (e.clientX - s.left - r.x) / r.w;
  var y = (e.clientY - s.top - r.y) / r.h;
  return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
}
function tuneDown(e){ tuneDrag = tunePos(e); e.preventDefault(); }
function tuneMove(e){
  if(!tuneDrag) return;
  var p = tunePos(e);
  var box = [Math.min(tuneDrag[0],p[0]), Math.min(tuneDrag[1],p[1]),
             Math.max(tuneDrag[0],p[0]), Math.max(tuneDrag[1],p[1])];
  if(tuneMode === "cal"){ tuneCal = box; calcScale(); } else { tuneBox = box; }
  paintTune();
}
function tuneUp(){ tuneDrag = null; }
function clearTune(){
  if(tuneMode === "cal"){ tuneCal = null; tuneScale = null; calcScale(); }
  else tuneBox = null;
  paintTune();
}
function saveTune(){
  var payload = { roi: tuneBox, min_conf: tuneConf };
  if(tuneCal){
    // 원본 프레임 픽셀로 보낸다. 화면에 그려진 크기로 보내면 모니터가 바뀔 때
    // 축척이 통째로 틀어진다.
    var img = document.getElementById("timg");
    var nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    payload.calibration = {
      w_px: (tuneCal[2]-tuneCal[0]) * nw, h_px: (tuneCal[3]-tuneCal[1]) * nh,
      cells_x: tuneCells[0], cells_y: tuneCells[1] };
  }
  fetch("/api/tuning", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)})
    .then(function(r){ return r.json(); })
    .then(function(){ closeTune(); tick(); });
}

function startPair(){ fetch("/api/pair/start", {method:"POST"}).then(tick); }
function cancelPair(){ fetch("/api/pair/cancel", {method:"POST"}).then(tick); }

// MJPEG 대신 1초에 한 장씩 받는다. 추론이 초당 한 번이라 더 받을 것도 없고,
// 크로미움의 multipart 스트림은 파이에서 메모리를 계속 물고 있는다.
function pollFrame(){
  if (!imgOn) return;
  var img = document.getElementById("live");
  if (img) img.src = "/frame.jpg?t=" + Date.now();
  setTimeout(pollFrame, 1000);
}

function tick(){
  fetch("/api/state", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(render)
    .catch(function(){});
}
tick();
setInterval(tick, 1000);
</script>
</body>
</html>
"""
