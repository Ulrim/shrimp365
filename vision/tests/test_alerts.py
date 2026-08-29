"""경보: 설정 CRUD, 급감 판정과 중복 억제, 복합 경보(개체수+용존산소).

발생한 경보는 shrimp365 의 alerts 표에 적히므로, 이력 조회 API 대신 DB 를
직접 확인한다 — 화면이 읽는 곳과 같은 자리를 본다는 뜻이다.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import select

from app.database import SessionLocal, utcnow
from app.models import ShrimpAlert, WaterQualityReading
from app.services.alert_service import PARAMETERS, alert_service
from app.services.stream_service import CameraSnapshot
from tests.conftest import TEST_USER_ID
from tests.test_counts import insert_counts


def snapshot_of(camera: dict, tank: dict) -> CameraSnapshot:
    return CameraSnapshot(
        id=uuid.UUID(camera["id"]),
        tank_id=uuid.UUID(tank["id"]),
        farm_id=uuid.UUID(tank["farm_id"]),
        name=camera["name"],
        camera_type="usb",
        stream_url=None,
        fps_target=1,
    )


async def unresolved_alerts(tank_id: str) -> list[ShrimpAlert]:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(ShrimpAlert).where(
                ShrimpAlert.tank_id == uuid.UUID(tank_id),
                ShrimpAlert.resolved.is_(False),
            )
        )
        return list(rows.scalars())


async def insert_do_series(tank_id: str, values: list[float], minutes_ago: int = 0):
    """수질 측정값을 1분 간격으로 넣는다. 복합 경보 판정용."""
    base = utcnow().replace(second=0, microsecond=0) - timedelta(
        minutes=minutes_ago + len(values)
    )
    async with SessionLocal() as session:
        for i, do in enumerate(values):
            session.add(
                WaterQualityReading(
                    id=uuid.uuid4(),
                    tank_id=uuid.UUID(tank_id),
                    temperature=28.0,
                    ph=7.9,
                    do_level=do,
                    recorded_at=base + timedelta(minutes=i),
                )
            )
        await session.commit()


async def make_config(client, auth_headers, camera, **overrides) -> dict:
    body = {
        "camera_id": camera["id"],
        "user_id": str(TEST_USER_ID),
        "alert_type": "count_drop",
        "threshold_pct": 30,
    }
    body.update(overrides)
    resp = await client.post("/api/v1/alerts/configs", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_alert_config_crud(client, auth_headers, camera):
    config = await make_config(client, auth_headers, camera, window_minutes=10)
    assert config["alert_type"] == "count_drop"
    assert config["is_enabled"] is True
    assert config["window_minutes"] == 10

    resp = await client.get("/api/v1/alerts/configs", headers=auth_headers)
    assert any(c["id"] == config["id"] for c in resp.json())

    resp = await client.put(
        f"/api/v1/alerts/configs/{config['id']}",
        json={
            "camera_id": camera["id"],
            "user_id": str(TEST_USER_ID),
            "alert_type": "count_drop",
            "threshold_pct": 40,
            "window_minutes": 15,
            "is_enabled": False,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["threshold_pct"] == 40
    assert resp.json()["is_enabled"] is False

    resp = await client.delete(
        f"/api/v1/alerts/configs/{config['id']}", headers=auth_headers
    )
    assert resp.status_code == 204


async def test_count_drop_alert_triggers(client, auth_headers, tank, camera):
    await make_config(client, auth_headers, camera)

    # Baseline ~300 over the last 10 minutes, then a sudden 150 (=-50%).
    await insert_counts(camera["id"], tank["id"], tank["farm_id"], [300] * 10)
    snapshot = snapshot_of(camera, tank)
    async with SessionLocal() as session:
        triggered = await alert_service.process_count(
            session, snapshot, count=150, timestamp=utcnow()
        )
    assert len(triggered) == 1
    assert triggered[0].parameter == PARAMETERS["count_drop"]
    assert triggered[0].type == "danger"
    assert "개체수 급감" in triggered[0].message
    # 통합 알림함에 수조 기준으로 적힌다 — 수질 경보와 같은 자리다.
    assert str(triggered[0].tank_id) == tank["id"]

    # Dedupe: same unresolved condition doesn't create a second row.
    async with SessionLocal() as session:
        again = await alert_service.process_count(
            session, snapshot, count=140, timestamp=utcnow()
        )
    assert again == []
    assert len(await unresolved_alerts(tank["id"])) == 1


async def test_normal_count_does_not_trigger(client, auth_headers, tank, camera):
    await make_config(client, auth_headers, camera)
    await insert_counts(camera["id"], tank["id"], tank["farm_id"], [300] * 10)
    async with SessionLocal() as session:
        triggered = await alert_service.process_count(
            session, snapshot_of(camera, tank), count=290, timestamp=utcnow()
        )
    assert triggered == []


async def test_compound_alert_when_do_also_drops(client, auth_headers, tank, camera):
    """개체수 급감 + 용존산소 급락이 겹치면 긴급 복합 경보 한 건으로 올린다."""
    await make_config(client, auth_headers, camera)
    await insert_counts(camera["id"], tank["id"], tank["farm_id"], [300] * 10)
    # 6.0 → 4.0 (약 33% 하락). 판정 기준 15% 를 넘는다.
    await insert_do_series(tank["id"], [6.0, 5.6, 5.0, 4.4, 4.0])

    async with SessionLocal() as session:
        triggered = await alert_service.process_count(
            session, snapshot_of(camera, tank), count=150, timestamp=utcnow()
        )
    assert len(triggered) == 1
    alert = triggered[0]
    assert alert.parameter == PARAMETERS["compound"]
    assert alert.type == "danger"
    assert "긴급" in alert.message
    assert "용존산소" in alert.message


async def test_stable_do_keeps_plain_count_alert(client, auth_headers, tank, camera):
    """용존산소가 멀쩡하면 복합으로 올리지 않는다 — 급감 경보 그대로."""
    await make_config(client, auth_headers, camera)
    await insert_counts(camera["id"], tank["id"], tank["farm_id"], [300] * 10)
    await insert_do_series(tank["id"], [6.0, 6.1, 5.9, 6.0, 6.05])

    async with SessionLocal() as session:
        triggered = await alert_service.process_count(
            session, snapshot_of(camera, tank), count=150, timestamp=utcnow()
        )
    assert len(triggered) == 1
    assert triggered[0].parameter == PARAMETERS["count_drop"]


async def test_offline_alert(client, auth_headers, tank, camera):
    await make_config(client, auth_headers, camera, alert_type="offline", threshold_pct=None)
    async with SessionLocal() as session:
        await alert_service.trigger_offline(session, snapshot_of(camera, tank))
    alerts = await unresolved_alerts(tank["id"])
    assert len(alerts) == 1
    assert alerts[0].parameter == PARAMETERS["offline"]
    assert alerts[0].type == "warning"
