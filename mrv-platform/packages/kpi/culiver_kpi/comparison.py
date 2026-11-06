"""전·후(A/B) 비교 표시 유틸 — phase-2 슬라이스 J(docs/design/phase-2.md 3.1절).

★ 경계(3.1절 명확화): 이 모듈은 "산식"이 아니라 이미 확정된 두 값(baseline/current)의
단순 산술(delta/개선율)이다. Rule 1의 "KPI/MRV 산식"에 해당하지 않으므로 backend-engineer가
구현하되(architect 제안 시그니처 그대로), 위치만 `packages/kpi`에 고정해 향후 Phase 3
MRV 감축량 계산과 일관된 자리에서 재사용한다(data-kpi-engineer 확인 대상).

순수·결정론(Rule 6): 동일 입력(baseline_value, current_value, direction) → 동일 출력.
now()/난수 미사용.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MetricDirection = Literal["lower_is_better", "higher_is_better"]

# 지표별 방향(phase-2.md 3.1절) — MASTER 3.2 산식 정의의 재인용이며 새 판단이 아니다.
METRIC_DIRECTION: dict[str, MetricDirection] = {
    "ei_total": "lower_is_better",
    "ei_aeration": "lower_is_better",
    "oei": "higher_is_better",
    "fcr": "lower_is_better",
    "mortality_rate": "lower_is_better",
}


@dataclass(frozen=True)
class MetricComparison:
    """단일 지표의 baseline vs current 비교 결과(표시 전용, 산식 아님)."""

    baseline_value: float | None
    current_value: float | None
    delta: float | None              # current - baseline. 어느 한쪽 None이면 None.
    improvement_pct: float | None    # 방향 보정 개선율(%). None 조건은 아래 규약 참조.
    direction: MetricDirection


def compare_metric(
    baseline_value: float | None,
    current_value: float | None,
    direction: MetricDirection,
) -> MetricComparison:
    """baseline_value/current_value 를 direction 에 따라 비교한다(단순 산술, 산식 아님).

    규약(phase-2.md 3.1절):
      - baseline_value 또는 current_value 중 하나라도 None → delta=None, improvement_pct=None.
      - delta = current_value - baseline_value (both not None).
      - improvement_pct:
          lower_is_better:  (baseline_value - current_value) / baseline_value * 100
          higher_is_better: (current_value - baseline_value) / baseline_value * 100
      - baseline_value <= 0 → improvement_pct=None(0 나눗셈/부호 왜곡 방지). delta 는 여전히 계산.
      - direction 은 'lower_is_better'|'higher_is_better' 만 허용, 그 외 → ValueError.
    """
    if direction not in ("lower_is_better", "higher_is_better"):
        raise ValueError(f"unknown direction: {direction!r}")

    if baseline_value is None or current_value is None:
        return MetricComparison(
            baseline_value=baseline_value,
            current_value=current_value,
            delta=None,
            improvement_pct=None,
            direction=direction,
        )

    delta = current_value - baseline_value

    if baseline_value <= 0:
        improvement_pct: float | None = None
    elif direction == "lower_is_better":
        improvement_pct = (baseline_value - current_value) / baseline_value * 100.0
    else:  # higher_is_better
        improvement_pct = (current_value - baseline_value) / baseline_value * 100.0

    return MetricComparison(
        baseline_value=baseline_value,
        current_value=current_value,
        delta=delta,
        improvement_pct=improvement_pct,
        direction=direction,
    )
