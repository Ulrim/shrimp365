"""Cameras: CRUD + start/stop/status/snapshot + 장비 귀속(host_id)."""
from __future__ import annotations

import asyncio

import pytest

from app.config import settings
from app.services.camera_manager import camera_manager


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


async def make_camera(client, auth_headers, tank, name, host_id=None):
    body = {"tank_id": tank["id"], "name": name, "camera_type": "picamera"}
    if host_id is not None:
        body["host_id"] = host_id
    resp = await client.post("/api/v1/cameras", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def no_real_streams(monkeypatch):
    """카메라를 실제로 켜지 않고 "어느 것을 켜려 했는지" 만 기록한다.

    귀속 판정을 보는 테스트에 진짜 스트림은 필요 없다. 오히려 해롭다 —
    처리기가 백그라운드에서 개체수를 계속 쓰면 테스트용 SQLite 파일이
    잠겨 뒤따르는 테스트가 "database is locked" 로 터진다.
    """
    started: list[str] = []

    async def fake_start(camera, farm_id):
        started.append(camera.name)

    monkeypatch.setattr(camera_manager, "start_camera", fake_start)
    return started


async def test_foreign_host_camera_rejected(client, auth_headers, tank, monkeypatch):
    """다른 장비에 물린 카메라는 이 서비스에서 시작되지 않는다.

    CSI 카메라는 보드에 리본으로 붙어 있어 그 보드에서만 열린다. 이 확인이
    없으면 비전 파이가 두 대일 때 서로 남의 카메라를 열려고 무한 재시도한다.
    """
    camera = await make_camera(client, auth_headers, tank, "2번 수조 카메라", "pi-tank-2")
    assert camera["host_id"] == "pi-tank-2"

    # 이 서비스는 1번 수조 파이라고 하자.
    monkeypatch.setattr(settings, "vision_host_id", "pi-tank-1")

    resp = await client.post(f"/api/v1/cameras/{camera['id']}/start", headers=auth_headers)
    assert resp.status_code == 409
    # 어느 장비에서 시작해야 하는지 알려 줘야 설정을 고칠 수 있다.
    assert "pi-tank-2" in resp.json()["detail"]


async def test_own_host_camera_accepted(
    client, auth_headers, tank, monkeypatch, no_real_streams
):
    monkeypatch.setattr(settings, "vision_host_id", "pi-tank-1")
    camera = await make_camera(client, auth_headers, tank, "1번 수조 카메라", "pi-tank-1")

    resp = await client.post(f"/api/v1/cameras/{camera['id']}/start", headers=auth_headers)
    assert resp.status_code == 202
    assert no_real_streams == ["1번 수조 카메라"]


async def test_auto_start_skips_other_hosts(
    client, auth_headers, tank, monkeypatch, no_real_streams
):
    """뜰 때 자동 시작도 내 카메라만 고른다.

    테스트 DB 는 한 파일을 여러 테스트가 나눠 쓰므로, 앞선 테스트가 남긴
    카메라와 섞이지 않도록 이 테스트만의 장비 이름을 쓴다.
    """
    mine, theirs = "pi-autostart-mine", "pi-autostart-theirs"
    for host in (mine, theirs):
        await make_camera(client, auth_headers, tank, f"{host} 카메라", host)

    monkeypatch.setattr(settings, "vision_host_id", mine)
    started = await camera_manager.auto_start_active_cameras()

    assert started == 1
    # 개수만 세면 남의 카메라를 대신 시작해도 통과한다. 무엇을 켰는지까지 본다.
    assert no_real_streams == [f"{mine} 카메라"]


async def test_unnamed_host_owns_unnamed_cameras(
    client, auth_headers, tank, monkeypatch, no_real_streams
):
    """장비가 한 대뿐인 배포에는 이름을 강제하지 않는다.

    양쪽 다 이름이 없으면 내 것으로 본다 — 이름을 요구하면 설정만 늘고
    얻는 것이 없다.
    """
    monkeypatch.setattr(settings, "vision_host_id", "")
    camera = await make_camera(client, auth_headers, tank, "유일한 카메라")
    assert camera["host_id"] is None

    resp = await client.post(f"/api/v1/cameras/{camera['id']}/start", headers=auth_headers)
    assert resp.status_code == 202
    assert no_real_streams == ["유일한 카메라"]
