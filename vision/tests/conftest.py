"""Test fixtures: temp SQLite DB, simulation mode, httpx ASGI client.

Environment is pinned BEFORE any `app.*` import so the settings singleton and
the SQLAlchemy engine bind to the temporary database.

운영에서는 farms·tanks·alerts 를 shrimp365 가 만들지만, 테스트에서는
SQLite 에 read-only 매핑까지 포함해 create_all 로 함께 만든다
(app/database.py 의 init_db 참고).
"""
from __future__ import annotations

import os
import tempfile
import uuid

_TMP = tempfile.mkdtemp(prefix="shrimp365-vision-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP}/test.db"
os.environ["SIMULATION_MODE"] = "true"
os.environ["AUTO_START_STREAMS"] = "false"
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"  # nothing listens -> local pub/sub
os.environ["VISION_SERVICE_KEY"] = "test-service-key-test-service-key"
os.environ["VISION_STREAM_SECRET"] = "test-stream-secret-test-stream-secret"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, Tank  # noqa: E402
from app.services.alert_service import alert_service  # noqa: E402

SERVICE_KEY = os.environ["VISION_SERVICE_KEY"]
TEST_USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture
async def client():
    await init_db()
    alert_service.invalidate_config_cache()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """서버 간 호출용 공유 키. shrimp365 의 API 라우트가 보내는 것과 같다."""
    return {"X-Vision-Key": SERVICE_KEY}


@pytest.fixture
async def tank(client) -> dict:
    """shrimp365 가 소유하는 양식장·수조를 직접 만든다.

    이 서비스에는 양식장·수조를 만드는 API 가 없다 — 등록은 shrimp365 화면에서
    한 번만 하는 것이 통합의 전제다. 테스트도 그 전제대로 DB 에 바로 넣는다.
    """
    farm_id = uuid.uuid4()
    tank_id = uuid.uuid4()
    async with SessionLocal() as session:
        session.add(Farm(id=farm_id, user_id=TEST_USER_ID, name="테스트 양식장"))
        session.add(Tank(id=tank_id, farm_id=farm_id, name="1번 수조"))
        await session.commit()
    return {"id": str(tank_id), "farm_id": str(farm_id)}


@pytest.fixture
async def camera(client: AsyncClient, auth_headers, tank) -> dict:
    resp = await client.post(
        "/api/v1/cameras",
        json={
            "tank_id": tank["id"],
            "name": "테스트 수조 카메라",
            "camera_type": "usb",
            "fps_target": 5,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
