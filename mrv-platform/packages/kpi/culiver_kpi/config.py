"""KPI config mapping — `kpi_config.params_json` ↔ 지표별 Config dataclass.

`kpi_config`(DB 테이블) 의 params_json 을 산출 파라미터 dataclass 로 변환한다.
산식 자체는 여기서 정의하지 않는다(산식은 energy/feed/oxygen/mortality.py). 여기서는
파라미터/버전만 다룬다.

params_json 문서 구조(phase-1 1.4 — 지표별 서브키, 단일 버전 공유):
```jsonc
{
  "ei":        { "included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0 },
  "fcr":       { "included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0 },
  "oei":       { "included_quality_flags": ["ok"], "min_biomass_kg": 0.0,
                 "do_band_method": "sample_count", "oei_scale_factor": 1.0, "clamp_max": 100.0 },
  "mortality": { "moving_avg_window_days": 7 }
}
```
버전은 전 지표가 공유한다(2026.1.0). 산식 변경이 없으므로 유지한다.

스프린트 0 하위호환: sprint-0 의 params_json 은 EI 파라미터를 **평면(flat)** 으로 담았다
(`{"included_quality_flags": [...], "min_biomass_delta_kg": 0.0}`). 서브키가 하나도 없는
평면 문서는 EI 평면 params 로 간주해 폴백한다(마이그레이션 무중단). `_is_nested_doc` 참조.

버전 규약(Rule 2 — ★ 반드시 준수):
  - 기본 버전은 DEFAULT_CONFIG_VERSION = '2026.1.0' (SemVer-유사: YYYY.MAJOR.MINOR).
  - 산식/파라미터 의미가 바뀌면 이 파일과 산식만 고치지 말고 **반드시**:
      1) `/packages/kpi` 에 변경을 고정하는 단위테스트를 추가하고,
      2) kpi_config 에 새 version 행을 추가(effective_from 지정)하며,
      3) 어떤 기간에 어떤 version 이 적용됐는지 kpi_snapshots.config_version 으로 추적한다.
  - 버전 증가 기준(권장):
      · MINOR(2026.1.0 → 2026.1.1): 산출값을 바꾸지 않는 파라미터 기본값/문서 보정.
      · MAJOR(2026.1.x → 2026.2.0): 산출값이 달라지는 산식/계수 보정(실증 튜닝 등).
        ★ OEI oei_scale_factor 실증 보정은 산출값이 바뀌므로 MAJOR 증가 필수(ADR 0003).
      · YEAR(2026.x → 2027.x): 회계연도 배출계수·규제 기준 갱신 등 연 단위 개정.
  - config_version 은 산출 로직 입력이 아니라 **결과에 실려 추적**되는 메타데이터다(결정론 유지).
"""

from __future__ import annotations

from typing import Any, Mapping

from .status import KpiThresholds, MetricThresholds
from .types import (
    AlertingConfig,
    EiConfig,
    FcrConfig,
    MortalityConfig,
    OeiConfig,
    RecommendConfig,
)

# 스프린트 0 기준 산출 버전. 전 지표 공유. 변경 시 위 '버전 규약' 절차를 따른다.
DEFAULT_CONFIG_VERSION: str = "2026.1.0"

# 지표별 서브키 이름. 평면 문서(하위호환) 판별에 사용한다.
# phase-2 에서 'alerting'/'recommend' 서브키가 추가되었다 — 이들도 '중첩 문서' 판별에 포함해야
# 알림/추천 파라미터만 담긴 문서도 올바르게 중첩 문서로 인식된다(EI 평면 폴백 오판 방지).
_METRIC_KEYS = ("ei", "fcr", "oei", "mortality", "alerting", "recommend")


def _is_nested_doc(params: Mapping[str, Any]) -> bool:
    """params_json 이 지표별 서브키 문서인지(평면 EI 문서가 아닌지) 판별.

    지표 서브키(ei/fcr/oei/mortality) 중 하나라도 있으면 '중첩 문서'로 본다.
    하나도 없으면 sprint-0 평면 EI 문서로 간주(하위호환 폴백).
    """
    return any(k in params for k in _METRIC_KEYS)


def _sub_params(params: Mapping[str, Any], metric_key: str) -> Mapping[str, Any]:
    """지표 서브 params 추출. 중첩 문서면 해당 서브키(없으면 {}), 평면 문서면 전체를 반환.

    평면(sprint-0) 폴백은 실질적으로 EI 에만 의미가 있으나, 다른 지표의 `_to_params` 평면
    출력을 되읽는 라운드트립도 이 규약으로 자연스럽게 지원된다.
    """
    if _is_nested_doc(params):
        return params.get(metric_key, {})
    return params


def _reject_unknown(sub: Mapping[str, Any], known: set[str], label: str) -> None:
    """알 수 없는 키를 방어적으로 거부(오탈자 조기 발견)."""
    unknown = set(sub) - known
    if unknown:
        raise ValueError(f"unknown {label} params_json keys: {sorted(unknown)}")


# ---------------------------------------------------------------------------
# EI (sprint-0) — 평면 문서 하위호환 포함
# ---------------------------------------------------------------------------

def ei_config_from_params(params: Mapping[str, Any]) -> EiConfig:
    """kpi_config.params_json → EiConfig.

    중첩 문서면 params['ei'] 를, 평면(sprint-0) 문서면 전체를 EI 파라미터로 읽는다.
    누락 키는 EiConfig 기본값. included_quality_flags(JSON 배열)는 tuple 로 정규화(결정론).
    """
    sub = _sub_params(params, "ei")
    _reject_unknown(sub, {"included_quality_flags", "min_biomass_delta_kg"}, "EiConfig")

    defaults = EiConfig()
    flags_raw = sub.get("included_quality_flags", defaults.included_quality_flags)
    min_delta = sub.get("min_biomass_delta_kg", defaults.min_biomass_delta_kg)
    return EiConfig(
        included_quality_flags=tuple(flags_raw),
        min_biomass_delta_kg=float(min_delta),
    )


def ei_config_to_params(config: EiConfig) -> dict[str, Any]:
    """EiConfig → params(평면 서브-dict). 라운드트립(from∘to = 항등)을 보장한다."""
    return {
        "included_quality_flags": list(config.included_quality_flags),
        "min_biomass_delta_kg": config.min_biomass_delta_kg,
    }


# ---------------------------------------------------------------------------
# FCR
# ---------------------------------------------------------------------------

def fcr_config_from_params(params: Mapping[str, Any]) -> FcrConfig:
    """kpi_config.params_json → FcrConfig(서브키 'fcr')."""
    sub = _sub_params(params, "fcr")
    _reject_unknown(sub, {"included_quality_flags", "min_biomass_delta_kg"}, "FcrConfig")

    defaults = FcrConfig()
    flags_raw = sub.get("included_quality_flags", defaults.included_quality_flags)
    min_delta = sub.get("min_biomass_delta_kg", defaults.min_biomass_delta_kg)
    return FcrConfig(
        included_quality_flags=tuple(flags_raw),
        min_biomass_delta_kg=float(min_delta),
    )


def fcr_config_to_params(config: FcrConfig) -> dict[str, Any]:
    """FcrConfig → params(평면 서브-dict). 라운드트립(from∘to = 항등)."""
    return {
        "included_quality_flags": list(config.included_quality_flags),
        "min_biomass_delta_kg": config.min_biomass_delta_kg,
    }


# ---------------------------------------------------------------------------
# OEI (ADR 0003)
# ---------------------------------------------------------------------------

def oei_config_from_params(params: Mapping[str, Any]) -> OeiConfig:
    """kpi_config.params_json → OeiConfig(서브키 'oei')."""
    sub = _sub_params(params, "oei")
    _reject_unknown(
        sub,
        {"included_quality_flags", "min_biomass_kg", "do_band_method",
         "oei_scale_factor", "clamp_max"},
        "OeiConfig",
    )

    defaults = OeiConfig()
    flags_raw = sub.get("included_quality_flags", defaults.included_quality_flags)
    return OeiConfig(
        included_quality_flags=tuple(flags_raw),
        min_biomass_kg=float(sub.get("min_biomass_kg", defaults.min_biomass_kg)),
        do_band_method=str(sub.get("do_band_method", defaults.do_band_method)),
        oei_scale_factor=float(sub.get("oei_scale_factor", defaults.oei_scale_factor)),
        clamp_max=float(sub.get("clamp_max", defaults.clamp_max)),
    )


def oei_config_to_params(config: OeiConfig) -> dict[str, Any]:
    """OeiConfig → params(평면 서브-dict). 라운드트립(from∘to = 항등)."""
    return {
        "included_quality_flags": list(config.included_quality_flags),
        "min_biomass_kg": config.min_biomass_kg,
        "do_band_method": config.do_band_method,
        "oei_scale_factor": config.oei_scale_factor,
        "clamp_max": config.clamp_max,
    }


# ---------------------------------------------------------------------------
# Mortality
# ---------------------------------------------------------------------------

def mortality_config_from_params(params: Mapping[str, Any]) -> MortalityConfig:
    """kpi_config.params_json → MortalityConfig(서브키 'mortality')."""
    sub = _sub_params(params, "mortality")
    _reject_unknown(sub, {"moving_avg_window_days"}, "MortalityConfig")

    defaults = MortalityConfig()
    window = sub.get("moving_avg_window_days", defaults.moving_avg_window_days)
    return MortalityConfig(moving_avg_window_days=int(window))


def mortality_config_to_params(config: MortalityConfig) -> dict[str, Any]:
    """MortalityConfig → params(평면 서브-dict). 라운드트립(from∘to = 항등)."""
    return {
        "moving_avg_window_days": config.moving_avg_window_days,
    }


# ---------------------------------------------------------------------------
# Alerting / KPI 신호등 임계값 (phase-2 슬라이스 G, phase-2.md 1.2절)
# ---------------------------------------------------------------------------

_THRESHOLD_METRIC_NAMES = ("ei_total", "ei_aeration", "fcr", "oei", "mortality_rate")


def _metric_thresholds_from_dict(raw: Mapping[str, Any]) -> MetricThresholds:
    """{'red_threshold':..,'amber_threshold':..} → MetricThresholds."""
    _reject_unknown(raw, {"red_threshold", "amber_threshold"}, "MetricThresholds")
    return MetricThresholds(
        red_threshold=float(raw["red_threshold"]),
        amber_threshold=float(raw["amber_threshold"]),
    )


def _metric_thresholds_to_dict(thresholds: MetricThresholds) -> dict[str, Any]:
    return {
        "red_threshold": thresholds.red_threshold,
        "amber_threshold": thresholds.amber_threshold,
    }


def _kpi_thresholds_from_dict(
    raw: Mapping[str, Any] | None, defaults: KpiThresholds
) -> KpiThresholds:
    """{'ei_total': {...}, ...} → KpiThresholds. 누락 지표는 defaults 값으로 채운다."""
    if raw is None:
        return defaults
    _reject_unknown(raw, set(_THRESHOLD_METRIC_NAMES), "KpiThresholds")
    values = {}
    for name in _THRESHOLD_METRIC_NAMES:
        sub = raw.get(name)
        values[name] = (
            _metric_thresholds_from_dict(sub) if sub is not None else getattr(defaults, name)
        )
    return KpiThresholds(**values)


def _kpi_thresholds_to_dict(thresholds: KpiThresholds) -> dict[str, Any]:
    return {name: _metric_thresholds_to_dict(getattr(thresholds, name))
            for name in _THRESHOLD_METRIC_NAMES}


def alerting_config_from_params(params: Mapping[str, Any]) -> AlertingConfig:
    """kpi_config.params_json → AlertingConfig(서브키 'alerting').

    'alerting.thresholds' 는 신호등 red/amber 경계값 묶음(status.py `classify_metric_status`
    입력). 누락 시 DEFAULT_KPI_THRESHOLDS(잠정치, status.py 참조)로 폴백한다.
    """
    sub = _sub_params(params, "alerting")
    _reject_unknown(
        sub,
        {
            "do_low_mg_l", "mortality_spike_ratio", "mortality_spike_min_count",
            "kpi_red_metrics", "thresholds",
        },
        "AlertingConfig",
    )

    defaults = AlertingConfig()
    thresholds = _kpi_thresholds_from_dict(sub.get("thresholds"), defaults.thresholds)
    return AlertingConfig(
        do_low_mg_l=float(sub.get("do_low_mg_l", defaults.do_low_mg_l)),
        mortality_spike_ratio=float(
            sub.get("mortality_spike_ratio", defaults.mortality_spike_ratio)
        ),
        mortality_spike_min_count=int(
            sub.get("mortality_spike_min_count", defaults.mortality_spike_min_count)
        ),
        kpi_red_metrics=tuple(sub.get("kpi_red_metrics", defaults.kpi_red_metrics)),
        thresholds=thresholds,
    )


def alerting_config_to_params(config: AlertingConfig) -> dict[str, Any]:
    """AlertingConfig → params(평면 서브-dict). 라운드트립(from∘to = 항등)."""
    return {
        "do_low_mg_l": config.do_low_mg_l,
        "mortality_spike_ratio": config.mortality_spike_ratio,
        "mortality_spike_min_count": config.mortality_spike_min_count,
        "kpi_red_metrics": list(config.kpi_red_metrics),
        "thresholds": _kpi_thresholds_to_dict(config.thresholds),
    }


# ---------------------------------------------------------------------------
# Recommend — 추천(운전 레시피) 파라미터 (phase-2 슬라이스 K, phase-2.md 2.2절)
# ---------------------------------------------------------------------------

def recommend_config_from_params(params: Mapping[str, Any]) -> RecommendConfig:
    """kpi_config.params_json → RecommendConfig(서브키 'recommend')."""
    sub = _sub_params(params, "recommend")
    _reject_unknown(
        sub,
        {
            "included_feed_quality_flags", "target_feed_rate_pct_of_biomass",
            "max_feed_adjustment_ratio", "do_low_margin_mg_l", "do_high_margin_mg_l",
            "high_water_temp_c",
        },
        "RecommendConfig",
    )

    defaults = RecommendConfig()
    flags_raw = sub.get("included_feed_quality_flags", defaults.included_feed_quality_flags)
    return RecommendConfig(
        included_feed_quality_flags=tuple(flags_raw),
        target_feed_rate_pct_of_biomass=float(
            sub.get("target_feed_rate_pct_of_biomass", defaults.target_feed_rate_pct_of_biomass)
        ),
        max_feed_adjustment_ratio=float(
            sub.get("max_feed_adjustment_ratio", defaults.max_feed_adjustment_ratio)
        ),
        do_low_margin_mg_l=float(sub.get("do_low_margin_mg_l", defaults.do_low_margin_mg_l)),
        do_high_margin_mg_l=float(sub.get("do_high_margin_mg_l", defaults.do_high_margin_mg_l)),
        high_water_temp_c=float(sub.get("high_water_temp_c", defaults.high_water_temp_c)),
    )


def recommend_config_to_params(config: RecommendConfig) -> dict[str, Any]:
    """RecommendConfig → params(평면 서브-dict). 라운드트립(from∘to = 항등)."""
    return {
        "included_feed_quality_flags": list(config.included_feed_quality_flags),
        "target_feed_rate_pct_of_biomass": config.target_feed_rate_pct_of_biomass,
        "max_feed_adjustment_ratio": config.max_feed_adjustment_ratio,
        "do_low_margin_mg_l": config.do_low_margin_mg_l,
        "do_high_margin_mg_l": config.do_high_margin_mg_l,
        "high_water_temp_c": config.high_water_temp_c,
    }
