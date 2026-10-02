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
