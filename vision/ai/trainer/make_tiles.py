"""큰 사진을 겹치는 조각(타일)으로 잘라 학습·평가용 자료를 만든다.

왜 필요한가
    급이대를 위에서 찍은 사진(예: 1512×2016)을 모델 입력 크기(416)로 줄이면
    20cm 급이대 위의 새우 한 마리가 40px 남짓으로 줄어 그물 무늬·수면 반사와
    구분되지 않는다. 사진을 조각내 조각마다 따로 보면 새우가 원래 크기에 가깝게
    남는다. 학습도 같은 방식으로 자른 조각으로 해야 추론 때와 크기가 맞는다.

쓰임
    python ai/trainer/make_tiles.py \\
        --images data/tank/labeled/train/images \\
        --labels data/tank/labeled/train/labels \\
        --out    data/tank/tiles/train --tile 768 --overlap 0.25 --keep-full

    라벨은 YOLO 형식(`class cx cy w h`, 0~1 정규화)으로 읽고 쓴다.
    조각 이름은 `<원본이름>__x<좌>_y<상>.jpg` 이다. 원본 이름의 `.rf.` 앞부분
    (촬영 회차)이 그대로 남으므로 prepare_dataset.py 가 한 회차를 한 분할로 묶는다.

규칙
    * 상자가 조각 경계에 잘리면 조각 안쪽 부분만 남긴다.
    * 잘린 뒤 남은 넓이가 원래의 `--min-visible`(기본 0.5) 미만이면 그 조각에서는
      버린다 — 라벨링 기준의 "몸통 절반 이상 보일 때만 그린다"와 같은 기준이다.
    * 새우가 없는 조각도 **지우지 않는다.** 수면 반사·그물만 있는 조각이 있어야
      모델이 그것을 새우로 착각하지 않게 배운다.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VISION = HERE.parent.parent          # vision/
if str(VISION) not in sys.path:
    sys.path.insert(0, str(VISION))

# 자르는 방식은 추론(app/services/tiling.py)과 **같은 구현**을 쓴다.
from app.services.tiling import tile_origins  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp"}

Box = tuple[float, float, float, float]  # x1, y1, x2, y2 (픽셀)


def clip_boxes(
    boxes: list[Box],
    x0: int,
    y0: int,
    width: int,
    height: int,
    min_visible: float = 0.5,
) -> list[Box]:
    """조각 (x0, y0, width, height) 안에 드는 상자를 조각 좌표로 옮겨 돌려준다."""
    kept: list[Box] = []
    for bx1, by1, bx2, by2 in boxes:
        area = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
        if area <= 0:
            continue
        cx1, cy1 = max(bx1, x0), max(by1, y0)
        cx2, cy2 = min(bx2, x0 + width), min(by2, y0 + height)
        visible = max(0.0, cx2 - cx1) * max(0.0, cy2 - cy1)
        if visible <= 0 or visible / area < min_visible:
            continue
        kept.append((cx1 - x0, cy1 - y0, cx2 - x0, cy2 - y0))
    return kept


def read_yolo(path: Path, width: int, height: int) -> list[Box]:
    """YOLO 라벨 파일을 픽셀 상자로 읽는다. 파일이 없으면 빈 목록(새우 없는 사진)."""
    if not path.exists():
        return []
    boxes: list[Box] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        cx, cy, w, h = (float(v) for v in parts[1:5])
        boxes.append(
            (
                (cx - w / 2) * width,
                (cy - h / 2) * height,
                (cx + w / 2) * width,
                (cy + h / 2) * height,
            )
        )
    return boxes


def format_yolo(boxes: list[Box], width: int, height: int) -> str:
    lines = []
    for x1, y1, x2, y2 in boxes:
        cx, cy = (x1 + x2) / 2 / width, (y1 + y2) / 2 / height
        w, h = (x2 - x1) / width, (y2 - y1) / height
        lines.append(f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


def make_tiles(
    images: Path,
    labels: Path,
    out: Path,
    *,
    tile: int = 768,
    overlap: float = 0.25,
    min_visible: float = 0.5,
    keep_full: bool = False,
    quality: int = 92,
) -> dict[str, int]:
    """`images`·`labels` 를 조각내 `out/images`·`out/labels` 에 쓴다. 집계를 돌려준다."""
    from PIL import Image  # noqa: PLC0415 - 테스트가 순수 함수만 쓸 때 PIL 없이도 import 되게

    out_images, out_labels = out / "images", out / "labels"
    out_images.mkdir(parents=True, exist_ok=True)
    out_labels.mkdir(parents=True, exist_ok=True)

    stats = {"사진": 0, "조각": 0, "빈_조각": 0, "원본_상자": 0, "조각_상자": 0}
    sources = sorted(p for p in images.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    for source in sources:
        with Image.open(source) as opened:
            image = opened.convert("RGB")
        width, height = image.size
        boxes = read_yolo(labels / f"{source.stem}.txt", width, height)
        stats["사진"] += 1
        stats["원본_상자"] += len(boxes)

        for y0 in tile_origins(height, tile, overlap):
            for x0 in tile_origins(width, tile, overlap):
                tw, th = min(tile, width), min(tile, height)
                kept = clip_boxes(boxes, x0, y0, tw, th, min_visible)
                name = f"{source.stem}__x{x0}_y{y0}"
                image.crop((x0, y0, x0 + tw, y0 + th)).save(
                    out_images / f"{name}.jpg", quality=quality
                )
                (out_labels / f"{name}.txt").write_text(
                    format_yolo(kept, tw, th), encoding="utf-8"
                )
                stats["조각"] += 1
                stats["조각_상자"] += len(kept)
                stats["빈_조각"] += 0 if kept else 1

        if keep_full:
            shutil.copy2(source, out_images / source.name)
            (out_labels / f"{source.stem}.txt").write_text(
                format_yolo(boxes, width, height), encoding="utf-8"
            )
    return stats


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="큰 사진을 겹치는 조각으로 자른다")
    parser.add_argument("--images", required=True, type=Path)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--tile", type=int, default=768, help="조각 한 변(px)")
    parser.add_argument("--overlap", type=float, default=0.25, help="이웃 조각과 겹치는 비율")
    parser.add_argument(
        "--min-visible",
        type=float,
        default=0.5,
        help="잘린 상자를 남기는 최소 넓이 비율(라벨링 기준의 '몸통 절반')",
    )
    parser.add_argument(
        "--keep-full", action="store_true", help="조각과 함께 원본 사진도 그대로 넣는다"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.images.is_dir():
        print(f"[오류] 사진 폴더가 없습니다: {args.images}", file=sys.stderr)
        return 1
    stats = make_tiles(
        args.images,
        args.labels,
        args.out,
        tile=args.tile,
        overlap=args.overlap,
        min_visible=args.min_visible,
        keep_full=args.keep_full,
    )
    if stats["사진"] == 0:
        print(f"[오류] 사진이 한 장도 없습니다: {args.images}", file=sys.stderr)
        return 1
    print(
        f"사진 {stats['사진']}장 → 조각 {stats['조각']}개 "
        f"(새우 없는 조각 {stats['빈_조각']}개), "
        f"상자 {stats['원본_상자']}개 → 조각 기준 {stats['조각_상자']}개"
    )
    print(f"출력: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
