"""Registry of running camera stream processors (start/stop/status/watchdog)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid

from sqlalchemy import select, update

from app.config import settings
from app.database import SessionLocal, utcnow
from app.models import Camera, Tank
from app.services.stream_service import CameraSnapshot, CameraStreamProcessor, frame_store

logger = logging.getLogger(__name__)

# 살아 있음 보고 주기(초). 화면의 "마지막 응답" 표시에 쓴다.
HEARTBEAT_INTERVAL_SECONDS = 60
AGENT_VERSION = "1.0.0"


class MaxCamerasReachedError(RuntimeError):
    pass


class ForeignCameraError(RuntimeError):
    """다른 장비에 물린 카메라를 이 서비스에서 열려고 한 경우."""


def owns_camera(camera: Camera) -> bool:
    """이 장비가 맡는 카메라인가.

    CSI 카메라는 보드에 리본으로 직접 붙어 있어 그 보드에서만 열린다. 장비가
    여러 대인데 이 확인이 없으면, 각 장비가 DB 의 모든 카메라를 열려 들고
    남의 카메라를 못 잡아 영원히 재시도한다.

    판정은 페어링 때 받은 기기 키로 한다. 사람이 이름을 옮겨 적는 방식이면
    오타 하나로 같은 증상이 나고, 그때는 원인이 보이지 않는다.

    기기 키가 없으면(시뮬레이션·개발) 전부 내 것으로 본다 — 장비 하나로
    시연하는 자리에까지 페어링을 강제할 이유가 없다.
    """
    if not settings.device_key:
        return True
    return camera.api_key == settings.device_key


class CameraManager:
    def __init__(self) -> None:
        self._processors: dict[uuid.UUID, CameraStreamProcessor] = {}
        self._watchdog_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None

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
        for name in ("_watchdog_task", "_heartbeat_task"):
            task = getattr(self, name)
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                setattr(self, name, None)

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
        # 내 것만 남긴다. 남의 카메라는 애초에 열 수 없다(위 owns_camera 주석).
        mine = [(camera, farm_id) for camera, farm_id in rows if owns_camera(camera)]
        skipped = len(rows) - len(mine)
        if skipped:
            logger.info("다른 장비의 카메라 %d대는 건너뜁니다.", skipped)
        started = 0
        for camera, farm_id in mine:
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
        if self._heartbeat_task is None:
            self._heartbeat_task = asyncio.create_task(
                self._heartbeat(), name="camera-heartbeat"
            )

    async def _heartbeat(self) -> None:
        """돌고 있는 카메라의 last_seen_at 을 주기적으로 찍는다.

        화면에서 "이 장비가 살아 있나"를 보려면 필요하다. 개체수 기록만으로는
        구분이 안 된다 — 카메라가 멈춰도 마지막 기록은 남아 있기 때문이다.

        1분에 한 번이면 충분하다. 프레임마다 쓰면 초당 한 번씩 같은 행을
        갱신하게 되어 DB 만 시끄러워진다.
        """
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            running = list(self._processors)
            if not running:
                continue
            try:
                async with SessionLocal() as session:
                    await session.execute(
                        update(Camera)
                        .where(Camera.id.in_(running))
                        .values(last_seen_at=utcnow(), agent_version=AGENT_VERSION)
                    )
                    await session.commit()
            except Exception as exc:  # noqa: BLE001 - 보고 실패가 추론을 멈추면 안 된다
                logger.debug("살아 있음 보고 실패: %s", exc)

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
