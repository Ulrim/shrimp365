"""ONNX 경로(라즈베리파이 배포용) 전처리·후처리 검증.

ultralytics 가 해 주던 letterbox 와 NMS, 좌표 복원을 직접 구현했으므로
숫자가 어긋나면 개체 수가 그대로 틀린다. onnxruntime 없이도 검증할 수 있게
세션을 가짜로 끼워 넣어 확인한다.
"""
from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from app.config import settings
from app.services.detector import build_detector
from app.services.detector_onnx import (
    PAD_VALUE,
    OnnxShrimpDetector,
    _as_rgb,
    letterbox,
    nms,
    postprocess,
    resize_bilinear,
    to_input_tensor,
)

# ---------------------------------------------------------------------------
# 전처리
# ---------------------------------------------------------------------------


def test_resize_is_identity_at_same_size():
    rgb = np.arange(4 * 5 * 3, dtype=np.uint8).reshape(4, 5, 3)
    assert resize_bilinear(rgb, 5, 4) is rgb


def test_resize_halves_a_ramp_by_averaging_pixel_pairs():
    # 가로 방향 0,10,20,30 을 2배 축소하면 픽셀 중심이 각 쌍의 가운데에 놓여
    # 두 값의 평균(5, 25)이 나온다.
    row = np.array([[0, 10, 20, 30]], dtype=np.uint8)
    rgb = np.repeat(row[:, :, None], 3, axis=2)
    out = resize_bilinear(rgb, 2, 1)
    assert out.shape == (1, 2, 3)
    assert out[0, 0, 0] == 5
    assert out[0, 1, 0] == 25


def test_letterbox_keeps_aspect_and_centers_padding():
    rgb = np.full((720, 1280, 3), 200, dtype=np.uint8)
    canvas, gain, pad_x, pad_y = letterbox(rgb, 640)

    assert canvas.shape == (640, 640, 3)
    assert gain == pytest.approx(0.5)
    assert (pad_x, pad_y) == (0.0, 140.0)  # (640-360)/2
    # 위아래 여백은 회색(114), 가운데는 원본 값
    assert canvas[0, 0, 0] == PAD_VALUE
    assert canvas[639, 639, 0] == PAD_VALUE
    assert canvas[320, 320, 0] == 200


def test_letterbox_square_image_has_no_padding():
    rgb = np.full((500, 500, 3), 10, dtype=np.uint8)
    canvas, gain, pad_x, pad_y = letterbox(rgb, 320)
    assert (pad_x, pad_y) == (0.0, 0.0)
    assert gain == pytest.approx(320 / 500)
    assert canvas.shape == (320, 320, 3)


def test_input_tensor_is_nchw_float_and_contiguous():
    canvas = np.full((64, 64, 3), 255, dtype=np.uint8)
    tensor = to_input_tensor(canvas)
    assert tensor.shape == (1, 3, 64, 64)
    assert tensor.dtype == np.float32
    assert tensor.flags["C_CONTIGUOUS"]
    assert tensor.max() == pytest.approx(1.0)


def test_as_rgb_flips_the_bgr_view_the_stream_hands_over():
    # stream_service 는 np.asarray(frame)[:, :, ::-1] 로 음수 스트라이드 뷰를
    # 넘긴다. 연속 메모리로 복사되고 채널 순서가 RGB 로 돌아와야 한다.
    rgb_source = np.zeros((2, 2, 3), dtype=np.uint8)
    rgb_source[..., 0] = 255  # 빨강
    bgr_view = rgb_source[:, :, ::-1]
    assert not bgr_view.flags["C_CONTIGUOUS"]

    restored = _as_rgb(bgr_view)
    assert restored.flags["C_CONTIGUOUS"]
    assert restored[0, 0].tolist() == [255, 0, 0]


def test_as_rgb_accepts_pil_and_drops_alpha():
    image = Image.new("RGBA", (3, 3), (10, 20, 30, 255))
    out = _as_rgb(image)
    assert out.shape == (3, 3, 3)
    assert out[0, 0].tolist() == [10, 20, 30]


# ---------------------------------------------------------------------------
# NMS / 후처리
# ---------------------------------------------------------------------------


def test_nms_collapses_overlapping_boxes():
    boxes = np.array(
        [[0, 0, 10, 10], [1, 1, 11, 11], [100, 100, 110, 110]], dtype=np.float32
    )
    scores = np.array([0.9, 0.8, 0.7], dtype=np.float32)
    keep = nms(boxes, scores, 0.5)
    assert keep == [0, 2]  # 겹친 1번이 빠진다


def test_nms_keeps_overlapping_boxes_when_threshold_is_high():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11]], dtype=np.float32)
    scores = np.array([0.9, 0.8], dtype=np.float32)
    assert nms(boxes, scores, 0.95) == [0, 1]


def test_nms_on_empty_input():
    assert nms(np.zeros((0, 4), dtype=np.float32), np.zeros(0, dtype=np.float32), 0.5) == []


ANCHORS = 100  # 실제 모델은 8400개지만 형태만 같으면 된다


def _yolo_output(
    boxes_xyxy: list[tuple[float, float, float, float]],
    scores: list[float],
    n_classes: int = 1,
):
    """(1, 4+nc, N) 모양의 YOLOv8 출력을 만든다(네트워크 입력 픽셀 단위).

    실제 출력처럼 앵커 자리를 전부 채우고 나머지는 점수 0 으로 둔다. 앵커 수가
    채널 수보다 많은 것이 진짜 출력의 모양이므로, 이 형태로 시험해야
    후처리의 축 판별까지 함께 검증된다.
    """
    array = np.zeros((4 + n_classes, ANCHORS), dtype=np.float32)
    for i, ((x1, y1, x2, y2), score) in enumerate(zip(boxes_xyxy, scores, strict=True)):
        array[0, i] = (x1 + x2) / 2
        array[1, i] = (y1 + y2) / 2
        array[2, i] = x2 - x1
        array[3, i] = y2 - y1
        array[4, i] = score
    return array[None, ...]


def test_postprocess_recovers_original_image_coordinates():
    # 1280x720 -> 640: gain 0.5, 위아래 여백 140.
    # 원본 (100,200)-(300,400) 은 네트워크에서 (50,240)-(150,340) 이 된다.
    output = _yolo_output([(50, 240, 150, 340)], [0.9])
    boxes = postprocess(output, gain=0.5, pad_x=0.0, pad_y=140.0, orig_w=1280, orig_h=720,
                        conf_threshold=0.25, iou_threshold=0.7)
    assert len(boxes) == 1
    box = boxes[0]
    assert (box.x1, box.y1, box.x2, box.y2) == pytest.approx((100.0, 200.0, 300.0, 400.0))
    assert box.confidence == pytest.approx(0.9)


def test_postprocess_filters_by_confidence():
    output = _yolo_output([(50, 50, 100, 100), (200, 200, 250, 250)], [0.9, 0.1])
    boxes = postprocess(output, 1.0, 0.0, 0.0, 640, 640, conf_threshold=0.25, iou_threshold=0.7)
    assert len(boxes) == 1
    assert boxes[0].confidence == pytest.approx(0.9)


def test_postprocess_clips_boxes_to_frame():
    output = _yolo_output([(-20, -30, 50, 60)], [0.8])
    boxes = postprocess(output, 1.0, 0.0, 0.0, 640, 480, conf_threshold=0.25, iou_threshold=0.7)
    assert boxes[0].x1 == 0.0
    assert boxes[0].y1 == 0.0


def test_postprocess_accepts_transposed_output():
    # (1, N, 5) 로 나오는 내보내기도 있어 두 방향 모두 받아야 한다.
    output = _yolo_output([(50, 240, 150, 340)], [0.9])
    transposed = output.transpose(0, 2, 1)
    boxes = postprocess(transposed, 0.5, 0.0, 140.0, 1280, 720, 0.25, 0.7)
    assert len(boxes) == 1
    assert boxes[0].x1 == pytest.approx(100.0)


def test_postprocess_handles_no_detections():
    output = np.zeros((1, 5, ANCHORS), dtype=np.float32)
    assert postprocess(output, 1.0, 0.0, 0.0, 640, 640, 0.25, 0.7) == []


def test_postprocess_runs_nms_per_class():
    # 두 클래스(4+nc=6)에서 거의 같은 자리에 있는 박스는 클래스가 다르면 둘 다 남는다.
    output = np.zeros((6, ANCHORS), dtype=np.float32)
    output[:, 0] = [50, 50, 20, 20, 0.9, 0.0]  # 클래스 0
    output[:, 1] = [51, 51, 20, 20, 0.0, 0.8]  # 클래스 1
    boxes = postprocess(output[None, ...], 1.0, 0.0, 0.0, 640, 640, 0.25, 0.5)
    assert len(boxes) == 2


# ---------------------------------------------------------------------------
# 검출기 전체 경로 (가짜 세션)
# ---------------------------------------------------------------------------


class _FakeSession:
    """onnxruntime 세션 흉내. 넘겨받은 입력을 기록하고 정해진 출력을 돌려준다."""

    def __init__(self, output: np.ndarray) -> None:
        self._output = output
        self.feed: dict | None = None

    def run(self, _outputs, feed):  # noqa: ANN001, ANN201
        self.feed = feed
        return [self._output]


def _detector_with_fake_session(output: np.ndarray, imgsz: int = 640) -> tuple:
    detector = OnnxShrimpDetector(
        model_path="ai/models/shrimp_yolov8n.onnx", conf_threshold=0.25, iou_threshold=0.7,
        imgsz=imgsz,
    )
    session = _FakeSession(output)
    detector._session = session
    detector._input_name = "images"
    return detector, session


def test_detect_counts_boxes_and_reports_frame_size():
    output = _yolo_output([(50, 240, 150, 340), (200, 250, 260, 300)], [0.9, 0.6])
    detector, session = _detector_with_fake_session(output)
    # 스트림이 주는 것과 같은 모양: BGR, 음수 스트라이드 뷰
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)[:, :, ::-1]

    result = detector.detect(frame)

    assert result.count == 2
    assert result.frame_width == 1280
    assert result.frame_height == 720
    assert result.confidence_avg == pytest.approx(0.75)
    assert result.model_version == "shrimp_yolov8n.onnx"
    assert result.track_ids is None
    assert result.inference_ms >= 0
    # 모델에 들어간 입력은 정규화된 NCHW 여야 한다.
    tensor = session.feed["images"]
    assert tensor.shape == (1, 3, 640, 640)
    assert tensor.dtype == np.float32


def test_detect_with_tracking_falls_back_to_plain_detect():
    output = _yolo_output([(50, 240, 150, 340)], [0.9])
    detector, _ = _detector_with_fake_session(output)
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    result = detector.detect_with_tracking(frame)
    assert result.count == 1
    assert result.track_ids is None  # ONNX 경로엔 트래커가 없다


def test_detect_respects_confidence_threshold():
    output = _yolo_output([(50, 240, 150, 340), (200, 250, 260, 300)], [0.9, 0.3])
    detector, _ = _detector_with_fake_session(output)
    detector.conf_threshold = 0.5
    result = detector.detect(np.zeros((720, 1280, 3), dtype=np.uint8))
    assert result.count == 1


def test_missing_onnxruntime_raises_a_readable_error(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "onnxruntime":
            raise ImportError("no onnxruntime")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    detector = OnnxShrimpDetector(model_path="nope.onnx")
    with pytest.raises(RuntimeError) as excinfo:
        detector.detect(np.zeros((10, 10, 3), dtype=np.uint8))
    assert "onnxruntime" in str(excinfo.value)


# ---------------------------------------------------------------------------
# 경로 선택
# ---------------------------------------------------------------------------


def test_build_detector_picks_onnx_backend_for_onnx_model(monkeypatch):
    monkeypatch.setattr(settings, "model_path", "./ai/models/shrimp_yolov8n.onnx")
    assert isinstance(build_detector(), OnnxShrimpDetector)


def test_build_detector_picks_ultralytics_for_pt_model(monkeypatch):
    from app.services.detector import ShrimpDetector

    monkeypatch.setattr(settings, "model_path", "./ai/models/shrimp_yolov8n.pt")
    detector = build_detector()
    assert isinstance(detector, ShrimpDetector)


def test_onnx_model_does_not_force_simulation_mode(monkeypatch, tmp_path):
    """파이에는 ultralytics 가 없다. 그래도 ONNX 모델이 있으면 실제 모드여야 한다."""
    import app.config as config

    model = tmp_path / "shrimp_yolov8n.onnx"
    model.write_bytes(b"not-a-real-model")
    monkeypatch.setattr(settings, "model_path", str(model))
    monkeypatch.setattr(settings, "simulation_mode", None)
    config.reset_simulation_mode_cache()
    try:
        # onnxruntime 가 설치되어 있으면 실제 모드, 없으면 시뮬레이션.
        try:
            import onnxruntime  # noqa: F401

            expected = False
        except ImportError:
            expected = True
        assert config.simulation_mode_active() is expected
    finally:
        config.reset_simulation_mode_cache()


# ---------------------------------------------------------------------------
# 두 경로 비교 도구 (ai/trainer/compare_backends.py)
# ---------------------------------------------------------------------------


def _compare_module():
    import importlib.util
    import sys as _sys
    from pathlib import Path as _Path

    path = _Path(__file__).resolve().parents[1] / "ai" / "trainer" / "compare_backends.py"
    spec = importlib.util.spec_from_file_location("compare_backends", path)
    module = importlib.util.module_from_spec(spec)
    _sys.modules["compare_backends"] = module
    spec.loader.exec_module(module)
    return module


def test_iou_matrix_basic_overlap():
    cb = _compare_module()
    a = np.array([[0, 0, 10, 10]], dtype=np.float32)
    b = np.array([[0, 0, 10, 10], [5, 0, 15, 10], [100, 100, 110, 110]], dtype=np.float32)
    ious = cb.iou_matrix(a, b)
    assert ious[0, 0] == pytest.approx(1.0)
    assert ious[0, 1] == pytest.approx(1 / 3)  # 절반 겹침 -> 50/150
    assert ious[0, 2] == pytest.approx(0.0)


def test_match_boxes_pairs_by_overlap_not_by_order():
    """순번으로 비교하면 박스 하나만 어긋나도 뒤가 전부 밀린다. 그래서 IoU 로 짝짓는다."""
    cb = _compare_module()
    # 같은 개체 3개인데 b 쪽 순서가 뒤섞이고 1픽셀씩 어긋나 있다.
    a = np.array([[0, 0, 10, 10], [50, 50, 60, 60], [100, 100, 110, 110]], dtype=np.float32)
    b = np.array([[100, 101, 110, 111], [1, 0, 11, 10], [50, 50, 60, 61]], dtype=np.float32)

    pairs, un_a, un_b = cb.match_boxes(a, b)

    assert len(pairs) == 3
    assert (un_a, un_b) == (0, 0)
    assert sorted(pairs) == [(0, 1), (1, 2), (2, 0)]  # 순번이 아니라 위치로 짝지었다


def test_match_boxes_reports_unmatched_on_both_sides():
    cb = _compare_module()
    a = np.array([[0, 0, 10, 10], [200, 200, 210, 210]], dtype=np.float32)
    b = np.array([[0, 0, 10, 10], [400, 400, 410, 410]], dtype=np.float32)
    pairs, un_a, un_b = cb.match_boxes(a, b)
    assert len(pairs) == 1
    assert (un_a, un_b) == (1, 1)


def test_match_boxes_handles_empty_sides():
    cb = _compare_module()
    empty = np.zeros((0, 4), dtype=np.float32)
    boxes = np.array([[0, 0, 10, 10]], dtype=np.float32)
    assert cb.match_boxes(empty, boxes) == ([], 0, 1)
    assert cb.match_boxes(boxes, empty) == ([], 1, 0)
    assert cb.match_boxes(empty, empty) == ([], 0, 0)


# ---------------------------------------------------------------------------
# 시뮬레이션 모드 진단 (app/config.simulation_mode_reason)
# ---------------------------------------------------------------------------


def _reason(monkeypatch, model_path: str, simulation_mode=None):
    import app.config as config

    monkeypatch.setattr(settings, "model_path", model_path)
    monkeypatch.setattr(settings, "simulation_mode", simulation_mode)
    config.reset_simulation_mode_cache()
    try:
        return config.simulation_mode_reason(), config.simulation_mode_active()
    finally:
        config.reset_simulation_mode_cache()


def test_missing_model_reason_names_the_path_and_the_knob(monkeypatch):
    """파이에서 가장 흔한 실패 — MODEL_PATH 오타. 로그만 보고 고칠 수 있어야 한다."""
    reason, active = _reason(monkeypatch, "/nonexistent/shrimp.onnx")
    assert active is True
    assert reason is not None
    assert "/nonexistent/shrimp.onnx" in reason  # 어느 경로를 찾았는지
    assert "MODEL_PATH" in reason  # 무엇을 고쳐야 하는지


def test_explicit_simulation_mode_is_reported_as_deliberate(monkeypatch, tmp_path):
    model = tmp_path / "m.onnx"
    model.write_bytes(b"x")
    reason, active = _reason(monkeypatch, str(model), simulation_mode=True)
    assert active is True
    assert reason is not None and "SIMULATION_MODE" in reason


def test_reason_and_active_never_disagree(monkeypatch, tmp_path):
    """active 는 reason 에서 파생된다 — 둘이 어긋나면 로그가 거짓말을 한다.

    캐시가 양쪽에 걸려 있어, 한쪽만 비우는 실수를 하면 바로 어긋난다.
    """
    model = tmp_path / "m.onnx"
    model.write_bytes(b"x")
    cases = [
        ("/nonexistent/x.onnx", None),
        (str(model), None),
        (str(tmp_path / "m.pt"), None),
        (str(model), True),
        ("/nonexistent/x.onnx", False),
    ]
    for path, sim in cases:
        reason, active = _reason(monkeypatch, path, simulation_mode=sim)
        assert active is (reason is not None), f"{path} sim={sim}: {active} vs {reason!r}"
