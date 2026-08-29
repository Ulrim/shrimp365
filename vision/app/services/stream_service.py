"""Per-camera stream processing loop and the in-memory frame/count caches.

Pipeline per tick (at the camera's fps_target):
    grab frame -> detect -> annotate -> JPEG -> ring buffer -> DB insert
    -> latest-count cache -> WebSocket count_update -> alert evaluation
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from app.config import settings, simulation_mode_active
from app.database import SessionLocal, utcnow
from app.models import Camera, CountRecord
from app.services.broadcaster import broadcaster
from app.services.camera_source import CameraSource, PiCameraSource, SimulatedCamera
from app.services.detector import ShrimpDetector, SimulatedDetector, TankSimulation
from app.services.rendering import annotate_frame, encode_jpeg

logger = logging.getLogger(__name__)


@dataclass
class LatestCount:
    camera_id: uuid.UUID
    tank_id: uuid.UUID
    farm_id: uuid.UUID
    timestamp: datetime
    count: int
    confidence_avg: float | None


class FrameStore:
    """Latest annotated JPEG frames + counts, kept in process memory."""

    def __init__(self) -> None:
        self._frames: dict[uuid.UUID, deque[bytes]] = {}
        self._events: dict[uuid.UUID, asyncio.Event] = {}
        self._latest: dict[uuid.UUID, LatestCount] = {}

    def push_frame(self, camera_id: uuid.UUID, jpeg: bytes) -> None:
        buf = self._frames.setdefault(camera_id, deque(maxlen=settings.frame_buffer_size))
        buf.append(jpeg)
        event = self._events.setdefault(camera_id, asyncio.Event())
        event.set()

    def latest_frame(self, camera_id: uuid.UUID) -> bytes | None:
        buf = self._frames.get(camera_id)
        return buf[-1] if buf else None

    async def wait_for_frame(self, camera_id: uuid.UUID, timeout: float = 5.0) -> bytes | None:
        event = self._events.setdefault(camera_id, asyncio.Event())
        event.clear()
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(event.wait(), timeout)
        return self.latest_frame(camera_id)

    def set_latest_count(self, latest: LatestCount) -> None:
        self._latest[latest.camera_id] = latest

    def latest_count(self, camera_id: uuid.UUID) -> LatestCount | None:
        return self._latest.get(camera_id)

    def clear_camera(self, camera_id: uuid.UUID) -> None:
        self._frames.pop(camera_id, None)
        self._latest.pop(camera_id, None)
        self._events.pop(camera_id, None)


frame_store = FrameStore()


@dataclass
class CameraSnapshot:
    """Immutable copy of camera config used by the processor task.

    farm_id 는 카메라 행에 없다 — 카메라는 수조에 매달려 있고 수조가 양식장에
    속한다. 매 프레임 조인하지 않도록 스트림을 시작할 때 한 번 풀어서 들고
    간다(camera_manager.start_camera).
    """

    id: uuid.UUID
    tank_id: uuid.UUID
    farm_id: uuid.UUID
    name: str
    camera_type: str
    stream_url: str | None
    fps_target: float
    # CSI 카메라는 해상도를 우리가 정해서 열어야 한다(URL 이 없다).
    resolution_w: int = 1280
    resolution_h: int = 720

    @classmethod
    def from_model(cls, camera: Camera, farm_id: uuid.UUID) -> CameraSnapshot:
        return cls(
            id=camera.id,
            tank_id=camera.tank_id,
            farm_id=farm_id,
            name=camera.name,
            camera_type=camera.camera_type,
            stream_url=camera.stream_url,
            fps_target=camera.fps_target,
            resolution_w=camera.resolution_w,
            resolution_h=camera.resolution_h,
        )


class CameraStreamProcessor:
    """Asyncio task processing one camera's stream."""

    def __init__(self, camera: CameraSnapshot) -> None:
        self.camera = camera
        self.status: str = "running"
        self.status_message: str | None = None
        self.last_frame_at: float | None = None
        self.simulation_mode = simulation_mode_active()
        self._task: asyncio.Task | None = None
        self._stopping = False
        # EMA of raw counts ("stable count") — alert engine input only; the
        # raw count is what gets stored and broadcast (WS contract unchanged).
        self._count_ema: float | None = None
        self._tracking_fallback_logged = False

        if self.simulation_mode:
            sim = TankSimulation(seed=str(camera.id))
            self.source = SimulatedCamera(sim)
            self.detector = SimulatedDetector(sim)
        else:
            # CSI 카메라(라즈베리파이 전용)는 libcamera 라 다른 길로 연다.
            if camera.camera_type == "picamera":
                self.source = PiCameraSource(camera.resolution_w, camera.resolution_h)
            else:
                self.source = CameraSource(camera.camera_type, camera.stream_url)
            self.detector = ShrimpDetector()

    # -- lifecycle ------------------------------------------------------------
    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"stream-{self.camera.id}")

    async def stop(self) -> None:
        self._stopping = True
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        self.source.release()
        self.status = "offline"
        await self._broadcast_status("offline", "스트림이 중지되었습니다.")

    # -- main loop --------------------------------------------------------------
    async def _run(self) -> None:
        # Honor fractional FPS (contract: 0.5 - 5). Cap at 5 processed fps.
        interval = 1.0 / min(max(self.camera.fps_target, 0.1), 5.0)
        await self._broadcast_status("running", "스트림 추론을 시작했습니다.")
        while not self._stopping:
            tick_start = time.monotonic()
            try:
                await self._process_one_tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Stream tick failed for camera %s", self.camera.id)
                if self.status != "error":
                    self.status = "error"
                    await self._broadcast_status("error", "프레임 처리 중 오류가 발생했습니다.")
            elapsed = time.monotonic() - tick_start
            await asyncio.sleep(max(interval - elapsed, 0.01))

    async def _process_one_tick(self) -> None:
        frame = await self.source.read()
        if frame is None:
            await self._handle_no_frame()
            return

        self.last_frame_at = time.monotonic()
        if self.status != "running":
            self.status = "running"
            await self._broadcast_status("running", "카메라 연결이 복구되었습니다.")

        if self.simulation_mode:
            result = self._run_detection(frame)
        else:
            bgr = np.asarray(frame)[:, :, ::-1]
            result = await asyncio.to_thread(self._run_detection, bgr)
        stable_count = self._update_stable_count(result.count)

        now = utcnow()
        annotated = annotate_frame(frame, result, self.camera.name, now)
        frame_store.push_frame(self.camera.id, encode_jpeg(annotated))

        async with SessionLocal() as session:
            session.add(
                CountRecord(
                    time=now,
                    camera_id=self.camera.id,
                    tank_id=self.camera.tank_id,
                    farm_id=self.camera.farm_id,
                    count=result.count,
                    confidence_avg=result.confidence_avg,
                    model_version=result.model_version,
                    inference_ms=result.inference_ms,
                )
            )
            await session.commit()

            frame_store.set_latest_count(
                LatestCount(
                    camera_id=self.camera.id,
                    tank_id=self.camera.tank_id,
                    farm_id=self.camera.farm_id,
                    timestamp=now,
                    count=result.count,
                    confidence_avg=result.confidence_avg,
                )
            )

            await broadcaster.publish(
                {
                    "type": "count_update",
                    "camera_id": str(self.camera.id),
                    "timestamp": now.isoformat(),
                    "count": result.count,
                    "confidence_avg": result.confidence_avg,
                    "bbox_count": len(result.bboxes),
                    # Frame-pixel boxes for the frontend canvas overlay
                    # (payload capped to keep WS messages sane).
                    "bboxes": [
                        {
                            "x1": round(b.x1, 1),
                            "y1": round(b.y1, 1),
                            "x2": round(b.x2, 1),
                            "y2": round(b.y2, 1),
                            "confidence": round(b.confidence, 3),
                        }
                        for b in result.bboxes[:400]
                    ],
                    "frame_width": result.frame_width,
                    "frame_height": result.frame_height,
                    "inference_ms": result.inference_ms,
                }
            )

            # Alert evaluation runs in the same session/tick. It gets the
            # EMA-smoothed count to damp single-frame detection flicker that
            # would otherwise cause false drop/spike alerts.
            from app.services.alert_service import alert_service

            await alert_service.process_count(
                session, self.camera, count=stable_count, timestamp=now
            )

    # -- detection helpers -------------------------------------------------------
    def _run_detection(self, frame):  # noqa: ANN001 - PIL Image or np.ndarray
        """detect_with_tracking when enabled, falling back to plain detect().

        A tracking failure is logged once per camera; afterwards the fallback
        stays silent (but tracking is retried every tick, so a transient
        failure heals itself).
        """
        if settings.use_tracking:
            try:
                return self.detector.detect_with_tracking(frame)
            except Exception:
                if not self._tracking_fallback_logged:
                    self._tracking_fallback_logged = True
                    logger.exception(
                        "Tracking failed for camera %s; falling back to detect()",
                        self.camera.id,
                    )
        return self.detector.detect(frame)

    def _update_stable_count(self, raw_count: int) -> int:
        """Exponential moving average over recent counts (flicker damping)."""
        alpha = min(max(settings.count_smoothing_alpha, 0.01), 1.0)
        if self._count_ema is None:
            self._count_ema = float(raw_count)
        else:
            self._count_ema = alpha * raw_count + (1 - alpha) * self._count_ema
        return int(round(self._count_ema))

    async def _handle_no_frame(self) -> None:
        failures = getattr(self.source, "consecutive_failures", 0)
        if failures >= 3 and self.status != "offline":
            self.status = "offline"
            await self._broadcast_status(
                "offline", "카메라 신호가 끊겼습니다. 재접속 시도 중입니다."
            )
            from app.services.alert_service import alert_service

            async with SessionLocal() as session:
                await alert_service.trigger_offline(session, self.camera)

    async def _broadcast_status(self, status: str, message: str) -> None:
        self.status_message = message
        await broadcaster.publish(
            {
                "type": "camera_status",
                "camera_id": str(self.camera.id),
                "status": status,
                "message": message,
            }
        )
