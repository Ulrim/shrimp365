#!/usr/bin/env python3
"""객체탐지 성능(mAP·Precision·Recall·F1)을 잰다 — 시험성적서용.

왜 따로 있나
------------
`eval_count.py` 는 "몇 마리인지 얼마나 맞췄나"(계수 오차율)를 잰다. 그것은
현장에서 쓰는 값이지만, 시험기관이 요구하는 **탐지 모델 성능 지표**는 아니다.
이 스크립트는 mAP@0.5, mAP@0.5:0.95, Precision, Recall, F1 을 낸다.

**배포본 그 자체를 잰다**
-------------------------
추론은 현장 장비가 쓰는 `app/services/detector_onnx.py` 를 그대로 불러 돌린다.
letterbox 전처리, NMS, 좌표 복원이 모두 배포 경로와 같은 코드다. 그래서 여기서
나온 수치는 "시험용으로 따로 만든 경로"가 아니라 **실제로 출하되는 경로**의
성적이다. 시험기관도 같은 명령으로 재현할 수 있다.

필요한 것: numpy, onnxruntime, pillow, pydantic, pydantic-settings
          (torch·ultralytics 불필요 — `pip install -e .[edge]` 로 한 번에 깔린다)

쓰는 법  — **vision/ 디렉터리에서** 실행한다(배포 모듈을 import 하므로).
-------
    cd vision
    python ai/trainer/eval_detect.py \
        --weights ai/models/shrimp_yolov8n_416.onnx \
        --images <시험이미지 폴더> --labels <라벨 폴더> \
        --conf 0.25 --json out/detect.json --csv out/detect.csv

라벨은 YOLO 형식이고 이미지와 **파일 이름이 같아야** 한다(확장자만 .txt).
`--labels` 를 생략하면 이미지 폴더 옆의 `labels/` 를 쓴다(YOLO 관례).
한 줄에 한 객체이며 두 가지를 모두 받는다 — 둘 다 0~1 정규화다.

    0 cx cy w h                     박스
    0 x1 y1 x2 y2 x3 y3 …           폴리곤(점 3개 이상) → 외접 박스로 접는다

학습에 쓴 shrimp_cf 데이터셋은 폴리곤이다. 그대로 넣어도 된다.

지표 정의 (시험기관 협의용)
---------------------------
* IoU         두 박스의 겹친 넓이 ÷ 합친 넓이
* TP          GT 와 IoU 가 기준 이상이고, 그 GT 가 아직 다른 예측에 쓰이지
              않은 예측. 한 GT 는 한 예측에만 대응한다(신뢰도 높은 쪽 우선).
* Precision   TP / (TP + FP)      예측한 것 중 맞은 비율
* Recall      TP / (TP + FN)      실제 있는 것 중 찾은 비율
* F1          2PR / (P + R)
* AP          신뢰도 내림차순으로 PR 곡선을 그리고 101점 보간으로 적분(COCO 방식)
* mAP@0.5     IoU 0.5 기준 AP (클래스가 하나이므로 AP 와 같다)
* mAP@0.5:0.95  IoU 0.50~0.95 를 0.05 간격으로 10번 잰 AP 의 평균

P·R·F1 은 **운영 신뢰도 임계값**(--conf)에서 잰다. mAP 는 임계값과 무관하게
곡선 전체를 보므로, 내부적으로는 --map-conf(기본 0.001)까지 낮춰 추론한다.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import platform
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
VISION = HERE.parent.parent          # vision/
if str(VISION) not in sys.path:
    sys.path.insert(0, str(VISION))

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
IOU_THRESHOLDS = np.round(np.arange(0.50, 0.96, 0.05), 2)   # 0.50 ... 0.95


# ── 자료 읽기 ───────────────────────────────────────────────────────────────
def find_images(images_dir: Path) -> list[Path]:
    return sorted(p for p in images_dir.rglob("*") if p.suffix.lower() in IMAGE_EXT)


def label_for(image: Path, images_dir: Path, labels_dir: Path) -> Path:
    """이미지에 대응하는 라벨 파일 경로. 하위 폴더 구조를 그대로 따라간다."""
    return (labels_dir / image.relative_to(images_dir)).with_suffix(".txt")


def read_gt(path: Path, width: int, height: int) -> np.ndarray:
    """YOLO 라벨 -> (N, 4) xyxy 픽셀 좌표. 없으면 빈 배열(= 새우 0마리 장면)."""
    if not path.exists():
        return np.zeros((0, 4), dtype=np.float32)
    rows = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        # 클래스는 1종이므로 무시한다. 폴리곤(5개 초과)이면 외접 박스로 만든다.
        values = [float(v) for v in parts[1:]]
        if len(values) == 4:
            cx, cy, w, h = values
            x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        else:
            xs, ys = values[0::2], values[1::2]
            x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        rows.append([x1 * width, y1 * height, x2 * width, y2 * height])
    return np.asarray(rows, dtype=np.float32) if rows else np.zeros((0, 4), dtype=np.float32)


# ── 지표 계산 ───────────────────────────────────────────────────────────────
def iou_matrix(pred: np.ndarray, gt: np.ndarray) -> np.ndarray:
    """(P, G) IoU 행렬."""
    if len(pred) == 0 or len(gt) == 0:
        return np.zeros((len(pred), len(gt)), dtype=np.float32)
    px1, py1, px2, py2 = (pred[:, i][:, None] for i in range(4))
    gx1, gy1, gx2, gy2 = (gt[:, i][None, :] for i in range(4))
    iw = np.clip(np.minimum(px2, gx2) - np.maximum(px1, gx1), 0, None)
    ih = np.clip(np.minimum(py2, gy2) - np.maximum(py1, gy1), 0, None)
    inter = iw * ih
    area_p = np.clip(px2 - px1, 0, None) * np.clip(py2 - py1, 0, None)
    area_g = np.clip(gx2 - gx1, 0, None) * np.clip(gy2 - gy1, 0, None)
    union = area_p + area_g - inter
    return np.where(union > 0, inter / np.maximum(union, 1e-9), 0.0).astype(np.float32)


def match_one_image_detail(pred_boxes: np.ndarray, pred_scores: np.ndarray,
                           gt: np.ndarray, thr: float,
                           ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """신뢰도 내림차순으로 탐욕 매칭 — 판정과 함께 **무엇과 맞았는지**도 돌려준다.

    반환 (모두 예측 순서, 길이 = 예측 수)
      tp           TP(1)/FP(0)
      matched_gt   맞은 정답의 번호(0부터). 맞은 것이 없으면 -1
      matched_iou  그 정답과의 IoU. 맞은 것이 없으면 0

    시험기관에 내는 예측별 로그가 이 값을 쓴다. 판정 경로는 하나뿐이다 —
    `match_one_image()` 는 이 함수의 첫 번째 값을 그대로 돌려준다.
    """
    order = np.argsort(-pred_scores)
    tp = np.zeros(len(pred_boxes), dtype=np.float32)
    matched_gt = np.full(len(pred_boxes), -1, dtype=np.int64)
    matched_iou = np.zeros(len(pred_boxes), dtype=np.float32)
    if len(gt) == 0:
        return tp, matched_gt, matched_iou
    ious = iou_matrix(pred_boxes, gt)
    used = np.zeros(len(gt), dtype=bool)
    for i in order:
        if ious.shape[1] == 0:
            break
        candidates = np.where(~used, ious[i], -1.0)
        best = int(np.argmax(candidates))
        if candidates[best] >= thr:
            tp[i] = 1.0
            used[best] = True
            matched_gt[i] = best
            matched_iou[i] = candidates[best]
    return tp, matched_gt, matched_iou


def match_one_image(pred_boxes: np.ndarray, pred_scores: np.ndarray,
                    gt: np.ndarray, thr: float) -> np.ndarray:
    """신뢰도 내림차순으로 탐욕 매칭. 반환: 예측마다 TP(1)/FP(0)."""
    return match_one_image_detail(pred_boxes, pred_scores, gt, thr)[0]


def score_order(scores: np.ndarray) -> np.ndarray:
    """AP 를 낼 때 예측을 늘어놓는 순서(신뢰도 내림차순).

    신뢰도가 **똑같은** 예측끼리의 앞뒤는 정렬 구현이 정한다. 로그만으로 같은
    AP 를 다시 내려면 그 순서까지 알아야 하므로, `average_precision()` 과
    예측별 로그(`전체순위` 열)가 이 함수 하나를 같이 쓴다.
    """
    return np.argsort(-scores)


def average_precision(tp: np.ndarray, scores: np.ndarray, n_gt: int) -> float:
    """101점 보간 AP (COCO 방식)."""
    if n_gt == 0:
        return float("nan")
    if len(tp) == 0:
        return 0.0
    order = score_order(scores)
    tp = tp[order]
    ctp = np.cumsum(tp)
    cfp = np.cumsum(1.0 - tp)
    recall = ctp / n_gt
    precision = ctp / np.maximum(ctp + cfp, 1e-9)
    # 단조 감소하도록 정밀도를 뒤에서부터 누적 최대값으로 덮는다
    precision = np.maximum.accumulate(precision[::-1])[::-1]
    points = np.linspace(0, 1, 101)
    idx = np.searchsorted(recall, points, side="left")
    interp = np.where(idx < len(precision), precision[np.minimum(idx, len(precision) - 1)], 0.0)
    return float(interp.mean())


def bootstrap_ci(per_image_tp: list[np.ndarray], per_image_scores: list[np.ndarray],
                 per_image_gt: list[int], rounds: int = 2000,
                 seed: int = 20261111) -> dict | None:
    """표본이 작을 때 mAP 가 어디까지 흔들리는지 — 이미지 단위 부트스트랩.

    시험 이미지가 수십 장뿐이면 mAP 0.81 이라는 한 숫자는 과장이다. 같은 모델도
    어떤 50장을 뽑느냐에 따라 0.7 과 0.9 사이를 오간다. 그 폭을 함께 적지 않으면
    읽는 사람이 정밀도를 실제보다 높게 믿는다.

    이미지를 **통째로** 복원추출해 다시 계산한다. 박스 단위로 섞으면 한 이미지
    안의 상관관계가 깨져 구간이 실제보다 좁게 나온다.
    """
    n = len(per_image_tp)
    if n < 2:
        return None
    rng = np.random.default_rng(seed)
    aps = np.empty(rounds, dtype=np.float64)
    for b in range(rounds):
        pick = rng.integers(0, n, size=n)
        tp = np.concatenate([per_image_tp[i] for i in pick]) if n else np.zeros(0)
        sc = np.concatenate([per_image_scores[i] for i in pick]) if n else np.zeros(0)
        aps[b] = average_precision(tp, sc, sum(per_image_gt[i] for i in pick))
    aps = aps[~np.isnan(aps)]
    if aps.size == 0:
        return None
    return {
        "반복": rounds,
        "하한_2.5%": round(float(np.percentile(aps, 2.5)), 4),
        "상한_97.5%": round(float(np.percentile(aps, 97.5)), 4),
        "표준오차": round(float(np.std(aps, ddof=1)), 4),
    }


def exact_lower_bound(successes: int, trials: int, alpha: float = 0.05) -> float | None:
    """맞힌 비율의 95% 하한 — 표본이 작을 때 부트스트랩이 못 하는 일을 한다.

    16개 중 16개를 맞히면 부트스트랩 구간은 1.000~1.000 으로 붙어 버린다. 어떻게
    다시 뽑아도 전부 정답이기 때문이다. 그러면 "100% 이고 오차도 없다"로 읽히는데,
    16개로는 그렇게 말할 수 없다. 실제로는 참값이 0.8 인 모델도 16번 연속 맞힐
    확률이 2.8% 나 된다.

    그래서 이항분포로 직접 센다(Clopper–Pearson 하한). 16/16 이면 약 0.79 다 —
    "적어도 0.79 라고 말할 수 있다"가 이 표본이 허용하는 정직한 최대치다.
    표본이 커지면 하한이 올라간다.
    """
    if trials <= 0 or successes < 0 or successes > trials:
        return None
    if successes == 0:
        return 0.0
    if successes == trials:
        return float((alpha / 2) ** (1.0 / trials))
    # 이항계수의 로그. 항을 로그로 계산해야 한다 — (1-p)^n 에서 출발해 곱해 나가면
    # n 이 수천일 때 첫 항이 0 으로 꺼져(언더플로) 꼬리 확률이 통째로 0 이 되고,
    # 하한이 관측 비율과 똑같이 나온다(3,403/3,699 → 0.92). 그건 하한이 아니다.
    log_comb = [math.lgamma(trials + 1) - math.lgamma(k + 1) - math.lgamma(trials - k + 1)
                for k in range(successes, trials + 1)]
    lo, hi = 0.0, float(successes) / trials
    for _ in range(200):                      # 이분법 — scipy 를 끌어오지 않는다
        mid = (lo + hi) / 2
        if mid <= 0.0:
            break
        # P(X >= successes | p=mid) 를 누적이항으로 구한다
        log_p, log_q = math.log(mid), math.log1p(-mid)
        tail = sum(math.exp(c + k * log_p + (trials - k) * log_q)
                   for k, c in zip(range(successes, trials + 1), log_comb, strict=True))
        if tail > alpha / 2:
            hi = mid
        else:
            lo = mid
    return float(lo)


def frame_for_detector(image):  # noqa: ANN001, ANN201 - PIL.Image in/out
    """배포 검출기에 넘길 프레임을 만든다 — **채널 순서를 틀리면 안 된다.**

    `OnnxShrimpDetector.detect()` 는 들어온 것이 ndarray 면 **BGR 로 간주해**
    뒤집는다(현장에서는 스트림이 BGR 을 주기 때문이다). 그래서 여기서 RGB
    ndarray 를 넘기면 R 과 B 가 맞바뀐 그림이 모델에 들어간다. 모델은 RGB 로
    학습했으므로 탐지가 크게 망가지고, **성적서에는 실제보다 훨씬 낮은 수치가
    올라간다.** 눈에 보이는 오류가 없어서 알아차리기도 어렵다.

    PIL 이미지로 넘기면 `detect()` 가 뒤집지 않고 그대로 RGB 로 읽는다.
    그 경로를 쓴다.
    """
    return image.convert("RGB")


@dataclass
class PerImage:
    name: str
    width: int
    height: int
    gt: int
    pred_at_conf: int
    tp: int
    fp: int
    fn: int
    infer_ms: float


def count_error(pairs: list[tuple[int, int]], tolerance: float = 0.20) -> dict:
    """계수 오차율 — 몇 마리인지 얼마나 맞췄나.

    탐지 지표(mAP·P·R)는 "박스가 제자리에 있나"를 보지만, 현장에서 쓰는 값은
    **마리 수**다. 박스가 조금 어긋나도 수가 맞으면 쓸 수 있고, 반대로 박스가
    정확해도 몇 마리를 빠뜨리면 못 쓴다. 그래서 따로 센다.

        오차율 = |예측 마리 수 − 실제 마리 수| ÷ 실제 마리 수

    정답이 0마리인 배경 이미지는 분모가 0이라 오차율을 낼 수 없다. 빼지 않고
    따로 센다 — 빈 수조에서 헛검출이 몇 개 나오는지가 중요하기 때문이다.
    """
    counted = [(gt, pred) for gt, pred in pairs if gt > 0]
    background = [pred for gt, pred in pairs if gt == 0]
    out: dict = {
        "대상_이미지_수": len(counted),
        "허용오차": tolerance,
        "배경이미지_수": len(background),
    }
    if counted:
        errors = [abs(pred - gt) / gt for gt, pred in counted]
        within = [e for e in errors if e <= tolerance]
        out["평균_오차율"] = round(float(np.mean(errors)), 4)
        out["중앙값_오차율"] = round(float(np.median(errors)), 4)
        out["최대_오차율"] = round(float(np.max(errors)), 4)
        out[f"±{int(tolerance * 100)}%_이내_비율"] = round(len(within) / len(counted), 4)
    if background:
        out["배경_오검출_평균"] = round(float(np.mean(background)), 2)
        out["배경_오검출_0건_비율"] = round(
            float(np.mean([1.0 if p == 0 else 0.0 for p in background])), 4)
    return out


def _as_arrays(bboxes) -> tuple[np.ndarray, np.ndarray]:  # noqa: ANN001
    boxes = np.asarray([[b.x1, b.y1, b.x2, b.y2] for b in bboxes],
                       dtype=np.float32).reshape(-1, 4)
    scores = np.asarray([b.confidence for b in bboxes], dtype=np.float32)
    return boxes, scores


# ── 본체 ───────────────────────────────────────────────────────────────────
def evaluate(args: argparse.Namespace) -> dict:
    from app.services.detector_onnx import OnnxShrimpDetector  # noqa: PLC0415
    from app.services.tiling import collect_tile_boxes, merge_candidates  # noqa: PLC0415

    images_dir = Path(args.images).resolve()
    labels_dir = Path(args.labels).resolve() if args.labels else images_dir.parent / "labels"
    images = find_images(images_dir)
    if not images:
        sys.exit(f"이미지를 찾지 못했습니다: {images_dir}")

    detector = OnnxShrimpDetector(
        model_path=str(Path(args.weights).resolve()),
        conf_threshold=args.map_conf,     # 곡선 전체를 그리려고 낮게 둔다
        iou_threshold=args.iou,
        imgsz=args.imgsz,
        max_det=args.max_det,
        tile=0,                           # 조각은 아래에서 --tile 로 직접 나눈다
    )

    from PIL import Image  # noqa: PLC0415

    all_scores: list[np.ndarray] = []
    all_tp: dict[float, list[np.ndarray]] = {float(t): [] for t in IOU_THRESHOLDS}
    per_image_gt: list[int] = []
    total_gt = 0
    rows: list[PerImage] = []
    op_tp = op_fp = op_fn = 0
    times: list[float] = []
    details: list[dict] = []          # 이미지별 중간값 — 로그(--log-dir)가 쓴다

    for n, image_path in enumerate(images, 1):
        with Image.open(image_path) as im:
            frame = frame_for_detector(im)
            width, height = frame.size

        start = time.perf_counter()
        if args.tile:
            candidates = collect_tile_boxes(detector, frame, tile=args.tile,
                                            overlap=args.tile_overlap)
            bboxes = merge_candidates(candidates, max_det=args.max_det)
            # 운영 임계값의 결과는 서비스와 같은 순서(거른 뒤 합치기)로 따로 만든다.
            # 합친 뒤에 거르면 임계값 아래의 상자가 반쪽 상자를 지워 수가 달라진다.
            op_bboxes = merge_candidates(candidates, min_confidence=args.conf,
                                         max_det=args.max_det)
            op_index = None           # 조각 추론은 운영 결과가 mAP 예측의 부분집합이 아니다
        else:
            bboxes = detector.detect(frame).bboxes
            op_index = [i for i, b in enumerate(bboxes) if b.confidence >= args.conf]
            op_bboxes = [bboxes[i] for i in op_index]
        times.append((time.perf_counter() - start) * 1000)

        boxes, scores = _as_arrays(bboxes)
        gt = read_gt(label_for(image_path, images_dir, labels_dir), width, height)
        total_gt += len(gt)
        per_image_gt.append(len(gt))

        all_scores.append(scores)
        matched_gt50 = matched_iou50 = None
        for t in IOU_THRESHOLDS:
            tp_t, mgt, miou = match_one_image_detail(boxes, scores, gt, float(t))
            all_tp[float(t)].append(tp_t)
            if float(t) == 0.5:
                matched_gt50, matched_iou50 = mgt, miou

        # 운영 임계값에서의 P/R/F1
        op_boxes, op_scores = _as_arrays(op_bboxes)
        tp_op, op_matched_gt, _ = match_one_image_detail(op_boxes, op_scores, gt, 0.5)
        tp_n = int(tp_op.sum())
        fp_n = int(len(tp_op) - tp_n)
        fn_n = int(len(gt) - tp_n)
        op_tp += tp_n
        op_fp += fp_n
        op_fn += fn_n
        rows.append(PerImage(str(image_path.relative_to(images_dir)), width, height,
                             len(gt), len(op_bboxes), tp_n, fp_n, fn_n,
                             round(times[-1], 1)))
        details.append({
            "name": rows[-1].name, "boxes": boxes, "scores": scores, "gt": gt,
            "tp": {f"{float(t):.2f}": all_tp[float(t)][-1] for t in IOU_THRESHOLDS},
            "matched_gt50": matched_gt50, "matched_iou50": matched_iou50,
            "op_index": op_index, "op_matched_gt": op_matched_gt,
            "ap50": average_precision(all_tp[0.5][-1], scores, len(gt)),
        })

        if args.progress and (n % args.progress == 0 or n == len(images)):
            print(f"  {n}/{len(images)} 장 처리", flush=True)

    scores_cat = np.concatenate(all_scores) if all_scores else np.zeros(0, dtype=np.float32)
    aps = {}
    for t in IOU_THRESHOLDS:
        tp_cat = np.concatenate(all_tp[float(t)]) if all_tp[float(t)] else np.zeros(0)
        aps[f"{float(t):.2f}"] = average_precision(tp_cat, scores_cat, total_gt)

    precision = op_tp / max(op_tp + op_fp, 1)
    recall = op_tp / max(op_tp + op_fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-9)

    return {
        "모델": str(Path(args.weights).resolve()),
        "모델_sha256": sha256_of(Path(args.weights)),
        "시험_이미지_폴더": str(images_dir),
        "시험_라벨_폴더": str(labels_dir),
        "이미지_수": len(images),
        "정답_박스_수": total_gt,
        "추론_해상도": detector.imgsz,
        "조각_추론": ({"조각_px": args.tile, "겹침": args.tile_overlap} if args.tile else None),
        "신뢰도_임계값": args.conf,
        "NMS_IoU": args.iou,
        "mAP@0.5": round(aps["0.50"], 4),
        "mAP@0.5:0.95": round(float(np.nanmean(list(aps.values()))), 4),
        "IoU별_AP": {k: round(v, 4) for k, v in aps.items()},
        "Precision": round(precision, 4),
        "Recall": round(recall, 4),
        "F1": round(f1, 4),
        "TP": op_tp, "FP": op_fp, "FN": op_fn,
        "mAP@0.5_신뢰구간": bootstrap_ci(all_tp[0.5], all_scores, per_image_gt,
                                       rounds=args.bootstrap) if args.bootstrap else None,
        "탐지율_95%_하한": (round(exact_lower_bound(op_tp, op_tp + op_fn), 4)
                            if (op_tp + op_fn) else None),
        "계수_오차율": count_error([(r.gt, r.pred_at_conf) for r in rows], args.count_tolerance),
        "추론시간_ms": {
            "중앙값": round(float(np.median(times)), 1),
            "평균": round(float(np.mean(times)), 1),
            "최소": round(float(np.min(times)), 1),
            "최대": round(float(np.max(times)), 1),
        },
        "_per_image": rows,
        "_details": details,
        "_score_order": score_order(scores_cat),
        "_data": {"images_dir": images_dir, "labels_dir": labels_dir, "images": images},
    }


def sha256_of(path: Path) -> str:
    import hashlib  # noqa: PLC0415
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ── 시험기관 제출용 로그 (--log-dir) ────────────────────────────────────────
# 시험기관은 받은 로그만으로 최종값을 다시 계산한다. 그래서 "이미지별 요약"만으로는
# 모자라고, 예측 박스 하나·정답 박스 하나마다 한 줄이 있어야 한다.
# 다시 계산하는 쪽은 `recompute_detect.py` — 이 파일의 함수를 쓰지 않는 독립 구현이다.
LOG_PRED = "02_예측별_결과.csv"
LOG_GT = "02_정답별_결과.csv"
LOG_IMAGE = "02_이미지별_결과.csv"
LOG_JSON = "03_최종결과.json"
LOG_TARGET = "00_시험대상_해시.txt"
LOG_DATA_DIR = "01_시험데이터"
LOG_SUMS = "sha256sums.txt"
LOG_STATS = "통계.txt"
LOG_README = "README_읽는법.txt"

LOG_README_TEXT = """이 폴더 읽는 법 — 쉬림프365 새우 탐지 AI 모델 시험 결과 묶음

파일
  00_시험대상_해시.txt       시험 대상 고정값: 모델 sha256, git 커밋, 코드 sha256
  01_시험데이터/             시험 이미지·라벨의 sha256 목록(sha256sums.txt), 건수 통계(통계.txt)
  02_예측별_결과.csv         예측 박스 1개 = 1줄  (모델이 낸 모든 예측)
  02_정답별_결과.csv         정답 박스 1개 = 1줄  (라벨의 모든 정답)
  02_이미지별_결과.csv       이미지 1장 = 1줄
  03_최종결과.json           시험 항목별 최종값·기준·판정, 실행 환경
  04_재계산_결과.txt         위 CSV 만으로 다시 계산한 값과 최종값의 비교
  05_실행로그.txt            시험 당일 콘솔 출력 그대로

CSV 는 UTF-8(BOM) 이라 엑셀에서 바로 열린다. 열어 본 뒤 저장하지 않는다
(저장하면 파일이 바뀌어 03_최종결과.json 의 '로그_sha256' 과 어긋난다).

02_예측별_결과.csv 의 열
  이미지, 예측번호        어느 이미지의 몇 번째 예측인가(1부터)
  신뢰도                  모델이 낸 점수(0~1)
  전체순위                모든 이미지의 예측을 신뢰도 내림차순으로 세웠을 때의 순번.
                          신뢰도가 같은 예측끼리의 순서도 이 값이 정한다
  x1,y1,x2,y2(px)         예측 박스 좌표(원본 이미지 픽셀)
  운영임계값_이상(0/1)    신뢰도가 운영 임계값 이상이면 1 — 마릿수와 P·R·F1 에 쓰인다
  TP@0.50(0/1)            IoU 0.50 기준으로 정답과 맞으면 1(TP), 아니면 0(FP)
  매칭정답번호@0.50       맞은 정답의 번호(02_정답별_결과.csv 의 정답번호). FP 면 빈칸
  IoU@0.50                그 정답과의 IoU. FP 면 빈칸
  TP@0.55 … TP@0.95       IoU 기준을 0.05 씩 올렸을 때의 TP(1)/FP(0)

02_정답별_결과.csv 의 열
  이미지, 정답번호        라벨 파일에서 유효한 줄(값 5개 이상)만 센 순서(1부터)
  x1,y1,x2,y2(px)         정답 박스 좌표(폴리곤 라벨은 외접 박스)
  운영임계값에서_탐지(0/1) 운영 임계값 이상인 예측이 IoU 0.5 이상으로 맞혔으면 1
  탐지한_예측번호         그 예측의 예측번호. 못 찾았으면 빈칸

02_이미지별_결과.csv 의 열
  정답수, 검출수          정답 마리 수, 운영 임계값 이상인 예측 수
  계수오차율              |검출수 − 정답수| ÷ 정답수. 정답 0마리 이미지는 빈칸
  TP, FP, FN              운영 임계값·IoU 0.5 기준
  AP@0.5(이미지 단독)     그 이미지만으로 낸 AP — 참고값. 정답 0마리 이미지는 빈칸
  헛검출(정답 0마리 이미지) 정답이 없는 이미지에서 나온 검출 수

최종값이 나오는 길
  mAP@0.5 는 이미지별 AP 의 평균이 **아니다.** 모든 이미지의 예측을 '전체순위' 로
  한 줄로 세우고 'TP@0.50' 열로 누적 TP·FP 를 세어 정밀도-재현율 곡선을 그린 뒤
  101점 보간(COCO 방식)으로 낸다. 식은 recompute_detect.py 머리말에 번호를 붙여
  적어 두었고, 그 스크립트가 CSV 만 읽어 같은 값을 다시 낸다.

    python ai/trainer/recompute_detect.py --dir <이 폴더>
"""

LOG_EXPLAIN = {
    "최종값_계산": (
        "데이터셋 mAP@0.5 는 이미지별 AP 의 평균이 아니다. 모든 이미지의 예측을 "
        "신뢰도 내림차순으로 한 줄로 합쳐(02_예측별_결과.csv 의 '전체순위') 누적 TP·FP 로 "
        "정밀도-재현율 곡선을 그리고 101점 보간(COCO 방식)으로 계산한 값이다."),
    "이미지별_AP": (
        "02_이미지별_결과.csv 의 'AP@0.5(이미지 단독)' 은 그 이미지의 예측·정답만으로 낸 "
        "참고값이다. 최종값은 02_예측별_결과.csv 로 다시 계산한다. 정답이 0마리인 "
        "이미지는 AP 가 정의되지 않으므로 빈칸이다."),
    "P_R_F1": (
        "신뢰도가 운영 임계값 이상인 예측만으로 IoU 0.5 기준 TP·FP·FN 을 센다. "
        "TP = 02_정답별_결과.csv 에서 '운영임계값에서_탐지' 가 1 인 줄 수, "
        "FP = '운영임계값_이상' 이 1 인 예측 수 − TP, FN = 정답 수 − TP."),
    "계수_오차율": (
        "이미지별 |검출 마리 수 − 정답 마리 수| ÷ 정답 마리 수. 검출 마리 수는 "
        "운영 임계값 이상인 예측 수다. 정답이 0마리인 이미지는 분모가 0이라 평균에서 "
        "빼고, 헛검출 수를 따로 적는다."),
    "번호": ("예측번호·정답번호는 이미지 안에서 1부터 센다. 정답번호는 라벨 파일에서 "
             "유효한 줄(값이 5개 이상인 줄)만 센 순서다 — 빈 줄은 건너뛴다."),
    "판정": "판정은 이 파일에 적힌 값(소수 넷째 자리로 반올림한 값)을 기준과 견준다.",
    "재계산": "python ai/trainer/recompute_detect.py --dir <이 폴더>",
    "실행": "묶음 만들기·재실행은 python ai/trainer/sta_run.py (prepare | rerun | rehearsal)",
}


def dataset_sha256_lines(images_dir: Path, labels_dir: Path, images: list[Path]) -> list[str]:
    """시험 이미지·라벨의 sha256 목록 — `sha256sum -c` 가 읽는 형식 그대로.

    경로는 이미지 폴더와 라벨 폴더의 공통 상위 폴더 기준이다(예: `images/a.jpg`).
    그 폴더에서 `sha256sum -c <목록 파일>` 을 돌리면 시험 데이터가 고정됐는지 확인된다.
    """
    base = Path(os.path.commonpath([images_dir, labels_dir]))
    entries: list[Path] = []
    for image in images:
        entries.append(image)
        label = label_for(image, images_dir, labels_dir)
        if label.exists():
            entries.append(label)
    pairs = sorted((e.relative_to(base).as_posix(), sha256_of(e)) for e in entries)
    return [f"{digest}  {rel}" for rel, digest in pairs]


def sha256_of_text(text: str) -> str:
    import hashlib  # noqa: PLC0415
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def git_info() -> dict:
    """실행 코드가 어느 커밋인지. git 이 없거나 저장소 밖(꾸러미 복사본)이면 None."""
    def run(*cmd: str) -> str | None:
        try:
            r = subprocess.run(["git", "-C", str(VISION), *cmd], capture_output=True,
                               text=True, timeout=20, check=False)
        except (OSError, subprocess.SubprocessError):
            return None
        return r.stdout.strip() if r.returncode == 0 else None

    head = run("rev-parse", "HEAD")
    if not head:
        stamp = VISION / "GIT_COMMIT"            # 꾸러미(저장소 밖 복사본)에 적어 둔 값
        if stamp.exists():
            return {"커밋": stamp.read_text(encoding="utf-8").strip(),
                    "비고": "git 저장소 밖 — 꾸러미의 GIT_COMMIT 파일에 적힌 값"}
        return {"커밋": None, "비고": "git 저장소가 아니거나 git 을 찾지 못했습니다"}
    dirty = run("status", "--porcelain", "--untracked-files=no", "--", str(VISION))
    return {"커밋": head, "추적파일_변경_있음": bool(dirty)}


def code_hashes() -> dict[str, str]:
    """측정에 관여하는 코드 파일의 sha256(vision/ 기준 경로)."""
    files = ["ai/trainer/eval_detect.py", "ai/trainer/recompute_detect.py",
             "app/services/detector_onnx.py", "app/services/detector.py",
             "app/services/tiling.py"]
    return {f: sha256_of(VISION / f) for f in files if (VISION / f).exists()}


def _windows_ram_gb() -> float | None:
    """윈도우에는 os.sysconf 가 없다. 커널에 직접 묻는다. 안 되면 None."""
    try:
        import ctypes  # noqa: PLC0415

        class MemoryStatus(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        *((name, ctypes.c_ulonglong) for name in (
                            "ullTotalPhys", "ullAvailPhys", "ullTotalPageFile",
                            "ullAvailPageFile", "ullTotalVirtual", "ullAvailVirtual",
                            "ullAvailExtendedVirtual"))]

        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(MemoryStatus)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return round(status.ullTotalPhys / 2**30, 1)
    except Exception:  # noqa: BLE001 - 사양 기록 때문에 측정이 죽으면 안 된다
        return None


def runtime_info() -> dict:
    import PIL  # noqa: PLC0415
    cpu = platform.processor()
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.lower().startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    try:
        ram_gb = round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30, 1)
    except (AttributeError, ValueError, OSError):
        ram_gb = _windows_ram_gb()
    try:
        import onnxruntime  # noqa: PLC0415
        ort_version = onnxruntime.__version__
    except ImportError:
        ort_version = None
    return {
        "OS": platform.platform(),
        "CPU": cpu or None,
        "논리코어_수": os.cpu_count(),
        "RAM_GB": ram_gb,
        "GPU": "사용 안 함(CPUExecutionProvider)",
        "python": platform.python_version(),
        "numpy": np.__version__,
        "onnxruntime": ort_version,
        "pillow": PIL.__version__,
    }


def judge(out: dict, args: argparse.Namespace) -> list[dict]:
    """시험 항목별 판정. 기준값은 모두 명령줄 설정값이다(임의로 굳히지 않는다)."""
    items = [{
        "시험항목": "새우 객체탐지 성능(경계박스 정확도)",
        "지표": "mAP@0.5",
        "측정값": out["mAP@0.5"],
        "기준": f"{args.pass_map50} 이상",
        "판정": "적합" if out["mAP@0.5"] >= args.pass_map50 else "부적합",
    }]
    c = out["계수_오차율"]
    pct = int(c["허용오차"] * 100)
    if args.count_judge in ("mean", "both"):
        v = c.get("평균_오차율")
        items.append({
            "시험항목": "개체수 계수 오차율",
            "지표": "이미지별 계수 오차율의 평균",
            "측정값": v,
            "기준": f"{args.pass_count_mean} 이하",
            "판정": ("판정 불가(정답이 있는 이미지가 없음)" if v is None
                     else "적합" if v <= args.pass_count_mean else "부적합"),
        })
    if args.count_judge in ("within", "both"):
        v = c.get(f"±{pct}%_이내_비율")
        items.append({
            "시험항목": "개체수 계수 오차율",
            "지표": f"오차율 ±{pct}% 이내 이미지 비율",
            "측정값": v,
            "기준": f"{args.pass_count_within} 이상",
            "판정": ("판정 불가(정답이 있는 이미지가 없음)" if v is None
                     else "적합" if v >= args.pass_count_within else "부적합"),
        })
    return items


def _score_text(v) -> str:  # noqa: ANN001
    """신뢰도를 **잃는 자리 없이** 적는다 — 다시 읽으면 같은 float32 가 된다."""
    return repr(float(v))


def _px(v) -> str:  # noqa: ANN001
    return f"{float(v):.2f}"


def _write_csv(path: Path, header: list[str], lines: list[list]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(lines)


def check_fixed_dataset(log_dir: Path, sums: list[str]) -> None:
    """전날 고정해 둔 sha256 목록이 있으면 오늘 데이터와 같은지 본다. 다르면 멈춘다."""
    path = log_dir / LOG_DATA_DIR / LOG_SUMS
    if path.exists() and path.read_text(encoding="utf-8").splitlines() != sums:
        sys.exit(f"[중단] 시험 데이터가 고정된 목록과 다릅니다: {path}\n"
                 "        이미지·라벨이 바뀌었거나 다른 폴더를 가리키고 있습니다. "
                 "측정하지 않습니다.")


def write_logs(log_dir: Path, out: dict, rows: list[PerImage], details: list[dict],
               order: np.ndarray, sums: list[str], args: argparse.Namespace) -> dict:
    """데이터 한 건마다 한 줄 — 예측별·정답별·이미지별 CSV 와 최종 JSON 을 쓴다.

    여기서는 **아무것도 다시 계산하지 않는다.** `evaluate()` 가 최종값을 내면서
    쓴 중간값(판정·매칭·순서)을 그대로 적을 뿐이다.
    """
    log_dir.mkdir(parents=True, exist_ok=True)
    thr_keys = [f"{float(t):.2f}" for t in IOU_THRESHOLDS]

    # 전체순위: AP 계산이 쓴 바로 그 순서에서 몇 번째인가(1부터)
    rank = np.empty(len(order), dtype=np.int64)
    rank[order] = np.arange(1, len(order) + 1)

    pred_lines: list[list] = []
    gt_lines: list[list] = []
    image_lines: list[list] = []
    offset = 0
    for row, d in zip(rows, details, strict=True):
        op_index = d["op_index"]
        op_set = set(op_index)
        for i in range(len(d["scores"])):
            matched = int(d["matched_gt50"][i])
            pred_lines.append([
                d["name"], i + 1, _score_text(d["scores"][i]), int(rank[offset + i]),
                *(_px(v) for v in d["boxes"][i]),
                1 if i in op_set else 0,
                int(d["tp"]["0.50"][i]),
                matched + 1 if matched >= 0 else "",
                f"{float(d['matched_iou50'][i]):.6f}" if matched >= 0 else "",
                *(int(d["tp"][k][i]) for k in thr_keys[1:]),
            ])
        offset += len(d["scores"])

        found_by = {int(g): op_index[k] + 1                 # 정답 번호 → 예측번호
                    for k, g in enumerate(d["op_matched_gt"]) if g >= 0}
        for j in range(len(d["gt"])):
            gt_lines.append([d["name"], j + 1, *(_px(v) for v in d["gt"][j]),
                             1 if j in found_by else 0, found_by.get(j, "")])

        err = "" if row.gt == 0 else round(abs(row.pred_at_conf - row.gt) / row.gt, 4)
        ap = d["ap50"]
        image_lines.append([
            row.name, row.width, row.height, row.gt, row.pred_at_conf, err,
            row.tp, row.fp, row.fn, row.infer_ms,
            "" if ap != ap else f"{ap:.6f}",                # nan → 빈칸
            row.pred_at_conf if row.gt == 0 else "",
        ])

    _write_csv(log_dir / LOG_PRED,
               ["이미지", "예측번호", "신뢰도", "전체순위",
                "x1(px)", "y1(px)", "x2(px)", "y2(px)",
                "운영임계값_이상(0/1)", "TP@0.50(0/1)", "매칭정답번호@0.50", "IoU@0.50",
                *(f"TP@{k}(0/1)" for k in thr_keys[1:])],
               pred_lines)
    _write_csv(log_dir / LOG_GT,
               ["이미지", "정답번호", "x1(px)", "y1(px)", "x2(px)", "y2(px)",
                "운영임계값에서_탐지(0/1)", "탐지한_예측번호"],
               gt_lines)
    _write_csv(log_dir / LOG_IMAGE,
               ["이미지", "가로(px)", "세로(px)", "정답수(마리)", "검출수(마리)",
                "계수오차율(비율)", "TP(개)", "FP(개)", "FN(개)", "추론시간(ms)",
                "AP@0.5(이미지 단독)", "헛검출(정답 0마리 이미지)(개)"],
               image_lines)

    # 시험 데이터: sha256 목록과 건수 통계
    data_dir = log_dir / LOG_DATA_DIR
    data_dir.mkdir(exist_ok=True)
    sums_text = "\n".join(sums) + "\n"
    # 줄바꿈을 \n 으로 못박는다 — 윈도우에서도 파일의 sha256 이 JSON 에 적는 값과 같아야 한다.
    (data_dir / LOG_SUMS).write_text(sums_text, encoding="utf-8", newline="\n")
    counts = [r.gt for r in rows]
    bins = [("0", 0, 0), ("1", 1, 1), ("2~5", 2, 5), ("6~10", 6, 10), ("11~20", 11, 20),
            ("21~50", 21, 50), ("51 이상", 51, 10**9)]
    stats = [
        f"시험 이미지 수        {len(rows):,} 장",
        f"정답 개체(박스) 수    {sum(counts):,} 개",
        f"이미지당 마리 수      최소 {min(counts)} · 중앙값 {float(np.median(counts)):g}"
        f" · 평균 {float(np.mean(counts)):.2f} · 최대 {max(counts)}",
        f"정답 0마리 이미지     {sum(1 for c in counts if c == 0):,} 장",
        "",
        "이미지당 마리 수 분포 (마리 수 구간 → 이미지 수)",
        *(f"  {name:<8} {sum(1 for c in counts if lo <= c <= hi):>6,} 장"
          for name, lo, hi in bins),
        "",
        f"sha256 목록           {LOG_SUMS} ({len(sums):,} 줄 = 이미지 + 라벨 파일)",
        f"sha256 목록의 sha256  {sha256_of_text(sums_text)}",
    ]
    (data_dir / LOG_STATS).write_text("\n".join(stats) + "\n", encoding="utf-8")

    git = git_info()
    codes = code_hashes()
    weights = Path(args.weights).resolve()
    extra = {
        "판정": judge(out, args),
        "설명": LOG_EXPLAIN,
        "mAP_최저_신뢰도": args.map_conf,
        "예측_수(mAP_최저_신뢰도_이상)": len(pred_lines),
        "로그_sha256": {name: sha256_of(log_dir / name)
                       for name in (LOG_PRED, LOG_GT, LOG_IMAGE)},
        "시험데이터": {
            "이미지_수": len(rows),
            "sha256_목록_파일": f"{LOG_DATA_DIR}/{LOG_SUMS}",
            "sha256_목록_줄수": len(sums),
            "sha256_목록_해시": sha256_of_text(sums_text),
        },
        "모델_바이트": weights.stat().st_size,
        "코드": {"git": git, "파일_sha256": codes},
        "실행_환경": runtime_info(),
        "실행_시각": datetime.now().astimezone().isoformat(timespec="seconds"),
        "실행_인자": {k: v for k, v in sorted(vars(args).items())},
    }

    target = [
        "시험 대상 고정값",
        "",
        f"모델 파일      {weights.name}",
        f"모델 sha256    {out['모델_sha256']}",
        f"모델 크기      {extra['모델_바이트']:,} 바이트",
        "",
        f"git 커밋       {git.get('커밋') or '확인 불가 — ' + git.get('비고', '')}",
        *([f"추적 파일 변경  {'있음 ⚠' if git['추적파일_변경_있음'] else '없음'}"]
          if "추적파일_변경_있음" in git else [f"               ({git['비고']})"]),
        "",
        "코드 sha256 (vision/ 기준)",
        *(f"  {digest}  {name}" for name, digest in codes.items()),
        "",
        f"시험 데이터    이미지 {len(rows):,}장 · 정답 박스 {sum(counts):,}개",
        f"sha256 목록의 sha256  {extra['시험데이터']['sha256_목록_해시']}"
        f"  ({LOG_DATA_DIR}/{LOG_SUMS})",
    ]
    (log_dir / LOG_TARGET).write_text("\n".join(target) + "\n", encoding="utf-8")
    (log_dir / LOG_README).write_text(LOG_README_TEXT, encoding="utf-8")
    return extra


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="객체탐지 성능(mAP/P/R/F1) 측정 — 시험성적서용")
    p.add_argument("--weights", required=True, help="배포 ONNX 경로")
    p.add_argument("--images", required=True, help="시험 이미지 폴더")
    p.add_argument("--labels", default=None, help="라벨 폴더(생략하면 ../labels)")
    p.add_argument("--conf", type=float, default=0.25,
                   help="P/R/F1 을 잴 운영 신뢰도 임계값")
    p.add_argument("--map-conf", type=float, default=0.001,
                   help="mAP 곡선용 최저 신뢰도. 낮을수록 곡선이 완전해진다")
    p.add_argument("--iou", type=float, default=0.7, help="NMS IoU")
    p.add_argument("--bootstrap", type=int, default=0,
                   help="mAP@0.5 신뢰구간 부트스트랩 반복 수(0=끄기, 권장 2000)")
    p.add_argument("--count-tolerance", type=float, default=0.20,
                   help="계수 오차 허용 범위(기본 0.20 = ±20%%)")
    p.add_argument("--imgsz", type=int, default=None, help="추론 해상도(미지정=모델값)")
    p.add_argument("--max-det", type=int, default=1000, help="이미지당 최대 검출 수")
    p.add_argument("--tile", type=int, default=0,
                   help="조각 추론: 프레임을 이 크기(px) 조각으로 나눠 조각마다 추론(0=끄기). "
                        "추론시간은 조각 전체를 합친 값으로 잰다")
    p.add_argument("--tile-overlap", type=float, default=0.25, help="조각끼리 겹치는 비율")
    p.add_argument("--json", default=None, help="결과 JSON 저장 경로")
    p.add_argument("--csv", default=None, help="이미지별 결과 CSV 저장 경로")
    p.add_argument("--log-dir", default=None,
                   help="시험기관 제출용 로그 폴더. 예측별·정답별·이미지별 CSV, "
                        "03_최종결과.json, 시험 대상·데이터 sha256 을 쓴다")
    p.add_argument("--pass-map50", type=float, default=0.75,
                   help="판정 기준: mAP@0.5 가 이 값 이상이면 적합")
    p.add_argument("--count-judge", choices=("mean", "within", "both"), default="mean",
                   help="계수 오차율을 무엇으로 판정하나: mean=이미지별 오차율 평균, "
                        "within=허용오차 이내 이미지 비율, both=둘 다")
    p.add_argument("--pass-count-mean", type=float, default=0.20,
                   help="판정 기준: 이미지별 계수 오차율 평균이 이 값 이하면 적합")
    p.add_argument("--pass-count-within", type=float, default=None,
                   help="판정 기준: 허용오차 이내 이미지 비율이 이 값 이상이면 적합 "
                        "(--count-judge within/both 일 때 반드시 지정)")
    p.add_argument("--progress", type=int, default=50, help="N장마다 진행 표시(0=끄기)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):          # 윈도우 콘솔(cp949)에서 죽지 않게
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    args = parse_args(argv)
    if args.count_judge in ("within", "both") and args.pass_count_within is None:
        sys.exit("--count-judge within/both 에는 --pass-count-within 기준값이 필요합니다.")
    if args.log_dir and args.tile:
        sys.exit("--log-dir 는 조각 추론(--tile)과 함께 쓸 수 없습니다. 조각 추론에서는 "
                 "운영 임계값의 결과가 mAP 용 예측의 부분집합이 아니어서 예측별 로그로 "
                 "나타낼 수 없습니다.")
    sums: list[str] = []
    if args.log_dir:
        # 시험 데이터가 고정한 목록과 같은지 **재기 전에** 본다 — 다르면 수치를 내지 않는다.
        images_dir = Path(args.images).resolve()
        labels_dir = Path(args.labels).resolve() if args.labels else images_dir.parent / "labels"
        sums = dataset_sha256_lines(images_dir, labels_dir, find_images(images_dir))
        check_fixed_dataset(Path(args.log_dir), sums)
    print("객체탐지 성능 측정 — 배포 경로(detector_onnx)로 추론합니다.\n")
    out = evaluate(args)
    rows: list[PerImage] = out.pop("_per_image")
    details: list[dict] = out.pop("_details")
    order: np.ndarray = out.pop("_score_order")
    out.pop("_data")

    print("=" * 62)
    print(f"  이미지 {out['이미지_수']:,}장 · 정답 박스 {out['정답_박스_수']:,}개")
    print(f"  추론 해상도 {out['추론_해상도']} · 신뢰도 임계값 {out['신뢰도_임계값']}")
    print("-" * 62)
    lb = out.get("탐지율_95%_하한")
    if lb is not None:
        print(f"  탐지율 하한     {lb:.4f}   (정답 {out['TP'] + out['FN']:,}개 기준,"
              f" 95% 신뢰)")
    ci = out.get("mAP@0.5_신뢰구간")
    if ci:
        print(f"  mAP@0.5        {out['mAP@0.5']:.4f}"
              f"   (95% 구간 {ci['하한_2.5%']:.4f} ~ {ci['상한_97.5%']:.4f})")
    else:
        print(f"  mAP@0.5        {out['mAP@0.5']:.4f}")
    print(f"  mAP@0.5:0.95   {out['mAP@0.5:0.95']:.4f}")
    print(f"  Precision      {out['Precision']:.4f}")
    print(f"  Recall         {out['Recall']:.4f}")
    print(f"  F1             {out['F1']:.4f}")
    print(f"  TP {out['TP']:,} / FP {out['FP']:,} / FN {out['FN']:,}")
    print("-" * 62)
    c = out["계수_오차율"]
    if c["대상_이미지_수"]:
        pct = int(c["허용오차"] * 100)
        print(f"  계수 오차율    평균 {c['평균_오차율'] * 100:.1f}%"
              f" · 중앙값 {c['중앙값_오차율'] * 100:.1f}%"
              f" · 최대 {c['최대_오차율'] * 100:.1f}%")
        print(f"  ±{pct}% 이내      {c[f'±{pct}%_이내_비율'] * 100:.1f}%"
              f"  ({c['대상_이미지_수']:,}장 기준)")
    if c["배경이미지_수"]:
        print(f"  배경 {c['배경이미지_수']:,}장    오검출 평균 {c['배경_오검출_평균']}마리"
              f" · 0건 {c['배경_오검출_0건_비율'] * 100:.1f}%")
    print("-" * 62)
    t = out["추론시간_ms"]
    print(f"  추론 시간(ms)  중앙값 {t['중앙값']} · 평균 {t['평균']}"
          f" · 최소 {t['최소']} · 최대 {t['최대']}")
    print("=" * 62)

    if args.json:
        path = Path(args.json)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
        print(f"\nJSON 저장: {path}")
    if args.csv:
        path = Path(args.csv)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(["이미지", "가로", "세로", "정답수", "검출수", "계수오차율",
                        "TP", "FP", "FN", "추론ms"])
            for r in rows:
                err = "" if r.gt == 0 else round(abs(r.pred_at_conf - r.gt) / r.gt, 4)
                w.writerow([r.name, r.width, r.height, r.gt, r.pred_at_conf, err,
                            r.tp, r.fp, r.fn, r.infer_ms])
        print(f"CSV 저장: {path}")
    if args.log_dir:
        log_dir = Path(args.log_dir)
        out.update(write_logs(log_dir, out, rows, details, order, sums, args))
        (log_dir / LOG_JSON).write_text(json.dumps(out, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
        print(f"\n시험기관 제출용 로그: {log_dir}")
        for name in (LOG_README, LOG_TARGET,
                     f"{LOG_DATA_DIR}/{LOG_SUMS}", f"{LOG_DATA_DIR}/{LOG_STATS}",
                     LOG_PRED, LOG_GT, LOG_IMAGE, LOG_JSON):
            print(f"  {name}")
        print("\n판정")
        for item in out["판정"]:
            print(f"  {item['시험항목']} — {item['지표']} {item['측정값']}"
                  f" (기준 {item['기준']}) → {item['판정']}")
        print("\n다음: python ai/trainer/recompute_detect.py --dir", log_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
