"""FastAPI application entrypoint (shrimp365 통합판).

Startup (lifespan): 스키마 확인 → 브로드캐스터(Redis 또는 인프로세스) 기동 →
활성 카메라 스트림 자동 시작.

이 서비스는 shrimp365 웹 컨테이너에서만 부른다. 외부에 직접 노출하지 않는다
(docker-compose 에서 포트를 호스트에 매핑하지 않는 이유).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.mjpeg import router as mjpeg_router
from app.api.v1.router import api_router
from app.api.websocket.stream import router as ws_router
from app.config import auto_start_streams_active, settings, simulation_mode_active
from app.database import init_db
from app.services.broadcaster import broadcaster
from app.services.camera_manager import camera_manager

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting shrimp365 vision service (simulation_mode=%s)", simulation_mode_active()
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
    if auto_start_streams_active():
        started = await camera_manager.auto_start_active_cameras()
        logger.info("Auto-started %d camera stream(s)", started)
    yield
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
