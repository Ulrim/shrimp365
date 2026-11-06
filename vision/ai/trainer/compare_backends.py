"""같은 모델을 ultralytics 와 파이 경로(detector_onnx)로 돌려 결과를 비교한다.

왜 필요한가. 파이에서는 torch 없이 onnxruntime 으로 돌리려고 letterbox·NMS·좌표
복원을 직접 구현했다(app/services/detector_onnx.py). 그 구현이 학습·검증 때 쓰는
ultralytics 와 다르게 세면, Colab 에서 통과한 계수 성능이 파이에서 재현되지 않는다.
가중치와 입력이 같으므로 차이가 나면 전적으로 전처리·후처리 탓이다.

    python ai/trainer/compare_backends.py --weights best.onnx \
        --images datasets/shrimp/valid/images --conf 0.35

박스를 **IoU 로 짝지어** 비교한다. 좌표순으로 정렬해 같은 순번끼리 재면, 한 장에
100개가 넘는 밀집 사진에서 박스 하나만 어긋나도 그 뒤가 전부 밀려 실제와 무관한
거대한 차이가 찍힌다(처음에 그렇게 만들었다가 246px 라는 헛된 숫자를 봤다).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
VISION_ROOT = _HERE.parents[1]
sys.path.insert(0, str(VISION_ROOT))

MATCH_IOU = 0.5  # 이만큼 겹치면 같은 개체로 본다
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
# 계수 기준이 ±20% 이므로, 그 1/10 미만이면 운영상 같은 결과로 본다.
COUNT_TOLERANCE = 0.02
COORD_TOLERANCE_PX = 3.0

MISSING_ULTRALYTICS_MSG = (
    "[오류] ultralytics 패키지가 설치되어 있지 않습니다.\n"
    "비교에는 양쪽 구현이 모두 필요합니다. vision 디렉터리에서 다음을 실행하세요:\n"
    '    pip install -e ".[ml,edge]"'
)


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """두 박스 묶음의 모든 조합에 대한 IoU."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    union = area_a[:, None] + area_b[None, :] - inter
    return np.where(union > 0, inter / np.maximum(union, 1e-9), 0.0)


def match_boxes(a: np.ndarray, b: np.ndarray) -> tuple[list[tuple[int, int]], int, int]:
    """IoU 가 큰 짝부터 묶는다. 반환: (짝 목록, a 쪽 미매칭 수, b 쪽 미매칭 수)."""
    ious = iou_matrix(a, b)
    pairs: list[tuple[int, int]] = []
    used_a: set[int] = set()
    used_b: set[int] = set()
    if ious.size:
        order = np.dstack(np.unravel_index(np.argsort(ious, axis=None)[::-1], ious.shape))[0]
        for i, j in order:
            if ious[i, j] < MATCH_IOU:
                break
            if int(i) in used_a or int(j) in used_b:
                continue
            used_a.add(int(i))
            used_b.add(int(j))
            pairs.append((int(i), int(j)))
    return pairs, len(a) - len(used_a), len(b) - len(used_b)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ultralytics 와 파이(ONNX) 경로의 검출 결과를 IoU 로 짝지어 비교한다",
    )
    parser.add_argument(
        "--weights", required=True, help="비교할 .onnx 경로(양쪽이 같은 파일을 쓴다)"
    )
    parser.add_argument("--images", required=True, help="이미지 디렉터리")
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--iou", type=float, default=0.7, help="NMS IoU")
    parser.add_argument("--limit", type=int, default=10, help="비교할 이미지 수")
    parser.add_argument(
        "--densest",
        action="store_true",
        help="파일이 큰(= 대체로 개체가 많은) 순으로 고른다. 차이는 밀집 장면에서 드러난다",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        from ultralytics import YOLO  # noqa: PLC0415 - 무거운 지연 임포트
    except ImportError:
        print(MISSING_ULTRALYTICS_MSG, file=sys.stderr)
        return 1
    from PIL import Image  # noqa: PLC0415

    from app.services.detector_onnx import OnnxShrimpDetector  # noqa: PLC0415

    images_dir = Path(args.images).expanduser()
    images = sorted(p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if args.densest:
        images = sorted(images, key=lambda p: -p.stat().st_size)
    images = images[: args.limit]
    if not images:
        raise SystemExit(f"[오류] 이미지가 없습니다: {images_dir}")

    model = YOLO(args.weights, task="detect")
    mine = OnnxShrimpDetector(
        model_path=args.weights, conf_threshold=args.conf, iou_threshold=args.iou
    )

    print(f"{'이미지':34} {'ultra':>6} {'파이':>6} {'차이':>5} {'짝':>5} {'좌표최대차':>10}")
    worst_delta = 0.0
    count_diffs: list[int] = []
    rel_diffs: list[float] = []
    unmatched = 0

    for image_path in images:
        results = model.predict(
            str(image_path), conf=args.conf, iou=args.iou, max_det=1000, verbose=False
        )
        boxes = [
            [float(v) for v in box.xyxy[0].tolist()]
            for result in results
            if result.boxes is not None
            for box in result.boxes
        ]
        ultra = np.array(boxes, dtype=np.float32).reshape(-1, 4)

        rgb = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.uint8)
        detection = mine.detect(rgb[:, :, ::-1])  # 스트림과 같은 BGR 로 넘긴다
        ours = np.array(
            [[b.x1, b.y1, b.x2, b.y2] for b in detection.bboxes], dtype=np.float32
        ).reshape(-1, 4)

        pairs, un_a, un_b = match_boxes(ultra, ours)
        delta = 0.0
        if pairs:
            idx_a = np.array([p[0] for p in pairs])
            idx_b = np.array([p[1] for p in pairs])
            delta = float(np.abs(ultra[idx_a] - ours[idx_b]).max())
        worst_delta = max(worst_delta, delta)
        diff = len(ours) - len(ultra)
        count_diffs.append(diff)
        if len(ultra):
            rel_diffs.append(abs(diff) / len(ultra))
        unmatched += un_a + un_b
        print(
            f"{image_path.name[:34]:34} {len(ultra):>6} {len(ours):>6} {diff:>+5} "
            f"{len(pairs):>5} {delta:>10.2f}"
        )

    mean_rel = float(np.mean(rel_diffs)) if rel_diffs else 0.0
    print()
    print(
        f"개수 차이 평균 {np.mean(np.abs(count_diffs)):.2f}개 (상대 {100 * mean_rel:.2f}%), "
        f"최대 {max(abs(d) for d in count_diffs)}개"
    )
    print(f"짝지어진 박스의 좌표 최대 차이: {worst_delta:.2f} px")
    print(f"짝을 못 찾은 박스 합계: {unmatched}개")

    ok = mean_rel < COUNT_TOLERANCE and worst_delta < COORD_TOLERANCE_PX
    if ok:
        print("판정: 운영상 같은 결과 — Colab 에서 검증한 계수 성능이 파이에서 재현된다")
    else:
        print("판정: 차이가 크다 — 전처리/후처리를 다시 봐야 한다")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
