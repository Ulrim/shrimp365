"""학습한 모델로 라벨 없는 이미지에 미리 라벨을 달아 두는 도구(사전 라벨링).

드라이브의 `02. 흰다리새우 이미지_해외`(DB1~DB5)와 우리 수조에서 뽑은 프레임은
**라벨이 없어서** 학습에 넣을 수 없습니다. 전부 손으로 그리면 한 장에 몇 분씩
걸리는데, 1차 모델로 박스를 미리 찍어 두고 사람이 **고치기만** 하면 훨씬 빠릅니다.

    python ai/trainer/pseudo_label.py --weights runs/shrimp/weights/best.pt \
        --images '/drive/.../02. 흰다리새우 이미지_해외/DB1' \
        --out datasets/db1_prelabel --conf 0.4

결과는 Roboflow·CVAT 에 그대로 올릴 수 있는 형태(images/ + labels/ + data.yaml)로
나옵니다. 사람이 고친 뒤 내려받아 `prepare_dataset.py --source` 에 추가하면 됩니다.

⚠ **사람이 고치지 않은 사전 라벨을 그대로 학습에 쓰면 안 됩니다.** 모델이 자기
실수를 정답으로 배워, 틀린 방향으로 자신감만 커집니다(확증 편향). 이 도구는
사람의 작업량을 줄이는 것이지 사람을 대신하는 것이 아닙니다.

`--conf` 는 평가 때보다 높게 잡습니다. 빠진 박스를 새로 그리는 것보다 잘못
찍힌 박스를 지우는 편이 손이 더 가기 때문입니다.
"""
from __future__ import annotations

import argparse
import shutil
import statistics
import sys
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

MISSING_ULTRALYTICS_MSG = (
    "[오류] ultralytics 패키지가 설치되어 있지 않습니다.\n"
    "사전 라벨링에는 ml 의존성이 필요합니다. vision 디렉터리에서 다음을 실행하세요:\n"
    '    pip install -e ".[ml]"'
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="학습한 모델로 라벨 없는 이미지에 사전 라벨을 만든다(사람이 고칠 것)",
    )
    parser.add_argument("--weights", required=True, help="best.pt 또는 .onnx")
    parser.add_argument("--images", required=True, help="라벨 없는 이미지 디렉터리")
    parser.add_argument("--out", required=True, help="출력 디렉터리(images/ + labels/)")
    parser.add_argument(
        "--conf",
        type=float,
        default=0.4,
        help="신뢰도 임계값. 평가 때보다 높게 — 지우는 쪽이 그리는 쪽보다 쉽다",
    )
    parser.add_argument("--iou", type=float, default=0.7, help="NMS IoU")
    parser.add_argument("--max-det", type=int, default=1000, help="한 장 최대 개체 수")
    parser.add_argument("--imgsz", type=int, default=None, help="추론 해상도")
    parser.add_argument("--device", default=None, help='"cpu", "0" 등')
    parser.add_argument("--limit", type=int, default=None, help="이미지 수 상한")
    parser.add_argument("--recursive", action="store_true", help="하위 폴더까지 훑는다")
    parser.add_argument(
        "--class-name", default="shrimp", help="생성할 data.yaml 의 클래스 이름"
    )
    parser.add_argument(
        "--link",
        action="store_true",
        help="이미지를 복사하지 않고 심볼릭 링크로 둔다(업로드용이면 복사가 낫다)",
    )
    return parser.parse_args(argv)


def collect_images(root: Path, recursive: bool, limit: int | None) -> list[Path]:
    if not root.is_dir():
        raise SystemExit(f"[오류] 이미지 디렉터리가 없습니다: {root}")
    walker = root.rglob("*") if recursive else root.iterdir()
    images = sorted(p for p in walker if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES)
    if limit:
        images = images[:limit]
    if not images:
        raise SystemExit(f"[오류] 이미지를 찾지 못했습니다: {root}")
    return images


def to_yolo_line(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> str | None:
    """픽셀 xyxy -> YOLO 정규화 `0 중심x 중심y 폭 높이`. 크기가 0 이면 None."""
    box_w, box_h = (x2 - x1) / width, (y2 - y1) / height
    if box_w <= 0 or box_h <= 0:
        return None
    xc, yc = (x1 + x2) / 2 / width, (y1 + y2) / 2 / height
    return f"0 {xc:.6f} {yc:.6f} {box_w:.6f} {box_h:.6f}"


def _load_model(weights: str):  # noqa: ANN202
    try:
        from ultralytics import YOLO  # noqa: PLC0415 - 무거운 지연 임포트
    except ImportError:
        print(MISSING_ULTRALYTICS_MSG, file=sys.stderr)
        raise SystemExit(1) from None
    return YOLO(weights)


def write_data_yaml(out_root: Path, class_name: str) -> Path:
    path = out_root / "data.yaml"
    path.write_text(
        "# pseudo_label.py 가 만든 사전 라벨입니다. **사람이 고친 뒤** 쓰세요.\n"
        f"path: {out_root.resolve()}\n"
        "train: images\n"
        "val: images\n"
        "\n"
        "nc: 1\n"
        f"names: ['{class_name}']\n",
        encoding="utf-8",
    )
    return path


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    images = collect_images(Path(args.images).expanduser(), args.recursive, args.limit)
    out_root = Path(args.out).expanduser()
    (out_root / "images").mkdir(parents=True, exist_ok=True)
    (out_root / "labels").mkdir(parents=True, exist_ok=True)

    model = _load_model(args.weights)
    print(f"[사전 라벨링] {len(images)}장, conf={args.conf}")

    counts: list[int] = []
    empty: list[str] = []
    for index, image_path in enumerate(images, start=1):
        kwargs = {
            "conf": args.conf,
            "iou": args.iou,
            "max_det": args.max_det,
            "verbose": False,
        }
        if args.imgsz:
            kwargs["imgsz"] = args.imgsz
        if args.device:
            kwargs["device"] = args.device
        results = model.predict(str(image_path), **kwargs)

        lines: list[str] = []
        for result in results:
            if result.boxes is None:
                continue
            height, width = result.orig_shape
            for box in result.boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                line = to_yolo_line(x1, y1, x2, y2, width, height)
                if line:
                    lines.append(line)

        out_image = out_root / "images" / image_path.name
        if out_image.exists() or out_image.is_symlink():
            out_image.unlink()
        if args.link:
            out_image.symlink_to(image_path.resolve())
        else:
            shutil.copy2(image_path, out_image)
        (out_root / "labels" / f"{image_path.stem}.txt").write_text(
            "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
        )

        counts.append(len(lines))
        if not lines:
            empty.append(image_path.name)
        if index % 50 == 0:
            print(f"  {index}/{len(images)}")

    yaml_path = write_data_yaml(out_root, args.class_name)
    ordered = sorted(counts)
    print(
        f"[완료] {len(images)}장, 박스 {sum(counts)}개 "
        f"(장당 중앙값 {statistics.median(ordered):.0f}, 최대 {ordered[-1]})"
    )
    if empty:
        print(f"  박스가 하나도 없는 장 {len(empty)}개 — 새우가 없거나 모델이 못 본 것입니다.")
        for name in empty[:5]:
            print(f"    {name}")
    print(f"  {yaml_path}")
    print("\n다음 단계")
    print("  1. 이 폴더를 Roboflow/CVAT 에 올려 **사람이 박스를 고칩니다**")
    print("     (빠진 것은 추가하고, 잘못 찍힌 것은 지웁니다)")
    print("  2. 고친 데이터셋을 YOLOv8 형식으로 내려받습니다.")
    print("  3. prepare_dataset.py --source <이름>=<경로> 로 학습 데이터에 합칩니다.")
    print("  고치지 않은 사전 라벨로 학습하면 모델이 자기 실수를 정답으로 배웁니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
