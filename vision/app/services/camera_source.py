"""Frame sources: 시뮬레이션 렌더러, 라즈베리파이 CSI 카메라, 일반 카메라.

카메라 종류에 따라 프레임을 가져오는 길이 완전히 다르다.

  · picamera — 라즈베리파이 전용 CSI 카메라(리본 케이블). **cv2.VideoCapture 로는
    열리지 않는다.** Bullseye 부터 카메라 스택이 libcamera 로 바뀌었고 OpenCV 는
    단순 V4L2 장치만 다루기 때문이다. picamera2 라이브러리를 써야 한다.
  · usb / rtsp / http — 일반 카메라. cv2.VideoCapture 로 연다.
"""
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


class PiCameraSource:
    """라즈베리파이 CSI 카메라(picamera2 / libcamera).

    picamera2 는 pip 로 깔지 않는다 — 라즈베리파이 OS 에 apt 로 들어 있는
    시스템 패키지다(`sudo apt install -y python3-picamera2`). 그래서 여기서
    지연 임포트하고, 없으면 이 종류의 카메라만 못 쓰고 나머지는 그대로 돈다.

    CameraSource 와 같은 인터페이스를 갖고 재연결도 같은 방식으로 한다 —
    스트림 처리 루프는 어느 쪽이 붙어 있는지 몰라도 된다.
    """

    MAX_BACKOFF = 30.0

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width = width
        self.height = height
        self._camera = None
        self._backoff = 1.0
        self._next_retry_at = 0.0
        self.consecutive_failures = 0

    def _open(self) -> bool:
        from picamera2 import Picamera2  # lazy: 라즈베리파이 OS 시스템 패키지

        if self._camera is not None:
            self._camera.close()
        camera = Picamera2()
        camera.configure(
            camera.create_video_configuration(
                main={"size": (self.width, self.height), "format": "RGB888"}
            )
        )
        camera.start()
        self._camera = camera
        return True

    @property
    def is_open(self) -> bool:
        return self._camera is not None

    async def read(self) -> Image.Image | None:
        now = time.monotonic()
        if not self.is_open:
            if now < self._next_retry_at:
                return None
            try:
                await asyncio.to_thread(self._open)
            except Exception as exc:  # noqa: BLE001 - 카메라가 없거나 점유 중
                self.consecutive_failures += 1
                self._next_retry_at = now + self._backoff
                self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)
                logger.warning(
                    "라즈베리파이 카메라를 열지 못했습니다 (%s); %.0f초 뒤 재시도",
                    exc,
                    self._backoff,
                )
                return None
            self._backoff = 1.0

        try:
            frame = await asyncio.to_thread(self._camera.capture_array)
        except Exception:  # noqa: BLE001 - 케이블이 빠지면 여기서 터진다
            self.consecutive_failures += 1
            self.release()
            self._next_retry_at = time.monotonic() + self._backoff
            self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)
            return None

        self.consecutive_failures = 0
        # picamera2 의 "RGB888" 은 이름과 달리 **BGR 순서**로 배열을 돌려준다
        # (OpenCV 와 맞추려는 설계다). PIL 은 RGB 를 기대하므로 뒤집지 않으면
        # 새우가 파랗게 나온다.
        return Image.fromarray(frame[:, :, ::-1])

    def release(self) -> None:
        if self._camera is not None:
            try:
                self._camera.close()
            except Exception:  # noqa: BLE001 - 이미 닫혔을 수 있다
                pass
            self._camera = None


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
