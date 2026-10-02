"""개체수를 DB 에 적는 간격 (stream_service).

추론은 초당 한 번 돌지만 그 값을 전부 남기면 카메라 한 대가 하루 86,400행을
쌓는다. Supabase 무료 구간이 두어 달이면 차고, 그때 **수질 기록까지 같이**
멈춘다. 실시간 화면과 경보는 메모리에서 매 프레임 갱신되므로 영향이 없어야
한다 — 그 둘이 느려지면 저장을 줄인 의미가 없다.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.config import settings
from app.database import SessionLocal
from app.models import CountRecord
from app.services.stream_service import CameraSnapshot, CameraStreamProcessor, frame_store


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _snapshot() -> CameraSnapshot:
    return CameraSnapshot(
        id=uuid.uuid4(), tank_id=uuid.uuid4(), farm_id=uuid.uuid4(),
        name="A-1조 카메라", camera_type="usb", stream_url=None, fps_target=1.0,
    )


async def _rows(camera_id: uuid.UUID) -> int:
    async with SessionLocal() as s:
        return (
            await s.execute(
                select(func.count()).select_from(CountRecord).where(
                    CountRecord.camera_id == camera_id
                )
            )
        ).scalar_one()


@pytest.mark.anyio
async def test_only_one_row_is_written_within_the_interval(client, monkeypatch):
    """20틱을 돌려도 간격 안에서는 한 번만 적는다."""
    monkeypatch.setattr(settings, "count_write_interval_seconds", 3600.0)
    cam = _snapshot()
    proc = CameraStreamProcessor(cam)
    for _ in range(20):
        await proc._process_one_tick()
    assert await _rows(cam.id) == 1, "간격을 무시하고 매 프레임 적었다"


@pytest.mark.anyio
async def test_every_tick_is_written_when_the_interval_is_zero(client, monkeypatch):
    """간격 0 이면 예전처럼 매 프레임 적는다 — 되돌릴 길을 남긴다."""
    monkeypatch.setattr(settings, "count_write_interval_seconds", 0.0)
    cam = _snapshot()
    proc = CameraStreamProcessor(cam)
    for _ in range(5):
        await proc._process_one_tick()
    assert await _rows(cam.id) == 5


@pytest.mark.anyio
async def test_live_values_still_update_every_frame(client, monkeypatch):
    """저장을 건너뛴 틱에도 화면이 보는 값과 프레임은 갱신되어야 한다."""
    monkeypatch.setattr(settings, "count_write_interval_seconds", 3600.0)
    cam = _snapshot()
    proc = CameraStreamProcessor(cam)

    await proc._process_one_tick()
    first = frame_store.latest_count(cam.id)
    assert first is not None

    for _ in range(5):
        await proc._process_one_tick()
    later = frame_store.latest_count(cam.id)

    assert await _rows(cam.id) == 1, "저장은 한 번이어야 한다"
    assert later is not None
    assert later.timestamp > first.timestamp, "화면이 보는 값이 멈춰 있다"
    assert frame_store.latest_frame(cam.id) is not None, "영상 프레임이 갱신되지 않았다"
    frame_store.clear_camera(cam.id)
