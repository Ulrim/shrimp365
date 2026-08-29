"""Frame sources: simulated tank renderer and real cv2.VideoCapture wrapper."""
from __future__ import annotations

import asyncio
import logging
import time

from PIL import Image

from app.services.detector import TankSimulation

logger = logging.getLogger(__name__)


class SimulatedCamera:
    """Renders top-view tank frames (1280x720) from a `TankSimulation`.

    Pure numpy + Pillow — works everywhere, no OpenCV required.
    """

    def __init__(self, simulation: TankSimulation) -> None:
        self.simulation = simulation

    async def read(self) -> Image.Image | None:
        self.simulation.step()
        return self.simulation.render()

    @property
    def is_open(self) -> bool:
        return True

    def release(self) -> None:  # symmetry with CameraSource
        return None


class CameraSource:
    """cv2.VideoCapture wrapper for usb / rtsp / http sources.

    - usb:  `stream_url` is a device index string ("0", "1", ...)
    - rtsp / http: `stream_url` is the full URL
    Auto-reconnects with exponential backoff; reports offline after repeated
    failures. cv2 is imported lazily so the app runs without the ml extra.
    """

    MAX_BACKOFF = 30.0

    def __init__(self, camera_type: str, stream_url: str | None) -> None:
        self.camera_type = camera_type
        self.stream_url = stream_url or "0"
        self._capture = None
        self._backoff = 1.0
        self._next_retry_at = 0.0
        self.consecutive_failures = 0

    def _source(self):
        if self.camera_type == "usb":
            try:
                return int(self.stream_url)
            except ValueError:
                return self.stream_url
        return self.stream_url

    def _open(self) -> bool:
        import cv2  # lazy: requires the `ml` extra

        if self._capture is not None:
            self._capture.release()
        self._capture = cv2.VideoCapture(self._source())
        return bool(self._capture.isOpened())

    @property
    def is_open(self) -> bool:
        return self._capture is not None and self._capture.isOpened()

    async def read(self) -> Image.Image | None:
        """Grab one frame; returns None while the source is unavailable."""
        now = time.monotonic()
        if not self.is_open:
            if now < self._next_retry_at:
                return None
            opened = await asyncio.to_thread(self._open)
            if not opened:
                self.consecutive_failures += 1
                self._next_retry_at = now + self._backoff
                self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)
                logger.warning(
                    "Camera source %s unavailable; retry in %.0fs",
                    self.stream_url,
                    self._backoff,
                )
                return None
            self._backoff = 1.0

        ok, frame = await asyncio.to_thread(self._capture.read)
        if not ok or frame is None:
            self.consecutive_failures += 1
            if self._capture is not None:
                self._capture.release()
                self._capture = None
            self._next_retry_at = time.monotonic() + self._backoff
            self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)
            return None

        self.consecutive_failures = 0
        # BGR (cv2) -> RGB PIL image for the Pillow-based pipeline.
        return Image.fromarray(frame[:, :, ::-1])

    def release(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None
