"""KPI 신호등(status) red/amber/green/na 판정 — phase-2 슬라이스 G(★ 알림의 게이트).

Phase 1 은 `value 있음 → 'green'`, `value=None → 'na'` 만 처리했다(임계 로직 예약).
이 모듈이 그 갭을 메운다: 지표값과 방향(낮을수록 좋음/높을수록 좋음)에 따라 임계값(red/amber
경계)을 적용해 4단계(`'green'|'amber'|'red'|'na'`) 로 분류한다.

★ 이 모듈은 신호등 산식의 단일 진실 공급원이다(Rule 1). API/FE 어디에도 임계 판정을
중복 구현하지 말 것 — `apps/api/app/services/kpi_service.py._metric()` 은 이 함수를
호출만 한다(phase-2.md 1.4절 통합 지점, 배선은 backend-engineer 소관).
순수·결정론(Rule 6): 동일 입력(value, direction, thresholds) → 동일 출력. now()/난수 금지.

경계값 판정 규약(방향별 부등호, "경계값 포함" 방향 명시):
  - direction='lower_is_better' (낮을수록 좋음: EI, FCR, 폐사율):
      value >= red_threshold   → 'red'    (경계값 자체도 red 에 포함)
      value >= amber_threshold → 'amber'  (경계값 자체도 amber 에 포함)
      그 외(value < amber_threshold) → 'green'
      요구: red_threshold >= amber_threshold (나쁠수록 큰 값이므로 red 경계가 더 높거나 같음).
  - direction='higher_is_better' (높을수록 좋음: OEI):
      value <= red_threshold   → 'red'
      value <= amber_threshold → 'amber'
      그 외(value > amber_threshold) → 'green'
      요구: red_threshold <= amber_threshold (나쁠수록 작은 값이므로 red 경계가 더 낮거나 같음).
  - value=None → 'na' (측정/산출 불가. 임계 판정 이전 단계이므로 최우선 처리).

임계값 선정 근거(잠정치, MASTER 3.2/1.1절 도메인 평균 참고 — 실증 전 가정, 버전에 기록,
데이터 축적 후 kpi_config 버전 상향으로 보정 예정):
  - ei_aeration (kWh/kg): MASTER 1.1절 "폭기전력 평균 ~5000kWh/t" = 5.0 kWh/kg 를 amber 경계로,
    이를 20% 초과한 6.0 을 red 경계로 삼는다(평균 수준이면 이미 개선 여지가 있다고 보아 amber).
  - ei_total (kWh/kg): 폭기 외 순환·냉난방 등을 포함하므로 ei_aeration 보다 넓게 잡아
    amber=7.0, red=8.5(ei_aeration 대비 +40~70% — RAS 총전력이 폭기전력의 1.4~1.7배 수준이라는
    산업 통념적 잠정 배수, 실증으로 재조정 예정).
  - fcr (무차원): MASTER 1.1절 "FCR 평균 1.4~1.6" → 평균 상단(1.5)을 amber, 그 이상(1.6)을 red.
  - oei (0~100 지수, 높을수록 좋음): 실증 전 지수이므로 중간값 기준 60=amber, 50=red(지수
    설계상 50 미만은 목표대역 유지 대비 폭기 비용이 과도하다고 잠정 판단).
  - mortality_rate (%, 누적): 양식 사이클 전체 누적 폐사율 기준 8%=amber, 12%=red(파일럿
    실증 이전 업계 통념 잠정치 — 데이터 축적 후 보정 대상).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

KpiMetricStatus = Literal["green", "amber", "red", "na"]
MetricDirection = Literal["lower_is_better", "higher_is_better"]

# 이번 Phase 신호등 판정 대상 5개 지표(phase-2.md 1.4절, kpi_red 알림 감시 대상과 동일 명명).
METRIC_DIRECTIONS: dict[str, MetricDirection] = {
    "ei_total": "lower_is_better",
    "ei_aeration": "lower_is_better",
    "fcr": "lower_is_better",
    "oei": "higher_is_better",
    "mortality_rate": "lower_is_better",
}


@dataclass(frozen=True)
class MetricThresholds:
    """지표 1개의 red/amber 경계값. 방향(direction)은 classify_metric_status 호출측이 지정한다.

    경계값 자체는 산식 파라미터이므로 kpi_config.version 관리 대상(Rule 2).
    """

    red_threshold: float
    amber_threshold: float


@dataclass(frozen=True)
class KpiThresholds:
    """5개 지표의 MetricThresholds 묶음. `kpi_config.params_json['alerting']['thresholds']`
    에서 로드된다(config.py 참조).
    """

    ei_total: MetricThresholds
    ei_aeration: MetricThresholds
    fcr: MetricThresholds
    oei: MetricThresholds
    mortality_rate: MetricThresholds


# 잠정 초기 임계값(위 docstring 근거 참조). 실증 보정 시 kpi_config.version 을 올리고
# 이 상수 대신 kpi_config 로드값을 사용해야 한다(이 상수는 kpi_config 미설정 시 기본값).
DEFAULT_KPI_THRESHOLDS = KpiThresholds(
    ei_total=MetricThresholds(red_threshold=8.5, amber_threshold=7.0),
    ei_aeration=MetricThresholds(red_threshold=6.0, amber_threshold=5.0),
    fcr=MetricThresholds(red_threshold=1.6, amber_threshold=1.5),
    oei=MetricThresholds(red_threshold=50.0, amber_threshold=60.0),
    mortality_rate=MetricThresholds(red_threshold=12.0, amber_threshold=8.0),
)


def classify_metric_status(
    value: float | None,
    direction: MetricDirection,
    thresholds: MetricThresholds,
) -> KpiMetricStatus:
    """value/direction/thresholds → 신호등 4단계. 순수·결정론(Rule 6).

    - value=None → 'na'(측정/산출 불가. 임계 판정보다 우선).
    - value 가 비유한(NaN/inf) → ValueError(신호등을 조용히 오염시키지 않음).
    - direction 은 'lower_is_better' | 'higher_is_better' 만 허용, 그 외 → ValueError.
    - thresholds 방향 정합성(나쁜 쪽 경계가 더 극단): 위배 시 ValueError
      (예: lower_is_better 인데 red_threshold < amber_threshold 는 논리적으로 모순).
    """
    if value is None:
        return "na"
    if not math.isfinite(value):
        raise ValueError(f"metric value must be finite or None, got {value!r}")

    if direction == "lower_is_better":
        if thresholds.red_threshold < thresholds.amber_threshold:
            raise ValueError(
                "lower_is_better thresholds must satisfy red_threshold >= amber_threshold: "
                f"{thresholds!r}"
            )
        if value >= thresholds.red_threshold:
            return "red"
        if value >= thresholds.amber_threshold:
            return "amber"
        return "green"

    if direction == "higher_is_better":
        if thresholds.red_threshold > thresholds.amber_threshold:
            raise ValueError(
                "higher_is_better thresholds must satisfy red_threshold <= amber_threshold: "
                f"{thresholds!r}"
            )
        if value <= thresholds.red_threshold:
            return "red"
        if value <= thresholds.amber_threshold:
            return "amber"
        return "green"

    raise ValueError(f"unknown direction: {direction!r}")
