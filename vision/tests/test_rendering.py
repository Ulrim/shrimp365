"""프레임에 그리는 것 — 세는 범위와 탐지 박스.

**왜 테스트가 필요한가.** 이 그림이 현장에서 유일한 증거다. 농장에서는 로그를
읽지 않는다 — 장비 화면과 웹에 뜨는 사진 한 장을 보고 "잘 돌고 있나" 를
판단한다. 범위를 잡아 두면 바깥의 탐지는 조용히 버려지는데, 그 경계가 그림에
안 보이면 **새우가 안 세어졌을 때 범위 밖이라 그런 것인지 신뢰도가 낮아서인지
구분할 수 없다.** 범위를 잡았는지조차 알 수 없다.
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest
from PIL import Image

from app.config import settings
from app.services.detector import BBox, DetectionResult
from app.services.rendering import (
    HEADER_HEIGHT,
    _display_tz,
    annotate_frame,
    local_time_text,
)

WHEN = datetime(2026, 10, 16, 1, 2, 3, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _fresh_timezone():
    """시간대는 한 번 읽고 캐시한다 — 테스트마다 다시 읽게 비운다."""
    _display_tz.cache_clear()
    yield
    _display_tz.cache_clear()


def frame(w: int = 400, h: int = 300, color=(180, 180, 180)) -> Image.Image:
    return Image.new("RGB", (w, h), color)


def result(boxes=(), w: int = 400, h: int = 300) -> DetectionResult:
    bb = [BBox(*b) for b in boxes]
    return DetectionResult(
        count=len(bb), bboxes=bb,
        confidence_avg=round(sum(b.confidence for b in bb) / len(bb), 3) if bb else 0.0,
        inference_ms=12, frame_width=w, frame_height=h, model_version="t",
    )


def brightness(img: Image.Image, x: int, y: int) -> int:
    return sum(img.getpixel((x, y))[:3])


#: 머리글 띠가 덮는 높이. 그 아래에서 밝기를 재야 범위 표시만 보게 된다.
BELOW_HEADER = 40


# ── 안 잡았으면 아무것도 그리지 않는다 ──────────────────────────────────────
def test_without_roi_nothing_is_dimmed():
    """범위를 안 잡은 장비의 그림은 예전 그대로여야 한다."""
    img = annotate_frame(frame(), result(), "cam", WHEN)
    corner = brightness(img, 5, BELOW_HEADER)
    middle = brightness(img, 200, 150)
    assert corner == middle, "범위를 안 잡았는데 어딘가 어두워졌다"


def header_ink(img: Image.Image) -> int:
    """머리글 띠에 찍힌 **흰 글자** 픽셀 수. 글을 읽을 수는 없어도 늘었는지는 안다.

    기준을 넉넉히 잡는다. 띠 바탕은 반투명 검정이라 밑그림 밝기에 따라
    값이 달라지지만, 글자는 흰색(765)이라 멀찍이 떨어져 있다.
    """
    return sum(
        1
        for y in range(HEADER_HEIGHT)
        for x in range(img.width)
        if sum(img.getpixel((x, y))[:3]) > 600
    )


def test_the_header_says_a_region_is_set():
    """작은 카드에서는 테두리가 잘 안 보인다 — 글로도 남겨야 한다.

    넓은 프레임으로 잰다. 좁으면 머리글이 오른쪽에서 잘려 덧붙인 글자가
    아예 그려지지 않는다(400px 로 재다가 한 번 속았다).
    """
    wide = frame(1280, 720)
    plain = annotate_frame(wide, result(w=1280, h=720), "cam", WHEN)
    marked = annotate_frame(
        wide, result(w=1280, h=720), "cam", WHEN, roi=(0.25, 0.25, 0.75, 0.75)
    )
    assert header_ink(marked) > header_ink(plain), "머리글에 범위 표시가 안 붙었다"


# ── 잡았으면 바깥이 어두워진다 ──────────────────────────────────────────────
def test_outside_the_roi_is_dimmed():
    """선만 그으면 그 선이 무슨 뜻인지 설명을 읽어야 안다. 바깥을 덮으면 본다."""
    img = annotate_frame(frame(), result(), "cam", WHEN, roi=(0.25, 0.25, 0.75, 0.75))
    inside = brightness(img, 200, 150)
    outside = brightness(img, 20, BELOW_HEADER + 20)
    assert outside < inside, "범위 바깥이 어두워지지 않았다"


def test_inside_the_roi_keeps_its_colour():
    """안쪽까지 어두워지면 정작 봐야 할 수조가 어두워진다."""
    plain = annotate_frame(frame(), result(), "cam", WHEN)
    shaded = annotate_frame(frame(), result(), "cam", WHEN, roi=(0.25, 0.25, 0.75, 0.75))
    assert brightness(shaded, 200, 150) == brightness(plain, 200, 150)


def test_the_border_is_drawn_in_its_own_colour():
    """탐지 박스(초록)와 다른 색이어야 한다 — 같으면 큰 박스 하나로 읽힌다."""
    img = annotate_frame(frame(), result(), "cam", WHEN, roi=(0.25, 0.25, 0.75, 0.75))
    # 왼쪽 테두리 위에서 주황(R>G>B)을 찾는다
    x = round(0.25 * 400)
    hits = [img.getpixel((px, 150)) for px in (x, x + 1)]
    assert any(r > g > b for r, g, b in hits), f"테두리 색을 찾지 못했다: {hits}"


# ── 이상한 값에도 터지지 않는다 ─────────────────────────────────────────────
#
# 범위는 사람이 장비 화면에서 손가락으로 긋는다. 거꾸로 긋거나 화면 밖으로
# 끌고 나가는 일이 실제로 생긴다. 거기서 예외가 나면 **프레임 한 장이 아니라
# 카메라 전체가 멈춘다.**
@pytest.mark.parametrize("roi", [
    (0.75, 0.75, 0.25, 0.25),   # 거꾸로 그었다
    (0.5, 0.5, 0.5, 0.5),       # 넓이가 없다
    (-0.5, -0.5, 1.5, 1.5),     # 화면 밖까지
    (0.0, 0.0, 1.0, 1.0),       # 화면 전체
])
def test_odd_regions_do_not_crash(roi):
    img = annotate_frame(frame(), result([(10, 10, 50, 50, 0.9)]), "cam", WHEN, roi=roi)
    assert img.size == (400, 300)


def test_a_reversed_region_draws_nothing():
    """거꾸로 그은 값으로 그리면 화면만 어지럽다 — 차라리 안 그린다."""
    plain = annotate_frame(frame(), result(), "cam", WHEN)
    odd = annotate_frame(frame(), result(), "cam", WHEN, roi=(0.75, 0.75, 0.25, 0.25))
    assert odd.tobytes() == plain.tobytes()


def test_full_frame_region_dims_nothing():
    """화면 전체가 범위면 가릴 바깥이 없다."""
    plain = annotate_frame(frame(), result(), "cam", WHEN)
    full = annotate_frame(frame(), result(), "cam", WHEN, roi=(0.0, 0.0, 1.0, 1.0))
    assert brightness(full, 200, 150) == brightness(plain, 200, 150)


# ── 박스와 함께 그릴 때 ─────────────────────────────────────────────────────
def test_boxes_are_drawn_on_top_of_the_shade():
    """범위를 박스보다 **먼저** 그려야 한다.

    나중에 그리면 바깥을 덮는 어둠이 그 자리의 탐지 박스까지 가려, 왜 안
    세어졌는지 되레 안 보이게 된다.
    """
    boxes = [(300, 200, 380, 260, 0.9)]   # 범위 밖에 있는 탐지
    img = annotate_frame(frame(), result(boxes), "cam", WHEN, roi=(0.05, 0.05, 0.5, 0.5))
    # 박스 선 위에서 초록(G 가 가장 큼)을 찾는다
    hits = [img.getpixel((px, 200)) for px in (300, 301, 302)]
    assert any(g > r and g > b for r, g, b in hits), f"박스가 가려졌다: {hits}"


def test_detection_boxes_still_drawn_without_roi():
    img = annotate_frame(frame(), result([(100, 100, 180, 160, 0.9)]), "cam", WHEN)
    hits = [img.getpixel((px, 120)) for px in (100, 101, 102)]
    assert any(g > r and g > b for r, g, b in hits)


# ── 머리글의 시각 ───────────────────────────────────────────────────────────
#
# **왜 이것이 중요한가.** 농장에서는 로그를 읽지 않는다. "지금 돌고 있나" 를
# 그림에 적힌 시각 하나로 판단한다. UTC 로 적으면 방금 찍힌 사진에 9시간 전
# 시각이 보이고, 사람은 그것을 "어제 것이 멈춰 있다" 로 읽는다 — 멀쩡한
# 카메라를 뜯게 만드는 글자다.
def test_the_time_is_written_in_local_time(monkeypatch):
    monkeypatch.setattr(settings, "display_timezone", "Asia/Seoul")
    # 2026-10-16 01:02:03 UTC == 같은 날 10:02:03 한국 시간
    assert local_time_text(WHEN) == "2026-10-16 10:02:03 KST"


def test_a_naive_time_is_read_as_utc(monkeypatch):
    """SQLite 에서 돌아온 시각에는 시간대가 없다. 현지 시간으로 오해하면 9시간 틀린다."""
    monkeypatch.setattr(settings, "display_timezone", "Asia/Seoul")
    assert local_time_text(WHEN.replace(tzinfo=None)) == local_time_text(WHEN)


def test_another_farms_timezone(monkeypatch):
    """베트남·인도네시아 농장에서도 그 지역 시각이 보여야 한다."""
    monkeypatch.setattr(settings, "display_timezone", "Asia/Ho_Chi_Minh")
    assert local_time_text(WHEN).startswith("2026-10-16 08:02:03 ")


def test_an_unknown_timezone_falls_back_to_utc(monkeypatch):
    """시간대 데이터가 없는 이미지에서 예외가 나면 카메라가 멈춘다 — 시각 한 줄 때문에."""
    monkeypatch.setattr(settings, "display_timezone", "Mars/Olympus_Mons")
    assert local_time_text(WHEN) == "2026-10-16 01:02:03 UTC"


def test_the_header_shows_that_time(monkeypatch):
    """머리글에 실제로 그 시각이 적히는가 — 글자 수로 센다.

    그림에서 글을 읽을 수는 없으니, 시간대를 바꿔 **다른 글자가 찍히는지**
    본다. UTC 와 KST 는 자릿수가 같아 폭이 거의 같으므로 픽셀 수를 비교하는
    대신 서로 다른지만 확인한다.
    """
    wide = frame(1280, 720)
    monkeypatch.setattr(settings, "display_timezone", "Asia/Seoul")
    _display_tz.cache_clear()
    seoul = annotate_frame(wide, result(w=1280, h=720), "cam", WHEN)
    monkeypatch.setattr(settings, "display_timezone", "Mars/Olympus_Mons")
    _display_tz.cache_clear()
    utc = annotate_frame(wide, result(w=1280, h=720), "cam", WHEN)
    assert seoul.tobytes() != utc.tobytes(), "머리글 시각이 시간대를 따라가지 않는다"
