"""A/B 비교 — GET /sites/{site_id}/comparison, phase-2 슬라이스 J(3.2절).

baseline 있음/없음(404), 5개 지표 delta/improvement_pct 수기 검산 일치, config_version
차이 노출, START 플랜 403, None 전파(baseline 없음 = 404 로 흡수되어 metrics None 전파는
compare_metric 단위테스트(packages/kpi)에서 충분히 커버 — 여기서는 API 계약 수준만 검증).
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import seed_demo_site as seed_mod
from culiver_kpi import OeiConfig
from culiver_kpi.config import oei_config_to_params
from sqlalchemy import select, text

from app.db.session import SessionLocal
from app.models.kpi_config import KpiConfig
from app.models.organization import Organization
from tests.conftest import ORG1_ID, ORG2_ID, SITE1_ID, _make_token

PERIOD_START = seed_mod.PERIOD_START
HOURS = seed_mod.HOURS
PERIOD_END = PERIOD_START + timedelta(hours=HOURS)

_NEW_CFG_ID = "kpicfg-2026-2-0-test"


def _purge_site1_baseline() -> None:
    with SessionLocal() as s:
        s.execute(text("DELETE FROM baselines WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM kpi_snapshots WHERE site_id = :sid"), {"sid": SITE1_ID})
        s.execute(text("DELETE FROM audit_logs WHERE entity = 'baselines'"))
        s.commit()


def _purge_extra_kpi_config() -> None:
    with SessionLocal() as s:
        s.execute(
            text("DELETE FROM kpi_config WHERE id = :cid"), {"cid": _NEW_CFG_ID}
        )
        s.commit()


@pytest.fixture(autouse=True)
def _clean(_prepare_db):
    _purge_site1_baseline()
    _purge_extra_kpi_config()
    with SessionLocal() as s:
        org = s.execute(select(Organization).where(Organization.id == ORG1_ID)).scalar_one()
        org.plan = "START"
        s.commit()
    yield
    _purge_site1_baseline()
    _purge_extra_kpi_config()
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


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _lock_full_period(client, owner_token) -> dict:
    resp = client.post(
        f"/sites/{SITE1_ID}/baseline/lock",
        json={"period": {"from": PERIOD_START.isoformat(), "to": PERIOD_END.isoformat()}},
        headers=_hdr(owner_token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _comparison(client, token, **params):
    return client.get(
        f"/sites/{SITE1_ID}/comparison",
        params=params,
        headers=_hdr(token),
    )


def test_comparison_404_when_no_baseline(client, org1_token, pro_plan):
    resp = _comparison(
        client, org1_token,
        compare_from=PERIOD_START.isoformat(), compare_to=PERIOD_END.isoformat(),
    )
    assert resp.status_code == 404
    assert "baseline" in resp.json()["detail"]


def test_comparison_start_plan_403(client, org1_token, owner_token):
    """PRO 미만(START, 기본값) → 403. (baseline 유무와 무관하게 플랜 게이트가 우선)."""
    _lock_full_period(client, owner_token)
    resp = _comparison(
        client, org1_token,
        compare_from=PERIOD_START.isoformat(), compare_to=PERIOD_END.isoformat(),
    )
    assert resp.status_code == 403


def test_comparison_viewer_403_even_on_pro_plan(client, owner_token, viewer_token, pro_plan):
    """phase-2.md 3.2절 에러표: 403(viewer 또는 START 플랜) — PRO 플랜이어도 viewer 는 차단."""
    _lock_full_period(client, owner_token)
    resp = _comparison(
        client, viewer_token,
        compare_from=PERIOD_START.isoformat(), compare_to=PERIOD_END.isoformat(),
    )
    assert resp.status_code == 403


def test_comparison_identical_period_zero_delta(client, owner_token, org1_token, pro_plan):
    """baseline == current(동일 기간/설정) → 4개 지표(oei 제외) delta=0, improvement_pct=0."""
    _lock_full_period(client, owner_token)
    resp = _comparison(
        client, org1_token,
        compare_from=PERIOD_START.isoformat(), compare_to=PERIOD_END.isoformat(),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["site_id"] == SITE1_ID
    assert body["baseline"]["config_version"] == "2026.1.0"
    assert body["current"]["config_version"] == "2026.1.0"
    assert body["provenance"]["baseline_id"].startswith("bsl-")
    assert body["provenance"]["current_kpi_snapshot_id"] is None

    for key in ("ei_total", "ei_aeration", "fcr", "mortality_rate", "oei"):
        row = body["comparison"][key]
        assert row["delta"] == pytest.approx(0.0, abs=1e-9)
        assert row["improvement_pct"] == pytest.approx(0.0, abs=1e-9)
    assert body["comparison"]["ei_total"]["direction"] == "lower_is_better"
    assert body["comparison"]["oei"]["direction"] == "higher_is_better"


def test_comparison_config_version_diff_and_manual_delta_check(
    client, owner_token, org1_token, pro_plan
):
    """oei_scale_factor 를 2배로 바꾼 새 kpi_config 버전 도입 후 동일 기간 재조회.

    - config_version 이 baseline/current 에서 다름을 그대로 노출.
    - oei 만 값이 바뀌고(2배) 다른 4개 지표는 그대로 → 수기 검산: delta=baseline,
      improvement_pct=100.0(정확히 2배이므로).
    """
    baseline_body = _lock_full_period(client, owner_token)
    baseline_oei = baseline_body["metrics"]["oei"]["value"]
    assert baseline_oei is not None and baseline_oei > 0.0

    # 새 kpi_config 버전(oei_scale_factor=2.0, 그 외 지표 파라미터는 기존과 동일).
    with SessionLocal() as s:
        s.add(
            KpiConfig(
                id=_NEW_CFG_ID,
                version="2026.2.0-test",
                params_json={
                    "ei": {},
                    "fcr": {},
                    "oei": oei_config_to_params(OeiConfig(oei_scale_factor=2.0)),
                    "mortality": {},
                },
                effective_from=PERIOD_END + timedelta(seconds=1),
            )
        )
        s.commit()

    resp = _comparison(
        client, org1_token,
        compare_from=PERIOD_START.isoformat(), compare_to=PERIOD_END.isoformat(),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["baseline"]["config_version"] == "2026.1.0"
    assert body["current"]["config_version"] == "2026.2.0-test"

    current_oei = body["current"]["metrics"]["oei"]
    assert current_oei == pytest.approx(baseline_oei * 2.0)

    oei_row = body["comparison"]["oei"]
    assert oei_row["delta"] == pytest.approx(baseline_oei)
    assert oei_row["improvement_pct"] == pytest.approx(100.0)

    for key in ("ei_total", "ei_aeration", "fcr", "mortality_rate"):
        row = body["comparison"][key]
        assert row["delta"] == pytest.approx(0.0, abs=1e-9)
        assert row["improvement_pct"] == pytest.approx(0.0, abs=1e-9)


def test_comparison_bad_period_422(client, org1_token, owner_token, pro_plan):
    _lock_full_period(client, owner_token)
    resp = _comparison(
        client, org1_token,
        compare_from=PERIOD_END.isoformat(), compare_to=PERIOD_START.isoformat(),
    )
    assert resp.status_code == 422


def test_comparison_cross_org_site_404_or_403(client, owner_token):
    """타 org 토큰(START 플랜) → 플랜 게이트가 먼저 403 으로 막는다(테넌시 이전에 차단)."""
    _lock_full_period(client, owner_token)
    token = _make_token(ORG2_ID, role="viewer")
    resp = _comparison(
        client, token,
        compare_from=PERIOD_START.isoformat(), compare_to=PERIOD_END.isoformat(),
    )
    assert resp.status_code == 403
