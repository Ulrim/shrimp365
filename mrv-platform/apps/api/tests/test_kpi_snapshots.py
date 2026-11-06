"""GET /kpi-snapshots/{id} — phase-3.md 1.7절(검증 추적성 갭 보강) 검증.

정상 조회(스칼라 5종 + inputs_json/provenance_json 포함) + 타 org 접근 시 403(멀티테넌시
누수 없음, Rule 4) + 존재하지 않는 id 404.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.organization import Organization
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, _make_token

PERIOD_START = seed_mod.PERIOD_START
HOURS = seed_mod.HOURS
PERIOD_END = PERIOD_START + timedelta(hours=HOURS)


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _purge_site1() -> None:
    with SessionLocal() as s:
        s.execute(text("DELETE FROM baselines WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM kpi_snapshots WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'baselines'"))
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    _purge_site1()
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "START"
        s.commit()
    yield
    _purge_site1()


def _lock_full_period(client, owner_token) -> dict:
    resp = client.post(
        f"/sites/{SITE1_ID}/baseline/lock",
        json={"period": {"from": PERIOD_START.isoformat(), "to": PERIOD_END.isoformat()}},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_get_kpi_snapshot_success(client, owner_token, org1_token):
    baseline = _lock_full_period(client, owner_token)
    snapshot_id = baseline["provenance"]["kpi_snapshot_id"]
    assert snapshot_id

    resp = client.get(f"/kpi-snapshots/{snapshot_id}", headers=_hdr(org1_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["id"] == snapshot_id
    assert body["site_id"] == SITE1_ID
    assert body["org_id"] == ORG1_ID
    assert body["ei_total"] == baseline["metrics"]["ei_total"]["value"]
    assert body["fcr"] == baseline["metrics"]["fcr"]["value"]
    assert "ei" in body["inputs_json"]
    assert "source_meter_ids" in body["provenance_json"]
    assert body["config_version"] == baseline["kpi_config"]["version"]


def test_get_kpi_snapshot_not_found_404(client, org1_token):
    resp = client.get("/kpi-snapshots/snap-does-not-exist", headers=_hdr(org1_token))
    assert resp.status_code == 404


def test_get_kpi_snapshot_cross_org_403(client, owner_token):
    """멀티테넌시 누수 테스트(Rule 4): org2 토큰으로 org1 스냅샷 접근 시도 → 403."""
    baseline = _lock_full_period(client, owner_token)
    snapshot_id = baseline["provenance"]["kpi_snapshot_id"]

    org2_token = _make_token(ORG2_ID, role="viewer")
    resp = client.get(f"/kpi-snapshots/{snapshot_id}", headers=_hdr(org2_token))
    assert resp.status_code == 403


def test_get_kpi_snapshot_missing_token_401(client):
    resp = client.get("/kpi-snapshots/snap-anything")
    assert resp.status_code == 401
