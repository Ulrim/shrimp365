"""GET /sites/{site_id}/onboarding-status — phase-3.md 7.3절 검증.

파생 조회이므로 4단계(install_kit/sensor_mapping/baseline_locked/plan_active) 각각의
완료/미완료 전이를 전용 org/site(다른 테스트 스위트의 baseline/meter 상태 변화에 영향받지
않도록 격리)에서 단계별로 직접 만들어 검증한다.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.api_key import ApiKey
from app.models.organization import Organization
from app.models.site import Site
from tests.conftest import ORG1_ID, PERIOD_START, _make_token

_ORG_ID = "org-onboard-test-0001"
_SITE_ID = "site-onboard-test-0001"


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module", autouse=True)
def _isolated_tenant(_prepare_db):
    """전용 org/site 생성(완전 격리). 모듈 종료 시 하위 행부터 역순으로 정리."""
    with SessionLocal() as s:
        s.add(Organization(id=_ORG_ID, name="온보딩 테스트 조직", plan="START"))
        s.flush()
        s.add(Site(id=_SITE_ID, org_id=_ORG_ID, name="온보딩 테스트 사이트"))
        s.commit()
    yield
    with SessionLocal() as s:
        s.execute(text("DELETE FROM sop_checklist_runs WHERE org_id = :oid"), {"oid": _ORG_ID})
        s.execute(text("DELETE FROM baselines WHERE org_id = :oid"), {"oid": _ORG_ID})
        s.execute(text("DELETE FROM kpi_snapshots WHERE org_id = :oid"), {"oid": _ORG_ID})
        s.execute(text("DELETE FROM meters WHERE org_id = :oid"), {"oid": _ORG_ID})
        s.execute(text("DELETE FROM api_keys WHERE org_id = :oid"), {"oid": _ORG_ID})
        s.execute(text("DELETE FROM audit_logs WHERE org_id = :oid"), {"oid": _ORG_ID})
        s.execute(text("DELETE FROM sites WHERE id = :sid"), {"sid": _SITE_ID})
        s.execute(text("DELETE FROM organizations WHERE id = :oid"), {"oid": _ORG_ID})
        s.commit()


def _owner_token() -> str:
    return _make_token(_ORG_ID, role="owner", user_id="u-onboard-owner")


def _status(client) -> dict:
    resp = client.get(
        f"/sites/{_SITE_ID}/onboarding-status", headers=_hdr(_owner_token())
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_step_0_all_incomplete(client):
    body = _status(client)
    steps = body["steps"]
    assert steps["install_kit"]["done"] is False
    assert steps["sensor_mapping"]["done"] is False
    assert steps["baseline_locked"]["done"] is False
    assert steps["plan_active"]["done"] is False
    assert body["current_step"] == "install_kit"


def test_step_1_install_kit_done_after_api_key(client):
    with SessionLocal() as s:
        s.add(
            ApiKey(
                id="apikey-onboard-test-0001",
                org_id=_ORG_ID,
                site_id=_SITE_ID,
                key_hash="deadbeef" * 8,
                label="온보딩 테스트 게이트웨이",
                revoked=False,
            )
        )
        s.commit()

    body = _status(client)
    steps = body["steps"]
    assert steps["install_kit"]["done"] is True
    assert steps["sensor_mapping"]["done"] is False
    assert body["current_step"] == "sensor_mapping"


def test_step_2_sensor_mapping_done_after_meter(client):
    resp = client.post(
        f"/sites/{_SITE_ID}/meters",
        json={
            "type": "power",
            "unit": "kWh_interval",
            "is_aeration": False,
            "tank_id": None,
            "label": "온보딩 테스트 계측기",
        },
        headers=_hdr(_owner_token()),
    )
    assert resp.status_code == 201, resp.text

    body = _status(client)
    steps = body["steps"]
    assert steps["sensor_mapping"]["done"] is True
    assert steps["baseline_locked"]["done"] is False
    assert body["current_step"] == "baseline_locked"


def test_step_3_baseline_locked_done_after_lock(client):
    period = {
        "from": PERIOD_START.isoformat(),
        "to": (PERIOD_START + timedelta(hours=24)).isoformat(),
    }
    resp = client.post(
        f"/sites/{_SITE_ID}/baseline/lock",
        json={"period": period},
        headers=_hdr(_owner_token()),
    )
    assert resp.status_code == 201, resp.text

    body = _status(client)
    steps = body["steps"]
    assert steps["baseline_locked"]["done"] is True
    assert steps["plan_active"]["done"] is False
    assert body["current_step"] == "plan_active"


def test_step_4_plan_active_done_after_upgrade(client):
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == _ORG_ID)).scalar_one()
        org.plan = "PRO"
        s.commit()

    body = _status(client)
    steps = body["steps"]
    assert steps["plan_active"]["done"] is True
    assert "PRO" in steps["plan_active"]["detail"]
    assert body["current_step"] is None


def test_onboarding_status_cross_org_403_or_404(client):
    """org1 토큰으로 전용 테스트 site 조회 시도 → 403/404(누수 없음)."""
    org1_owner_token = _make_token(ORG1_ID, role="owner")
    resp = client.get(
        f"/sites/{_SITE_ID}/onboarding-status", headers=_hdr(org1_owner_token)
    )
    assert resp.status_code in (403, 404)


def test_onboarding_status_missing_token_401(client):
    resp = client.get(f"/sites/{_SITE_ID}/onboarding-status")
    assert resp.status_code == 401
