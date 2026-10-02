"""ONNX 경로를 **실제 onnxruntime** 으로 돌려 보는 통합 검증.

test_detector_onnx.py 는 세션을 가짜로 끼워 전처리·후처리 계산만 봤다. 여기서는
작은 ONNX 모델을 즉석에서 만들어 실제 런타임에 올린다. 세션 생성, 입력 이름
찾기, 입력 shape 로 해상도 알아내기, 메타데이터에서 해상도 읽기 같은 배선은
이렇게 해야 검증된다(파이에서 처음 돌릴 때 터지는 곳이 바로 이 배선이다).

`pip install -e ".[dev]"` 에 onnx·onnxruntime 이 들어 있다. 없으면 건너뛴다.
"""
from __future__ import annotations

import numpy as np
import pytest

onnx = pytest.importorskip("onnx", reason="onnx 미설치 — 통합 검증 생략")
pytest.importorskip("onnxruntime", reason="onnxruntime 미설치 — 통합 검증 생략")

from onnx import TensorProto, helper  # noqa: E402

from app.services.detector_onnx import OnnxShrimpDetector  # noqa: E402

ANCHORS = 8


def _detection_tensor(boxes_xyxy: list[tuple[float, float, float, float]], scores: list[float]):
    """YOLOv8 출력과 같은 (1, 5, N) 배열. 좌표는 네트워크 입력 픽셀 단위."""
    array = np.zeros((1, 5, ANCHORS), dtype=np.float32)
    for i, ((x1, y1, x2, y2), score) in enumerate(zip(boxes_xyxy, scores, strict=True)):
        array[0, :, i] = [(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, score]
    return array


def _write_model(
    path,
    detections: np.ndarray,
    imgsz: int | None = 640,
    metadata_imgsz: str | None = None,
):
    """고정 출력을 돌려주는 최소 ONNX 모델을 만든다.

    입력을 쓰지 않는 그래프는 런타임이 거부할 수 있어, 두 번째 출력으로
    입력의 shape 를 내보내 입력이 실제로 쓰이게 한다.
    """
    height_width = imgsz if imgsz is not None else "h"
    image_input = helper.make_tensor_value_info(
        "images", TensorProto.FLOAT, [1, 3, height_width, height_width]
    )
    detect_output = helper.make_tensor_value_info(
        "output0", TensorProto.FLOAT, list(detections.shape)
    )
    shape_output = helper.make_tensor_value_info("input_shape", TensorProto.INT64, [4])

    const_node = helper.make_node(
        "Constant",
        inputs=[],
        outputs=["output0"],
        value=helper.make_tensor(
            name="detections",
            data_type=TensorProto.FLOAT,
            dims=list(detections.shape),
            vals=detections.flatten().tolist(),
        ),
    )
    shape_node = helper.make_node("Shape", inputs=["images"], outputs=["input_shape"])

    graph = helper.make_graph(
        [const_node, shape_node],
        "tiny-shrimp-detector",
        [image_input],
        [detect_output, shape_output],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 12)])
    model.ir_version = 8  # onnxruntime 이 확실히 읽는 범위
    if metadata_imgsz is not None:
        entry = model.metadata_props.add()
        entry.key = "imgsz"
        entry.value = metadata_imgsz
    onnx.save(model, str(path))
    return path


def test_real_runtime_recovers_original_frame_coordinates(tmp_path):
    # 1280x720 -> 640 letterbox: 배율 0.5, 위아래 여백 140.
    # 네트워크 좌표 (50,240)-(150,340) 은 원본 (100,200)-(300,400) 이어야 한다.
    model_path = tmp_path / "tiny.onnx"
    _write_model(model_path, _detection_tensor([(50, 240, 150, 340)], [0.9]))

    detector = OnnxShrimpDetector(model_path=str(model_path), conf_threshold=0.25)
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)[:, :, ::-1]  # 스트림과 같은 BGR 뷰

    result = detector.detect(frame)

    assert detector.imgsz == 640  # 입력 shape 에서 알아냈다
    assert result.count == 1
    box = result.bboxes[0]
    assert (box.x1, box.y1, box.x2, box.y2) == pytest.approx((100.0, 200.0, 300.0, 400.0), abs=0.01)
    assert result.frame_width == 1280
    assert result.frame_height == 720
    assert result.model_version == "tiny.onnx"
    assert result.inference_ms >= 0


def test_real_runtime_honours_a_smaller_export_size(tmp_path):
    # imgsz 416 으로 내보낸 모델: 1280x720 -> 배율 0.325, 여백 (416-234)/2=91
    model_path = tmp_path / "tiny416.onnx"
    gain = 416 / 1280
    pad_y = (416 - round(720 * gain)) / 2
    net_box = (100 * gain, 200 * gain + pad_y, 300 * gain, 400 * gain + pad_y)
    _write_model(model_path, _detection_tensor([net_box], [0.8]), imgsz=416)

    detector = OnnxShrimpDetector(model_path=str(model_path), conf_threshold=0.25)
    result = detector.detect(np.zeros((720, 1280, 3), dtype=np.uint8))

    assert detector.imgsz == 416
    assert result.count == 1
    box = result.bboxes[0]
    assert (box.x1, box.x2) == pytest.approx((100.0, 300.0), abs=1.5)
    assert (box.y1, box.y2) == pytest.approx((200.0, 400.0), abs=1.5)


def test_real_runtime_reads_imgsz_from_model_metadata(tmp_path):
    """해상도가 동적(dynamic)으로 내보내진 모델은 메타데이터를 봐야 한다."""
    model_path = tmp_path / "dynamic.onnx"
    _write_model(
        model_path,
        _detection_tensor([(10, 10, 20, 20)], [0.7]),
        imgsz=None,
        metadata_imgsz="[320, 320]",
    )

    detector = OnnxShrimpDetector(model_path=str(model_path), conf_threshold=0.25)
    result = detector.detect(np.zeros((480, 640, 3), dtype=np.uint8))

    assert detector.imgsz == 320
    assert result.count == 1


def test_real_runtime_filters_low_confidence(tmp_path):
    model_path = tmp_path / "two.onnx"
    _write_model(
        model_path,
        _detection_tensor([(50, 240, 150, 340), (200, 250, 260, 300)], [0.9, 0.2]),
    )
    detector = OnnxShrimpDetector(model_path=str(model_path), conf_threshold=0.5)
    assert detector.detect(np.zeros((720, 1280, 3), dtype=np.uint8)).count == 1


def test_real_runtime_reuses_one_session(tmp_path):
    """세션은 한 번만 만들어야 한다. 프레임마다 다시 만들면 파이에서 못 버틴다."""
    model_path = tmp_path / "reuse.onnx"
    _write_model(model_path, _detection_tensor([(50, 240, 150, 340)], [0.9]))
    detector = OnnxShrimpDetector(model_path=str(model_path))

    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    detector.detect(frame)
    session = detector._session
    detector.detect(frame)
    assert detector._session is session
