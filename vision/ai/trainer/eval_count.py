"""계수 오차율 평가 — 이 사업의 진짜 합격 기준을 재는 도구.

mAP 는 "박스를 얼마나 잘 맞췄나" 지표지 "몇 마리인지 얼마나 맞췄나" 가
아니다. 수행계획서의 검수 기준은 계수 오차율 ±20%(일반) / ±30%(탁도·겹침),
처리 시간 1~3초다. 그래서 학습이 끝나면 mAP 와 **별도로** 이 스크립트를
돌려 장당 마리 수 오차를 직접 재야 한다.

    python ai/trainer/eval_count.py --weights runs/shrimp_yolov8/weights/best.pt \
        --data datasets/shrimp/data.yaml --split valid

    # 탁하거나 겹침이 심한 이미지 목록을 따로 주면 그 묶음은 ±30% 기준으로 본다
    python ai/trainer/eval_count.py ... --hard-list hard_images.txt

정답 마리 수는 라벨 파일의 줄 수다(= 사람이 찍은 개체 수). 예측 마리 수는
검출된 박스 수이며, 운영 코드(app/services/detector.py)와 같은 방식이다.

임계값 훑기: 한 번만 추론해 두고(낮은 conf) 박스별 점수를 기억한 뒤 여러
임계값에서 개수를 다시 세므로, 추가 추론 없이 최적 conf 를 찾는다. 계수
정확도는 conf 에 매우 민감해서 이 값을 맞추는 것만으로 오차율이 크게 바뀐다.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SWEEP_THRESHOLDS = [round(0.05 * i, 2) for i in range(1, 13)]  # 0.05 ~ 0.60
TARGET_ERROR = 0.20  # 일반 조건 계수 오차율
TARGET_ERROR_HARD = 0.30  # 탁도·겹침 조건
TARGET_LATENCY_S = 3.0  # 장당 처리 시간 상한

MISSING_ULTRALYTICS_MSG = (
    "[오류] ultralytics 패키지가 설치되어 있지 않습니다.\n"
    "평가에는 ml 의존성이 필요합니다. vision 디렉터리에서 다음을 실행하세요:\n"
    '    pip install -e ".[ml]"'
)


# ---------------------------------------------------------------------------
# 데이터셋 읽기
# ---------------------------------------------------------------------------


def _yaml_value(text: str, key: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}:"):
            return stripped.split(":", 1)[1].strip().strip("'\"")
    return None


def split_images_dir(data_yaml: Path, split: str) -> Path:
    """data.yaml 의 path/train/val/test 에서 해당 분할의 images 디렉터리를 찾는다."""
    text = data_yaml.read_text(encoding="utf-8", errors="replace")
    key = {"train": "train", "valid": "val", "val": "val", "test": "test"}[split]
    rel = _yaml_value(text, key)
    if rel is None:
        raise SystemExit(f"[오류] {data_yaml} 에 '{key}:' 항목이 없습니다.")
    base = _yaml_value(text, "path")
    root = Path(base).expanduser() if base else data_yaml.parent
    if not root.is_absolute():
        root = (data_yaml.parent / root).resolve()
    images = (root / rel).resolve() if not Path(rel).is_absolute() else Path(rel)
    if not images.is_dir():
        raise SystemExit(f"[오류] 이미지 디렉터리가 없습니다: {images}")
    return images


def label_path_for(image: Path) -> Path:
    """YOLO 규칙: .../images/x.jpg -> .../labels/x.txt"""
    parts = list(image.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "images":
            parts[i] = "labels"
            break
    return Path(*parts).with_suffix(".txt")


def ground_truth_count(image: Path) -> int:
    label = label_path_for(image)
    if not label.exists():
        return 0
    lines = label.read_text(encoding="utf-8", errors="replace").splitlines()
    return sum(1 for line in lines if line.strip())


# ---------------------------------------------------------------------------
# 지표
# ---------------------------------------------------------------------------


@dataclass
class Sample:
    name: str
    gt: int
    scores: list[float] = field(default_factory=list)  # 박스별 신뢰도
    latency_ms: float = 0.0
    hard: bool = False

    def predicted(self, conf: float) -> int:
        return sum(1 for s in self.scores if s >= conf)


def error_rate(pred: int, gt: int) -> float:
    """계수 오차율. 정답이 0 인 장은 예측이 0 이면 0, 아니면 1(100%)로 본다."""
    if gt == 0:
        return 0.0 if pred == 0 else 1.0
    return abs(pred - gt) / gt


def summarize(samples: list[Sample], conf: float) -> dict:
    errors, signed, preds, gts = [], [], [], []
    for s in samples:
        pred = s.predicted(conf)
        errors.append(error_rate(pred, s.gt))
        signed.append(pred - s.gt)
        preds.append(pred)
        gts.append(s.gt)
    n = len(samples)
    if n == 0:
        return {"n": 0}
    within20 = sum(1 for e in errors if e <= TARGET_ERROR) / n
    within30 = sum(1 for e in errors if e <= TARGET_ERROR_HARD) / n
    return {
        "n": n,
        "conf": conf,
        "error_rate_mean": round(statistics.fmean(errors), 4),
        "error_rate_median": round(statistics.median(errors), 4),
        "within_20pct": round(within20, 4),
        "within_30pct": round(within30, 4),
        "mae": round(statistics.fmean(abs(v) for v in signed), 3),
        "bias": round(statistics.fmean(signed), 3),  # +면 과다검출, -면 누락
        "gt_total": sum(gts),
        "pred_total": sum(preds),
        "total_ratio": round(sum(preds) / sum(gts), 4) if sum(gts) else None,
    }


DENSITY_BANDS = ((1, 10), (11, 30), (31, 60), (61, 120), (121, 10**9))


def density_breakdown(samples: list[Sample], conf: float) -> list[dict]:
    rows = []
    for lo, hi in DENSITY_BANDS:
        band = [s for s in samples if lo <= s.gt <= hi]
        if not band:
            continue
        row = summarize(band, conf)
        row["band"] = f"{lo}~{hi if hi < 10**9 else ''}마리"
        rows.append(row)
    empty = [s for s in samples if s.gt == 0]
    if empty:
        row = summarize(empty, conf)
        row["band"] = "0마리(배경)"
        rows.append(row)
    return rows


def best_threshold(samples: list[Sample]) -> tuple[float, dict]:
    scored = [(summarize(samples, t)["error_rate_mean"], t) for t in SWEEP_THRESHOLDS]
    _, best = min(scored, key=lambda pair: (pair[0], pair[1]))
    return best, summarize(samples, best)


# ---------------------------------------------------------------------------
# 추론
# ---------------------------------------------------------------------------


def _load_yolo(weights: str):
    try:
        from ultralytics import YOLO  # noqa: PLC0415 - 무거운 지연 임포트
    except ImportError:
        print(MISSING_ULTRALYTICS_MSG, file=sys.stderr)
        raise SystemExit(1) from None
    return YOLO(weights)


def run_inference(
    weights: str,
    images: list[Path],
    min_conf: float,
    iou: float,
    imgsz: int | None,
    device: str | None,
    hard: set[str],
) -> list[Sample]:
    model = _load_yolo(weights)
    samples: list[Sample] = []
    for image in images:
        start = time.perf_counter()
        kwargs = {"conf": min_conf, "iou": iou, "verbose": False}
        if imgsz:
            kwargs["imgsz"] = imgsz
        if device:
            kwargs["device"] = device
        results = model.predict(str(image), **kwargs)
        latency_ms = (time.perf_counter() - start) * 1000
        scores: list[float] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                scores.append(float(box.conf[0]))
        samples.append(
            Sample(
                name=image.name,
                gt=ground_truth_count(image),
                scores=scores,
                latency_ms=latency_ms,
                hard=image.name in hard,
            )
        )
    return samples


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="계수 오차율(±20%) 평가 — 수행계획서 검수 기준",
    )
    parser.add_argument("--weights", required=True, help="best.pt / .onnx / *_ncnn_model 경로")
    parser.add_argument("--data", required=True, help="prepare_dataset.py 가 만든 data.yaml")
    parser.add_argument("--split", default="valid", choices=("train", "valid", "val", "test"))
    parser.add_argument("--conf", type=float, default=0.25, help="운영에서 쓸 신뢰도 임계값")
    parser.add_argument("--iou", type=float, default=0.7, help="NMS IoU (겹침이 심하면 올린다)")
    parser.add_argument("--imgsz", type=int, default=None, help="추론 해상도(미지정=모델 기본값)")
    parser.add_argument("--device", default=None, help='"cpu", "0" 등. 미지정이면 자동')
    parser.add_argument("--limit", type=int, default=None, help="이미지 수 상한(빠른 점검)")
    parser.add_argument(
        "--hard-list",
        default=None,
        help="탁도·겹침 이미지 파일명 목록(한 줄에 하나). 이 묶음은 ±30%% 기준으로 판정",
    )
    parser.add_argument("--json", default=None, help="결과 JSON 저장 경로")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="기준 미달이면 종료 코드 2 로 끝낸다(자동화용)",
    )
    return parser.parse_args(argv)


def _print_row(title: str, row: dict) -> None:
    if not row.get("n"):
        return
    print(
        f"  {title:14} n={row['n']:5} 평균오차 {row['error_rate_mean'] * 100:5.1f}% "
        f"중앙 {row['error_rate_median'] * 100:5.1f}% "
        f"±20% 내 {row['within_20pct'] * 100:5.1f}% "
        f"MAE {row['mae']:6.2f} 편향 {row['bias']:+6.2f}"
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    data_yaml = Path(args.data).expanduser().resolve()
    images_dir = split_images_dir(data_yaml, args.split)
    images = sorted(p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if args.limit:
        images = images[: args.limit]
    if not images:
        raise SystemExit(f"[오류] 평가할 이미지가 없습니다: {images_dir}")

    hard: set[str] = set()
    if args.hard_list:
        hard = {
            line.strip()
            for line in Path(args.hard_list).read_text(encoding="utf-8").splitlines()
            if line.strip()
        }

    min_conf = min(SWEEP_THRESHOLDS + [args.conf])
    print(f"[평가] {len(images)}장 @ {images_dir}")
    samples = run_inference(
        args.weights, images, min_conf, args.iou, args.imgsz, args.device, hard
    )

    overall = summarize(samples, args.conf)
    easy = [s for s in samples if not s.hard]
    hard_samples = [s for s in samples if s.hard]
    latencies = sorted(s.latency_ms for s in samples)
    p95 = latencies[min(len(latencies) - 1, int(0.95 * len(latencies)))]
    rec_conf, rec = best_threshold(samples)

    print(f"\n[conf={args.conf}] 전체")
    _print_row("전체", overall)
    print(
        f"  합계 정답 {overall['gt_total']}마리 / 예측 {overall['pred_total']}마리 "
        f"(비율 {overall['total_ratio']})"
    )
    if hard_samples:
        print("\n[조건별]")
        _print_row("일반", summarize(easy, args.conf))
        _print_row("탁도·겹침", summarize(hard_samples, args.conf))

    print("\n[밀도 구간별]")
    for row in density_breakdown(samples, args.conf):
        _print_row(row["band"], row)

    print("\n[임계값 훑기] 추가 추론 없이 conf 만 바꿔 다시 센 결과")
    for t in SWEEP_THRESHOLDS:
        row = summarize(samples, t)
        mark = " <= 추천" if t == rec_conf else ""
        print(
            f"  conf={t:.2f} 평균오차 {row['error_rate_mean'] * 100:5.1f}% "
            f"±20% 내 {row['within_20pct'] * 100:5.1f}% 편향 {row['bias']:+6.2f}{mark}"
        )

    worst = sorted(samples, key=lambda s: -error_rate(s.predicted(args.conf), s.gt))[:10]
    print("\n[오차가 큰 장면]")
    for s in worst:
        pred = s.predicted(args.conf)
        rate = error_rate(pred, s.gt) * 100
        print(f"  {s.name[:60]:60} 정답 {s.gt:4} 예측 {pred:4} 오차 {rate:5.1f}%")

    print(
        f"\n[처리 시간] 이 장비 기준 중앙 {statistics.median(latencies):.0f}ms "
        f"p95 {p95:.0f}ms (라즈베리파이 실측은 ai/trainer/export_edge.py --bench 로)"
    )

    ok_general = summarize(easy or samples, args.conf)["error_rate_mean"] <= TARGET_ERROR
    ok_hard = (
        summarize(hard_samples, args.conf)["error_rate_mean"] <= TARGET_ERROR_HARD
        if hard_samples
        else True
    )
    print("\n[판정]")
    print(f"  일반 계수 오차율 ±20%   : {'통과' if ok_general else '미달'}")
    if hard_samples:
        print(f"  탁도·겹침 오차율 ±30%   : {'통과' if ok_hard else '미달'}")
    print(f"  추천 conf              : {rec_conf} (평균오차 {rec['error_rate_mean'] * 100:.1f}%)")
    if rec_conf != args.conf:
        print(f"  -> 운영 설정 CONFIDENCE_THRESHOLD={rec_conf} 을(를) 검토하세요.")

    if args.json:
        payload = {
            "weights": args.weights,
            "data": str(data_yaml),
            "split": args.split,
            "conf": args.conf,
            "iou": args.iou,
            "overall": overall,
            "easy": summarize(easy, args.conf) if hard_samples else None,
            "hard": summarize(hard_samples, args.conf) if hard_samples else None,
            "density": density_breakdown(samples, args.conf),
            "sweep": {str(t): summarize(samples, t) for t in SWEEP_THRESHOLDS},
            "recommended_conf": rec_conf,
            "latency_ms": {
                "median": round(statistics.median(latencies), 1),
                "p95": round(p95, 1),
            },
            "targets": {
                "error_rate": TARGET_ERROR,
                "error_rate_hard": TARGET_ERROR_HARD,
                "latency_s": TARGET_LATENCY_S,
            },
            "pass": bool(ok_general and ok_hard),
        }
        Path(args.json).expanduser().write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n[저장] {args.json}")

    if args.strict and not (ok_general and ok_hard):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
