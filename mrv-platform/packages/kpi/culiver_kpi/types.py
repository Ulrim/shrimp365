"""Input/output contracts for the Culiver KPI engine.

KPI 엔진 입출력 계약(dataclass). `docs/design/sprint-0.md` 2.1절 계약을 그대로 구현.
모든 dataclass 는 `frozen=True`(불변)로 두어 산출 중 상태 변형을 원천 차단한다.

경계 규약(sprint-0 2.1):
- 입력 전력값(`PowerReading.kwh`)은 ADR 0001 에 따라 **이미 interval kWh 로 정규화**된 값이다.
  → 엔진은 정렬/차분/롤오버/보간 없이 순수 합산만 한다(Rule 6: 결정론).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Mapping, Optional, Sequence  # noqa: F401 (산출 함수 시그니처에서 사용)

from .status import DEFAULT_KPI_THRESHOLDS, KpiThresholds


@dataclass(frozen=True)
class PowerReading:
    """단일 전력 계측값. 근거 추적(readings→meters)이 가능하도록 meter_id 를 보존한다."""

    meter_id: str          # 근거 추적용 ID (readings→meters 역추적, drill-down)
    ts: datetime           # 계측 시각(UTC 권장). 기간 필터 [start, end) 판단용
    kwh: float             # 계측 간격 증분 전력량(kWh). ADR 0001 로 정규화된 값
    is_aeration: bool      # 폭기(블로워) 서브미터 여부 → ei_aeration 분자 구분
    quality_flag: str      # 데이터 정합 플래그: 'ok' | 'suspect' | 'bad'


@dataclass(frozen=True)
class BiomassPoint:
    """생체량 시점값. EI 분모 Δbiomass 의 개시/마감 근거."""

    ts: datetime
    biomass_kg: float      # 시점 생체량(kg)
    source_ref: str        # 근거 참조 ID (harvest_logs.id 등) — drill-down 용


@dataclass(frozen=True)
class EiConfig:
    """EI 산출 파라미터. `kpi_config.params_json` 에서 로드된다(config.py 참조).

    산식을 바꾸지 않고 동작을 조절하는 파라미터만 담는다. 변경 시 kpi_config.version 증가(Rule 2).
    """

    # KPI 에 포함할 quality_flag 화이트리스트. 기본은 'ok' 만.
    included_quality_flags: tuple[str, ...] = ("ok",)
    # 이 값 이하의 biomass_delta 는 산출 불가(0 나눗셈 방지). 기본 0.0.
    min_biomass_delta_kg: float = 0.0


@dataclass(frozen=True)
class EiResult:
    """EI 산출 결과 + 근거/중간값(검증 추적성; MASTER 3.3, 7장 재현성 NFR).

    ei_total/ei_aeration 이 None 이면 '산출 불가'(biomass_delta <= min).
    나머지 필드는 항상 채워져 원천 reading 까지 역추적(drill-down)이 가능하다.
    """

    # --- 산출 지표 (None = 산출 불가) ---
    ei_total: Optional[float]              # kWh/kg
    ei_aeration: Optional[float]           # kWh/kg
    # --- 산출 근거/중간값 ---
    total_power_kwh: float                 # 분자(총전력)
    aeration_power_kwh: float              # 분자(폭기전력)
    biomass_start_kg: float
    biomass_end_kg: float
    biomass_delta_kg: float                # 분모 Δbiomass
    period_start: datetime
    period_end: datetime
    included_reading_count: int            # 포함된 reading 수
    excluded_reading_count: int            # quality_flag/기간 밖으로 제외된 수
    source_meter_ids: tuple[str, ...]      # 근거 계측기 목록 (정렬·중복제거, drill-down)
    source_biomass_refs: tuple[str, ...]   # 근거 생체량 참조 (개시/마감, drill-down)
    config_version: str                    # 적용된 kpi_config.version


# ============================================================================
# FCR — Feed Conversion Ratio (MASTER 3.2 ③, phase-1 1.1)
# ============================================================================


@dataclass(frozen=True)
class FeedReading:
    """단일 급이(feeding) 기록. 근거 추적(feed_logs.id)이 가능하도록 source_ref 를 보존한다."""

    source_ref: str        # 근거 추적 ID (feed_logs.id) — drill-down
    batch_id: str          # 급이 대상 배치(batches.id)
    ts: datetime           # 급이 시각(UTC 권장). 기간 필터 [start, end) 판단용
    feed_kg: float         # 급이량(kg). 음수/비유한 불가(포함 시 ValueError)
    quality_flag: str = "ok"   # 데이터 정합 플래그(수기 입력 검증 결과). 기본 'ok'


@dataclass(frozen=True)
class FcrConfig:
    """FCR 산출 파라미터. `kpi_config.params_json['fcr']` 에서 로드된다(config.py 참조).

    산식을 바꾸지 않고 동작을 조절하는 파라미터만 담는다. 변경 시 kpi_config.version 증가(Rule 2).
    """

    included_quality_flags: tuple[str, ...] = ("ok",)  # 합산 포함 플래그 화이트리스트
    min_biomass_delta_kg: float = 0.0                  # 이하이면 FCR=None(0 나눗셈 방지)


@dataclass(frozen=True)
class FcrResult:
    """FCR 산출 결과 + 근거/중간값(검증 추적성; MASTER 3.3, 7장 재현성 NFR).

    fcr 이 None 이면 '산출 불가'(biomass_delta <= min). 나머지 필드는 항상 채워져
    원천 feed_logs 까지 역추적(drill-down)이 가능하다.
    """

    # --- 산출 지표 (None = 산출 불가) ---
    fcr: Optional[float]               # 무차원(kg/kg). None=산출 불가
    # --- 산출 근거/중간값 ---
    total_feed_kg: float               # 분자 Σ(feed_kg)
    biomass_start_kg: float
    biomass_end_kg: float
    biomass_delta_kg: float            # 분모 Δbiomass
    period_start: datetime
    period_end: datetime
    included_feed_count: int
    excluded_feed_count: int
    source_feed_refs: tuple[str, ...]  # 근거 feed_logs (정렬·중복제거, drill-down)
    source_biomass_refs: tuple[str, ...]
    config_version: str


# ============================================================================
# OEI — Oxygen Efficiency Index (MASTER 3.2 ②, phase-1 1.2, ADR 0003)
# ============================================================================


@dataclass(frozen=True)
class DoReading:
    """단일 용존산소(DO) 계측값. 근거 추적(readings→meters)이 가능하도록 meter_id 를 보존한다."""

    meter_id: str          # DO 센서 계측기 (drill-down)
    ts: datetime           # 계측 시각(UTC 권장). 기간 필터 [start, end) 판단용
    do_mg_l: float         # 용존산소(mg/L). 비유한 불가(포함 시 ValueError)
    quality_flag: str      # 'ok' | 'suspect' | 'bad'


@dataclass(frozen=True)
class DoBand:
    """DO 목표대역(target band). tanks.target_do_min/max 근거."""

    do_min: float          # 목표대역 하한(tanks.target_do_min)
    do_max: float          # 목표대역 상한(tanks.target_do_max)


@dataclass(frozen=True)
class OeiConfig:
    """OEI 산출 파라미터. `kpi_config.params_json['oei']` 에서 로드된다(config.py 참조).

    산식을 바꾸지 않고 동작을 조절하는 파라미터만 담는다. 변경 시 kpi_config.version 증가(Rule 2).
    oei_scale_factor 는 MASTER 3.2 ② 가 명시한 '제안값'으로, 실증 보정 시 version↑(ADR 0003).
    """

    included_quality_flags: tuple[str, ...] = ("ok",)
    min_biomass_kg: float = 0.0            # Δbiomass 이하이면 OEI=None
    do_band_method: str = "sample_count"   # ADR 0003: v1 개수 비율. 'time_weighted' 예약
    oei_scale_factor: float = 1.0          # ★ 제안 스케일 계수(실증 보정 대상, version↑)
    clamp_max: float = 100.0               # 0~100 지수 상한


@dataclass(frozen=True)
class OeiResult:
    """OEI 산출 결과 + 근거/중간값(검증 추적성; MASTER 3.3, 7장 재현성 NFR).

    oei 이 None 이면 '산출 불가'(유효 DO 0 / aeration_kwh=0 / biomass_delta<=min).
    oei_raw(스케일 전 원값)·scale_factor 를 함께 노출해 보정 근거를 drill-down 추적한다.
    """

    # --- 산출 지표 (None = 산출 불가) ---
    oei: Optional[float]                   # 0~100. None=산출 불가
    # --- 산출 근거/중간값 ---
    do_in_band_fraction: Optional[float]   # t_in_band/t_total (0~1). 유효 DO 0 → None
    do_total_samples: int                  # 유효 DO 샘플 수(t_total 근거)
    do_in_band_samples: int                # 대역 내 유효 샘플 수(t_in_band 근거)
    do_excluded_samples: int               # 기간밖/불량 제외 수
    aeration_power_kwh: float              # 폭기 전력(분모 항)
    biomass_delta_kg: float                # 생산량(분모 정규화 항)
    band_min: float
    band_max: float
    oei_raw: Optional[float]               # 스케일 전 원값(검증 추적)
    scale_factor: float                    # 적용된 oei_scale_factor(보정 근거)
    method: str                            # 적용된 do_band_method
    period_start: datetime
    period_end: datetime
    source_do_meter_ids: tuple[str, ...]
    source_aeration_meter_ids: tuple[str, ...]
    source_biomass_refs: tuple[str, ...]
    config_version: str


# ============================================================================
# Mortality — 폐사율 (MASTER 3.2 ④, phase-1 1.3)
# ============================================================================


@dataclass(frozen=True)
class MortalityReading:
    """단일 폐사(mortality) 기록. 근거 추적(mortality_logs.id)이 가능하도록 source_ref 를 보존한다."""

    source_ref: str        # 근거 추적 ID (mortality_logs.id)
    batch_id: str          # 배치(batches.id)
    ts: datetime           # 폐사 기록 시각(UTC 권장). 기간 필터 + UTC 일 버킷팅용
    dead_count: int        # 폐사 개체수(음수 불가; 포함 시 ValueError)


@dataclass(frozen=True)
class MortalityConfig:
    """폐사율 산출 파라미터. `kpi_config.params_json['mortality']` 에서 로드된다(config.py 참조)."""

    moving_avg_window_days: int = 7   # 이동평균 창(기본 7일, MASTER 명시)
    # day_boundary 는 UTC 고정(v1). tz 파라미터화는 필요 시 version↑ 로 도입(예약).


@dataclass(frozen=True)
class DailyMortality:
    """일일 폐사 집계(UTC 일 버킷)."""

    date: date             # UTC 기준 일자
    dead_count: int
    daily_rate_pct: Optional[float]   # dead_count/stocked_count*100. stocked<=0 → None


@dataclass(frozen=True)
class MovingAvgPoint:
    """7일(창) 이동평균 점."""

    date: date
    ma_rate_pct: Optional[float]      # 최근 window 일 daily_rate 평균. stocked<=0 → None


@dataclass(frozen=True)
class MortalityResult:
    """폐사율 산출 결과 + 근거/중간값(검증 추적성; MASTER 3.3, 7장 재현성 NFR).

    cumulative_rate_pct 이 None 이면 '산출 불가'(stocked_count <= 0). 나머지 근거 필드는
    항상 채워져 원천 mortality_logs 까지 역추적(drill-down)이 가능하다.
    """

    # --- 산출 지표 (None = 산출 불가) ---
    cumulative_rate_pct: Optional[float]   # Σdead/stocked*100. None=산출 불가
    # --- 산출 근거/중간값 ---
    total_dead_count: int
    stocked_count: int
    daily: tuple[DailyMortality, ...]      # 일자 오름차순
    moving_avg: tuple[MovingAvgPoint, ...] # 7일 이동평균 시계열(daily 와 동일 일자축)
    period_start: datetime
    period_end: datetime
    source_refs: tuple[str, ...]           # 근거 mortality_logs (정렬·중복제거)
    config_version: str


# ============================================================================
# Alerting / KPI 신호등 — phase-2 슬라이스 G (status.py 산식과 함께 사용)
# ============================================================================


@dataclass(frozen=True)
class AlertingConfig:
    """알림 임계치 + 신호등 임계값 파라미터. `kpi_config.params_json['alerting']` 에서
    로드된다(config.py 참조, phase-2.md 1.2절).

    do_low_mg_l/mortality_spike_*: 알림 배치(job_evaluate_alerts, backend-engineer 소관)가
    소비하는 임계치 — 이 dataclass 는 파라미터 보관만 하고 배치 배선은 하지 않는다.
    thresholds: 신호등 red/amber 경계값 묶음(status.py `classify_metric_status` 입력).
    kpi_red_metrics: 'kpi_red' 알림이 감시할 지표 목록(신호등 red 전환 감시 대상).
    """

    do_low_mg_l: float = 3.0
    mortality_spike_ratio: float = 2.0
    mortality_spike_min_count: int = 5
    kpi_red_metrics: tuple[str, ...] = (
        "ei_total", "fcr", "mortality_rate", "oei",
    )
    thresholds: KpiThresholds = field(default=DEFAULT_KPI_THRESHOLDS)


# ============================================================================
# Recommendation — 추천(운전 레시피) 엔진, phase-2 슬라이스 K (recommend.py)
# ============================================================================


@dataclass(frozen=True)
class RecommendConfig:
    """추천 산출 파라미터. `kpi_config.params_json['recommend']` 에서 로드된다(config.py 참조).

    산식을 바꾸지 않고 동작을 조절하는 파라미터만 담는다. 변경 시 kpi_config.version 증가(Rule 2).
    """

    # --- 급이(feed) 추천 ---
    included_feed_quality_flags: tuple[str, ...] = ("ok",)  # 급이 이력 집계 포함 플래그
    target_feed_rate_pct_of_biomass: float = 0.03    # 목표 급이율(생체량 대비 일일 %, 3% 기본)
    max_feed_adjustment_ratio: float = 0.05           # 최근 평균 대비 1회 조정폭 상한(±5%)

    # --- 산소(oxygen) 추천 ---
    do_low_margin_mg_l: float = 0.3     # 하한 근접 판정 여유폭(mg/L)
    do_high_margin_mg_l: float = 0.3    # 상한 근접 판정 여유폭(mg/L)

    # --- 순환(circulation) 추천 ---
    high_water_temp_c: float = 30.0     # 이 이상이면 순환 증가 권장(RAS 새우 고수온 스트레스 기준)


@dataclass(frozen=True)
class RecommendationInput:
    """추천 산출에 필요한 현재 상태(서비스가 조립; 산식은 여기 없음). phase-2.md 2.2절 시그니처."""

    do_latest: Optional[DoReading]         # 현재 DO(최신 유효 샘플). 없으면 None
    do_band: DoBand                        # tanks.target_do_min/max
    water_temp_latest: Optional[float]     # 현재 수온(meters.type='temp'). 없으면 None
    biomass_latest_kg: Optional[float]     # 최근 harvest_logs 기준 생체량. 없으면 None
    feed_history: Sequence[FeedReading]    # 최근 N일 급이 이력(FCR 추세 참고)
    aeration_power_recent_kwh: float       # 최근 폭기 전력(OEI 추세 참고, 향후 확장 여지)
    period_start: datetime
    period_end: datetime


@dataclass(frozen=True)
class RecommendationOutput:
    """추천 산출 결과. 값 필드가 None 이면 해당 항목은 '추천 불가'(근거 부족) — 에러 아님."""

    feed_kg_per_day: Optional[float]           # 급이 추천값(kg/일). None=추천 불가(근거 부족)
    oxygen_target_do_mg_l: Optional[float]     # 산소(DO 목표) 추천값. None=추천 불가
    circulation_setting: Optional[str]         # 'normal' | 'increase' | 'reduce'. None=추천 불가
    rationale: str                             # 근거 설명(사람이 읽는 한국어 텍스트, 감사용)
    source_refs: Mapping[str, tuple[str, ...]]  # 근거 drill-down(지표별 참조 ID)
    config_version: str
