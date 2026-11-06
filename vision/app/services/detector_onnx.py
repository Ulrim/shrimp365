"""ONNX Runtime 기반 검출기 — 라즈베리파이 4 에서 쓰는 길.

왜 따로 만드는가. `ShrimpDetector` 는 ultralytics 를 쓰고, ultralytics 는
PyTorch 를 끌고 온다. 파이 4(ARM, 4GB)에서 torch 는 설치가 무겁고 실행 중
메모리도 많이 먹는다. 추론만 할 거면 `.pt` 를 ONNX 로 내보내고
onnxruntime 만 설치하는 쪽이 훨씬 가볍고 빠르다.

    pip install onnxruntime        # torch 없이, aarch64 휠 있음
    MODEL_PATH=./ai/models/shrimp_yolov8n.onnx

전처리(letterbox)와 후처리(NMS, 좌표 복원)를 여기서 numpy 로 직접 한다.
ultralytics 가 해 주던 일이라 숫자가 어긋나면 개수가 틀리므로, 규칙을
ultralytics 와 똑같이 맞췄다.

- letterbox: 비율 유지 축소 후 **가운데** 여백, 여백 색 114(회색)
- 모델 출력: (1, 4+nc, N), 박스는 xywh **중심 좌표 + 네트워크 입력 픽셀 단위**
- 후처리: conf 필터 -> xyxy 변환 -> 클래스별 NMS -> 여백/배율 되돌리기

트래킹(ByteTrack)은 ultralytics 안에 있는 기능이라 이 경로에는 없다.
`detect_with_tracking` 은 그래서 `detect` 와 같다(track_ids 없음). 계수는
프레임마다 박스를 세는 방식이라 영향이 없다.
"""
from __future__ import annotations

import ast
import time
from pathlib import Path

import numpy as np
from PIL import Image

from app.config import settings
from app.services.detector import BBox, DetectionResult

PAD_VALUE = 114  # ultralytics letterbox 기본 여백 색
DEFAULT_IMGSZ = 640

MISSING_ORT_MSG = (
    "[오류] onnxruntime 이 설치되어 있지 않습니다.\n"
    "ONNX 모델로 추론하려면 다음을 실행하세요:\n"
    "    pip install onnxruntime"
)


# ---------------------------------------------------------------------------
# 전처리 / 후처리 (numpy 만 쓴다 — 단위 테스트 가능)
# ---------------------------------------------------------------------------


def resize_bilinear(rgb: np.ndarray, new_w: int, new_h: int) -> np.ndarray:
    """OpenCV 의 INTER_LINEAR 와 같은 방식으로 크기를 바꾼다.

    PIL 의 `resize(BILINEAR)` 를 쓰지 않는 이유가 있다. PIL 은 축소할 때
    안티에일리어싱을 걸어 여러 픽셀을 평균하는데, ultralytics 는 학습·추론
    모두 cv2.INTER_LINEAR(안티에일리어싱 없음)로 전처리한다. 전처리가 다르면
    학습할 때 본 그림과 추론할 때 보는 그림이 미묘하게 달라지므로, 여기서는
    학습 쪽에 맞춘다.
    """
    src_h, src_w = rgb.shape[:2]
    if (new_w, new_h) == (src_w, src_h):
        return rgb
    scale_x, scale_y = src_w / new_w, src_h / new_h
    # cv2 의 픽셀 중심 정렬: src = (dst + 0.5) * scale - 0.5
    xs = np.clip((np.arange(new_w) + 0.5) * scale_x - 0.5, 0, None)
    ys = np.clip((np.arange(new_h) + 0.5) * scale_y - 0.5, 0, None)
    x0 = np.floor(xs).astype(np.int32)
    y0 = np.floor(ys).astype(np.int32)
    fx = (xs - x0).astype(np.float32)[None, :, None]
    fy = (ys - y0).astype(np.float32)[:, None, None]
    x1 = np.minimum(x0 + 1, src_w - 1)
    y1 = np.minimum(y0 + 1, src_h - 1)
    src = rgb.astype(np.float32)
    top = src[y0[:, None], x0[None, :]] * (1 - fx) + src[y0[:, None], x1[None, :]] * fx
    bottom = src[y1[:, None], x0[None, :]] * (1 - fx) + src[y1[:, None], x1[None, :]] * fx
    out = top * (1 - fy) + bottom * fy
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def letterbox(rgb: np.ndarray, imgsz: int) -> tuple[np.ndarray, float, float, float]:
    """비율을 지키며 imgsz x imgsz 로 맞춘다. 반환: (이미지, 배율, x여백, y여백)."""
    h, w = rgb.shape[:2]
    gain = min(imgsz / h, imgsz / w)
    new_w, new_h = max(1, int(round(w * gain))), max(1, int(round(h * gain)))
    resized = resize_bilinear(rgb, new_w, new_h)
    canvas = np.full((imgsz, imgsz, 3), PAD_VALUE, dtype=np.uint8)
    pad_x = (imgsz - new_w) / 2
    pad_y = (imgsz - new_h) / 2
    top, left = int(round(pad_y - 0.1)), int(round(pad_x - 0.1))
    canvas[top : top + new_h, left : left + new_w] = resized
    return canvas, gain, float(left), float(top)


def to_input_tensor(canvas: np.ndarray) -> np.ndarray:
    """HWC uint8 RGB -> NCHW float32 0~1 (연속 메모리)."""
    tensor = canvas.astype(np.float32) / 255.0
    return np.ascontiguousarray(tensor.transpose(2, 0, 1)[None, ...])


def nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
    """xyxy 박스에 대한 greedy NMS. 남길 인덱스를 점수 내림차순으로 반환."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        best = int(order[0])
        keep.append(best)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[best], x1[rest])
        yy1 = np.maximum(y1[best], y1[rest])
        xx2 = np.minimum(x2[best], x2[rest])
        yy2 = np.minimum(y2[best], y2[rest])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        union = areas[best] + areas[rest] - inter
        iou = np.where(union > 0, inter / np.maximum(union, 1e-9), 0.0)
        order = rest[iou <= iou_threshold]
    return keep


def postprocess(
    output: np.ndarray,
    gain: float,
    pad_x: float,
    pad_y: float,
    orig_w: int,
    orig_h: int,
    conf_threshold: float,
    iou_threshold: float,
    max_det: int = 1000,
) -> list[BBox]:
    """YOLOv8 ONNX 출력 -> 원본 이미지 좌표의 박스 목록."""
    pred = np.asarray(output)
    if pred.ndim == 3:
        pred = pred[0]
    # (4+nc, N) 으로 들어오면 (N, 4+nc) 로 돌린다.
    if pred.shape[0] < pred.shape[1]:
        pred = pred.transpose(1, 0)
    if pred.shape[1] < 5:
        return []

    class_scores = pred[:, 4:]
    scores = class_scores.max(axis=1)
    classes = class_scores.argmax(axis=1)
    mask = scores >= conf_threshold
    if not mask.any():
        return []
    xywh, scores, classes = pred[mask, :4], scores[mask], classes[mask]

    xy = xywh[:, :2]
    wh = xywh[:, 2:4]
    boxes = np.concatenate([xy - wh / 2, xy + wh / 2], axis=1)

    # letterbox 되돌리기: 여백을 빼고 배율로 나눈다.
    boxes[:, [0, 2]] -= pad_x
    boxes[:, [1, 3]] -= pad_y
    boxes /= max(gain, 1e-9)

    # 화면 밖으로 나간 부분을 자르는 것은 **NMS 뒤에** 한다. ultralytics 도 그
    # 순서다. 먼저 자르면 테두리에 걸친 박스의 면적이 달라져 IoU 가 바뀌고,
    # 드물게 NMS 결과가 갈린다(두 경로의 개수가 달라진다).
    result: list[BBox] = []
    for cls in np.unique(classes):
        idx = np.nonzero(classes == cls)[0]
        for local in nms(boxes[idx], scores[idx], iou_threshold):
            j = int(idx[local])
            result.append(
                BBox(
                    float(min(max(boxes[j, 0], 0.0), orig_w)),
                    float(min(max(boxes[j, 1], 0.0), orig_h)),
                    float(min(max(boxes[j, 2], 0.0), orig_w)),
                    float(min(max(boxes[j, 3], 0.0), orig_h)),
                    float(scores[j]),
                )
            )
    result.sort(key=lambda b: -b.confidence)
    return result[:max_det]


# ---------------------------------------------------------------------------
# 검출기
# ---------------------------------------------------------------------------


class OnnxShrimpDetector:
    """ONNX Runtime 으로 돌리는 흰다리새우 검출기(파이 4 권장 경로)."""

    def __init__(
        self,
        model_path: str | None = None,
        conf_threshold: float | None = None,
        iou_threshold: float | None = None,
        imgsz: int | None = None,
        max_det: int | None = None,
    ) -> None:
        self.model_path = model_path or settings.model_path
        self.conf_threshold = (
            conf_threshold if conf_threshold is not None else settings.confidence_threshold
        )
        self.iou_threshold = (
            iou_threshold if iou_threshold is not None else settings.nms_iou_threshold
        )
        self.max_det = max_det if max_det is not None else settings.max_detections
        self._imgsz = imgsz or (settings.model_imgsz or None)
        self._session = None
        self._input_name: str | None = None

    # -- 모델 적재 --------------------------------------------------------------
    def _load(self):
        if self._session is not None:
            return self._session
        try:
            import onnxruntime as ort  # noqa: PLC0415 - 지연 임포트
        except ImportError as exc:
            # 원인을 버리지 않는다. onnxruntime 은 "없어서" 말고도 못 불러온다 —
            # 보드에 안 맞는 wheel, libstdc++ 가 오래된 경우 등. 그때 "미설치"
            # 라고만 적으면 재설치만 반복하게 된다.
            raise RuntimeError(f"{MISSING_ORT_MSG}\n  (실제 오류: {exc})") from exc

        options = ort.SessionOptions()
        if settings.inference_threads > 0:
            options.intra_op_num_threads = settings.inference_threads
        self._session = ort.InferenceSession(
            self.model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )
        self._input_name = self._session.get_inputs()[0].name
        self._imgsz = self._imgsz or self._detect_imgsz(self._session)
        return self._session

    def _detect_imgsz(self, session) -> int:  # noqa: ANN001 - ort.InferenceSession
        """입력 shape -> 모델 메타데이터 -> 기본값 순서로 추론 해상도를 정한다."""
        shape = session.get_inputs()[0].shape
        if len(shape) == 4 and isinstance(shape[2], int) and shape[2] > 0:
            return int(shape[2])
        try:
            meta = session.get_modelmeta().custom_metadata_map or {}
            raw = meta.get("imgsz")
            if raw:
                value = ast.literal_eval(raw)
                if isinstance(value, (list, tuple)) and value:
                    return int(value[0])
                return int(value)
        except (ValueError, SyntaxError, TypeError):
            pass
        return DEFAULT_IMGSZ

    @property
    def imgsz(self) -> int:
        return self._imgsz or DEFAULT_IMGSZ

    # -- 추론 ------------------------------------------------------------------
    def detect(self, frame) -> DetectionResult:  # noqa: ANN001 - np.ndarray(BGR) | PIL
        session = self._load()
        rgb = _as_rgb(frame)
        orig_h, orig_w = rgb.shape[:2]
        start = time.perf_counter()
        canvas, gain, pad_x, pad_y = letterbox(rgb, self.imgsz)
        outputs = session.run(None, {self._input_name: to_input_tensor(canvas)})
        bboxes = postprocess(
            outputs[0],
            gain,
            pad_x,
            pad_y,
            orig_w,
            orig_h,
            self.conf_threshold,
            self.iou_threshold,
            max_det=self.max_det,
        )
        inference_ms = int((time.perf_counter() - start) * 1000)
        conf_avg = round(sum(b.confidence for b in bboxes) / len(bboxes), 3) if bboxes else 0.0
        return DetectionResult(
            count=len(bboxes),
            bboxes=bboxes,
            confidence_avg=conf_avg,
            inference_ms=inference_ms,
            frame_width=orig_w,
            frame_height=orig_h,
            model_version=Path(self.model_path).name,
            track_ids=None,
        )

    def detect_with_tracking(self, frame) -> DetectionResult:  # noqa: ANN001
        """ONNX 경로에는 트래커가 없다. 계수 방식이 같으므로 그대로 위임한다."""
        return self.detect(frame)


def _as_rgb(frame) -> np.ndarray:  # noqa: ANN001
    """스트림이 주는 BGR ndarray 또는 PIL 이미지를 연속 RGB 배열로 만든다.

    stream_service 는 `np.asarray(frame)[:, :, ::-1]` 로 BGR **뷰**(음수
    스트라이드)를 넘긴다. 그대로 두면 onnxruntime 입력에서 문제가 되므로
    여기서 반드시 연속 메모리로 복사한다.
    """
    if isinstance(frame, Image.Image):
        return np.ascontiguousarray(np.asarray(frame.convert("RGB"), dtype=np.uint8))
    array = np.asarray(frame)
    if array.ndim == 2:
        array = np.stack([array] * 3, axis=-1)
    if array.shape[2] == 4:
        array = array[:, :, :3]
    # 들어오는 것은 BGR 이므로 뒤집어 RGB 로 만든다.
    return np.ascontiguousarray(array[:, :, ::-1], dtype=np.uint8)
