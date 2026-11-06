"""GET /sites/{site_id}/kpi — 정상/권한/경계 테스트(B5).

DB(시드)→API 로 EI 값이 일관되게 흐르는지, 계약(2.2절) 필드가 모두 존재하는지 검증한다.
"""

from __future__ import annotations

from tests.conftest import SITE1_ID


def test_kpi_ok_returns_ei_and_provenance(client, org1_token, full_period):
    """200 정상: EI 산출 + inputs/provenance/config version 항상 포함."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params=full_period,
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # 계약 필드 존재.
    assert body["site_id"] == SITE1_ID
    assert body["period"]["from"] is not None
    assert body["period"]["to"] is not None
    assert body["period"]["granularity"] == "period"
    assert body["kpi_config"]["version"] == "2026.1.0"
    # phase-1 1.4: params_json 은 지표별 서브키(nested) 문서.
    assert "included_quality_flags" in body["kpi_config"]["params"]["ei"]
    assert "fcr" in body["kpi_config"]["params"]
    assert "mortality" in body["kpi_config"]["params"]

    # EI 산출값 존재 + green.
    ei_total = body["metrics"]["ei_total"]
    ei_aeration = body["metrics"]["ei_aeration"]
    assert ei_total["value"] is not None
    assert ei_total["unit"] == "kWh/kg"
    assert ei_total["status"] == "green"
    assert ei_aeration["value"] is not None
    assert ei_aeration["status"] == "green"

    # phase-1: 4종 지표가 이제 채워진다(값 있으면 green). 상세 검증은 test_kpi_metrics.
    assert body["metrics"]["fcr"]["value"] is not None
    assert body["metrics"]["fcr"]["unit"] == "kg/kg"
    assert body["metrics"]["mortality_rate"]["value"] is not None
    assert body["metrics"]["mortality_rate"]["unit"] == "%"
    assert body["metrics"]["oei"]["value"] is not None
    assert body["metrics"]["oei"]["unit"] == "index"

    # inputs 로 EI 역추적 가능(재현성): value == 분자/분모.
    inputs = body["inputs"]
    assert inputs["biomass_delta_kg"] == 2560.0
    assert inputs["included_reading_count"] == 2 * 720  # main + blower, 720h
    expected_total = inputs["total_power_kwh"] / inputs["biomass_delta_kg"]
    expected_aer = inputs["aeration_power_kwh"] / inputs["biomass_delta_kg"]
    assert abs(ei_total["value"] - expected_total) < 1e-9
    assert abs(ei_aeration["value"] - expected_aer) < 1e-9
    # 폭기 분자는 총전력 분자보다 작다(부분집합).
    assert inputs["aeration_power_kwh"] < inputs["total_power_kwh"]

    # provenance: 근거 계측기/생체량 참조.
    prov = body["provenance"]
    assert "meter-power-main-0001" in prov["source_meter_ids"]
    assert "meter-power-blower-0001" in prov["source_meter_ids"]
    assert prov["source_biomass_refs"] == ["harvest-open-0001", "harvest-close-0001"]


def test_kpi_deterministic_repeat(client, org1_token, full_period):
    """결정론: 동일 요청 2회 → 동일 EI(값 안정)."""
    headers = {"Authorization": f"Bearer {org1_token}"}
    a = client.get(f"/sites/{SITE1_ID}/kpi", params=full_period, headers=headers).json()
    b = client.get(f"/sites/{SITE1_ID}/kpi", params=full_period, headers=headers).json()
    assert a["metrics"]["ei_total"]["value"] == b["metrics"]["ei_total"]["value"]
    assert a["inputs"] == b["inputs"]


def test_kpi_biomass_delta_zero_value_null(client, org1_token, short_period):
    """경계: biomass_delta=0 → EI value=null, status=na."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params=short_period,
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["inputs"]["biomass_delta_kg"] == 0.0
    assert body["metrics"]["ei_total"]["value"] is None
    assert body["metrics"]["ei_total"]["status"] == "na"
    assert body["metrics"]["ei_aeration"]["value"] is None
    assert body["metrics"]["ei_aeration"]["status"] == "na"


def test_kpi_missing_token_401(client, full_period):
    """401: 인증 토큰 없음."""
    resp = client.get(f"/sites/{SITE1_ID}/kpi", params=full_period)
    assert resp.status_code == 401


def test_kpi_unknown_site_404(client, org1_token, full_period):
    """404: 존재하지 않는 site."""
    resp = client.get(
        "/sites/does-not-exist/kpi",
        params=full_period,
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code == 404


def test_kpi_bad_period_422(client, org1_token):
    """422: from >= to(역전/동일 기간)."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params={"from": "2026-06-30T00:00:00Z", "to": "2026-06-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code == 422


def test_kpi_malformed_date_422(client, org1_token):
    """422: 날짜 파싱 실패."""
    resp = client.get(
        f"/sites/{SITE1_ID}/kpi",
        params={"from": "not-a-date", "to": "2026-06-01T00:00:00Z"},
        headers={"Authorization": f"Bearer {org1_token}"},
    )
    assert resp.status_code == 422
