"""현장 수조 사진으로 탐지 모델을 학습한다 — 조각 자료 + 장면 묶음 단위 분할.

왜 train.py 와 따로 두는가
    train.py 는 공개 데이터셋(쟁반 위 새우)을 통째로 학습하는 일반 CLI 다. 수조
    사진은 (1) 조각으로 잘라야 새우가 제 크기로 남고, (2) 몇 초 간격으로 찍은
    거의 같은 장면이 많아 **장면 묶음 단위로** 나눠야 평가가 부풀지 않는다.
    이 두 가지를 한 번에 지키는 고정 절차를 여기에 둔다.

쓰임 (vision/ 에서, ml extra 필요)
    # 묶음 A 를 빼고 학습 → 뺀 묶음으로 평가 (교차검증의 한 번)
    python ai/trainer/train_tank.py --holdout A --out data/tank/tiles/cvA
    # 전부 학습 (배포용)
    python ai/trainer/train_tank.py --holdout none --out data/tank/tiles/all

    만들어지는 것
        <out>/train/{images,labels}     조각 + 원본 (학습용)
        <out>/heldout/{images,labels}   뺀 묶음의 **원본 사진** (평가용, 조각내지 않음)
        <out>/data.yaml
        ai/trainer/runs/<이름>/weights/last.pt

    평가는 배포 경로 그대로 한다.
        python ai/trainer/export_edge.py --weights <last.pt> --format onnx --imgsz 416
        python ai/trainer/eval_detect.py --weights <last.onnx> \\
            --images <out>/heldout/images --labels <out>/heldout/labels --tile 1008

지킨 것
    * 검증 분할로 모델을 고르지 않는다(val=False, 마지막 에폭의 last.pt).
      뺀 묶음을 보고 에폭을 고르면 그 묶음의 점수가 더는 처음 보는 점수가 아니다.
    * 조각은 추론(app/services/tiling.py)과 같은 함수로 자른다(make_tiles.py).
"""
from __future__ import annotations

import argparse
import csv
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VISION = HERE.parent.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import make_tiles  # noqa: E402

DEFAULT_LABELED = VISION / "data" / "tank" / "labeled"
SEED = 20261112

# 고정 학습 설정. 급이대를 위에서 찍으므로 새우의 방향에 위아래가 없다 → 상하·좌우
# 뒤집기와 회전을 모두 쓴다. scale 은 조각 크기와 추론 해상도의 차이를 덮는다.
RECIPE: dict = {
    "imgsz": 640,
    "batch": 8,
    "flipud": 0.5,
    "fliplr": 0.5,
    "degrees": 15,
    "scale": 0.6,
    "mosaic": 1.0,
    "close_mosaic": 10,
    "hsv_h": 0.02,
    "hsv_s": 0.5,
    "hsv_v": 0.4,
    "val": False,
    "seed": SEED,
    "deterministic": True,
    "plots": False,
    "amp": False,
}

MISSING_ULTRALYTICS_MSG = (
    "[오류] ultralytics 패키지가 설치되어 있지 않습니다.\n"
    '모델 학습에는 ml 의존성이 필요합니다: pip install -e ".[ml]"'
)


def read_scenes(index_tsv: Path) -> dict[str, str]:
    """index.tsv → {파일 이름: 장면 묶음}."""
    with index_tsv.open(encoding="utf-8") as handle:
        return {row["파일"]: row["장면묶음"] for row in csv.DictReader(handle, delimiter="\t")}


def build_fold(
    labeled: Path,
    out: Path,
    holdout: str | None,
    *,
    tile: int = 768,
    overlap: float = 0.25,
) -> dict[str, int]:
    """`labeled` 를 학습용 조각과 평가용 원본으로 나눠 `out` 에 쓴다.

    `holdout` 은 뺄 장면 묶음 이름(없으면 전부 학습). 묶음에 든 사진은 **한 장도**
    학습 쪽에 들어가지 않는다.
    """
    scenes = read_scenes(labeled / "index.tsv")
    if holdout is not None and holdout not in set(scenes.values()):
        known = sorted(set(scenes.values()))
        raise ValueError(f"장면 묶음 '{holdout}' 이 index.tsv 에 없습니다: {known}")
    if out.exists():
        shutil.rmtree(out)

    staging = out / "_train_full"
    held = out / "heldout"
    counts = {"학습_사진": 0, "평가_사진": 0}
    for name, scene in sorted(scenes.items()):
        target = held if scene == holdout else staging
        (target / "images").mkdir(parents=True, exist_ok=True)
        (target / "labels").mkdir(parents=True, exist_ok=True)
        stem = Path(name).stem
        shutil.copy2(labeled / "images" / name, target / "images" / name)
        shutil.copy2(labeled / "labels" / f"{stem}.txt", target / "labels" / f"{stem}.txt")
        counts["평가_사진" if scene == holdout else "학습_사진"] += 1
    if counts["학습_사진"] == 0:
        raise ValueError("학습에 쓸 사진이 한 장도 남지 않았습니다")

    stats = make_tiles.make_tiles(
        staging / "images",
        staging / "labels",
        out / "train",
        tile=tile,
        overlap=overlap,
        keep_full=True,
    )
    shutil.rmtree(staging)
    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: train/images\nval: train/images\nnames:\n  0: shrimp\n",
        encoding="utf-8",
    )
    return {**counts, "조각": stats["조각"], "조각_상자": stats["조각_상자"]}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="현장 수조 사진으로 탐지 모델 학습")
    parser.add_argument("--labeled", type=Path, default=DEFAULT_LABELED)
    parser.add_argument("--out", type=Path, required=True, help="조각 자료를 쓸 폴더")
    parser.add_argument(
        "--holdout", required=True, help="평가용으로 뺄 장면 묶음(index.tsv). 전부 학습은 none"
    )
    parser.add_argument("--tile", type=int, default=768)
    parser.add_argument("--overlap", type=float, default=0.25)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--base-model", default="yolov8n.pt")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--project", default=str(HERE / "runs"))
    parser.add_argument("--name", default=None, help="실행 이름(기본: tank_<묶음>)")
    parser.add_argument(
        "--build-only", action="store_true", help="자료만 만들고 학습은 하지 않는다"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    holdout = None if args.holdout.lower() == "none" else args.holdout
    try:
        counts = build_fold(args.labeled, args.out, holdout, tile=args.tile, overlap=args.overlap)
    except (ValueError, FileNotFoundError) as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        return 1
    print(
        f"학습 {counts['학습_사진']}장(조각 {counts['조각']}개, 상자 {counts['조각_상자']}개) · "
        f"평가 {counts['평가_사진']}장 → {args.out}"
    )
    if args.build_only:
        return 0

    try:
        from ultralytics import YOLO  # noqa: PLC0415 - 무거운 의존성은 늦게 부른다
    except ImportError:
        print(MISSING_ULTRALYTICS_MSG, file=sys.stderr)
        return 1

    name = args.name or f"tank_{holdout or 'all'}"
    YOLO(args.base_model).train(
        data=str(args.out / "data.yaml"),
        epochs=args.epochs,
        device=args.device,
        workers=args.workers,
        cache=True,
        project=args.project,
        name=name,
        exist_ok=True,
        **RECIPE,
    )
    print(f"가중치: {Path(args.project) / name / 'weights' / 'last.pt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
