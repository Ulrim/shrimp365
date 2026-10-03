"""GET /audit-logs — phase-3.md 5절 검증.

entity/action/기간 필터, org 스코프(cross-org 미노출), viewer 200(읽기전용, require_writer
불요), ENTERPRISE 게이팅(START/PRO 403), pagination(limit/offset/total).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.organization import Organization
from tests.conftest import ORG1_ID, ORG2_ID, _make_token

_ENTITY = "test_widgets_audit_viewer"


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _set_plan(org_id: str, plan: str) -> None:
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == org_id)).scalar_one()
        org.plan = plan
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    yield
    with SessionLocal() as s:
        s.execute(delete(AuditLog).where(AuditLog.entity == _ENTITY))
        s.commit()
    _set_plan(ORG1_ID, "START")
    _set_plan(ORG2_ID, "START")


@pytest.fixture
def enterprise_plan():
    _set_plan(ORG1_ID, "ENTERPRISE")
    yield


def _insert_log(
    org_id: str, entity: str, action: str, ts: datetime, *, note: str | None = None
) -> str:
    log_id = f"audit-test-{uuid4().hex}"
    with SessionLocal() as s:
        s.add(
            AuditLog(
                id=log_id,
                org_id=org_id,
                actor_id="user-test",
                entity=entity,
                entity_id="ent-1",
                action=action,
                diff_json={"before": None, "after": {"x": 1}},
                note=note,
                ts=ts,
            )
        )
        s.commit()
    return log_id


_BASE_TS = datetime(2026, 5, 1, tzinfo=UTC)


def test_filters_by_entity_action_and_period(client, owner_token, enterprise_plan):
    id1 = _insert_log(ORG1_ID, _ENTITY, "lock", _BASE_TS)
    id2 = _insert_log(ORG1_ID, _ENTITY, "approve", _BASE_TS + timedelta(days=1))
    id3 = _insert_log(ORG1_ID, "other_entity_not_matched", "lock", _BASE_TS + timedelta(days=2))

    resp = client.get("/audit-logs", params={"entity": _ENTITY}, headers=_hdr(owner_token))
    assert resp.status_code == 200, resp.text
    ids = {i["id"] for i in resp.json()["items"]}
    assert {id1, id2} <= ids
    assert id3 not in ids

    resp_action = client.get(
        "/audit-logs", params={"entity": _ENTITY, "action": "approve"},
        headers=_hdr(owner_token),
    )
    assert {i["id"] for i in resp_action.json()["items"]} == {id2}

    resp_period = client.get(
        "/audit-logs",
        params={
            "entity": _ENTITY,
            "from": _BASE_TS.isoformat(),
            "to": (_BASE_TS + timedelta(hours=1)).isoformat(),
        },
        headers=_hdr(owner_token),
    )
    assert {i["id"] for i in resp_period.json()["items"]} == {id1}


def test_response_shape_includes_diff_and_note_metadata(client, owner_token, enterprise_plan):
    log_id = _insert_log(ORG1_ID, _ENTITY, "reject", _BASE_TS, note="사유 텍스트")
    resp = client.get("/audit-logs", params={"entity": _ENTITY}, headers=_hdr(owner_token))
    entry = next(i for i in resp.json()["items"] if i["id"] == log_id)
    assert entry["entity"] == _ENTITY
    assert entry["entity_id"] == "ent-1"
    assert entry["action"] == "reject"
    assert entry["actor_id"] == "user-test"
    assert entry["diff"] == {"before": None, "after": {"x": 1}}
    assert "ts" in entry


def test_org_scope_no_cross_org_leak(client, owner_token, enterprise_plan):
    _set_plan(ORG2_ID, "ENTERPRISE")
    org1_log = _insert_log(ORG1_ID, _ENTITY, "lock", _BASE_TS)
    org2_log = _insert_log(ORG2_ID, _ENTITY, "lock", _BASE_TS)

    resp1 = client.get("/audit-logs", params={"entity": _ENTITY}, headers=_hdr(owner_token))
    ids1 = {i["id"] for i in resp1.json()["items"]}
    assert org1_log in ids1
    assert org2_log not in ids1

    token2 = _make_token(ORG2_ID, role="owner")
    resp2 = client.get("/audit-logs", params={"entity": _ENTITY}, headers=_hdr(token2))
    ids2 = {i["id"] for i in resp2.json()["items"]}
    assert org2_log in ids2
    assert org1_log not in ids2


def test_viewer_read_allowed(client, viewer_token, enterprise_plan):
    """읽기 전용 — require_writer 불요, viewer 도 200."""
    _insert_log(ORG1_ID, _ENTITY, "lock", _BASE_TS)
    resp = client.get("/audit-logs", params={"entity": _ENTITY}, headers=_hdr(viewer_token))
    assert resp.status_code == 200


def test_start_plan_403(client, owner_token):
    resp = client.get("/audit-logs", headers=_hdr(owner_token))
    assert resp.status_code == 403


def test_pro_plan_403(client, owner_token):
    _set_plan(ORG1_ID, "PRO")
    resp = client.get("/audit-logs", headers=_hdr(owner_token))
    assert resp.status_code == 403


def test_pagination_limit_offset_and_total(client, owner_token, enterprise_plan):
    ids = [
        _insert_log(ORG1_ID, _ENTITY, "lock", _BASE_TS + timedelta(minutes=i))
        for i in range(5)
    ]
    resp = client.get(
        "/audit-logs", params={"entity": _ENTITY, "limit": 2, "offset": 0},
        headers=_hdr(owner_token),
    )
    body = resp.json()
    assert resp.status_code == 200
    assert len(body["items"]) == 2
    assert body["total"] == 5

    resp2 = client.get(
        "/audit-logs", params={"entity": _ENTITY, "limit": 2, "offset": 4},
        headers=_hdr(owner_token),
    )
    assert len(resp2.json()["items"]) == 1
    assert len(ids) == 5  # sanity: 삽입된 5개 id 존재
