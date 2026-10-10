"""SOP 라이브러리 API — phase-3.md 2절(화면8, PRO) 검증.

목록/상세 200(PRO+), START 플랜 403, 없는 sop_id 404, 체크리스트 실행 기록 생성+audit,
require_writer(viewer 403), 타 org 404, 조회(PRO+) 필터.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.organization import Organization
from app.models.sop_checklist_run import SopChecklistRun
from tests.conftest import ORG1_ID, SITE1_ID, SITE2_ID, _make_token

_KNOWN_SOP_ID = "sop-do-drop"


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _purge_site1_checklist_runs() -> None:
    with SessionLocal() as s:
        s.execute(text("DELETE FROM sop_checklist_runs WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'sop_checklist_runs'"))
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    _purge_site1_checklist_runs()
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "START"
        s.commit()
    yield
    _purge_site1_checklist_runs()
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "START"
        s.commit()


@pytest.fixture
def pro_plan():
    """org1 을 PRO 플랜으로 임시 전환(테스트 종료 후 _clean 이 START 로 복원)."""
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "PRO"
        s.commit()
    yield


# --- GET /sop ---


def test_list_sop_pro_200(client, owner_token, pro_plan):
    resp = client.get("/sop", headers=_hdr(owner_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    categories = {item["category"] for item in body["items"]}
    assert categories == {"normal", "water_quality", "do_drop", "mortality_spike"}
    for item in body["items"]:
        assert item["id"]
        assert item["title"]
        assert item["summary"]


def test_list_sop_start_plan_403(client, owner_token):
    resp = client.get("/sop", headers=_hdr(owner_token))
    assert resp.status_code == 403


def test_list_sop_missing_token_401(client):
    resp = client.get("/sop")
    assert resp.status_code == 401


# --- GET /sop/{id} ---


def test_get_sop_detail_200(client, owner_token, pro_plan):
    resp = client.get(f"/sop/{_KNOWN_SOP_ID}", headers=_hdr(owner_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == _KNOWN_SOP_ID
    assert body["category"] == "do_drop"
    assert len(body["body_markdown"]) > 0
    assert len(body["checklist_items"]) >= 1
    assert all({"id", "label"} <= set(item.keys()) for item in body["checklist_items"])


def test_get_sop_detail_unknown_id_404(client, owner_token, pro_plan):
    resp = client.get("/sop/sop-does-not-exist", headers=_hdr(owner_token))
    assert resp.status_code == 404


def test_get_sop_detail_start_plan_403(client, owner_token):
    resp = client.get(f"/sop/{_KNOWN_SOP_ID}", headers=_hdr(owner_token))
    assert resp.status_code == 403


# --- POST /sites/{site_id}/sop/{sop_id}/checklist-runs ---


def _run_payload() -> dict:
    return {
        "items": [
            {"item_id": "do-01", "checked": True, "note": "휴대용 측정기로 교차검증 완료"},
            {"item_id": "do-02", "checked": False, "note": None},
        ]
    }


def test_create_checklist_run_201_and_audit(client, owner_token):
    resp = client.post(
        f"/sites/{SITE1_ID}/sop/{_KNOWN_SOP_ID}/checklist-runs",
        json=_run_payload(),
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["site_id"] == SITE1_ID
    assert body["org_id"] == ORG1_ID
    assert body["sop_id"] == _KNOWN_SOP_ID
    assert len(body["items"]) == 2
    assert body["items"][0]["item_id"] == "do-01"
    assert body["items"][0]["checked"] is True

    with SessionLocal() as session:
        row = session.execute(
            select(SopChecklistRun).where(SopChecklistRun.id == body["id"])
        ).scalar_one()
        assert row.sop_id == _KNOWN_SOP_ID
        assert len(row.items_json) == 2

        logs = session.execute(
            select(AuditLog).where(
                AuditLog.entity == "sop_checklist_runs", AuditLog.entity_id == body["id"]
            )
        ).scalars().all()
        assert len(logs) == 1
        assert logs[0].action == "create"
        assert logs[0].diff_json["before"] is None


def test_create_checklist_run_viewer_403(client, viewer_token):
    resp = client.post(
        f"/sites/{SITE1_ID}/sop/{_KNOWN_SOP_ID}/checklist-runs",
        json=_run_payload(),
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


def test_create_checklist_run_unknown_sop_404(client, owner_token):
    resp = client.post(
        f"/sites/{SITE1_ID}/sop/sop-does-not-exist/checklist-runs",
        json=_run_payload(),
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 404


def test_create_checklist_run_cross_org_404(client, owner_token):
    """org1 owner 토큰으로 org2 소속 site2 경로 시도 → 404(타 org 리소스)."""
    resp = client.post(
        f"/sites/{SITE2_ID}/sop/{_KNOWN_SOP_ID}/checklist-runs",
        json=_run_payload(),
        headers=_hdr(owner_token),
    )
    assert resp.status_code in (403, 404)


# --- GET /sites/{site_id}/sop/checklist-runs ---


def test_list_checklist_runs_pro_200_with_filter(client, owner_token, pro_plan):
    create_resp = client.post(
        f"/sites/{SITE1_ID}/sop/{_KNOWN_SOP_ID}/checklist-runs",
        json=_run_payload(),
        headers=_hdr(owner_token),
    )
    assert create_resp.status_code == 201, create_resp.text

    resp = client.get(
        f"/sites/{SITE1_ID}/sop/checklist-runs",
        params={"sop_id": _KNOWN_SOP_ID},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    assert all(item["sop_id"] == _KNOWN_SOP_ID for item in body["items"])

    # 존재하지 않는 sop_id 필터 → 0건.
    resp2 = client.get(
        f"/sites/{SITE1_ID}/sop/checklist-runs",
        params={"sop_id": "sop-nonexistent"},
        headers=_hdr(owner_token),
    )
    assert resp2.status_code == 200
    assert resp2.json()["total"] == 0


def test_list_checklist_runs_start_plan_403(client, owner_token):
    resp = client.get(f"/sites/{SITE1_ID}/sop/checklist-runs", headers=_hdr(owner_token))
    assert resp.status_code == 403


def test_list_checklist_runs_viewer_ok_when_pro(client, viewer_token, pro_plan):
    """조회(GET)는 require_writer 가 아니라 require_plan 만 게이트(2.2절 "require_writer"는
    POST에만 적용) — viewer 도 PRO 플랜이면 실행 이력을 읽을 수 있다(audit_logs 5절 관례와
    동일: 증빙 열람은 쓰기 권한과 분리)."""
    resp = client.get(f"/sites/{SITE1_ID}/sop/checklist-runs", headers=_hdr(viewer_token))
    assert resp.status_code == 200, resp.text


def test_create_checklist_run_empty_items_201(client, owner_token):
    """경계값: items=[] 도 유효(부분 점검/전부 미체크 상태 저장 허용) — 422 로 막지 않는다."""
    resp = client.post(
        f"/sites/{SITE1_ID}/sop/{_KNOWN_SOP_ID}/checklist-runs",
        json={"items": []},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["items"] == []

    with SessionLocal() as session:
        row = session.execute(
            select(SopChecklistRun).where(SopChecklistRun.id == resp.json()["id"])
        ).scalar_one()
        assert row.items_json == []


def test_list_checklist_runs_reversed_period_returns_empty(client, owner_token, pro_plan):
    """경계값: from > to (기간 역전) → 500/오류 없이 0건 반환(필터 조건이 공집합이 되는 것뿐)."""
    create_resp = client.post(
        f"/sites/{SITE1_ID}/sop/{_KNOWN_SOP_ID}/checklist-runs",
        json=_run_payload(),
        headers=_hdr(owner_token),
    )
    assert create_resp.status_code == 201, create_resp.text

    resp = client.get(
        f"/sites/{SITE1_ID}/sop/checklist-runs",
        params={"from": "2030-01-01T00:00:00Z", "to": "2020-01-01T00:00:00Z"},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 0


def test_list_checklist_runs_cross_org(client, pro_plan):
    """org2 소속 토큰(PRO 로 임시 승격)이 org1 site1 조회 시도 → 403/404(누수 없음)."""
    from tests.conftest import ORG2_ID

    with SessionLocal() as s:
        org2 = s.execute(select(Organization).where(Organization.id == ORG2_ID)).scalar_one()
        org2.plan = "PRO"
        s.commit()
    try:
        org2_owner_token = _make_token(ORG2_ID, role="owner")
        resp = client.get(
            f"/sites/{SITE1_ID}/sop/checklist-runs", headers=_hdr(org2_owner_token)
        )
        assert resp.status_code in (403, 404)
    finally:
        with SessionLocal() as s:
            org2 = s.execute(select(Organization).where(Organization.id == ORG2_ID)).scalar_one()
            org2.plan = "START"
            s.commit()
