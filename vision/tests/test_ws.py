"""WebSocket /ws/stream: 토큰 인증, 구독 범위 제한, 실시간 count_update 흐름."""
from __future__ import annotations

import asyncio
import uuid

from starlette.testclient import TestClient

from app.api.websocket.stream import _Subscription
from app.core.security import sign_stream_token
from app.database import SessionLocal
from app.main import app
from app.models import Farm, Tank
from app.services.broadcaster import Broadcaster
from tests.conftest import SERVICE_KEY, TEST_USER_ID

CAM_A = "11111111-1111-1111-1111-111111111111"
CAM_B = "22222222-2222-2222-2222-222222222222"


async def test_local_broadcaster_fanout():
    broadcaster = Broadcaster()  # not started -> in-process mode
    q1 = broadcaster.subscribe()
    q2 = broadcaster.subscribe()
    await broadcaster.publish({"type": "count_update", "camera_id": "cam-1", "count": 5})
    assert (await asyncio.wait_for(q1.get(), 1))["count"] == 5
    assert (await asyncio.wait_for(q2.get(), 1))["camera_id"] == "cam-1"
    broadcaster.unsubscribe(q2)
    await broadcaster.publish({"type": "count_update", "camera_id": "cam-1", "count": 6})
    assert (await asyncio.wait_for(q1.get(), 1))["count"] == 6
    assert q2.empty()


def test_subscription_filtering():
    sub = _Subscription(CAM_A, frozenset({CAM_A, CAM_B}))
    assert sub.matches({"camera_id": CAM_A})
    assert not sub.matches({"camera_id": CAM_B})
    sub.update([CAM_B])
    assert sub.matches({"camera_id": CAM_B})
    assert not sub.matches({"camera_id": CAM_A})


def test_subscription_cannot_escape_its_grant():
    """토큰에 없는 카메라는 'all' 로도, 직접 지정으로도 구독되지 않는다.

    여기가 뚫리면 카메라 id 하나로 남의 양식장 개체수와 경보가 흘러간다.
    """
    outsider = "33333333-3333-3333-3333-333333333333"
    sub = _Subscription("all", frozenset({CAM_A}))
    assert sub.camera_ids == {CAM_A}
    assert not sub.matches({"camera_id": outsider})

    sub.update([outsider])
    assert sub.camera_ids == set()
    assert not sub.matches({"camera_id": outsider})

    sub.update(["all"])
    assert sub.camera_ids == {CAM_A}

    # 경로에 남의 카메라를 넣어 붙는 경우도 빈 구독으로 떨어진다.
    assert _Subscription(outsider, frozenset({CAM_A})).camera_ids == set()


def _seed_tank() -> str:
    async def go() -> str:
        farm_id, tank_id = uuid.uuid4(), uuid.uuid4()
        async with SessionLocal() as session:
            session.add(Farm(id=farm_id, user_id=TEST_USER_ID, name="WS 테스트 양식장"))
            session.add(Tank(id=tank_id, farm_id=farm_id, name="WS 수조"))
            await session.commit()
        return str(tank_id)

    return asyncio.run(go())


def test_ws_rejects_missing_or_foreign_token():
    with TestClient(app) as tc:  # runs lifespan: init_db + broadcaster
        for url in (
            f"/ws/stream/{CAM_A}",
            f"/ws/stream/{CAM_A}?token=garbage",
            # 서명은 유효하지만 다른 카메라에 발급된 토큰.
            f"/ws/stream/{CAM_A}?token={sign_stream_token([CAM_B], str(TEST_USER_ID))}",
        ):
            try:
                with tc.websocket_connect(url):
                    raise AssertionError(f"연결이 허용되면 안 된다: {url}")
            except AssertionError:
                raise
            except Exception:
                pass  # 정책 위반으로 닫힘 — 기대한 결과


def test_ws_receives_count_updates_from_running_camera():
    headers = {"X-Vision-Key": SERVICE_KEY}
    with TestClient(app) as tc:  # runs lifespan: init_db + broadcaster
        tank_id = _seed_tank()
        camera = tc.post(
            "/api/v1/cameras",
            json={"tank_id": tank_id, "name": "WS 카메라", "fps_target": 5},
            headers=headers,
        ).json()
        token = sign_stream_token([camera["id"]], str(TEST_USER_ID))

        assert tc.post(f"/api/v1/cameras/{camera['id']}/start", headers=headers).status_code == 202
        try:
            with tc.websocket_connect(f"/ws/stream/{camera['id']}?token={token}") as ws:
                # Collect until a count_update for our camera arrives.
                update = None
                for _ in range(20):
                    message = ws.receive_json()
                    assert message["camera_id"] == camera["id"]
                    if message["type"] == "count_update":
                        update = message
                        break
                assert update is not None
                assert update["count"] > 0
                assert update["frame_width"] == 1280
                assert update["frame_height"] == 720
                assert "timestamp" in update
                # bboxes power the frontend canvas overlay (capped at 400).
                assert update["bbox_count"] == update["count"]
                assert 0 < len(update["bboxes"]) <= 400
                box = update["bboxes"][0]
                assert set(box) == {"x1", "y1", "x2", "y2", "confidence"}
                assert box["x2"] > box["x1"]

                # Widen subscription via a client subscribe message.
                ws.send_json({"type": "subscribe", "camera_ids": [camera["id"]]})
                follow_up = ws.receive_json()
                assert follow_up["camera_id"] == camera["id"]
        finally:
            tc.post(f"/api/v1/cameras/{camera['id']}/stop", headers=headers)
