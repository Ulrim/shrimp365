"""Scope2 탄소 MRV 산정 — MASTER 3.3절 산식 그대로 구현 (phase-3.md 1.3절 계약 확정).

```
Scope2 배출량(tCO2e) = 전력사용량(MWh) × 전력 배출계수(tCO2e/MWh)
감축량(tCO2e)        = (EI_baseline − EI_after) × 생산량(kg) × 배출계수
  → 동일 생산량 기준으로 정규화하여 "절감"을 분리(생산량 증가 효과와 혼동 방지)
```

★ 이 모듈은 Scope2 산식의 단일 진실 공급원이다(Rule 1). API/FE 어디에도 산식을 중복하지
말 것. 순수·결정론(Rule 6): 동일 입력 → 동일 출력. now()/난수/외부 상태 금지.
전력 배출계수는 하드코딩하지 않는다(Rule 5) — 이 모듈은 값을 계산하지 않고 `Scope2Input`
으로 주입받기만 한다(값 자체는 `emission_factors` 테이블에서 서비스 계층이 로드).

--------------------------------------------------------------------------------------------
★ 게이트 결정 (docs/design/phase-3.md 1.3절, data-kpi-engineer 최종 확정 — 2026-07-07)

(a) 감축량 정규화의 `production_kg` = After 기간 실제 `biomass_delta_kg`. **승인**.

    근거: 감축량 산식은 "동일 생산량으로 baseline 효율을 냈다면 썼을 전력" 대비 "실제로
    쓴 전력"의 반사실적(counterfactual) 차이를 tCO2e 로 환산하는 것이다. 이 비교가 의미를
    가지려면 두 항(EI_baseline, EI_after) 모두에 **동일한, 실제로 관측된 생산량**을 곱해야
    한다.
      - baseline 기간 생산량을 쓰면 "baseline 시절 실제로 쓴 전력"이 되어버려 개선 효과가
        아니라 단순 과거 재현이 된다.
      - 두 기간의 생산량을 각각 곱하면 (EI_b×prod_b − EI_a×prod_a) = "실제 전력 사용량
        차이"가 되어 생산량 증감 효과가 감축량에 섞인다 — MASTER 3.3 "생산량 증가 효과와
        혼동 방지" 문구와 정면으로 배치된다.
    따라서 production_kg 은 After 기간 실제 달성 생산량(after_biomass_delta_kg) 고정이
    산식 의미와 유일하게 정합한다. architect 제안 그대로 승인.

(b) before/after 총배출량(scope2_tco2e_baseline/after)에 **단일** 배출계수 적용. **승인**.

    근거: MASTER 3.3 감축량 산식 자체가 배출계수 항을 하나만 갖는다(기간별로 다른 계수를
    쓰는 산식이 아니다). 두 기간에 서로 다른 배출계수(예: 연도별 국가 전력망 탄소집약도
    갱신값)를 적용하면 "설비/운영 효율 개선에 의한 감축"과 "국가 전력망 자체가 청정해진
    효과"가 뒤섞여 리포트의 "달성/미달성" 판정이 흐려진다(MASTER 1장 "심사위원이 판정할 수
    있는 증빙" 원칙과 직결). baseline 값을 재계산하지 않는 원칙(ADR 0002)과도 정합적 —
    배출계수도 리포트 생성 시점에 선택된 단일 값을 전 기간에 일괄 적용해 재현 가능성을
    지킨다. architect 제안 그대로 승인. (과거 배출계수로 재현 검증이 필요하면 phase-3.md
    1.1절의 `emission_factor_id` 지정 경로로 다른 배출계수를 명시적으로 골라 별도 리포트를
    재생성하면 된다 — 이 함수 내부에서 기간별로 자동 분기하지 않는다.)
--------------------------------------------------------------------------------------------

단위 정합: EI(kWh/kg) × production_kg(kg) = kWh → ÷1000 = MWh → × factor(tCO2e/MWh) = tCO2e.
`scope2_tco2e_baseline`/`scope2_tco2e_after` 는 입력 자체가 이미 MWh
(`Scope2Input.*_power_mwh` — 서비스가 EiResult.total_power_kwh 를 /1000 해서 조립)이므로
추가 환산 없이 MWh × factor 로 바로 산출한다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Scope2Input:
    """Scope2 산정 입력. 서비스가 조립한다(잠긴 baseline 값 + after 기간 라이브 EI/전력 +
    활성 `emission_factors` 1행의 투영).

    EI 는 kWh/kg(`compute_ei` 결과 `EiResult.ei_total`), 전력은 MWh(서비스가
    `EiResult.total_power_kwh`를 /1000 해서 조립한 값)다.

    `baseline_ei_total`/`after_ei_total` 이 None 인 경우는 `compute_ei` 가 '산출 불가'
    (biomass_delta<=min_biomass_delta_kg)로 반환한 `EiResult.ei_total=None` 을 그대로
    전파한 것이다(Rule 6: 산출 불가를 조용히 감추거나 0으로 치환하지 않고 결과에 그대로
    실어 전달한다 — EI/FCR/OEI 와 동일한 규약).
    """

    baseline_ei_total: float | None    # baseline.ei_total (잠긴 값, kWh/kg)
    after_ei_total: float | None       # after 기간 라이브 EI(kWh/kg)
    after_biomass_delta_kg: float      # after 기간 생산량(감축량 정규화 기준 — 게이트 (a))
    baseline_power_mwh: float | None   # before 기간 총 전력(MWh). 없으면 total 계산 생략(선택)
    after_power_mwh: float             # after 기간 총 전력(MWh)
    emission_factor_tco2e_per_mwh: float
    emission_factor_source: str
    emission_factor_year: int
    emission_factor_version: str


@dataclass(frozen=True)
class Scope2Result:
    """Scope2 산정 결과.

    `formula_text` 는 실제 대입값을 포함한 재현 가능한 텍스트다(MASTER 3.3 ③ "산식 전문
    출력", ⑤ "적용 로직·버전"). 배출계수의 출처/연도/버전(Rule 5 — 검증 가능성 확보)도
    `formula_text` 첫 줄에 명시한다.
    """

    scope2_tco2e_baseline: float | None   # baseline_power_mwh 없으면 None
    scope2_tco2e_after: float
    reduction_tco2e: float | None         # EI 중 하나라도 None 이면 None(전파, 조용한 오염 방지)
    formula_text: str
    emission_factor_version: str


def _require_finite(value: float, label: str) -> None:
    if not math.isfinite(value):
        raise ValueError(f"{label} must be finite, got {value!r}")


def _fmt(value: float, ndigits: int = 4) -> str:
    """산식 문자열용 숫자 포맷(표시 전용 — 계산에는 원값을 그대로 쓴다).

    ndigits 자리 반올림 후 불필요한 trailing zero/decimal point 제거. 결정론(같은 입력 →
    같은 문자열).
    """
    rounded = round(value, ndigits)
    if rounded == 0:
        return "0"
    text = f"{rounded:.{ndigits}f}".rstrip("0").rstrip(".")
    return text


def compute_scope2_reduction(inputs: Scope2Input) -> Scope2Result:
    """MASTER 3.3절 Scope2 산식 그대로. 순수·결정론.

    ```
    scope2_tco2e = 전력사용량(MWh) × 배출계수(tCO2e/MWh)
    감축량        = (EI_baseline − EI_after) × 생산량(kg) × 배출계수 (동일 생산량 정규화, 게이트 (a))
      단위: EI(kWh/kg) × production_kg(kg) = kWh → ÷1000 = MWh → × factor(tCO2e/MWh) = tCO2e.
    ```

    규칙:
      - `baseline_ei_total` 또는 `after_ei_total` 가 None → `reduction_tco2e = None`
        (0 나눗셈/미산출 전파. EI/FCR/OEI 와 동일한 '산출 불가' 규약 — 조용히 0으로 감추지
        않는다).
      - `baseline_power_mwh` 가 None → `scope2_tco2e_baseline = None`
        (EI 산출 가능 여부와 무관 — 참고용 총배출량은 전력 존재 여부만으로 판단, 게이트 (b)).
      - `scope2_tco2e_after` 는 `after_power_mwh` 로 항상 산출(EI 미산출과 무관).

    방어(데이터 정합, EI/OEI 와 동일한 방어 규약):
      - `emission_factor_tco2e_per_mwh` 가 비유한이거나 0 이하 → ValueError
        (배출계수 부재를 묵시적 0 으로 처리하지 않는다 — Rule 5).
      - `after_biomass_delta_kg` 가 비유한이거나 0 이하 → ValueError
        (감축량 정규화 기준이 되는 생산량은 반드시 양수 실측값이어야 한다 — phase-3.md 1.3절).
      - `baseline_ei_total`/`after_ei_total`(None 이 아닌 경우)/`baseline_power_mwh`(있는
        경우)/`after_power_mwh` 가 비유한이면 ValueError(조용한 NaN 전파 방지).
      - `after_power_mwh`, `baseline_power_mwh`(있는 경우)가 음수면 ValueError(전력 사용량은
        물리적으로 음수일 수 없다).

    `formula_text` 는 위 산식 문자열에 실제 숫자를 대입한 사람이 읽는 텍스트를 반환한다
    (예: "감축량 = (4.87 - 4.10) kWh/kg × 2560 kg / 1000 × 0.4747 tCO2e/MWh = 0.9357 tCO2e").
    """
    factor = inputs.emission_factor_tco2e_per_mwh
    _require_finite(factor, "emission_factor_tco2e_per_mwh")
    if factor <= 0:
        raise ValueError(f"emission_factor_tco2e_per_mwh must be > 0, got {factor!r}")

    production_kg = inputs.after_biomass_delta_kg
    _require_finite(production_kg, "after_biomass_delta_kg")
    if production_kg <= 0:
        raise ValueError(f"after_biomass_delta_kg must be > 0, got {production_kg!r}")

    _require_finite(inputs.after_power_mwh, "after_power_mwh")
    if inputs.after_power_mwh < 0:
        raise ValueError(f"after_power_mwh must be >= 0, got {inputs.after_power_mwh!r}")

    if inputs.baseline_power_mwh is not None:
        _require_finite(inputs.baseline_power_mwh, "baseline_power_mwh")
        if inputs.baseline_power_mwh < 0:
            raise ValueError(
                f"baseline_power_mwh must be >= 0, got {inputs.baseline_power_mwh!r}"
            )

    if inputs.baseline_ei_total is not None:
        _require_finite(inputs.baseline_ei_total, "baseline_ei_total")
    if inputs.after_ei_total is not None:
        _require_finite(inputs.after_ei_total, "after_ei_total")

    scope2_tco2e_after = inputs.after_power_mwh * factor
    scope2_tco2e_baseline = (
        inputs.baseline_power_mwh * factor if inputs.baseline_power_mwh is not None else None
    )

    lines: list[str] = [
        f"적용 배출계수: {inputs.emission_factor_version} "
        f"({inputs.emission_factor_source}, {inputs.emission_factor_year}년, "
        f"{_fmt(factor)} tCO2e/MWh)",
        f"Scope2 배출량(after) = {_fmt(inputs.after_power_mwh)} MWh × "
        f"{_fmt(factor)} tCO2e/MWh = {_fmt(scope2_tco2e_after)} tCO2e",
    ]
    if scope2_tco2e_baseline is not None:
        lines.append(
            f"Scope2 배출량(before) = {_fmt(inputs.baseline_power_mwh)} MWh × "
            f"{_fmt(factor)} tCO2e/MWh = {_fmt(scope2_tco2e_baseline)} tCO2e"
        )

    if inputs.baseline_ei_total is None or inputs.after_ei_total is None:
        reduction_tco2e = None
        lines.append(
            "감축량 = 산출 불가 (EI_baseline="
            f"{inputs.baseline_ei_total!r}, EI_after={inputs.after_ei_total!r} 중 "
            "미산출(None) 값 존재)"
        )
    else:
        ei_diff = inputs.baseline_ei_total - inputs.after_ei_total
        reduction_tco2e = ei_diff * production_kg / 1000.0 * factor
        lines.append(
            f"감축량 = ({_fmt(inputs.baseline_ei_total)} - {_fmt(inputs.after_ei_total)}) "
            f"kWh/kg × {_fmt(production_kg)} kg / 1000 × {_fmt(factor)} tCO2e/MWh = "
            f"{_fmt(reduction_tco2e)} tCO2e"
        )

    formula_text = "\n".join(lines)

    return Scope2Result(
        scope2_tco2e_baseline=scope2_tco2e_baseline,
        scope2_tco2e_after=scope2_tco2e_after,
        reduction_tco2e=reduction_tco2e,
        formula_text=formula_text,
        emission_factor_version=inputs.emission_factor_version,
    )
