"""GET /auth/me — QA phase-2 조건부승인 갭1 하드닝(app/routers/auth.py).

검증 범위: 정상 응답 shape, plan 이 organizations.plan 실값과 일치(START/PRO 양쪽),
토큰 없음 → 401. 인증만 요구하는 엔드포인트이므로 org 격리 테스트는 불필요
(자기 org 정보만 반환 — 3중 방어 대상 아님, app/routers/auth.py 참고).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.organization import Organization
from tests.conftest import ORG1_ID


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _set_plan(org_id: str, plan: str) -> None:
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == org_id)).scalar_one()
        org.plan = plan
        s.commit()


@pytest.fixture(autouse=True)
def _restore_plan(_prepare_db):
    yield
    _set_plan(ORG1_ID, "START")


def test_auth_me_returns_context_and_plan(client, org1_token):
    resp = client.get("/auth/me", headers=_hdr(org1_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["org_id"] == ORG1_ID
    assert body["role"] == "admin"
    assert body["user_id"] == "u-1"
    assert body["plan"] == "START"


def test_auth_me_reflects_pro_plan(client, org1_token):
    """plan 변경이 토큰 재발급 없이 즉시 반영된다(토큰에 claim 을 굽지 않는 이유)."""
    _set_plan(ORG1_ID, "PRO")
    resp = client.get("/auth/me", headers=_hdr(org1_token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["plan"] == "PRO"


def test_auth_me_without_token_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_auth_me_invalid_token_401(client):
    resp = client.get("/auth/me", headers=_hdr("garbage.token.value"))
    assert resp.status_code == 401
