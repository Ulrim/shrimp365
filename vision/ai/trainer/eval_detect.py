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
import sys
import time
from dataclasses import dataclass
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


def match_one_image(pred_boxes: np.ndarray, pred_scores: np.ndarray,
                    gt: np.ndarray, thr: float) -> np.ndarray:
    """신뢰도 내림차순으로 탐욕 매칭. 반환: 예측마다 TP(1)/FP(0)."""
    order = np.argsort(-pred_scores)
    tp = np.zeros(len(pred_boxes), dtype=np.float32)
    if len(gt) == 0:
        return tp
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
    return tp


def average_precision(tp: np.ndarray, scores: np.ndarray, n_gt: int) -> float:
    """101점 보간 AP (COCO 방식)."""
    if n_gt == 0:
        return float("nan")
    if len(tp) == 0:
        return 0.0
    order = np.argsort(-scores)
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
    lo, hi = 0.0, float(successes) / trials
    for _ in range(200):                      # 이분법 — scipy 를 끌어오지 않는다
        mid = (lo + hi) / 2
        # P(X >= successes | p=mid) 를 누적이항으로 구한다
        tail = 0.0
        term = (1 - mid) ** trials
        for k in range(trials + 1):
            if k >= successes:
                tail += term
            if k < trials and mid < 1.0:
                term *= (trials - k) / (k + 1) * mid / (1 - mid)
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


# ── 본체 ───────────────────────────────────────────────────────────────────
def evaluate(args: argparse.Namespace) -> dict:
    from app.services.detector_onnx import OnnxShrimpDetector  # noqa: PLC0415
    from app.services.tiling import detect_tiled  # noqa: PLC0415

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
    )

    from PIL import Image  # noqa: PLC0415

    all_scores: list[np.ndarray] = []
    all_tp: dict[float, list[np.ndarray]] = {float(t): [] for t in IOU_THRESHOLDS}
    per_image_gt: list[int] = []
    total_gt = 0
    rows: list[PerImage] = []
    op_tp = op_fp = op_fn = 0
    times: list[float] = []

    for n, image_path in enumerate(images, 1):
        with Image.open(image_path) as im:
            frame = frame_for_detector(im)
            width, height = frame.size

        start = time.perf_counter()
        if args.tile:
            result = detect_tiled(detector, frame, tile=args.tile,
                                  overlap=args.tile_overlap, max_det=args.max_det)
        else:
            result = detector.detect(frame)
        times.append((time.perf_counter() - start) * 1000)

        boxes = np.asarray([[b.x1, b.y1, b.x2, b.y2] for b in result.bboxes],
                           dtype=np.float32).reshape(-1, 4)
        scores = np.asarray([b.confidence for b in result.bboxes], dtype=np.float32)
        gt = read_gt(label_for(image_path, images_dir, labels_dir), width, height)
        total_gt += len(gt)
        per_image_gt.append(len(gt))

        all_scores.append(scores)
        for t in IOU_THRESHOLDS:
            all_tp[float(t)].append(match_one_image(boxes, scores, gt, float(t)))

        # 운영 임계값에서의 P/R/F1
        keep = scores >= args.conf
        tp_op = match_one_image(boxes[keep], scores[keep], gt, 0.5)
        tp_n = int(tp_op.sum())
        fp_n = int(len(tp_op) - tp_n)
        fn_n = int(len(gt) - tp_n)
        op_tp += tp_n
        op_fp += fp_n
        op_fn += fn_n
        rows.append(PerImage(str(image_path.relative_to(images_dir)), width, height,
                             len(gt), int(keep.sum()), tp_n, fp_n, fn_n,
                             round(times[-1], 1)))

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
    }


def sha256_of(path: Path) -> str:
    import hashlib  # noqa: PLC0415
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    p.add_argument("--progress", type=int, default=50, help="N장마다 진행 표시(0=끄기)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print("객체탐지 성능 측정 — 배포 경로(detector_onnx)로 추론합니다.\n")
    out = evaluate(args)
    rows: list[PerImage] = out.pop("_per_image")

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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
