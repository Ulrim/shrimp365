#!/usr/bin/env python3
"""점검용 수조 사진 한 장을 만든다 — 장비가 실제로 보내는 모양 그대로.

scripts/check-vision-frame-ui.mjs 가 흉내 서버로 내려 주는 사진이다. 손으로
그린 아무 그림이 아니라 **장비와 같은 코드**(app.services.rendering)로 굽는다.
그래야 위쪽 머리글 띠와 세는 범위 표시가 현장과 같은 자리에 놓이고, 웹 배지가
그 글자를 가리지 않는지 보는 점검이 뜻을 갖는다.

실행 (저장소 루트에서):

    vision/.venv/bin/python scripts/fixtures/make-vision-frame.py

결과물은 커밋한다 — 점검을 돌릴 때마다 파이썬 환경이 있어야 하면 곤란하다.
"""
from __future__ import annotations

import random
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vision"))

from PIL import Image, ImageDraw  # noqa: E402

from app.services.detector import BBox, DetectionResult  # noqa: E402
from app.services.rendering import annotate_frame, encode_jpeg  # noqa: E402

OUT = ROOT / "scripts" / "fixtures" / "vision-frame-640x360.jpg"

#: 장비가 올리는 크기(settings.snapshot_width 로 줄인 뒤의 모양).
WIDTH, HEIGHT = 640, 360
#: 고정된 시각 — 점검 결과가 돌릴 때마다 달라지면 안 된다.
WHEN = datetime(2026, 10, 16, 1, 2, 3, tzinfo=UTC)


def tank_background() -> Image.Image:
    """수조처럼 보이는 밑그림. 평평한 색으로 두면 JPEG 가 비현실적으로 작아진다."""
    random.seed(7)
    img = Image.new("RGB", (WIDTH, HEIGHT), (18, 52, 66))
    draw = ImageDraw.Draw(img)
    for x in range(0, WIDTH, 40):           # 먹이망 격자(축척의 근거)
        draw.line((x, 0, x, HEIGHT), fill=(28, 74, 88), width=1)
    for y in range(0, HEIGHT, 38):
        draw.line((0, y, WIDTH, y), fill=(28, 74, 88), width=1)
    for _ in range(600):                    # 물속 잡티
        draw.point(
            (random.randrange(WIDTH), random.randrange(HEIGHT)),
            fill=(40 + random.randrange(40),) * 3,
        )
    return img


def main() -> None:
    boxes = [(150, 160, 205, 185, 0.88), (300, 120, 352, 148, 0.81), (420, 230, 478, 258, 0.76)]
    bb = [BBox(*b) for b in boxes]
    result = DetectionResult(
        count=len(bb), bboxes=bb, confidence_avg=0.817, inference_ms=41,
        frame_width=WIDTH, frame_height=HEIGHT, model_version="shrimp-y8n-416",
    )
    frame = annotate_frame(
        tank_background(), result, "1호 수조 카메라", WHEN, roi=(0.08, 0.12, 0.92, 0.88)
    )
    data = encode_jpeg(frame, quality=60)
    OUT.write_bytes(data)
    print(f"{OUT.relative_to(ROOT)} — {len(data):,} 바이트, {frame.width}×{frame.height}")


if __name__ == "__main__":
    main()
