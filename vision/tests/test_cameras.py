"""Cameras: CRUD + start/stop/status/snapshot in simulation mode."""
from __future__ import annotations

import asyncio


async def test_camera_crud(client, auth_headers, tank):
    resp = await client.post(
        "/api/v1/cameras",
        json={"tank_id": tank["id"], "name": "1번 수조 카메라"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    cam = resp.json()
    assert cam["camera_type"] == "usb"
    assert cam["resolution_w"] == 1920
    assert cam["fps_target"] == 1
    assert cam["tank_id"] == tank["id"]

    # List filtered by tank
    resp = await client.get(f"/api/v1/cameras?tank_id={tank['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # 부분 수정 — 보내지 않은 항목은 그대로 남는다.
    resp = await client.patch(
        f"/api/v1/cameras/{cam['id']}",
        json={"name": "1번 수조 카메라(신형)", "fps_target": 1.5},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "1번 수조 카메라(신형)"
    assert resp.json()["fps_target"] == 1.5
    assert resp.json()["resolution_w"] == 1920

    # Out-of-range FPS rejected (contract: 0.5 - 5).
    resp = await client.patch(
        f"/api/v1/cameras/{cam['id']}",
        json={"fps_target": 10},
        headers=auth_headers,
    )
    assert resp.status_code == 422

    # Delete
    resp = await client.delete(f"/api/v1/cameras/{cam['id']}", headers=auth_headers)
    assert resp.status_code == 204
    resp = await client.get(f"/api/v1/cameras/{cam['id']}", headers=auth_headers)
    assert resp.status_code == 404


async def test_camera_start_stop_simulation(client, auth_headers, camera, tank):
    camera_id = camera["id"]

    # Initially offline.
    resp = await client.get(f"/api/v1/cameras/{camera_id}/status", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "offline"

    # Start -> running, produces frames and count records.
    resp = await client.post(f"/api/v1/cameras/{camera_id}/start", headers=auth_headers)
    assert resp.status_code == 202
    try:
        await asyncio.sleep(1.0)  # fps_target=5 -> several ticks

        resp = await client.get(f"/api/v1/cameras/{camera_id}/status", headers=auth_headers)
        assert resp.json()["status"] == "running"

        resp = await client.get(f"/api/v1/counts/{camera_id}/latest", headers=auth_headers)
        assert resp.status_code == 200
        latest = resp.json()
        assert latest["camera_id"] == camera_id
        # 수조·양식장이 개체수 기록에 함께 실린다 — 통합 조회의 조인 키다.
        assert latest["tank_id"] == tank["id"]
        assert latest["farm_id"] == tank["farm_id"]
        assert latest["count"] > 0
        assert 0.5 <= latest["confidence_avg"] <= 1.0

        # Snapshot returns an annotated JPEG.
        resp = await client.get(f"/api/v1/cameras/{camera_id}/snapshot", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.content[:3] == b"\xff\xd8\xff"  # JPEG magic
    finally:
        resp = await client.post(f"/api/v1/cameras/{camera_id}/stop", headers=auth_headers)
        assert resp.status_code == 202

    resp = await client.get(f"/api/v1/cameras/{camera_id}/status", headers=auth_headers)
    assert resp.json()["status"] == "offline"


async def test_camera_create_unknown_tank(client, auth_headers):
    resp = await client.post(
        "/api/v1/cameras",
        json={"tank_id": "00000000-0000-0000-0000-000000000000", "name": "고아 카메라"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_service_key_required(client, tank):
    """공유 키가 없거나 틀리면 아무 경로도 열리지 않는다."""
    resp = await client.get("/api/v1/cameras")
    assert resp.status_code == 401

    resp = await client.get("/api/v1/cameras", headers={"X-Vision-Key": "wrong"})
    assert resp.status_code == 401


async def test_picamera_type_accepted(client, auth_headers, tank):
    """라즈베리파이 CSI 카메라는 주소 없이 등록된다.

    보드에 리본으로 직접 붙어 있어 가리킬 주소가 없다. stream_url 을 요구하면
    현장에서 쓸 수 없는 값을 억지로 채워 넣게 된다.
    """
    resp = await client.post(
        "/api/v1/cameras",
        json={"tank_id": tank["id"], "name": "파이 카메라", "camera_type": "picamera"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["camera_type"] == "picamera"
    assert resp.json()["stream_url"] is None


async def test_unknown_camera_type_rejected(client, auth_headers, tank):
    resp = await client.post(
        "/api/v1/cameras",
        json={"tank_id": tank["id"], "name": "이상한 카메라", "camera_type": "webcam"},
        headers=auth_headers,
    )
    assert resp.status_code == 422
