"""조각(타일) 추론 — 큰 프레임을 겹치는 조각으로 나눠 조각마다 탐지한다.

왜 필요한가
    모델 입력은 416×416 이다. 급이대 전체를 담은 프레임을 통째로 줄이면 새우 한
    마리가 40px 남짓이 되어 그물 무늬·수면 반사와 구분되지 않는다(2026-11-12 현장
    사진에서 확인 — docs/result-03-bluestartup/evidence/09_현장수조_1차확인.txt).
    조각마다 따로 추론하면 새우가 원래 크기에 가깝게 남는다. 대신 추론 횟수가
    조각 수만큼 늘어난다.

이 파일은 **무거운 의존성 없이** import 된다(numpy 만). 학습 자료를 만드는
ai/trainer/make_tiles.py 도 같은 `tile_origins` 를 쓴다 — 학습 때와 추론 때 자르는
방식이 다르면 크기가 어긋나 성능이 떨어지므로 구현을 하나로 둔다.

조각을 합치는 규칙 (`merge_tile_boxes`)
    1. 조각 경계에 잘린 상자(경계에 닿은 상자)가 다른 조각의 상자에
       `contain_threshold` 이상 덮이면 버린다 — 같은 새우의 "잘린 반쪽"이다.
    2. 남은 상자에 NMS(`iou_threshold`)를 건다 — 겹치는 구역에서 두 조각이 같은
       새우를 온전히 본 경우다.
    경계에 닿지 않은 상자는 1 로 지우지 않는다. 비스듬히 누운 새우의 상자 안에
    다른 새우가 통째로 들어가는 일이 실제로 있기 때문이다.
"""
from __future__ import annotations

import time
from typing import NamedTuple

import numpy as np


class TileRect(NamedTuple):
    x0: int
    y0: int
    x1: int
    y1: int


def tile_origins(size: int, tile: int, overlap: float) -> list[int]:
    """한 축을 `tile` 길이 조각으로 덮는 시작점들.

    마지막 조각은 끝에 맞춰 당긴다(바깥으로 삐져나가 여백이 생기지 않게).
    축이 조각보다 짧으면 시작점은 0 하나다.
    """
    if tile <= 0:
        raise ValueError("tile 은 1 이상이어야 합니다")
    if not 0.0 <= overlap < 1.0:
        raise ValueError("overlap 은 0 이상 1 미만이어야 합니다")
    if size <= tile:
        return [0]
    step = max(1, int(round(tile * (1.0 - overlap))))
    origins = list(range(0, size - tile, step))
    origins.append(size - tile)
    return origins


def plan_tiles(width: int, height: int, tile: int, overlap: float) -> list[TileRect]:
    """프레임 전체를 덮는 조각 목록(위→아래, 왼쪽→오른쪽)."""
    tw, th = min(tile, width), min(tile, height)
    return [
        TileRect(x0, y0, x0 + tw, y0 + th)
        for y0 in tile_origins(height, tile, overlap)
        for x0 in tile_origins(width, tile, overlap)
    ]


def _area(boxes: np.ndarray) -> np.ndarray:
    return np.clip(boxes[:, 2] - boxes[:, 0], 0, None) * np.clip(boxes[:, 3] - boxes[:, 1], 0, None)


def _intersection(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    w = np.clip(np.minimum(box[2], boxes[:, 2]) - np.maximum(box[0], boxes[:, 0]), 0, None)
    h = np.clip(np.minimum(box[3], boxes[:, 3]) - np.maximum(box[1], boxes[:, 1]), 0, None)
    return w * h


def touches_cut_edge(
    boxes: np.ndarray, tile: TileRect, width: int, height: int, margin: float = 3.0
) -> np.ndarray:
    """상자가 조각의 **안쪽 경계**(프레임 가장자리가 아닌 변)에 닿았는지.

    프레임 가장자리에 닿은 것은 잘린 것이 아니라 원래 화면 끝에 걸친 새우다.
    """
    if len(boxes) == 0:
        return np.zeros(0, dtype=bool)
    cut = np.zeros(len(boxes), dtype=bool)
    if tile.x0 > 0:
        cut |= boxes[:, 0] <= tile.x0 + margin
    if tile.y0 > 0:
        cut |= boxes[:, 1] <= tile.y0 + margin
    if tile.x1 < width:
        cut |= boxes[:, 2] >= tile.x1 - margin
    if tile.y1 < height:
        cut |= boxes[:, 3] >= tile.y1 - margin
    return cut


def merge_tile_boxes(
    boxes: np.ndarray,
    scores: np.ndarray,
    tile_index: np.ndarray,
    cut: np.ndarray,
    *,
    iou_threshold: float = 0.5,
    contain_threshold: float = 0.6,
) -> list[int]:
    """조각별 탐지를 하나로 합친다. 남길 상자의 인덱스(신뢰도 내림차순)를 돌려준다.

    boxes        (N, 4) 프레임 좌표 xyxy
    scores       (N,)
    tile_index   (N,)  그 상자가 나온 조각 번호
    cut          (N,)  조각 안쪽 경계에 닿았는지(`touches_cut_edge`)
    """
    count = len(boxes)
    if count == 0:
        return []
    boxes = np.asarray(boxes, dtype=np.float64).reshape(-1, 4)
    areas = _area(boxes)
    alive = np.ones(count, dtype=bool)

    # 1) 잘린 반쪽 지우기 — 다른 조각의 상자에 충분히 덮인 경계 상자
    for i in np.flatnonzero(cut):
        if areas[i] <= 0:
            alive[i] = False
            continue
        others = (tile_index != tile_index[i]) & (areas >= areas[i])
        if not others.any():
            continue
        covered = _intersection(boxes[i], boxes[others]) / areas[i]
        if (covered >= contain_threshold).any():
            alive[i] = False

    # 2) NMS — 신뢰도 높은 것부터
    keep: list[int] = []
    order = [int(i) for i in np.argsort(-np.asarray(scores)) if alive[i]]
    while order:
        best = order.pop(0)
        keep.append(best)
        if not order:
            break
        rest = np.asarray(order)
        inter = _intersection(boxes[best], boxes[rest])
        iou = inter / (areas[best] + areas[rest] - inter + 1e-9)
        order = [int(i) for i, v in zip(rest, iou, strict=True) if v < iou_threshold]
    return keep


def detect_tiled(
    detector,  # noqa: ANN001 - OnnxShrimpDetector 등 detect(PIL) -> DetectionResult
    frame,  # noqa: ANN001 - PIL.Image (RGB)
    *,
    tile: int,
    overlap: float = 0.25,
    iou_threshold: float = 0.5,
    contain_threshold: float = 0.6,
    max_det: int = 1000,
):
    """프레임을 조각내 조각마다 `detector.detect` 를 부르고 결과를 합친다.

    `frame` 은 **PIL 이미지**여야 한다. ndarray 를 넘기면 detect() 가 BGR 로 보고
    채널을 뒤집는데, 조각으로 자른 뒤에는 그 구분을 되살릴 수 없다.
    """
    from app.services.detector import BBox, DetectionResult  # noqa: PLC0415

    image = frame.convert("RGB")
    width, height = image.size
    tiles = plan_tiles(width, height, tile, overlap)

    start = time.perf_counter()
    boxes: list[list[float]] = []
    scores: list[float] = []
    tile_index: list[int] = []
    cut: list[bool] = []
    model_version = "unknown"
    for index, rect in enumerate(tiles):
        result = detector.detect(image.crop(rect))
        model_version = result.model_version
        local = np.asarray(
            [[b.x1, b.y1, b.x2, b.y2] for b in result.bboxes], dtype=np.float64
        ).reshape(-1, 4)
        local[:, [0, 2]] += rect.x0
        local[:, [1, 3]] += rect.y0
        boxes.extend(local.tolist())
        scores.extend(b.confidence for b in result.bboxes)
        tile_index.extend([index] * len(local))
        cut.extend(touches_cut_edge(local, rect, width, height).tolist())

    keep = merge_tile_boxes(
        np.asarray(boxes, dtype=np.float64).reshape(-1, 4),
        np.asarray(scores, dtype=np.float64),
        np.asarray(tile_index, dtype=np.int64),
        np.asarray(cut, dtype=bool),
        iou_threshold=iou_threshold,
        contain_threshold=contain_threshold,
    )[:max_det]
    merged = [
        BBox(
            x1=round(boxes[i][0], 1),
            y1=round(boxes[i][1], 1),
            x2=round(boxes[i][2], 1),
            y2=round(boxes[i][3], 1),
            confidence=round(float(scores[i]), 4),
        )
        for i in keep
    ]
    inference_ms = int((time.perf_counter() - start) * 1000)
    conf_avg = round(sum(b.confidence for b in merged) / len(merged), 3) if merged else 0.0
    return DetectionResult(
        count=len(merged),
        bboxes=merged,
        confidence_avg=conf_avg,
        inference_ms=inference_ms,
        frame_width=width,
        frame_height=height,
        model_version=model_version,
        track_ids=None,
    )
