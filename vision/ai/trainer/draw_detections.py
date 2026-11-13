#!/usr/bin/env python3
"""정답 박스와 배포본의 예측을 한 장에 겹쳐 그린다 — 눈으로 확인하려고.

수치만 보고서에 적으면 "그래서 뭘 잘못 잡았나"를 아무도 모른다. 틀린 장면을
눈으로 봐야 원인을 찾을 수 있고, 점검위원도 그림 한 장이면 납득한다.

    초록 = 정답(사람이 붙인 라벨)
    빨강 = 배포본의 예측 (신뢰도 함께 적는다)

추론은 `eval_detect.py` 와 똑같이 배포 경로(detector_onnx)로 한다.

    cd vision
    python ai/trainer/draw_detections.py \
        --weights ai/models/shrimp_yolov8n_416.onnx \
        --images <폴더> --labels <폴더> --out out/그림 --limit 6
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VISION = HERE.parent.parent
if str(VISION) not in sys.path:
    sys.path.insert(0, str(VISION))

from ai.trainer.eval_detect import (  # noqa: E402
    find_images,
    frame_for_detector,
    label_for,
    read_gt,
)

GT_COLOR = (34, 197, 94)
PRED_COLOR = (239, 68, 68)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="정답·예측을 겹쳐 그린다")
    p.add_argument("--weights", required=True)
    p.add_argument("--images", required=True)
    p.add_argument("--labels", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--limit", type=int, default=0, help="앞에서 N장만(0=전부)")
    p.add_argument("--tile", type=int, default=0, help="조각 추론 크기(px). 0=통째로")
    p.add_argument("--tile-overlap", type=float, default=0.25)
    args = p.parse_args(argv)

    from PIL import Image, ImageDraw

    from app.services.detector_onnx import OnnxShrimpDetector
    from app.services.tiling import detect_tiled

    images_dir = Path(args.images).resolve()
    labels_dir = Path(args.labels).resolve() if args.labels else images_dir.parent / "labels"
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    detector = OnnxShrimpDetector(model_path=str(Path(args.weights).resolve()),
                                  conf_threshold=args.conf, tile=0)
    paths = find_images(images_dir)
    if args.limit:
        paths = paths[: args.limit]

    for path in paths:
        with Image.open(path) as im:
            frame = frame_for_detector(im)
        if args.tile:
            result = detect_tiled(detector, frame, tile=args.tile, overlap=args.tile_overlap)
        else:
            result = detector.detect(frame)
        gt = read_gt(label_for(path, images_dir, labels_dir), frame.width, frame.height)

        canvas = frame.copy()
        draw = ImageDraw.Draw(canvas)
        for x1, y1, x2, y2 in gt.tolist():
            draw.rectangle([x1, y1, x2, y2], outline=GT_COLOR, width=3)
        for b in result.bboxes:
            draw.rectangle([b.x1, b.y1, b.x2, b.y2], outline=PRED_COLOR, width=2)
            draw.text((b.x1 + 3, max(0, b.y1 - 12)), f"{b.confidence:.2f}", fill=PRED_COLOR)
        draw.text((6, 6), f"정답 {len(gt)} · 예측 {len(result.bboxes)}", fill=(255, 255, 255))

        dest = out_dir / f"{path.stem}.jpg"
        canvas.save(dest, quality=90)
        print(f"  {dest.name}  정답 {len(gt)} · 예측 {len(result.bboxes)}")
    print(f"{len(paths)}장 그렸습니다 → {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
