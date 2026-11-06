"""culiver_kpi — Culiver KPI/MRV domain engine (pure, deterministic).

컬리버 KPI/MRV 산식 엔진. 산식의 단일 진실 공급원(Rule 1)이며, 모든 산출 함수는
순수·결정론(Rule 6)이다. 백엔드(apps/api)는 이 패키지의 공개 API 만 호출하고
산식을 재구현하지 않는다.

공개 범위:
  - EI(ei_total / ei_aeration)      — energy.py (sprint-0)
  - FCR(사료요구율)                 — feed.py     (phase-1)
  - OEI(산소운전 효율지수)          — oxygen.py   (phase-1, ADR 0003)
  - Mortality(폐사율: 누적/일일/7일 MA) — mortality.py (phase-1)
  - KPI 신호등(red/amber/green/na)   — status.py    (phase-2, 슬라이스 G)
  - 추천(운전 레시피: feed/oxygen/circulation) — recommend.py (phase-2, 슬라이스 K)
  - Scope2 MRV(감축량 산정)          — mrv.py    (Phase 3, 슬라이스 M)
"""

from __future__ import annotations

from .config import (
    DEFAULT_CONFIG_VERSION,
    alerting_config_from_params,
    alerting_config_to_params,
    ei_config_from_params,
    ei_config_to_params,
    fcr_config_from_params,
    fcr_config_to_params,
    mortality_config_from_params,
    mortality_config_to_params,
    oei_config_from_params,
    oei_config_to_params,
    recommend_config_from_params,
    recommend_config_to_params,
)
from .energy import compute_ei
from .feed import compute_fcr
from .mortality import compute_mortality
from .mrv import Scope2Input, Scope2Result, compute_scope2_reduction
from .oxygen import compute_oei
from .recommend import compute_recommendation
from .status import (
    DEFAULT_KPI_THRESHOLDS,
    METRIC_DIRECTIONS,
    KpiMetricStatus,
    KpiThresholds,
    MetricDirection,
    MetricThresholds,
    classify_metric_status,
)
from .types import (
    AlertingConfig,
    BiomassPoint,
    DailyMortality,
    DoBand,
    DoReading,
    EiConfig,
    EiResult,
    FcrConfig,
    FcrResult,
    FeedReading,
    MortalityConfig,
    MortalityReading,
    MortalityResult,
    MovingAvgPoint,
    OeiConfig,
    OeiResult,
    PowerReading,
    RecommendConfig,
    RecommendationInput,
    RecommendationOutput,
)

__all__ = [
    # types — shared
    "PowerReading",
    "BiomassPoint",
    # types — EI
    "EiConfig",
    "EiResult",
    # types — FCR
    "FeedReading",
    "FcrConfig",
    "FcrResult",
    # types — OEI
    "DoReading",
    "DoBand",
    "OeiConfig",
    "OeiResult",
    # types — Mortality
    "MortalityReading",
    "MortalityConfig",
    "DailyMortality",
    "MovingAvgPoint",
    "MortalityResult",
    # types/engine — KPI status (G)
    "KpiMetricStatus",
    "MetricDirection",
    "MetricThresholds",
    "KpiThresholds",
    "DEFAULT_KPI_THRESHOLDS",
    "METRIC_DIRECTIONS",
    "classify_metric_status",
    "AlertingConfig",
    "alerting_config_from_params",
    "alerting_config_to_params",
    # types/engine — Recommendation (K)
    "RecommendationInput",
    "RecommendationOutput",
    "RecommendConfig",
    "compute_recommendation",
    "recommend_config_from_params",
    "recommend_config_to_params",
    # engines
    "compute_ei",
    "compute_fcr",
    "compute_oei",
    "compute_mortality",
    # types/engine — Scope2 MRV (Phase 3, mrv.py)
    "Scope2Input",
    "Scope2Result",
    "compute_scope2_reduction",
    # config
    "DEFAULT_CONFIG_VERSION",
    "ei_config_from_params",
    "ei_config_to_params",
    "fcr_config_from_params",
    "fcr_config_to_params",
    "oei_config_from_params",
    "oei_config_to_params",
    "mortality_config_from_params",
    "mortality_config_to_params",
]
