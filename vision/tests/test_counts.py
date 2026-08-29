"""Counts: latest values + bucketed history (SQLite path)."""
from __future__ import annotations

import uuid
from datetime import timedelta

from app.database import SessionLocal, utcnow
from app.models import CountRecord


async def insert_counts(
    camera_id: str, tank_id: str, farm_id: str, values: list[int], minutes_ago: int = 0
):
    """Insert one record per minute ending `minutes_ago` minutes before now."""
    base = utcnow().replace(second=0, microsecond=0) - timedelta(
        minutes=minutes_ago + len(values)
    )
    async with SessionLocal() as session:
        for i, value in enumerate(values):
            session.add(
                CountRecord(
                    time=base + timedelta(minutes=i),
                    camera_id=uuid.UUID(camera_id),
                    tank_id=uuid.UUID(tank_id),
                    farm_id=uuid.UUID(farm_id),
                    count=value,
                    confidence_avg=0.9,
                    model_version="test",
                    inference_ms=42,
                )
            )
        await session.commit()
    return base


async def test_latest_counts(client, auth_headers, tank, camera):
    await insert_counts(camera["id"], tank["id"], tank["farm_id"], [100, 110, 120])

    resp = await client.get("/api/v1/counts/latest", headers=auth_headers)
    assert resp.status_code == 200
    rows = [r for r in resp.json() if r["camera_id"] == camera["id"]]
    assert len(rows) == 1
    assert rows[0]["count"] == 120
    assert rows[0]["tank_id"] == tank["id"]
    assert rows[0]["farm_id"] == tank["farm_id"]

    resp = await client.get(f"/api/v1/counts/{camera['id']}/latest", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["count"] == 120


async def test_history_buckets(client, auth_headers, tank, camera):
    # 120 one-minute records (2 hours), constant blocks: 100 then 200.
    values = [100] * 60 + [200] * 60
    base = await insert_counts(camera["id"], tank["id"], tank["farm_id"], values)
    start = (base - timedelta(minutes=5)).isoformat()
    end = (base + timedelta(minutes=125)).isoformat()

    resp = await client.get(
        f"/api/v1/counts/{camera['id']}/history",
        params={"start": start, "end": end, "interval": "1h"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    buckets = resp.json()
    assert 2 <= len(buckets) <= 3
    assert sum(b["sample_count"] for b in buckets) == 120
    assert all(b["camera_id"] == camera["id"] for b in buckets)
    assert all(b["tank_id"] == tank["id"] for b in buckets)
    assert buckets[0]["min_count"] >= 100
    assert buckets[-1]["max_count"] == 200

    # 5m buckets over the same window.
    resp = await client.get(
        f"/api/v1/counts/{camera['id']}/history",
        params={"start": start, "end": end, "interval": "5m"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    five_min = resp.json()
    assert len(five_min) >= 24
    # All buckets average within the data range; the single transition bucket
    # (100 -> 200 mid-bucket) may fall in between, every other one is exact.
    assert all(100 <= b["avg_count"] <= 200 for b in five_min)
    assert sum(1 for b in five_min if b["avg_count"] not in (100, 200)) <= 1
    assert five_min[0]["avg_count"] == 100
    assert five_min[-1]["avg_count"] == 200

    # Invalid interval rejected.
    resp = await client.get(
        f"/api/v1/counts/{camera['id']}/history",
        params={"start": start, "end": end, "interval": "2h"},
        headers=auth_headers,
    )
    assert resp.status_code == 422
