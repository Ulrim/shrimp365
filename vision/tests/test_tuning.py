"""카메라별 보정 — 관심영역과 최소 신뢰도.

이 코드가 틀리면 **개체수가 조용히 틀어진다.** 너무 많이 거르면 실제 새우를
놓치고, 덜 거르면 철망을 계속 센다. 둘 다 화면에는 멀쩡한 숫자로 보인다.
"""
from __future__ import annotations

import uuid

import pytest

from app.services import tuning
from app.services.detector import BBox, DetectionResult


def _result(boxes: list[tuple[float, float, float, float, float]], *, w=640, h=480):
    bb = [BBox(x1, y1, x2, y2, c) for x1, y1, x2, y2, c in boxes]
    return DetectionResult(
        count=len(bb),
        bboxes=bb,
        confidence_avg=round(sum(b.confidence for b in bb) / len(bb), 3) if bb else 0.0,
        inference_ms=10,
        frame_width=w,
        frame_height=h,
        model_version="t",
    )


@pytest.fixture
def state(monkeypatch, tmp_path):
    monkeypatch.setattr(tuning.settings, "device_state_path", str(tmp_path / "device.json"))
    return tmp_path


# ── 거르기 ──────────────────────────────────────────────────────────────────
def test_nothing_set_changes_nothing():
    r = _result([(0, 0, 10, 10, 0.9), (600, 440, 630, 470, 0.4)])
    assert tuning.apply(r, tuning.Tuning()) is r  # 그대로 돌려준다


def test_roi_keeps_only_what_is_inside():
    """수조 안쪽만 센다. 화면 모서리의 철망은 빠져야 한다."""
    r = _result([
        (300, 220, 340, 260, 0.9),   # 한가운데 — 남는다
        (0, 0, 40, 40, 0.9),         # 왼쪽 위 모서리 — 빠진다
        (600, 440, 640, 480, 0.9),   # 오른쪽 아래 모서리 — 빠진다
    ])
    out = tuning.apply(r, tuning.Tuning(roi=(0.25, 0.25, 0.75, 0.75)))
    assert out.count == 1
    assert len(out.bboxes) == 1
    assert out.bboxes[0].x1 == 300


def test_roi_judges_by_center_not_overlap():
    """테두리에 걸친 것은 **가운데**로 판정한다.

    겹침으로 하면 수조 가장자리의 새우가 들어왔다 나갔다 하며 개체수가 춤춘다.
    """
    r = _result([(100, 220, 340, 260, 0.9)])  # 가운데 x=220 → 비율 0.34
    assert tuning.apply(r, tuning.Tuning(roi=(0.3, 0.25, 0.75, 0.75))).count == 1
    assert tuning.apply(r, tuning.Tuning(roi=(0.4, 0.25, 0.75, 0.75))).count == 0


def test_min_conf_drops_weak_detections():
    r = _result([(10, 10, 20, 20, 0.80), (30, 30, 40, 40, 0.35)])
    out = tuning.apply(r, tuning.Tuning(min_conf=0.5))
    assert out.count == 1
    assert out.confidence_avg == 0.8  # 남은 것만으로 다시 센다


def test_count_follows_the_boxes_that_remain():
    """count 를 그대로 두면 화면의 상자 수와 숫자가 어긋난다."""
    r = _result([(10, 10, 20, 20, 0.9)] * 5)
    r.count = 99  # 추적기가 다른 수를 줬다고 하자
    out = tuning.apply(r, tuning.Tuning(min_conf=0.95))
    assert out.count == 0
    assert out.bboxes == []


def test_track_ids_stay_lined_up():
    """추적 번호는 상자와 짝이다. 한쪽만 거르면 엉뚱한 번호가 붙는다."""
    r = _result([(10, 10, 20, 20, 0.9), (30, 30, 40, 40, 0.3), (50, 50, 60, 60, 0.8)])
    r.track_ids = [7, 8, 9]
    out = tuning.apply(r, tuning.Tuning(min_conf=0.5))
    assert out.track_ids == [7, 9]
    assert len(out.track_ids) == len(out.bboxes)


def test_empty_frame_is_safe():
    assert tuning.apply(_result([]), tuning.Tuning(roi=(0.1, 0.1, 0.9, 0.9))).count == 0


# ── 저장·읽기 ───────────────────────────────────────────────────────────────
def test_saved_values_survive(state):
    cam = uuid.uuid4()
    assert tuning.save(cam, tuning.Tuning(roi=(0.1, 0.2, 0.8, 0.9), min_conf=0.45))
    got = tuning.get(cam)
    assert got.roi == (0.1, 0.2, 0.8, 0.9)
    assert got.min_conf == 0.45


def test_cameras_do_not_share(state):
    a, b = uuid.uuid4(), uuid.uuid4()
    tuning.save(a, tuning.Tuning(min_conf=0.6))
    assert tuning.get(b).is_empty()
    assert tuning.get(a).min_conf == 0.6


def test_clearing_removes_it(state):
    cam = uuid.uuid4()
    tuning.save(cam, tuning.Tuning(roi=(0.1, 0.1, 0.9, 0.9)))
    tuning.save(cam, tuning.Tuning())
    assert tuning.get(cam).is_empty()


def test_box_drawn_backwards_is_accepted(state):
    """오른쪽에서 왼쪽으로 그으면 좌표가 뒤집혀 온다. 사람 손은 그렇다."""
    cam = uuid.uuid4()
    tuning.save(cam, tuning.Tuning(roi=(0.8, 0.9, 0.2, 0.1)))
    assert tuning.get(cam).roi == (0.2, 0.1, 0.8, 0.9)


def test_too_small_box_is_ignored(state):
    """손가락이 스친 정도의 네모를 쓰면 **개체수가 0으로 굳는다.**"""
    cam = uuid.uuid4()
    tuning.save(cam, tuning.Tuning(roi=(0.5, 0.5, 0.503, 0.503)))
    assert tuning.get(cam).roi is None


def test_nonsense_values_are_ignored(state):
    cam = uuid.uuid4()
    tuning.save(cam, tuning.Tuning(min_conf=5.0))   # 1 을 넘는 신뢰도는 없다
    assert tuning.get(cam).min_conf is None


def test_broken_file_does_not_stop_counting(state):
    (state / "tuning.json").write_text("{깨진 파일")
    assert tuning.get(uuid.uuid4()).is_empty()
