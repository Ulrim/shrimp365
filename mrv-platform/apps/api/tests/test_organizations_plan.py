"""PATCH /organizations/{org_id}/plan — phase-3.md 7.4절(유료 전환) 검증.

owner 성공, operator 403, 잘못된 plan 값 422, audit_logs(action='plan_change') 확인,
3중 테넌시(타 org 경로 404). 테스트 종료 후 org1.plan 을 START 로 복원(다른 스위트의
require_plan 게이팅 기본 전제를 깨지 않기 위함).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.organization import Organization
from tests.conftest import ORG1_ID, ORG2_ID, _make_token


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _reset_org1_plan(_prepare_db):
    yield
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "START"
        s.commit()


def test_owner_can_change_plan_and_audit_recorded(client, owner_token):
    resp = client.patch(
        f"/organizations/{ORG1_ID}/plan", json={"plan": "PRO"}, headers=_hdr(owner_token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == ORG1_ID
    assert body["plan"] == "PRO"

    with SessionLocal() as session:
        org = session.execute(
            select(Organization).where(Organization.id == ORG1_ID)
        ).scalar_one()
        assert org.plan == "PRO"

        logs = session.execute(
            select(AuditLog).where(
                AuditLog.entity == "organizations",
                AuditLog.entity_id == ORG1_ID,
                AuditLog.action == "plan_change",
            )
        ).scalars().all()
        assert len(logs) == 1
        assert logs[0].diff_json["before"]["plan"] == "START"
        assert logs[0].diff_json["after"]["plan"] == "PRO"


def test_operator_cannot_change_plan(client, operator_token):
    resp = client.patch(
        f"/organizations/{ORG1_ID}/plan", json={"plan": "PRO"}, headers=_hdr(operator_token)
    )
    assert resp.status_code == 403


def test_viewer_cannot_change_plan(client, viewer_token):
    resp = client.patch(
        f"/organizations/{ORG1_ID}/plan", json={"plan": "PRO"}, headers=_hdr(viewer_token)
    )
    assert resp.status_code == 403


def test_invalid_plan_value_returns_422(client, owner_token):
    resp = client.patch(
        f"/organizations/{ORG1_ID}/plan",
        json={"plan": "ULTRA"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 422


def test_cross_org_path_returns_404(client, owner_token):
    """org1 owner 토큰으로 org2 경로 시도 → 404(타 org 존재 자체를 노출하지 않음)."""
    resp = client.patch(
        f"/organizations/{ORG2_ID}/plan", json={"plan": "PRO"}, headers=_hdr(owner_token)
    )
    assert resp.status_code == 404


def test_org2_owner_cannot_change_org1_plan(client):
    """반대 방향 누수 테스트: org2 owner 토큰으로 org1 경로 시도 → 404."""
    org2_owner_token = _make_token(ORG2_ID, role="owner")
    resp = client.patch(
        f"/organizations/{ORG1_ID}/plan", json={"plan": "PRO"}, headers=_hdr(org2_owner_token)
    )
    assert resp.status_code == 404


def test_missing_token_returns_401(client):
    resp = client.patch(f"/organizations/{ORG1_ID}/plan", json={"plan": "PRO"})
    assert resp.status_code == 401
