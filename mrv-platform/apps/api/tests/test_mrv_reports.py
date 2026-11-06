"""MRV 리포트 API — phase-3.md 1.5절(★Phase 3 헤드라인) 검증.

정상 생성 흐름(baseline 있음 → 201, before/after/reduction_tco2e 수기검산 일치, PDF 파일
생성 확인), baseline 없음 404, emission_factor 없음 404, START 플랜 403, PDF 다운로드
200+content-type, 이력 조회, 타 org 격리(멀티테넌시 누수 없음, Rule 4).
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
import seed_demo_site as seed_mod
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.models.mrv_report import MrvReport
from app.models.organization import Organization
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, _make_token

PERIOD_START = seed_mod.PERIOD_START
HOURS = seed_mod.HOURS
PERIOD_END = PERIOD_START + timedelta(hours=HOURS)

_FACTOR = 0.4747


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _unique_version(label: str) -> str:
    return f"{label}-{uuid4().hex[:8]}"[:32]


def _purge_site1_mrv_state() -> None:
    with SessionLocal() as s:
        s.execute(text("DELETE FROM mrv_reports WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'mrv_reports'"))
        s.execute(text("DELETE FROM baselines WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM kpi_snapshots WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'baselines'"))
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    _purge_site1_mrv_state()
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "START"
        s.commit()
    yield
    _purge_site1_mrv_state()
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


def _lock_full_period(client, owner_token) -> dict:
    resp = client.post(
        f"/sites/{SITE1_ID}/baseline/lock",
        json={"period": {"from": PERIOD_START.isoformat(), "to": PERIOD_END.isoformat()}},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_emission_factor(client, owner_token, version: str | None = None) -> dict:
    version = version or _unique_version("mrv-test-ef")
    resp = client.post(
        "/emission-factors",
        json={
            "factor_tco2e_per_mwh": _FACTOR,
            "source": "환경부 온실가스종합정보센터(GIR)",
            "year": 2024,
            "version": version,
            "effective_from": "2026-01-01T00:00:00Z",
        },
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _generate(client, token, **body):
    payload = {
        "after_period": {"from": PERIOD_START.isoformat(), "to": PERIOD_END.isoformat()},
    }
    payload.update(body)
    return client.post(
        f"/sites/{SITE1_ID}/mrv-reports/generate",
        json=payload,
        headers=_hdr(token),
    )


def test_generate_success_and_manual_reduction_check(
    client, owner_token, org1_token, pro_plan
):
    """201 + before/after/reduction_tco2e 수기검산 일치 + PDF 파일 생성(또는 폴백) 확인."""
    _lock_full_period(client, owner_token)
    ef = _create_emission_factor(client, owner_token)

    resp = _generate(client, owner_token, emission_factor_id=ef["id"])
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["id"].startswith("mrv-")
    assert body["site_id"] == SITE1_ID
    assert body["org_id"] == ORG1_ID
    assert body["baseline_id"].startswith("bsl-")
    assert body["emission_factor"]["version"] == ef["version"]

    before = body["before"]
    after = body["after"]
    assert before["ei_total"] is not None
    assert after["ei_total"] is not None

    # 수기검산: reduction = (ei_b - ei_a) * production_kg / 1000 * factor.
    expected_reduction = (
        (before["ei_total"] - after["ei_total"])
        * after["biomass_delta_kg"]
        / 1000.0
        * _FACTOR
    )
    assert body["reduction_tco2e"] == pytest.approx(expected_reduction, abs=1e-6)

    # 동일 기간(Before==After) 이므로 EI 동일 → 감축량 0.
    assert body["reduction_tco2e"] == pytest.approx(0.0, abs=1e-9)

    # scope2_tco2e 수기검산: total_power_kwh/1000 * factor.
    expected_scope2_after = after["total_power_kwh"] / 1000.0 * _FACTOR
    assert after["scope2_tco2e"] == pytest.approx(expected_scope2_after, abs=1e-6)
    expected_scope2_before = before["total_power_kwh"] / 1000.0 * _FACTOR
    assert before["scope2_tco2e"] == pytest.approx(expected_scope2_before, abs=1e-6)

    # formula_text: MASTER 3.3 ③ 재현 가능한 산식 전문.
    assert "감축량" in body["formula_text"]
    assert ef["version"] in body["formula_text"]

    # boundary(1.6절): 자동 생성 assumptions 3종 고정.
    boundary = body["boundary"]
    assert boundary["site_id"] == SITE1_ID
    assert len(boundary["assumptions"]) == 3
    assert boundary["config_version"]["before"] == before["config_version"]
    assert boundary["config_version"]["after"] == after["config_version"]

    assert body["generated_by"] == "u-1"
    assert body["pdf_available"] is True

    # DB 확인: mrv_reports 1행 + audit_logs(action='generate').
    with SessionLocal() as s:
        mrv = s.execute(
            select(MrvReport).where(MrvReport.id == body["id"])
        ).scalar_one()
        assert mrv.pdf_path is not None
        import os

        assert os.path.exists(mrv.pdf_path), "PDF(or HTML fallback) 파일이 실제 저장돼야 한다"

        logs = s.execute(
            select(AuditLog).where(
                AuditLog.entity == "mrv_reports", AuditLog.entity_id == body["id"]
            )
        ).scalars().all()
        assert len(logs) == 1
        assert logs[0].action == "generate"
        assert logs[0].diff_json["before"] is None


def test_generate_without_baseline_404(client, org1_token, owner_token, pro_plan):
    ef = _create_emission_factor(client, owner_token)
    resp = _generate(client, owner_token, emission_factor_id=ef["id"])
    assert resp.status_code == 404
    assert "baseline" in resp.json()["detail"]


def test_generate_without_emission_factor_404(client, owner_token, pro_plan):
    """emission_factor_id 미지정 + 활성 배출계수가 전혀 없는 상태 → 404."""
    _lock_full_period(client, owner_token)
    with SessionLocal() as s:
        s.execute(text("DELETE FROM emission_factors"))
        s.commit()
    resp = _generate(client, owner_token)
    assert resp.status_code == 404
    assert "emission factor" in resp.json()["detail"]


def test_generate_unknown_emission_factor_id_404(client, owner_token, pro_plan):
    _lock_full_period(client, owner_token)
    resp = _generate(client, owner_token, emission_factor_id="ef-does-not-exist")
    assert resp.status_code == 404


def test_generate_start_plan_403(client, owner_token):
    """PRO 미만(START, 기본값) → 403(baseline/emission_factor 유무와 무관하게 우선 차단)."""
    resp = _generate(client, owner_token)
    assert resp.status_code == 403


def test_generate_viewer_403(client, owner_token, viewer_token, pro_plan):
    _lock_full_period(client, owner_token)
    ef = _create_emission_factor(client, owner_token)
    resp = _generate(client, viewer_token, emission_factor_id=ef["id"])
    assert resp.status_code == 403


def test_generate_bad_period_422(client, owner_token, pro_plan):
    _lock_full_period(client, owner_token)
    resp = client.post(
        f"/sites/{SITE1_ID}/mrv-reports/generate",
        json={
            "after_period": {
                "from": PERIOD_END.isoformat(),
                "to": PERIOD_START.isoformat(),
            }
        },
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 422


def test_get_mrv_report_pdf_200_and_history(client, owner_token, org1_token, pro_plan):
    _lock_full_period(client, owner_token)
    ef = _create_emission_factor(client, owner_token)
    gen = _generate(client, owner_token, emission_factor_id=ef["id"])
    assert gen.status_code == 201, gen.text
    report_id = gen.json()["id"]

    # 재조회: 동일 shape.
    get_resp = client.get(f"/mrv-reports/{report_id}", headers=_hdr(org1_token))
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["id"] == report_id

    # PDF 다운로드.
    pdf_resp = client.get(f"/mrv-reports/{report_id}/pdf", headers=_hdr(org1_token))
    assert pdf_resp.status_code == 200, pdf_resp.text
    assert pdf_resp.headers["content-type"] == "application/pdf"
    assert len(pdf_resp.content) > 0

    # 이력 목록.
    hist_resp = client.get(
        f"/sites/{SITE1_ID}/mrv-reports", headers=_hdr(org1_token)
    )
    assert hist_resp.status_code == 200, hist_resp.text
    hist_body = hist_resp.json()
    assert hist_body["total"] == 1
    assert hist_body["items"][0]["id"] == report_id


def test_cross_org_mrv_report_access_403(client, owner_token, pro_plan):
    """멀티테넌시 누수 테스트(Rule 4): org2 토큰으로 org1 의 리포트 접근 시도 → 403."""
    _lock_full_period(client, owner_token)
    ef = _create_emission_factor(client, owner_token)
    gen = _generate(client, owner_token, emission_factor_id=ef["id"])
    assert gen.status_code == 201, gen.text
    report_id = gen.json()["id"]

    org2_token = _make_token(ORG2_ID, role="owner")
    resp = client.get(f"/mrv-reports/{report_id}", headers=_hdr(org2_token))
    assert resp.status_code == 403

    resp_pdf = client.get(f"/mrv-reports/{report_id}/pdf", headers=_hdr(org2_token))
    assert resp_pdf.status_code == 403


def test_cross_org_site_generate_403(client, pro_plan):
    """타 org owner 토큰으로 site1 리포트 생성 시도 → 403(테넌시 격리)."""
    org2_owner = _make_token(ORG2_ID, role="owner")
    resp = _generate(client, org2_owner)
    assert resp.status_code == 403
