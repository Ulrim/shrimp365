"""계측기(meter) 등록/조회 API — phase-3.md 7.2절 검증.

POST/GET 정상 + audit + require_writer(viewer 403, 쓰기만) + 타 org 격리(Rule 4).
"""

from __future__ import annotations

from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.meter import Meter
from tests.conftest import SITE1_ID, SITE2_ID


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _purge_created_meters() -> None:
    with SessionLocal() as s:
        s.execute(text("DELETE FROM meters WHERE label LIKE 'test-meter-%'"))
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'meters'"))
        s.commit()


def _payload(label: str = "test-meter-power") -> dict:
    return {
        "type": "power",
        "unit": "kWh_interval",
        "is_aeration": False,
        "tank_id": None,
        "label": label,
        "certification_info": {"kcc": "R-C-XXX-000000", "kc": "KC-2026-000"},
    }


def test_create_meter_201_and_audit(client, owner_token):
    resp = client.post(
        f"/sites/{SITE1_ID}/meters", json=_payload(), headers=_hdr(owner_token)
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["site_id"] == SITE1_ID
    assert body["type"] == "power"
    assert body["unit"] == "kWh_interval"
    assert body["label"] == "test-meter-power"
    assert body["certification_info"]["kcc"] == "R-C-XXX-000000"
    assert body["id"].startswith("mtr-")

    with SessionLocal() as session:
        row = session.execute(select(Meter).where(Meter.id == body["id"])).scalar_one()
        assert row.site_id == SITE1_ID
        assert row.label == "test-meter-power"

        logs = session.execute(
            select(AuditLog).where(
                AuditLog.entity == "meters", AuditLog.entity_id == body["id"]
            )
        ).scalars().all()
        assert len(logs) == 1
        assert logs[0].action == "create"
        assert logs[0].diff_json["before"] is None

    _purge_created_meters()


def test_create_meter_operator_ok(client, operator_token):
    """require_writer 는 operator 도 허용."""
    resp = client.post(
        f"/sites/{SITE1_ID}/meters",
        json=_payload("test-meter-operator"),
        headers=_hdr(operator_token),
    )
    assert resp.status_code == 201, resp.text
    _purge_created_meters()


def test_create_meter_viewer_403(client, viewer_token):
    resp = client.post(
        f"/sites/{SITE1_ID}/meters",
        json=_payload("test-meter-viewer"),
        headers=_hdr(viewer_token),
    )
    assert resp.status_code == 403


def test_create_meter_cross_org_403_or_404(client, owner_token):
    """org1 owner 토큰으로 org2 소속 site2 에 계측기 등록 시도 → 403/404(누수 없음)."""
    resp = client.post(
        f"/sites/{SITE2_ID}/meters",
        json=_payload("test-meter-cross-org"),
        headers=_hdr(owner_token),
    )
    assert resp.status_code in (403, 404)


def test_create_meter_missing_token_401(client):
    resp = client.post(f"/sites/{SITE1_ID}/meters", json=_payload("test-meter-notoken"))
    assert resp.status_code == 401


def test_list_meters_includes_created(client, owner_token):
    create_resp = client.post(
        f"/sites/{SITE1_ID}/meters",
        json=_payload("test-meter-list"),
        headers=_hdr(owner_token),
    )
    assert create_resp.status_code == 201, create_resp.text
    created_id = create_resp.json()["id"]

    resp = client.get(f"/sites/{SITE1_ID}/meters", headers=_hdr(owner_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    ids = [item["id"] for item in body["items"]]
    assert created_id in ids

    _purge_created_meters()


def test_list_meters_viewer_ok(client, viewer_token):
    """조회는 viewer 도 가능(require_writer 아님)."""
    resp = client.get(f"/sites/{SITE1_ID}/meters", headers=_hdr(viewer_token))
    assert resp.status_code == 200


def test_list_meters_cross_org_403_or_404(client, owner_token):
    resp = client.get(f"/sites/{SITE2_ID}/meters", headers=_hdr(owner_token))
    assert resp.status_code in (403, 404)
