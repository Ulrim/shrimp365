"""웹에서 켠 카메라를 장비가 스스로 집어가는가 (camera_manager._reconcile).

정상 경로는 브라우저 → shrimp365 → 장비 API 다. 그런데 그 경로는 장비에
바깥 주소(터널)가 있어야 열린다. 터널을 아직 안 깐 농장에서는 웹에서
카메라를 켜도 장비가 영영 모르고, 사람이 SSH 로 들어가 다시 시작해야 했다.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import Camera, Farm, Tank
from app.services import camera_manager as cm


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def tank_id(client) -> uuid.UUID:
    """양식장·수조를 직접 만든다. client 픽스처가 스키마를 준비한다."""
    farm_id, tid = uuid.uuid4(), uuid.uuid4()
    async with SessionLocal() as s:
        s.add(Farm(id=farm_id, user_id=uuid.uuid4(), name="농장"))
        s.add(Tank(id=tid, farm_id=farm_id, name="A-1조"))
        await s.commit()
    return tid


@pytest.mark.anyio
async def test_camera_turned_on_later_is_picked_up(monkeypatch, tank_id):
    """기동 **뒤에** 켠 카메라도 재시작 없이 돌아야 한다."""
    cam_id = uuid.uuid4()
    mgr = cm.CameraManager()
    monkeypatch.setattr(cm, "RECONCILE_INTERVAL_SECONDS", 0.05)
    # 소유 판정을 명시한다. 앞선 테스트가 남긴 device_key 에 따라 결과가
    # 달라지면, 이 테스트는 맞춤 루프가 아니라 실행 순서를 재게 된다.
    monkeypatch.setattr(cm.settings, "device_key", "")
    # 전체 실행에서는 앞선 테스트들이 켜 둔 카메라가 DB 에 남아 있다. 상한에
    # 먼저 걸리면 이 테스트의 카메라까지 차례가 오지 않는다 — 맞춤 루프가
    # 아니라 상한을 재게 된다.
    monkeypatch.setattr(cm.settings, "max_cameras", 500)

    task = asyncio.create_task(mgr._reconcile())
    try:
        assert not mgr.is_running(cam_id)
        async with SessionLocal() as s:  # 웹에서 카메라를 추가하고 켠다
            s.add(Camera(id=cam_id, tank_id=tank_id, name="A-1조 카메라",
                         camera_type="usb", is_active=True))
            await s.commit()

        for _ in range(100):
            await asyncio.sleep(0.05)
            if mgr.is_running(cam_id):
                break
        assert mgr.is_running(cam_id), "맞춤 루프가 카메라를 집어가지 못했다"
    finally:
        task.cancel()
        await mgr.stop_all()


@pytest.mark.anyio
async def test_reconcile_never_takes_another_devices_camera(monkeypatch, tank_id):
    """기기 키가 다르면 남의 카메라다 — 열면 그 수조를 들여다보게 된다."""
    async with SessionLocal() as s:
        s.add(Camera(id=uuid.uuid4(), tank_id=tank_id, name="남의 카메라",
                     camera_type="usb", is_active=True, api_key="다른-장비-키"))
        await s.commit()

    mgr = cm.CameraManager()
    monkeypatch.setattr(cm, "RECONCILE_INTERVAL_SECONDS", 0.05)
    monkeypatch.setattr(cm.settings, "device_key", "내-기기-키")

    task = asyncio.create_task(mgr._reconcile())
    try:
        await asyncio.sleep(0.4)
        assert not mgr._processors, "남의 카메라를 열었다"
    finally:
        task.cancel()
        await mgr.stop_all()


@pytest.mark.anyio
async def test_reconcile_survives_a_database_hiccup(monkeypatch):
    """DB 가 잠깐 끊겨도 루프가 죽으면 안 된다 — 죽으면 영영 안 붙는다."""
    mgr = cm.CameraManager()
    monkeypatch.setattr(cm, "RECONCILE_INTERVAL_SECONDS", 0.05)

    calls = []

    class Boom:
        async def __aenter__(self):
            calls.append(1)
            raise OSError("DB 연결 끊김")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(cm, "SessionLocal", lambda: Boom())
    task = asyncio.create_task(mgr._reconcile())
    try:
        await asyncio.sleep(0.4)
        assert len(calls) >= 2, "첫 실패에서 루프가 멈췄다"
        assert not task.done(), "루프가 죽었다"
    finally:
        task.cancel()


@pytest.mark.anyio
async def test_reconcile_does_not_restart_a_running_camera(monkeypatch, tank_id):
    """이미 도는 스트림을 다시 시작하면 영상이 끊긴다."""
    cam_id = uuid.uuid4()
    async with SessionLocal() as s:
        s.add(Camera(id=cam_id, tank_id=tank_id, name="A-1조 카메라",
                     camera_type="usb", is_active=True))
        await s.commit()
        camera = (await s.execute(select(Camera).where(Camera.id == cam_id))).scalar_one()
        farm_id = (await s.execute(select(Tank.farm_id).where(Tank.id == tank_id))).scalar_one()

    mgr = cm.CameraManager()
    monkeypatch.setattr(cm, "RECONCILE_INTERVAL_SECONDS", 0.05)
    await mgr.start_camera(camera, farm_id)
    first = mgr.processor(cam_id)

    task = asyncio.create_task(mgr._reconcile())
    try:
        await asyncio.sleep(0.4)
        assert mgr.processor(cam_id) is first, "돌고 있는 카메라를 다시 시작했다"
    finally:
        task.cancel()
        await mgr.stop_all()
