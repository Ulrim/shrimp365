"""Registry of running camera stream processors (start/stop/status/watchdog)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Camera, Tank
from app.services.stream_service import CameraSnapshot, CameraStreamProcessor, frame_store

logger = logging.getLogger(__name__)


class MaxCamerasReachedError(RuntimeError):
    pass


class CameraManager:
    def __init__(self) -> None:
        self._processors: dict[uuid.UUID, CameraStreamProcessor] = {}
        self._watchdog_task: asyncio.Task | None = None

    # -- lifecycle ------------------------------------------------------------
    def is_running(self, camera_id: uuid.UUID) -> bool:
        return camera_id in self._processors

    def processor(self, camera_id: uuid.UUID) -> CameraStreamProcessor | None:
        return self._processors.get(camera_id)

    async def start_camera(
        self, camera: Camera, farm_id: uuid.UUID
    ) -> CameraStreamProcessor:
        if camera.id in self._processors:
            return self._processors[camera.id]
        if len(self._processors) >= settings.max_cameras:
            raise MaxCamerasReachedError(
                f"동시 처리 가능한 카메라 수({settings.max_cameras}대)를 초과했습니다."
            )
        processor = CameraStreamProcessor(CameraSnapshot.from_model(camera, farm_id))
        self._processors[camera.id] = processor
        processor.start()
        logger.info("Started stream processor for camera %s (%s)", camera.name, camera.id)
        return processor

    async def stop_camera(self, camera_id: uuid.UUID) -> bool:
        processor = self._processors.pop(camera_id, None)
        if processor is None:
            return False
        await processor.stop()
        frame_store.clear_camera(camera_id)
        logger.info("Stopped stream processor for camera %s", camera_id)
        return True

    async def stop_all(self) -> None:
        for camera_id in list(self._processors):
            await self.stop_camera(camera_id)
        if self._watchdog_task:
            self._watchdog_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watchdog_task
            self._watchdog_task = None

    def status_of(self, camera_id: uuid.UUID) -> tuple[str, str | None]:
        """(status, message) for a camera; offline when no processor runs."""
        processor = self._processors.get(camera_id)
        if processor is None:
            return "offline", "스트림이 실행 중이 아닙니다."
        return processor.status, processor.status_message

    async def auto_start_active_cameras(self) -> int:
        """Start processors for all is_active cameras (used at startup).

        수조가 지워졌는데 카메라 행만 남는 경우는 외래키(ON DELETE CASCADE)가
        막아 주지만, 조인으로 함께 읽어 양식장 id 를 한 번에 푼다.
        """
        async with SessionLocal() as session:
            result = await session.execute(
                select(Camera, Tank.farm_id)
                .join(Tank, Tank.id == Camera.tank_id)
                .where(Camera.is_active.is_(True))
            )
            rows = result.all()
        started = 0
        for camera, farm_id in rows:
            try:
                await self.start_camera(camera, farm_id)
                started += 1
            except MaxCamerasReachedError:
                logger.warning("MAX_CAMERAS reached; not auto-starting %s", camera.id)
                break
        return started

    # -- offline watchdog -------------------------------------------------------
    def start_watchdog(self) -> None:
        if self._watchdog_task is None:
            self._watchdog_task = asyncio.create_task(self._watchdog(), name="camera-watchdog")

    async def _watchdog(self) -> None:
        from app.services.alert_service import alert_service

        while True:
            await asyncio.sleep(5)
            now = time.monotonic()
            for processor in list(self._processors.values()):
                stale = (
                    processor.last_frame_at is not None
                    and now - processor.last_frame_at > settings.offline_timeout_seconds
                )
                if stale and processor.status == "running":
                    processor.status = "offline"
                    await processor._broadcast_status(
                        "offline", "일정 시간 프레임이 수신되지 않았습니다."
                    )
                    async with SessionLocal() as session:
                        await alert_service.trigger_offline(session, processor.camera)


camera_manager = CameraManager()
