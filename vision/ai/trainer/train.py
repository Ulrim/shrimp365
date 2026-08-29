"""YOLOv8 흰다리새우 탐지 모델 파인튜닝 CLI (plan §8.2).

Usage (ml extra required: `pip install -e ".[ml]"`):

    python ai/trainer/train.py --data ai/trainer/data.yaml --epochs 100
    python ai/trainer/train.py --base-model yolov8s.pt --batch 8 --device 0
    python ai/trainer/train.py --install   # copy best.pt to ai/models/

Target metric (plan §8.2): mAP@0.5 >= 0.85 on the validation split.
The heavy ultralytics import is lazy so this file parses/imports without the
ml extra installed and exits with a friendly Korean message instead.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

TARGET_MAP50 = 0.85
_HERE = Path(__file__).resolve().parent
DEFAULT_INSTALL_PATH = _HERE.parent / "models" / "shrimp_yolov8n.pt"

MISSING_ULTRALYTICS_MSG = (
    "[오류] ultralytics 패키지가 설치되어 있지 않습니다.\n"
    "모델 학습에는 ml 의존성이 필요합니다. backend 디렉터리에서 다음을 실행하세요:\n"
    '    pip install -e ".[ml]"'
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="YOLOv8 shrimp detector fine-tuning (CULIVER ShrimpVision)",
    )
    parser.add_argument("--data", default=str(_HERE / "data.yaml"), help="dataset yaml")
    parser.add_argument("--base-model", default="yolov8n.pt", help="base weights to fine-tune")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="auto", help='"auto", "cpu", "0", "0,1", ...')
    parser.add_argument("--project", default=str(_HERE / "runs"), help="output project dir")
    parser.add_argument("--name", default="shrimp_yolov8", help="run name (subdir of project)")
    parser.add_argument(
        "--install",
        action="store_true",
        help=f"on success, copy best.pt to {DEFAULT_INSTALL_PATH}",
    )
    return parser.parse_args(argv)


def _load_yolo_class():
    try:
        from ultralytics import YOLO  # noqa: PLC0415 - lazy heavy import
    except ImportError:
        print(MISSING_ULTRALYTICS_MSG, file=sys.stderr)
        raise SystemExit(1) from None
    return YOLO


def _final_map50(results) -> float | None:  # noqa: ANN001 - ultralytics metrics obj
    try:
        return float(results.box.map50)
    except (AttributeError, TypeError):
        try:
            return float(results.results_dict.get("metrics/mAP50(B)"))
        except (AttributeError, TypeError):
            return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    yolo_cls = _load_yolo_class()

    model = yolo_cls(args.base_model)
    device = None if args.device == "auto" else args.device
    print(f"[학습 시작] data={args.data} base={args.base_model} epochs={args.epochs}")
    results = model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=device,
        project=args.project,
        name=args.name,
    )

    map50 = _final_map50(results)
    if map50 is not None:
        status = "달성" if map50 >= TARGET_MAP50 else "미달"
        print(f"[학습 완료] mAP@0.5 = {map50:.4f} (목표 {TARGET_MAP50:.2f} {status})")
        if map50 < TARGET_MAP50:
            print("목표 성능 미달 — 데이터 추가 수집/증강 또는 하이퍼파라미터 조정을 검토하세요.")
    else:
        print("[학습 완료] 최종 mAP@0.5 지표를 읽지 못했습니다. 학습 로그를 확인하세요.")

    save_dir = Path(getattr(results, "save_dir", Path(args.project) / args.name))
    best = save_dir / "weights" / "best.pt"
    if best.exists():
        print(f"최적 가중치: {best}")
        if args.install:
            DEFAULT_INSTALL_PATH.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(best, DEFAULT_INSTALL_PATH)
            print(f"[설치 완료] {DEFAULT_INSTALL_PATH} (MODEL_PATH 기본 경로)")
    else:
        print(f"best.pt를 찾지 못했습니다: {best}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
