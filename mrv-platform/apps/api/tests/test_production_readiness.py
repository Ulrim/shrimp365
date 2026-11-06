"""phase-3 슬라이스 N(프로덕션 준비성, docs/design/phase-3.md 8절) 회귀 테스트.

검증 범위:
  - GET /health : liveness, DB 미조회, 항상 200.
  - GET /ready  : readiness, DB `SELECT 1` 성공 200 / 실패 503.
  - CORS preflight(OPTIONS): 허용 오리진은 Access-Control-Allow-Origin 에코,
    비허용 오리진은 400 + 헤더 미부여.
  - 전역 예외 핸들러: 미처리 예외가 500 + `{"detail": "internal server error"}` 봉투로
    통일되는지(8.5절, OWASP A05 — 트레이스백/내부 구현 비노출).
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

import app.main as main_module
import app.routers.kpi as kpi_router_module
from app.main import app
from tests.conftest import PERIOD_START, SITE1_ID


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- /health, /ready ---------------------------------------------------


def test_health_is_always_ok(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_ready_ok_when_db_reachable(client: TestClient):
    resp = client.get("/ready")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ready"}


def test_ready_returns_503_when_db_unreachable(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    class _BoomEngine:
        def connect(self):  # noqa: D401 - 테스트 더블
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr(main_module, "engine", _BoomEngine())
    resp = client.get("/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "not_ready"
    assert "detail" in body


# --- CORS ---------------------------------------------------------------


def test_cors_preflight_allows_configured_origin(client: TestClient):
    resp = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_preflight_rejects_unlisted_origin(client: TestClient):
    resp = client.options(
        "/health",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 400
    assert "access-control-allow-origin" not in resp.headers


def test_cors_does_not_allow_credentials(client: TestClient):
    """Bearer 토큰 방식이라 쿠키 자격증명이 불필요 — allow_credentials=False 근거 회귀."""
    resp = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-credentials" not in resp.headers


# --- 전역 예외 핸들러 -----------------------------------------------------


def test_unhandled_exception_returns_uniform_500_envelope(
    monkeypatch: pytest.MonkeyPatch, org1_token: str
):
    """의도적으로 서비스 계층에서 RuntimeError 를 유발해 전역 핸들러 동작을 확인.

    기본 `client` 픽스처(raise_server_exceptions=True)는 starlette 이 always-reraise 하는
    ServerErrorMiddleware 특성상 예외를 그대로 재발생시켜 응답을 검증할 수 없다
    (starlette 는 test client 가 원하면 예외를 볼 수 있도록 항상 재발생시킨다).
    따라서 이 테스트만 raise_server_exceptions=False 인 별도 클라이언트를 사용한다.
    """

    def _boom(**_kwargs):
        raise RuntimeError("intentional failure for exception-handler test")

    monkeypatch.setattr(kpi_router_module, "compute_site_kpi", _boom)

    local_client = TestClient(app, raise_server_exceptions=False)
    frm = PERIOD_START
    to = PERIOD_START + timedelta(hours=10)
    resp = local_client.get(
        f"/sites/{SITE1_ID}/kpi",
        params={"from": frm.isoformat(), "to": to.isoformat()},
        headers=_hdr(org1_token),
    )
    assert resp.status_code == 500
    assert resp.json() == {"detail": "internal server error"}
