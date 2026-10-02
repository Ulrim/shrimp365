"""카메라 소스 선택 — 종류마다 프레임을 가져오는 길이 다르다.

라즈베리파이 CSI 카메라를 cv2.VideoCapture 로 열려던 실수를 다시 하지 않도록
고정해 둔다. libcamera 스택이라 OpenCV 로는 열리지 않는다.
"""
from __future__ import annotations

import uuid

from app.services.camera_source import CameraSource, PiCameraSource
from app.services.stream_service import CameraSnapshot, CameraStreamProcessor


def snapshot(camera_type: str) -> CameraSnapshot:
    return CameraSnapshot(
        id=uuid.uuid4(),
        tank_id=uuid.uuid4(),
        farm_id=uuid.uuid4(),
        name="테스트 카메라",
        camera_type=camera_type,
        stream_url=None if camera_type == "picamera" else "0",
        fps_target=1.0,
        resolution_w=1280,
        resolution_h=720,
    )


def test_picamera_uses_libcamera_source(monkeypatch):
    monkeypatch.setattr(
        "app.services.stream_service.simulation_mode_active", lambda: False
    )
    processor = CameraStreamProcessor(snapshot("picamera"))
    assert isinstance(processor.source, PiCameraSource)
    # 해상도는 우리가 정해서 연다 — 주소가 없으므로 다른 데서 알아낼 수 없다.
    assert processor.source.width == 1280
    assert processor.source.height == 720


def test_usb_uses_videocapture_source(monkeypatch):
    monkeypatch.setattr(
        "app.services.stream_service.simulation_mode_active", lambda: False
    )
    processor = CameraStreamProcessor(snapshot("usb"))
    assert isinstance(processor.source, CameraSource)


def test_simulation_wins_over_camera_type(monkeypatch):
    """시뮬레이션 모드에서는 종류와 무관하게 가짜 카메라를 쓴다.

    학습 모델도 카메라도 없는 상태에서 전체 기능을 시연할 수 있어야 한다.
    """
    monkeypatch.setattr(
        "app.services.stream_service.simulation_mode_active", lambda: True
    )
    processor = CameraStreamProcessor(snapshot("picamera"))
    assert not isinstance(processor.source, PiCameraSource)


def test_pi_camera_stream_uses_the_onnx_detector_when_model_is_onnx(monkeypatch):
    """파이 배포 조합(CSI 카메라 + ONNX 모델)이 실제로 그 경로를 타는지 확인한다.

    MODEL_PATH 만 바꿔 파이에 적용하는 것이 설계이므로, 이 연결이 끊기면
    파이에서 torch 를 찾다가 실패한다.
    """
    from app.config import settings
    from app.services.detector_onnx import OnnxShrimpDetector

    monkeypatch.setattr("app.services.stream_service.simulation_mode_active", lambda: False)
    monkeypatch.setattr(settings, "model_path", "./ai/models/shrimp_yolov8n.onnx")

    processor = CameraStreamProcessor(snapshot("picamera"))

    assert isinstance(processor.source, PiCameraSource)
    assert isinstance(processor.detector, OnnxShrimpDetector)


def test_usb_camera_stream_uses_ultralytics_for_pt_weights(monkeypatch):
    from app.config import settings
    from app.services.detector import ShrimpDetector

    monkeypatch.setattr("app.services.stream_service.simulation_mode_active", lambda: False)
    monkeypatch.setattr(settings, "model_path", "./ai/models/shrimp_yolov8n.pt")

    processor = CameraStreamProcessor(snapshot("usb"))

    assert isinstance(processor.source, CameraSource)
    assert isinstance(processor.detector, ShrimpDetector)
