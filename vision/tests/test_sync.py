"""서버로 올리는 길 — reporter 와 sync_service.

여기서 지키려는 것은 하나다. **회선이 끊겨도 개체수를 잃지 않는다.**

장비는 이제 DB 비밀번호를 들지 않는다(설치에서 DATABASE_URL 을 없앤 이유).
대신 기기 키로 shrimp365 에 올린다. 그래서 끊김 처리가 전부 이 두 모듈에 있고,
여기서 틀리면 농장에서 조용히 데이터가 사라진다 — 화면에는 아무 표시도 없이.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import CountRecord, Farm, Tank
from app.services import reporter as reporter_mod
from app.services import sync_service
from app.services.reporter import ServerReporter


#: 테스트 DB 는 SQLite 파일 하나를 세션 내내 함께 쓴다. 아이디를 고정하면
#: 앞 테스트가 심어 둔 행이 남아 뒤 테스트가 "이미 있다"로 떨어진다 — 코드는
#: 멀쩡한데 순서 때문에 깨지는 테스트가 된다. 그래서 매번 새로 뽑는다.
@pytest.fixture
def ids() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    return uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _row(n: int = 1, cam: uuid.UUID | None = None) -> dict:
    """서버로 올라가는 한 줄의 모양."""
    return {
        "camera_id": str(cam or uuid.UUID(int=1)),
        "time": (datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=n)).isoformat(),
        "count": n,
        "confidence_avg": 0.5,
        "model_version": "t",
        "inference_ms": 10,
    }


# ── reporter ────────────────────────────────────────────────────────────────
async def test_send_counts_reports_failure_without_losing_anything(monkeypatch):
    """못 보내면 False. 보관은 호출부(장비 DB)가 한다 — 여기서 쌓지 않는다."""
    r = ServerReporter()
    monkeypatch.setattr(reporter_mod, "_post", _fake_post(0))
    assert await r.send_counts([_row(1)], agent_version="t") is False
    assert r.last_ok is False

    monkeypatch.setattr(reporter_mod, "_post", _fake_post(200))
    assert await r.send_counts([_row(1)], agent_version="t") is True
    assert r.last_ok is True


async def test_send_counts_sends_exactly_what_it_was_given(monkeypatch):
    """건네받은 것만 보낸다. 더 보내거나 덜 보내면 워터마크가 거짓이 된다."""
    r = ServerReporter()
    sent: list[list[dict]] = []

    async def fake_post(path, payload):
        sent.append(payload["counts"])
        return 200, {}

    monkeypatch.setattr(reporter_mod, "_post", fake_post)
    given = [_row(i) for i in range(1, 8)]
    assert await r.send_counts(given, agent_version="t") is True
    assert sent == [given]


async def test_nothing_to_send_is_not_a_connection(monkeypatch):
    """보낼 것이 없을 때는 통신하지 않는다 — 끊김 표시를 덮어쓰면 안 된다.

    화면이 server_ok 를 그대로 그리므로, 여기서 True 로 바꾸면 회선이 끊긴
    장비가 "연결됨"으로 보인다.
    """
    r = ServerReporter()
    monkeypatch.setattr(reporter_mod, "_post", _fake_post(0))
    await r.send_counts([_row(1)], agent_version="t")
    assert r.last_ok is False

    assert await r.send_counts([], agent_version="t") is True
    assert r.last_ok is False  # 여전히 끊긴 것으로 남아야 한다


async def test_no_device_key_means_no_request(monkeypatch):
    """연결 전 장비는 서버를 부르지 않는다. 부르면 401 로그만 쌓인다."""
    monkeypatch.setattr(reporter_mod.settings, "device_key", "")
    monkeypatch.setattr(reporter_mod.settings, "shrimp365_internal_url", "http://x")
    assert await reporter_mod._post("/api/vision/device", {}) == (0, {})
    assert await reporter_mod._get("/api/vision/device") == (0, {})


def _fake_post(status: int):
    async def fake_post(path, payload):
        return status, {}

    return fake_post


# ── sync_service ────────────────────────────────────────────────────────────
async def test_pull_assignment_creates_camera_and_its_tank(client, monkeypatch, ids):
    """서버가 준 카메라를 로컬에 심는다. 수조·양식장이 먼저 있어야 외래키가 선다."""
    CAM, TANK, FARM = ids

    async def fake_fetch():
        return {
            "cameras": [
                {
                    "id": str(CAM),
                    "tank_id": str(TANK),
                    "farm_id": str(FARM),
                    "tank_name": "A-1조",
                    "name": "A-1조 수중 카메라",
                    "camera_type": "usb",
                    "stream_url": "0",
                    "resolution_w": 640,
                    "resolution_h": 480,
                    "fps_target": 1,
                    "is_active": True,
                }
            ],
            "alert_configs": [],
        }

    monkeypatch.setattr(sync_service.reporter, "fetch_assignment", fake_fetch)
    assert await sync_service.pull_assignment() == 1

    from app.models import Camera

    async with SessionLocal() as s:
        cam = await s.get(Camera, CAM)
        assert cam is not None
        assert cam.name == "A-1조 수중 카메라"
        assert cam.tank_id == TANK
        assert (await s.get(Tank, TANK)) is not None
        assert (await s.get(Farm, FARM)) is not None

    # 두 번 받아도 행이 늘지 않는다 — 30초마다 도는 길이다.
    assert await sync_service.pull_assignment() == 1


async def test_pull_assignment_skips_malformed_row(client, monkeypatch, ids):
    """서버가 준 모양이 어긋나도 그 줄만 건너뛴다. 전체가 멈추면 카메라가 안 뜬다."""
    CAM, TANK, _ = ids

    async def fake_fetch():
        return {"cameras": [{"id": "그런-UUID-없음", "tank_id": str(TANK)}]}

    monkeypatch.setattr(sync_service.reporter, "fetch_assignment", fake_fetch)
    assert await sync_service.pull_assignment() == 1  # 줄 수는 세지만
    from app.models import Camera

    async with SessionLocal() as s:
        assert await s.get(Camera, CAM) is None  # 심지는 않는다


async def test_pull_assignment_tolerates_unreachable_server(monkeypatch):
    async def fake_fetch():
        return None

    monkeypatch.setattr(sync_service.reporter, "fetch_assignment", fake_fetch)
    assert await sync_service.pull_assignment() == 0


async def test_push_counts_advances_watermark_only_on_success(
    client, monkeypatch, tmp_path, ids
):
    """실패하면 워터마크를 올리지 않는다 — 올리면 그 구간이 영구히 안 간다."""
    CAM, TANK, FARM = ids
    monkeypatch.setattr(
        sync_service.settings, "device_state_path", str(tmp_path / "device.json")
    )
    # 테스트 DB 는 세션 내내 공유된다 — 다른 테스트가 남긴 개체수까지 집어
    # 올려 건수가 어긋난다. 실제 장비도 워터마크 뒤만 보므로, 여기서도 이미
    # 있는 것 뒤에 워터마크를 세우고 그 뒤로 세 줄을 넣어 범위를 가둔다.
    async with SessionLocal() as s:
        newest = (await s.execute(select(func.max(CountRecord.time)))).scalar()
    floor = datetime(2026, 1, 1, tzinfo=UTC)
    if newest is not None:
        newest = newest if newest.tzinfo else newest.replace(tzinfo=UTC)
        floor = max(floor, newest + timedelta(seconds=1))
    sync_service.write_watermark(floor)

    async with SessionLocal() as s:
        s.add(Farm(id=FARM, user_id=uuid.uuid4(), name="f"))
        s.add(Tank(id=TANK, farm_id=FARM, name="t"))
        await s.flush()
        for i in range(1, 4):
            s.add(
                CountRecord(
                    camera_id=CAM,
                    time=floor + timedelta(seconds=i),
                    tank_id=TANK,
                    farm_id=FARM,
                    count=10 + i,
                )
            )
        await s.commit()

    monkeypatch.setattr(reporter_mod, "_post", _fake_post(0))
    before = sync_service.read_watermark()
    assert await sync_service.push_counts() == 0
    assert sync_service.read_watermark() == before  # 올라가지 않았다

    monkeypatch.setattr(reporter_mod, "_post", _fake_post(200))
    assert await sync_service.push_counts() == 3
    assert sync_service.read_watermark() != before  # 보낸 만큼 올라갔다

    # 두 번째 호출은 보낼 것이 없다 — 같은 구간을 다시 보내지 않는다.
    assert await sync_service.push_counts() == 0
    assert sync_service.backlog() == 0  # 화면에 보여 줄 보관 건수도 0


async def test_watermark_survives_restart(monkeypatch, tmp_path):
    """워터마크는 파일이다. 메모리면 재부팅마다 처음부터 다시 보낸다."""
    monkeypatch.setattr(
        sync_service.settings, "device_state_path", str(tmp_path / "device.json")
    )
    when = datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC)
    sync_service.write_watermark(when)
    assert sync_service.read_watermark() == when


async def test_watermark_read_survives_garbage(monkeypatch, tmp_path):
    """파일이 깨졌으면 처음부터 다시 보낸다 — 터지지 않는다(서버가 덮어쓴다)."""
    monkeypatch.setattr(
        sync_service.settings, "device_state_path", str(tmp_path / "device.json")
    )
    (tmp_path / "sync-watermark.json").write_text("{깨진 파일")
    assert sync_service.read_watermark() is None


@pytest.mark.parametrize(
    ("database_url", "server_url", "expect"),
    [
        ("", "https://www.shrimp365.kr", True),  # 기본 — 서버로 올린다
        ("postgresql+asyncpg://u:p@h/db", "https://www.shrimp365.kr", False),  # DB 직결
        ("", "", False),  # 올릴 곳이 없다
    ],
)
async def test_enabled(monkeypatch, database_url, server_url, expect):
    monkeypatch.setattr(sync_service.settings, "database_url", database_url)
    monkeypatch.setattr(sync_service.settings, "shrimp365_internal_url", server_url)
    assert sync_service.enabled() is expect


# ── 장비 화면이 읽는 값 ──────────────────────────────────────────────────────
async def test_screen_reads_reachability_from_the_right_place(monkeypatch):
    """"서버 끊김"은 **서버에 닿았는가**로 판단해야 한다.

    예전에는 로컬 DB 쓰기 성공으로 판단했다. 장비가 DB 에 직접 붙던 때는
    그게 곧 서버였지만, 기기 키로 올리는 지금은 로컬 쓰기가 언제나 성공한다 —
    회선이 끊겨도 화면에 "연결됨"이 뜨고, 농장은 값이 안 올라가는 것을
    모른다. 그래서 구성에 따라 보는 곳이 달라야 한다.
    """
    from app.kiosk import build_state
    from app.services.camera_manager import camera_manager

    monkeypatch.setattr(camera_manager, "last_report_ok", True)
    sync_service.reporter.last_ok = False
    sync_service._set_backlog(7)

    # 서버로 올리는 구성 — reporter 를 본다
    monkeypatch.setattr(sync_service.settings, "database_url", "")
    monkeypatch.setattr(
        sync_service.settings, "shrimp365_internal_url", "https://www.shrimp365.kr"
    )
    state = build_state()
    assert state["server_ok"] is False
    assert state["pending_uploads"] == 7  # 보관 중인 건수가 화면에 간다

    # DB 직결 구성 — 예전처럼 camera_manager 를 본다
    monkeypatch.setattr(sync_service.settings, "database_url", "postgresql+asyncpg://u:p@h/d")
    state = build_state()
    assert state["server_ok"] is True
    assert state["pending_uploads"] == 0
    sync_service._set_backlog(0)


async def test_watermark_never_passes_an_unsent_record(client, monkeypatch, tmp_path, ids):
    """한 주기에 보내는 양보다 많이 쌓여 있어도 **보낸 만큼만** 올라간다.

    여기서 틀리면 조용히 기록이 빈다. 예전 구조가 그랬다 — 메모리에 따로
    쌓아 두고 한 번에 500건만 보내면서, 워터마크는 읽어 온 전체만큼 올렸다.
    재부팅하면 그 차이가 "이미 올린 것"으로 남아 영구히 건너뛰어졌다.
    """
    CAM, TANK, FARM = ids
    monkeypatch.setattr(
        sync_service.settings, "device_state_path", str(tmp_path / "device.json")
    )
    async with SessionLocal() as s:
        newest = (await s.execute(select(func.max(CountRecord.time)))).scalar()
    floor = datetime(2026, 1, 1, tzinfo=UTC)
    if newest is not None:
        newest = newest if newest.tzinfo else newest.replace(tzinfo=UTC)
        floor = max(floor, newest + timedelta(seconds=1))
    sync_service.write_watermark(floor)

    total = sync_service.BATCH_SIZE + 37
    async with SessionLocal() as s:
        s.add(Farm(id=FARM, user_id=uuid.uuid4(), name="f"))
        s.add(Tank(id=TANK, farm_id=FARM, name="t"))
        await s.flush()
        for i in range(1, total + 1):
            s.add(
                CountRecord(
                    camera_id=CAM,
                    time=floor + timedelta(seconds=i),
                    tank_id=TANK,
                    farm_id=FARM,
                    count=i,
                )
            )
        await s.commit()

    sent: list[int] = []

    async def fake_post(path, payload):
        sent.append(len(payload["counts"]))
        return 200, {}

    monkeypatch.setattr(reporter_mod, "_post", fake_post)

    assert await sync_service.push_counts() == sync_service.BATCH_SIZE
    assert sent == [sync_service.BATCH_SIZE]
    # 워터마크는 **보낸 마지막 줄**에 서 있어야 한다. 더 가 있으면 나머지 37건은
    # 영원히 안 올라간다. (워터마크는 DB 가 준 값을 그대로 적는다. SQLite 는
    # 시간대를 떼고 돌려주므로 견주기 전에 다시 붙인다.)
    mark = sync_service.read_watermark()
    assert mark is not None
    mark = mark if mark.tzinfo else mark.replace(tzinfo=UTC)
    assert mark == floor + timedelta(seconds=sync_service.BATCH_SIZE)
    assert sync_service.backlog() == 37

    assert await sync_service.push_counts() == 37
    assert sync_service.backlog() == 0


async def test_prune_never_touches_an_unsent_record(client, monkeypatch, tmp_path, ids):
    """오래된 것은 지우되, **아직 안 올린 줄은 어떤 경우에도 남긴다.**

    그걸 지우면 서버에도 없고 장비에도 없게 된다 — 복구할 곳이 없다.
    """
    CAM, TANK, FARM = ids
    monkeypatch.setattr(
        sync_service.settings, "device_state_path", str(tmp_path / "device.json")
    )
    base = datetime(2030, 6, 1, tzinfo=UTC)  # 다른 테스트 자료와 겹치지 않게
    async with SessionLocal() as s:
        s.add(Farm(id=FARM, user_id=uuid.uuid4(), name="f"))
        s.add(Tank(id=TANK, farm_id=FARM, name="t"))
        await s.flush()
        for days in (30, 20, 1):  # 올린 것: 아주 오래된 것 ~ 최근
            s.add(
                CountRecord(
                    camera_id=CAM,
                    time=base - timedelta(days=days),
                    tank_id=TANK,
                    farm_id=FARM,
                    count=days,
                )
            )
        # 아직 안 올린 줄 — 날짜는 오래되었지만 워터마크보다 뒤다.
        s.add(
            CountRecord(
                camera_id=CAM, time=base, tank_id=TANK, farm_id=FARM, count=999
            )
        )
        await s.commit()

    # 워터마크를 "1일 전" 에 세운다 → 보관 기간(7일) 기준선은 그보다 7일 앞.
    # (지운 건수로 견주지 않는다 — 테스트 DB 는 공유라 다른 테스트가 남긴
    #  옛 기록까지 같이 지워진다. 실제 장비에는 자기 기록만 있다.)
    sync_service.write_watermark(base - timedelta(days=1))
    await sync_service.prune_local()

    async with SessionLocal() as s:
        left = sorted(
            (await s.execute(select(CountRecord.count).where(CountRecord.camera_id == CAM)))
            .scalars()
        )
    assert left == [1, 999], "안 올린 줄이나 보관 기간 안의 줄을 지웠다"


async def test_prune_does_nothing_before_the_first_upload(monkeypatch, tmp_path):
    """한 번도 못 올린 장비(설치 직후·회선 없음)에서는 아무것도 지우지 않는다."""
    monkeypatch.setattr(
        sync_service.settings, "device_state_path", str(tmp_path / "device.json")
    )
    assert sync_service.read_watermark() is None
    assert await sync_service.prune_local() == 0
