"""수조 사진 밀어 올리기.

이것이 틀리면 **농장 회선과 DB 쓰기만 먹고 아무것도 달라지지 않는다.** 멈춘
카메라의 같은 프레임을 15초마다 올리거나, 받지도 않는 서버에 영원히 올려 보는
식으로. 증상이 조용해서 눈에 띄지 않는 종류의 낭비다.
"""
from __future__ import annotations

import io
import uuid

import pytest
from PIL import Image

from app.database import utcnow
from app.services import snapshot_sender as mod
from app.services.snapshot_sender import SnapshotSender, shrink
from app.services.stream_service import LatestCount, frame_store


def jpeg(width: int, height: int, *, color=(10, 120, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture
def cam():
    camera_id = uuid.uuid4()
    yield camera_id
    frame_store.clear_camera(camera_id)


@pytest.fixture
def sender(monkeypatch):
    monkeypatch.setattr(mod.settings, "snapshot_interval_seconds", 15.0)
    monkeypatch.setattr(mod.settings, "snapshot_width", 640)
    monkeypatch.setattr(mod.settings, "snapshot_quality", 60)
    monkeypatch.setattr(mod.settings, "device_key", "dev-key")
    return SnapshotSender()


class FakeReporter:
    """보낸 것을 적어 두고, 미리 정한 상태 코드를 돌려준다."""

    def __init__(self, *statuses: int) -> None:
        self.statuses = list(statuses) or [200]
        self.sent: list[dict] = []

    async def send_snapshot(self, camera_id, jpeg_bytes, **kwargs):  # noqa: ANN001
        self.sent.append({"camera_id": camera_id, "bytes": jpeg_bytes, **kwargs})
        return self.statuses[min(len(self.sent) - 1, len(self.statuses) - 1)]


# ── 줄이기 ──────────────────────────────────────────────────────────────────
def test_wide_frame_is_shrunk_and_keeps_aspect():
    small, w, h = shrink(jpeg(1920, 1080), width=640, quality=60)
    assert (w, h) == (640, 360)
    with Image.open(io.BytesIO(small)) as img:
        assert img.size == (640, 360)
    assert len(small) < len(jpeg(1920, 1080))


def test_already_small_frame_is_not_reencoded():
    """다시 인코딩하면 화질만 깎이고 작아지지도 않는다."""
    original = jpeg(320, 240)
    out, w, h = shrink(original, width=640)
    assert out is original
    assert (w, h) == (320, 240)


def test_shrunk_frame_fits_the_upload_limit():
    """라우트가 300 KB 에서 끊는다. 기본 설정이 그 안에 들어와야 한다."""
    # 압축이 잘 안 되는 그림(잡음)으로 최악에 가깝게 잡는다.
    import random

    random.seed(0)
    noisy = Image.new("RGB", (1920, 1080))
    noisy.putdata([(random.randrange(256), random.randrange(256), random.randrange(256))
                   for _ in range(1920 * 1080)])
    buf = io.BytesIO()
    noisy.save(buf, format="JPEG", quality=95)
    out, _, _ = shrink(buf.getvalue(), width=640, quality=60)
    assert len(out) < 300_000


# ── 한 장 보내기 ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_sends_latest_frame_with_its_count(sender, cam, monkeypatch):
    reporter = FakeReporter(200)
    monkeypatch.setattr(mod, "reporter", reporter)
    frame_store.push_frame(cam, jpeg(1280, 720))
    frame_store.set_latest_count(
        LatestCount(
            camera_id=cam, tank_id=uuid.uuid4(), farm_id=uuid.uuid4(),
            timestamp=utcnow(), count=7, confidence_avg=0.8, length_cm=11.5,
        )
    )

    assert await sender.send_once(cam) == 200
    (sent,) = reporter.sent
    assert sent["camera_id"] == str(cam)
    assert sent["count"] == 7
    assert sent["length_cm"] == 11.5
    assert sent["size"] == (640, 360)
    assert sent["bytes"][:2] == b"\xff\xd8"  # JPEG 그대로 보낸다


@pytest.mark.asyncio
async def test_no_frame_sends_nothing(sender, cam, monkeypatch):
    reporter = FakeReporter(200)
    monkeypatch.setattr(mod, "reporter", reporter)
    assert await sender.send_once(cam) is None
    assert reporter.sent == []


@pytest.mark.asyncio
async def test_no_count_yet_still_sends_the_picture(sender, cam, monkeypatch):
    """막 켠 카메라는 아직 센 값이 없다. 그래도 사진은 보여 줄 수 있다."""
    reporter = FakeReporter(200)
    monkeypatch.setattr(mod, "reporter", reporter)
    frame_store.push_frame(cam, jpeg(800, 600))
    assert await sender.send_once(cam) == 200
    assert reporter.sent[0]["count"] is None
    assert reporter.sent[0]["taken_at"]  # 시각은 지금으로 채운다


# ── 같은 프레임은 다시 안 보낸다 ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_same_frame_is_not_sent_twice(sender, cam, monkeypatch):
    """카메라가 멈추면 frame_store 에 같은 프레임이 그대로 남는다.

    그걸 15초마다 올리면 달라지는 것은 없고 회선과 DB 쓰기만 먹는다.
    """
    reporter = FakeReporter(200)
    monkeypatch.setattr(mod, "reporter", reporter)
    frame_store.push_frame(cam, jpeg(640, 480))

    assert await sender.send_once(cam) == 200
    assert await sender.send_once(cam) is None
    assert len(reporter.sent) == 1


@pytest.mark.asyncio
async def test_new_frame_is_sent(sender, cam, monkeypatch):
    reporter = FakeReporter(200)
    monkeypatch.setattr(mod, "reporter", reporter)
    frame_store.push_frame(cam, jpeg(640, 480, color=(10, 10, 10)))
    await sender.send_once(cam)
    frame_store.push_frame(cam, jpeg(640, 480, color=(240, 240, 240)))
    assert await sender.send_once(cam) == 200
    assert len(reporter.sent) == 2


@pytest.mark.asyncio
async def test_failed_send_is_retried_with_the_same_frame(sender, cam, monkeypatch):
    """실패한 사진을 "보낸 것"으로 적으면, 다음 사진이 올 때까지 화면이 빈다."""
    reporter = FakeReporter(0, 200)
    monkeypatch.setattr(mod, "reporter", reporter)
    frame_store.push_frame(cam, jpeg(640, 480))

    assert await sender.send_once(cam) == 0
    assert await sender.send_once(cam) == 200  # 같은 프레임을 다시 보냈다
    assert len(reporter.sent) == 2


# ── 실패하면 간격을 늘린다 ──────────────────────────────────────────────────
def test_interval_starts_at_the_setting(sender):
    assert sender.interval() == 15.0


def test_failures_back_off_up_to_the_cap(sender):
    sender._interval = 15.0
    for _ in range(20):
        sender._note([0])
    assert sender.interval() == mod.MAX_INTERVAL_SECONDS


def test_one_success_resets_the_interval(sender):
    sender._interval = 15.0
    sender._note([0])
    assert sender.interval() > 15.0
    sender._note([0, 200])  # 카메라가 여러 대면 하나만 성공해도 회선은 살아 있다
    assert sender.interval() == 15.0


def test_nothing_to_send_does_not_back_off(sender):
    """보낼 것이 없는 것은 실패가 아니다 — 카메라가 안 돌고 있을 뿐이다."""
    sender._interval = 15.0
    sender._note([])
    assert sender.interval() == 15.0


def test_migration_missing_is_explained_once(sender, caplog):
    """501 = 서버에 vision_snapshot.sql 을 안 돌렸다. 사람이 할 일이 있다."""
    with caplog.at_level("WARNING"):
        sender._note([501])
        sender._note([501])
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1
    assert "vision_snapshot.sql" in warnings[0].getMessage()


def test_recovery_is_logged(sender, caplog):
    sender._note([0])
    with caplog.at_level("INFO"):
        sender._note([200])
    assert any("다시 올리고" in r.getMessage() for r in caplog.records)


# ── 켜고 끄기 ───────────────────────────────────────────────────────────────
def test_disabled_when_interval_is_zero(monkeypatch):
    monkeypatch.setattr(mod.settings, "snapshot_interval_seconds", 0.0)
    monkeypatch.setattr(mod.settings, "shrimp365_internal_url", "https://www.shrimp365.kr")
    monkeypatch.setattr(mod.settings, "database_url", "")
    assert mod.enabled() is False


def test_disabled_without_a_server_to_push_to(monkeypatch):
    monkeypatch.setattr(mod.settings, "snapshot_interval_seconds", 15.0)
    monkeypatch.setattr(mod.settings, "shrimp365_internal_url", "")
    assert mod.enabled() is False


def test_enabled_on_a_farm_pi(monkeypatch):
    monkeypatch.setattr(mod.settings, "snapshot_interval_seconds", 15.0)
    monkeypatch.setattr(mod.settings, "shrimp365_internal_url", "https://www.shrimp365.kr")
    monkeypatch.setattr(mod.settings, "database_url", "")
    assert mod.enabled() is True
