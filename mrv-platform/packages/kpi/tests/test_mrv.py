"""Unit tests for compute_scope2_reduction (Phase 3 슬라이스 M — MASTER 3.3절 Scope2 산식).

경계조건: 정상 산출(수기 검산), EI 악화(감축량 음수 허용), baseline_power_mwh=None 전파,
배출계수/생산량 방어(음수·비유한·0), 결정론, formula_text 재현 가능성 확인.
"""

from __future__ import annotations

import math

import pytest

from culiver_kpi.mrv import Scope2Input, Scope2Result, compute_scope2_reduction


def _base_inputs(**overrides) -> Scope2Input:
    """공통 정상 입력(수기 검산 기준값). MASTER 3.3 예시와 동형: EI 4.87→4.10, 2560kg,
    factor 0.4747 tCO2e/MWh."""
    defaults = dict(
        baseline_ei_total=4.87,
        after_ei_total=4.10,
        after_biomass_delta_kg=2560.0,
        baseline_power_mwh=12.48,
        after_power_mwh=10.496,
        emission_factor_tco2e_per_mwh=0.4747,
        emission_factor_source="환경부 온실가스종합정보센터(GIR)",
        emission_factor_year=2024,
        emission_factor_version="2024-GIR-v1",
    )
    defaults.update(overrides)
    return Scope2Input(**defaults)


def test_normal_computation_matches_manual_calculation():
    inputs = _base_inputs()
    result = compute_scope2_reduction(inputs)

    expected_scope2_after = 10.496 * 0.4747
    expected_scope2_baseline = 12.48 * 0.4747
    expected_reduction = (4.87 - 4.10) * 2560.0 / 1000.0 * 0.4747

    assert result.scope2_tco2e_after == pytest.approx(expected_scope2_after)
    assert result.scope2_tco2e_baseline == pytest.approx(expected_scope2_baseline)
    assert result.reduction_tco2e == pytest.approx(expected_reduction)
    assert result.emission_factor_version == "2024-GIR-v1"
    assert isinstance(result, Scope2Result)


def test_ei_worsening_yields_negative_reduction_not_error():
    """EI_baseline < EI_after (효율 악화) → 감축량은 음수(허용). '미달성' 판정은 이 함수 밖."""
    inputs = _base_inputs(baseline_ei_total=4.10, after_ei_total=4.87)
    result = compute_scope2_reduction(inputs)

    expected_reduction = (4.10 - 4.87) * 2560.0 / 1000.0 * 0.4747
    assert result.reduction_tco2e == pytest.approx(expected_reduction)
    assert result.reduction_tco2e < 0


def test_baseline_power_mwh_none_propagates_to_none_scope2_baseline():
    inputs = _base_inputs(baseline_power_mwh=None)
    result = compute_scope2_reduction(inputs)

    assert result.scope2_tco2e_baseline is None
    # after 총배출량/감축량은 baseline 전력 부재와 무관하게 산출된다.
    assert result.scope2_tco2e_after == pytest.approx(10.496 * 0.4747)
    assert result.reduction_tco2e is not None


def test_baseline_ei_none_propagates_to_none_reduction():
    inputs = _base_inputs(baseline_ei_total=None)
    result = compute_scope2_reduction(inputs)

    assert result.reduction_tco2e is None
    # 참고용 총배출량들은 EI 미산출과 무관하게 여전히 산출된다.
    assert result.scope2_tco2e_after is not None
    assert result.scope2_tco2e_baseline is not None
    assert "산출 불가" in result.formula_text


def test_after_ei_none_propagates_to_none_reduction():
    inputs = _base_inputs(after_ei_total=None)
    result = compute_scope2_reduction(inputs)

    assert result.reduction_tco2e is None


def test_both_ei_none_propagates_to_none_reduction():
    inputs = _base_inputs(baseline_ei_total=None, after_ei_total=None)
    result = compute_scope2_reduction(inputs)

    assert result.reduction_tco2e is None


@pytest.mark.parametrize("bad_factor", [0.0, -0.4747])
def test_non_positive_emission_factor_raises(bad_factor):
    inputs = _base_inputs(emission_factor_tco2e_per_mwh=bad_factor)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)


@pytest.mark.parametrize("bad_factor", [math.inf, -math.inf, math.nan])
def test_non_finite_emission_factor_raises(bad_factor):
    inputs = _base_inputs(emission_factor_tco2e_per_mwh=bad_factor)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)


@pytest.mark.parametrize("bad_production", [0.0, -100.0])
def test_non_positive_production_kg_raises(bad_production):
    inputs = _base_inputs(after_biomass_delta_kg=bad_production)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)


def test_non_finite_production_kg_raises():
    inputs = _base_inputs(after_biomass_delta_kg=math.nan)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)


@pytest.mark.parametrize("bad_power", [-1.0, math.inf, math.nan])
def test_invalid_after_power_mwh_raises(bad_power):
    inputs = _base_inputs(after_power_mwh=bad_power)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)


@pytest.mark.parametrize("bad_power", [-1.0, math.inf, math.nan])
def test_invalid_baseline_power_mwh_raises(bad_power):
    inputs = _base_inputs(baseline_power_mwh=bad_power)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)


def test_non_finite_ei_raises():
    inputs = _base_inputs(baseline_ei_total=math.nan)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs)

    inputs2 = _base_inputs(after_ei_total=math.inf)
    with pytest.raises(ValueError):
        compute_scope2_reduction(inputs2)


def test_deterministic_repeat():
    inputs = _base_inputs()
    a = compute_scope2_reduction(inputs)
    b = compute_scope2_reduction(inputs)
    assert a == b


def test_formula_text_contains_actual_substituted_values():
    inputs = _base_inputs()
    result = compute_scope2_reduction(inputs)

    # 배출계수 출처/연도/버전 명시(Rule 5 — 검증 가능성).
    assert "2024-GIR-v1" in result.formula_text
    assert "환경부 온실가스종합정보센터(GIR)" in result.formula_text
    assert "2024" in result.formula_text
    # 산식에 실제 대입값이 들어있는지 확인(재현 가능성, MASTER 3.3 ③).
    assert "4.87" in result.formula_text
    assert "4.1" in result.formula_text  # 4.10 → trailing zero 제거되어 "4.1"
    assert "2560" in result.formula_text
    assert "0.4747" in result.formula_text
    # 계산된 감축량 값(반올림 4자리)이 그대로 텍스트에 있는지.
    expected_reduction = (4.87 - 4.10) * 2560.0 / 1000.0 * 0.4747
    assert f"{round(expected_reduction, 4):.4f}".rstrip("0").rstrip(".") in result.formula_text


def test_reduction_none_formula_text_still_includes_scope2_lines():
    inputs = _base_inputs(after_ei_total=None)
    result = compute_scope2_reduction(inputs)

    assert "Scope2 배출량(after)" in result.formula_text
    assert "Scope2 배출량(before)" in result.formula_text
    assert "산출 불가" in result.formula_text
