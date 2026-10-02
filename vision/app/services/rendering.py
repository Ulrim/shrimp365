"""Frame annotation (bounding boxes + count overlay) and JPEG encoding.

Pillow-only so it works without OpenCV installed.
"""
from __future__ import annotations

import io
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.config import settings
from app.services.detector import DetectionResult

BOX_COLOR = (80, 255, 140)
TEXT_BG = (0, 0, 0, 160)

# Hangul-capable fonts first (Docker image installs Noto CJK), then latin-only
# fallbacks. The bool marks whether the font can render Hangul.
_FONT_CANDIDATES: list[tuple[str, bool]] = [
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", True),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", True),
    ("/usr/share/fonts/truetype/nanum/NanumGothic.ttf", True),
    ("/usr/share/fonts/opentype/unifont/unifont.otf", True),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", False),
]


@lru_cache(maxsize=1)
def _overlay_font() -> tuple[ImageFont.ImageFont | ImageFont.FreeTypeFont, bool]:
    """(font, supports_hangul). Falls back to PIL's built-in bitmap font."""
    for path, hangul in _FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, 16), hangul
            except OSError:
                continue
    return ImageFont.load_default(), False


def _ascii_safe(text: str) -> str:
    return text.encode("ascii", errors="ignore").decode() or "camera"


def annotate_frame(
    frame: Image.Image,
    result: DetectionResult,
    camera_name: str,
    timestamp: datetime,
) -> Image.Image:
    """Draw detection boxes and a count overlay onto a copy of the frame."""
    annotated = frame.convert("RGB").copy()
    draw = ImageDraw.Draw(annotated, "RGBA")

    for box in result.bboxes:
        draw.rectangle((box.x1, box.y1, box.x2, box.y2), outline=BOX_COLOR, width=2)

    font, hangul_ok = _overlay_font()
    name = camera_name if hangul_ok else _ascii_safe(camera_name)
    header = (
        f"{name}  |  count: {result.count}  |  "
        f"conf: {result.confidence_avg:.2f}  |  {result.inference_ms}ms  |  "
        f"{timestamp.strftime('%Y-%m-%d %H:%M:%S')} UTC"
    )
    draw.rectangle((0, 0, annotated.width, 28), fill=TEXT_BG)
    draw.text((10, 6), header, fill=(255, 255, 255), font=font)
    return annotated


def encode_jpeg(frame: Image.Image, quality: int | None = None) -> bytes:
    buf = io.BytesIO()
    frame.convert("RGB").save(buf, format="JPEG", quality=quality or settings.mjpeg_quality)
    return buf.getvalue()
