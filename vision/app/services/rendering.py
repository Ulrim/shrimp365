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

#: 세는 범위(관심영역) 표시.
#:
#: 탐지 박스와 **다른 색**이어야 한다. 같은 색이면 "큰 박스 하나가 더 잡혔나"
#: 로 읽힌다. 주황은 초록 박스와 겹쳐도 구분되고, 수조 물빛(파랑·초록)과도
#: 섞이지 않는다.
ROI_COLOR = (255, 190, 60)
#: 범위 바깥을 덮는 어둠. 이것이 핵심이다 — 선만 그으면 "저 선이 무슨 뜻인가"
#: 를 알려면 설명을 읽어야 하지만, 바깥이 어두우면 보는 순간 안다.
#: 너무 진하면 수조가 안 보이고, 너무 옅으면 구분이 안 된다.
ROI_SHADE = (0, 0, 0, 90)

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


def _draw_roi(draw: ImageDraw.ImageDraw, roi, width: int, height: int) -> None:
    """세는 범위를 그린다. 바깥을 어둡게 덮고 테두리를 두른다.

    **왜 그려야 하나.** 범위를 잡아 두면 바깥의 탐지는 조용히 버려진다. 그런데
    그림에 아무 표시가 없으면, 새우가 안 세어졌을 때 그것이 범위 밖이라
    그런 것인지 신뢰도가 낮아서인지 **화면만 보고는 알 수 없다.** 범위를
    잡았는지조차 알 수 없다. 거르는 기준은 눈에 보여야 한다.

    roi 는 0~1 비율이다(tuning.Tuning.roi). 해상도가 바뀌어도 같은 자리를
    가리키도록 저장된 값이라, 그릴 때 실제 픽셀로 편다.
    """
    x1, y1, x2, y2 = (
        max(0, min(width, round(roi[0] * width))),
        max(0, min(height, round(roi[1] * height))),
        max(0, min(width, round(roi[2] * width))),
        max(0, min(height, round(roi[3] * height))),
    )
    if x2 <= x1 or y2 <= y1:
        return  # 뒤집히거나 찌그러진 값 — 그리면 화면만 어지럽다

    # 바깥 네 조각을 덮는다. 가운데를 뚫은 사각형을 한 번에 그릴 수는 없다.
    for part in (
        (0, 0, width, y1),           # 위
        (0, y2, width, height),      # 아래
        (0, y1, x1, y2),             # 왼쪽
        (x2, y1, width, y2),         # 오른쪽
    ):
        if part[2] > part[0] and part[3] > part[1]:
            draw.rectangle(part, fill=ROI_SHADE)

    draw.rectangle((x1, y1, x2 - 1, y2 - 1), outline=ROI_COLOR, width=2)


def annotate_frame(
    frame: Image.Image,
    result: DetectionResult,
    camera_name: str,
    timestamp: datetime,
    roi: tuple[float, float, float, float] | None = None,
) -> Image.Image:
    """Draw the counting region, detection boxes and a count overlay."""
    annotated = frame.convert("RGB").copy()
    draw = ImageDraw.Draw(annotated, "RGBA")

    # 범위를 **박스보다 먼저** 그린다. 나중에 그리면 바깥을 덮는 어둠이 그
    # 자리의 탐지 박스까지 가려, 왜 안 세어졌는지 되레 안 보이게 된다.
    if roi is not None:
        _draw_roi(draw, roi, annotated.width, annotated.height)

    for box in result.bboxes:
        draw.rectangle((box.x1, box.y1, box.x2, box.y2), outline=BOX_COLOR, width=2)

    font, hangul_ok = _overlay_font()
    name = camera_name if hangul_ok else _ascii_safe(camera_name)
    header = (
        f"{name}  |  count: {result.count}  |  "
        f"conf: {result.confidence_avg:.2f}  |  {result.inference_ms}ms  |  "
        f"{timestamp.strftime('%Y-%m-%d %H:%M:%S')} UTC"
    )
    # 범위를 잡았다는 사실을 글로도 남긴다. 그림이 작게 줄어 테두리가 잘
    # 안 보이는 자리(웹 목록의 작은 카드)에서도 알 수 있어야 한다.
    if roi is not None:
        header += "  |  " + ("세는 범위" if hangul_ok else "ROI")
    draw.rectangle((0, 0, annotated.width, 28), fill=TEXT_BG)
    draw.text((10, 6), header, fill=(255, 255, 255), font=font)
    return annotated


def encode_jpeg(frame: Image.Image, quality: int | None = None) -> bytes:
    buf = io.BytesIO()
    frame.convert("RGB").save(buf, format="JPEG", quality=quality or settings.mjpeg_quality)
    return buf.getvalue()
