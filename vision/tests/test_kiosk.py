"""장비 터치스크린 화면 (app/kiosk.py).

여기서 지키는 것은 두 가지다.

  1. **루프백 밖으로는 절대 뜨지 않는다.** 이 화면은 영상과 페어링 코드를
     인증 없이 보여 준다. 본 서비스는 Cloudflare 터널로 바깥에 열리므로,
     화면이 같은 자리에 뜨면 카메라 id 하나로 남의 수조를 들여다볼 수 있다.
  2. **가짜 개체수를 진짜처럼 보여 주지 않는다.** 시뮬레이션이면 상태에
     그대로 실려 화면이 경고를 띄운다.
"""
from __future__ import annotations

import uuid

import pytest
from starlette.testclient import TestClient

from app import kiosk
from app.config import settings
from app.services.pairing import PairingState


@pytest.fixture
def client():
    with TestClient(kiosk.create_app()) as c:
        yield c


# ---------------------------------------------------------------------------
# 루프백 전용
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1", "127.0.0.5"])
def test_loopback_hosts_are_allowed(host):
    assert kiosk._is_loopback(host) is True


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.0.50", "10.0.0.1", "example.com", ""])
def test_non_loopback_hosts_are_rejected(host):
    assert kiosk._is_loopback(host) is False


@pytest.mark.anyio
async def test_serve_refuses_to_bind_outside_loopback(monkeypatch, caplog):
    """0.0.0.0 으로 잘못 설정하면 **뜨지 않아야** 한다.

    조용히 열어 주면 인증 없는 영상이 그대로 바깥에 나간다. 설정 실수를
    못 띄우는 것으로 알리는 쪽이 낫다.
    """
    monkeypatch.setattr(settings, "kiosk_host", "0.0.0.0")  # noqa: S104 - 테스트 의도
    started = []
    monkeypatch.setattr(
        kiosk, "create_app", lambda: started.append(1)  # 여기 닿으면 실패다
    )
    await kiosk.serve()
    assert started == [], "루프백이 아닌데 화면을 띄웠다"


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------------------------------------------------------------------------
# 상태
# ---------------------------------------------------------------------------


def test_state_has_everything_the_screen_draws(client):
    body = client.get("/api/state").json()
    for key in (
        "count", "count_age", "camera", "history", "simulation",
        "simulation_reason", "server_ok", "pairing", "model", "conf_threshold",
    ):
        assert key in body, f"화면이 쓰는 값이 빠졌다: {key}"
    assert body["pairing"]["serial"]


def test_state_is_not_cached(client):
    """1초마다 묻는 화면이 캐시된 값을 받으면 멈춘 것처럼 보인다."""
    assert client.get("/api/state").headers["cache-control"] == "no-store"


def test_simulation_is_reported_to_the_screen(client, monkeypatch, tmp_path):
    """가짜 개체수를 조용히 보여 주지 않는다 — 화면이 경고를 띄울 근거."""
    import app.config as config

    monkeypatch.setattr(settings, "model_path", "/nonexistent/x.onnx")
    monkeypatch.setattr(settings, "simulation_mode", None)
    config.reset_simulation_mode_cache()
    try:
        body = client.get("/api/state").json()
        assert body["simulation"] is True
        assert "MODEL_PATH" in (body["simulation_reason"] or "")
    finally:
        config.reset_simulation_mode_cache()


def test_server_ok_is_none_before_any_report(client, monkeypatch):
    """한 번도 보고하지 않았으면 '연결됨'이라고 추측하지 않는다."""
    from app.services.camera_manager import camera_manager

    monkeypatch.setattr(camera_manager, "last_report_ok", None)
    assert client.get("/api/state").json()["server_ok"] is None


def test_frame_returns_204_when_there_is_no_frame(client):
    """빈 본문 대신 204 — <img> 가 깨진 아이콘을 띄우지 않게."""
    assert client.get("/frame.jpg").status_code == 204


def test_favicon_does_not_404(client):
    """크로미움이 매번 요청한다. 404 가 쌓이면 진짜 오류가 묻힌다."""
    assert client.get("/favicon.ico").status_code == 204


def test_frame_serves_the_latest_annotated_jpeg(client, monkeypatch):
    from app.services.camera_manager import camera_manager
    from app.services.stream_service import frame_store

    cam = uuid.uuid4()
    monkeypatch.setitem(camera_manager._processors, cam, object())
    frame_store.push_frame(cam, b"\xff\xd8fake-jpeg")
    try:
        res = client.get("/frame.jpg")
        assert res.status_code == 200
        assert res.headers["content-type"] == "image/jpeg"
        assert res.content == b"\xff\xd8fake-jpeg"
    finally:
        frame_store.clear_camera(cam)


# ---------------------------------------------------------------------------
# 페어링 상태
# ---------------------------------------------------------------------------


def test_pairing_state_reports_each_step():
    st = PairingState()
    assert st.snapshot()["status"] == "idle"

    st.begin_request()
    assert st.snapshot()["status"] == "requesting"

    st.code_received("482917", deadline=0.0)
    snap = st.snapshot()
    assert snap["status"] == "waiting"
    assert snap["code"] == "482917"

    st.linked("cam-1", "A-1조")
    snap = st.snapshot()
    assert snap["status"] == "linked"
    assert snap["tank_name"] == "A-1조"
    assert snap["code"] is None, "연결된 뒤에도 코드가 화면에 남으면 안 된다"


def test_pairing_failure_keeps_the_reason():
    st = PairingState()
    st.begin_request()
    st.failed("인터넷 연결을 확인하세요")
    snap = st.snapshot()
    assert snap["status"] == "failed"
    assert snap["error"] == "인터넷 연결을 확인하세요"


def test_cancel_without_a_running_pairing_is_a_no_op():
    assert PairingState().cancel() is False


def test_page_is_served(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    # 화면이 실제로 그리는 것들이 페이지 안에 있어야 한다.
    for needle in ("현재 개체수", "기기 연결", "/api/state", "/frame.jpg"):
        assert needle in res.text


@pytest.mark.anyio
async def test_port_conflict_does_not_kill_the_service(monkeypatch, caplog):
    """화면 포트가 이미 쓰이고 있어도 **계수는 계속되어야 한다.**

    uvicorn 은 bind 실패를 sys.exit(3) 으로 알린다. 그대로 두면 화면 포트가
    겹쳤다는 이유로 프로세스 전체가 죽어 개체수가 끊긴다. 화면은 있으면 좋은
    것이고, 세는 일이 본업이다.
    """
    import socket as _socket

    busy = _socket.socket()
    busy.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
    busy.bind(("127.0.0.1", 0))
    busy.listen(1)
    port = busy.getsockname()[1]
    try:
        monkeypatch.setattr(settings, "kiosk_host", "127.0.0.1")
        monkeypatch.setattr(settings, "kiosk_port", port)
        built = []
        monkeypatch.setattr(kiosk, "create_app", lambda: built.append(1))

        await kiosk.serve()  # 예외 없이 돌아와야 한다

        assert built == [], "포트를 못 잡았는데 서버를 만들려 들었다"
    finally:
        busy.close()


# ---------------------------------------------------------------------------
# 설정 점검 (app/config.config_problems)
#
# install.sh 가 만드는 env 는 세 줄이 비어 있다. 그래서 **첫 기동은 반드시**
# 여기에 걸린다 — 그때 파이썬 스택트레이스가 아니라 할 일이 보여야 한다.
# ---------------------------------------------------------------------------


def _problems(monkeypatch, **over):
    import app.config as config

    defaults = {
        "database_url": "postgresql+asyncpg://u:p@h:5432/d",
        "vision_service_key": "k" * 32,
        "stream_secret": "s" * 32,
    }
    for attr, val in {**defaults, **over}.items():
        monkeypatch.setattr(settings, attr, val)
    return config.config_problems()


def test_complete_config_has_no_problems(monkeypatch):
    assert _problems(monkeypatch) == []


def test_empty_values_are_each_named(monkeypatch):
    found = _problems(monkeypatch, database_url="", vision_service_key="", stream_secret="")
    joined = " | ".join(found)
    for env_name in ("DATABASE_URL", "VISION_SERVICE_KEY", "VISION_STREAM_SECRET"):
        assert env_name in joined, f"{env_name} 를 짚어 주지 않는다"


def test_whitespace_only_counts_as_empty(monkeypatch):
    """nano 에서 값을 지우면 공백이 남기 쉽다."""
    assert any("DATABASE_URL" in p for p in _problems(monkeypatch, database_url="   "))


def test_supabase_string_pasted_as_is_is_caught(monkeypatch):
    """가장 흔한 실수 — +asyncpg 를 빠뜨린 채 붙여넣기.

    이걸 못 잡으면 sqlalchemy 가 'Could not parse SQLAlchemy URL' 만 던지고
    끝난다. 현장에서 그 문구로는 무엇을 고쳐야 할지 알 수 없다.
    """
    found = _problems(
        monkeypatch,
        database_url="postgresql://postgres.abc:pw@aws-0.pooler.supabase.com:5432/postgres",
    )
    assert any("+asyncpg" in p for p in found)


def test_sqlite_is_accepted(monkeypatch):
    """테스트와 개발은 SQLite 로 돈다 — 막으면 안 된다."""
    assert _problems(monkeypatch, database_url="sqlite+aiosqlite:///./t.db") == []


def test_message_names_the_file_and_the_restart_command(monkeypatch):
    import app.config as config

    text = config.explain_config_problems(["X 가 비어 있습니다"], "/etc/shrimp365-vision/env")
    assert "/etc/shrimp365-vision/env" in text
    assert "systemctl restart shrimp365-vision" in text
    assert "X 가 비어 있습니다" in text


# ---------------------------------------------------------------------------
# CORS_ORIGINS 형식 (app/config)
#
# pydantic-settings 는 목록 필드의 환경변수를 JSON 으로 먼저 해독한다. 그래서
# .env.example 이 안내하는 "쉼표로 구분" 도, install.sh 가 쓰던 값도, 심지어
# **빈 값까지** SettingsError 로 터져 서비스가 뜨지 않았다. 현장에서 설정을
# 손으로 고치는 이상, 형식 하나 틀렸다고 못 뜨면 안 된다.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://www.shrimp365.kr", ["https://www.shrimp365.kr"]),
        ("https://a.kr,https://b.kr", ["https://a.kr", "https://b.kr"]),
        (" https://a.kr , https://b.kr ", ["https://a.kr", "https://b.kr"]),
        ('["https://a.kr","https://b.kr"]', ["https://a.kr", "https://b.kr"]),  # 예전 JSON
        ("https://a.kr,,", ["https://a.kr"]),  # 꼬리 쉼표
    ],
)
def test_cors_origins_accepts_the_documented_forms(raw, expected):
    from app.config import Settings

    assert Settings._split_origins(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_blank_cors_origins_falls_back_instead_of_crashing(raw):
    """.env.example 의 `CORS_ORIGINS=` 가 그대로 터지면 안 된다."""
    from app.config import Settings

    got = Settings._split_origins(raw)
    assert got is None or got == ["http://localhost:3000"]
