"""GET /sites/{site_id}/kpi — phase-1 4종 metrics(FCR/OEI/mortality) 산출·경계 검증.

시드 데이터로 각 지표가 근거(inputs/provenance)와 일관되게 산출되는지, 경계(None)에서
value=null/status=na 로 떨어지는지 확인한다. 산식은 packages/kpi 소유이므로 여기서는
'응답값 == 응답근거로 재계산' 일관성만 검증한다(Rule 1).
"""

from __future__ import annotations

from tests.conftest import SITE1_ID, STOCKED_COUNT


def _get(client, token, period):
    return client.get(
        f"/sites/{SITE1_ID}/kpi",
        params=period,
        headers={"Authorization": f"Bearer {token}"},
    )


def test_fcr_value_matches_inputs(client, org1_token, full_period):
    """FCR value == Σfeed / Δbiomass(응답 근거로 재계산 일치)."""
    body = _get(client, org1_token, full_period).json()
    fcr = body["metrics"]["fcr"]
    fin = body["inputs"]["fcr"]
    assert fcr["value"] is not None
    assert fcr["status"] == "green"
    assert fcr["unit"] == "kg/kg"
    assert fin["included_feed_count"] == 30  # 시드 일 1회 × 30일
    expected = fin["total_feed_kg"] / fin["biomass_delta_kg"]
    assert abs(fcr["value"] - expected) < 1e-9
    # provenance 로 feed_logs 역추적 가능.
    assert len(body["provenance"]["source_feed_refs"]) == 30


def test_mortality_value_matches_inputs(client, org1_token, full_period):
    """mortality_rate == Σdead / stocked * 100. 일일/7일 MA 시계열 반환(drill-down)."""
    body = _get(client, org1_token, full_period).json()
    mort = body["metrics"]["mortality_rate"]
    min_ = body["inputs"]["mortality"]
    assert mort["value"] is not None
    assert mort["status"] == "green"
    assert mort["unit"] == "%"
    assert min_["stocked_count"] == STOCKED_COUNT
    expected = min_["total_dead_count"] / STOCKED_COUNT * 100.0
    assert abs(mort["value"] - expected) < 1e-9
    # 일일/7일 이동평균 시계열이 응답 확장 필드로 포함(카드는 누적률만 사용).
    assert len(min_["daily"]) == 30
    assert len(min_["moving_avg"]) == 30
    assert body["provenance"]["stocked_count"] == STOCKED_COUNT
    assert len(body["provenance"]["source_mortality_refs"]) == 30


def test_oei_value_and_provenance(client, org1_token, full_period):
    """OEI 산출(단일 tank band). do_in_band_fraction·근거 노출, index 단위.

    시드 데이터의 oei 산출값(~0.59)은 DEFAULT_KPI_THRESHOLDS.oei(red<=50, amber<=60,
    higher_is_better)로 분류하면 'red'다(신호등 슬라이스 G 통합 후 값 유무가 아니라
    실제 임계 반영 — phase-2.md 1.4절). status='green' 하드코딩 기대는 폐기하고
    현실 값에 맞춘다(값 자체는 변경하지 않음).
    """
    body = _get(client, org1_token, full_period).json()
    oei = body["metrics"]["oei"]
    oin = body["inputs"]["oei"]
    assert oei["value"] is not None
    assert oei["status"] == "red"
    assert oei["unit"] == "index"
    assert oei["value"] > 0.0
    # 시드 DO 는 목표대역(6~8) 내 → 유지율 근처 1.0.
    assert oin["do_total_samples"] == 720
    assert oin["do_in_band_fraction"] is not None
    assert 0.0 <= oin["do_in_band_fraction"] <= 1.0
    assert oin["band_min"] == 6.0
    assert oin["band_max"] == 8.0
    assert "meter-do-tank1-0001" in body["provenance"]["source_do_meter_ids"]
    assert "meter-power-blower-0001" in body["provenance"]["source_aeration_meter_ids"]


def test_metrics_null_boundary(client, org1_token, short_period):
    """경계: biomass_delta=0 → FCR/OEI value=null·status=na(폐사율은 stocked>0 로 산출됨)."""
    body = _get(client, org1_token, short_period).json()
    assert body["metrics"]["fcr"]["value"] is None
    assert body["metrics"]["fcr"]["status"] == "na"
    assert body["metrics"]["oei"]["value"] is None
    assert body["metrics"]["oei"]["status"] == "na"
    # mortality 는 stocked_count>0 이므로 누적률 산출 가능(경계 아님).
    assert body["metrics"]["mortality_rate"]["value"] is not None


def test_metrics_deterministic(client, org1_token, full_period):
    """결정론: 동일 요청 2회 → 4종 지표·근거 동일."""
    a = _get(client, org1_token, full_period).json()
    b = _get(client, org1_token, full_period).json()
    assert a["metrics"] == b["metrics"]
    assert a["inputs"] == b["inputs"]
