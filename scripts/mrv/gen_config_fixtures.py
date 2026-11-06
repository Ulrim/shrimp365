"""KPI config 매핑 차분 검증용 기준값 생성기 (원본 Python → JSON).

`lib/mrv/kpi/config.ts` 는 DB 의 `mrv_kpi_config.params_json` 을 산출 파라미터로 옮기는
계층이다. KPI 를 계산할 때마다 먼저 지나가는 길목이라, 여기가 원본과 어긋나면 **모든
KPI 값이 조용히 달라진다** — 산식 자체는 멀쩡한데 결과만 틀리는, 가장 알아채기 어려운
형태의 오류다. `gen_kpi_fixtures.py` 는 설정 객체를 직접 넘겨 이 계층을 건너뛰므로,
이 파일이 그 빈틈을 메운다.

실행:
    python3 scripts/mrv/gen_config_fixtures.py > scripts/mrv/config-fixtures.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mrv-platform" / "packages" / "kpi"))

from culiver_kpi.config import (  # noqa: E402
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

# 산출 파라미터 dataclass → 이식본의 camelCase 필드명 매핑.
# (이식하며 이름만 바꿨고 의미는 같다. 값 비교는 이 대응표로 한다.)
FIELD_MAP = {
    "included_quality_flags": "includedQualityFlags",
    "min_biomass_delta_kg": "minBiomassDeltaKg",
    "min_biomass_kg": "minBiomassKg",
    "do_band_method": "doBandMethod",
    "oei_scale_factor": "oeiScaleFactor",
    "clamp_max": "clampMax",
    "moving_avg_window_days": "movingAvgWindowDays",
    "do_low_mg_l": "doLowMgL",
    "mortality_spike_ratio": "mortalitySpikeRatio",
    "mortality_spike_min_count": "mortalitySpikeMinCount",
    "kpi_red_metrics": "kpiRedMetrics",
    "included_feed_quality_flags": "includedFeedQualityFlags",
    "target_feed_rate_pct_of_biomass": "targetFeedRatePctOfBiomass",
    "max_feed_adjustment_ratio": "maxFeedAdjustmentRatio",
    "do_low_margin_mg_l": "doLowMarginMgL",
    "do_high_margin_mg_l": "doHighMarginMgL",
    "high_water_temp_c": "highWaterTempC",
    "red_threshold": "redThreshold",
    "amber_threshold": "amberThreshold",
}

THRESHOLD_METRICS = ("ei_total", "ei_aeration", "fcr", "oei", "mortality_rate")


def config_to_json(config) -> dict:
    """dataclass → 이식본 필드명 기준 dict(비교용)."""
    out = {}
    for name in config.__dataclass_fields__:  # type: ignore[attr-defined]
        value = getattr(config, name)
        key = FIELD_MAP.get(name, name)
        if name == "thresholds":
            out[key] = {
                m: {
                    "redThreshold": getattr(value, m).red_threshold,
                    "amberThreshold": getattr(value, m).amber_threshold,
                }
                for m in THRESHOLD_METRICS
            }
        elif isinstance(value, tuple):
            out[key] = list(value)
        else:
            out[key] = value
    return out


PARSERS = {
    "ei": (ei_config_from_params, ei_config_to_params),
    "fcr": (fcr_config_from_params, fcr_config_to_params),
    "oei": (oei_config_from_params, oei_config_to_params),
    "mortality": (mortality_config_from_params, mortality_config_to_params),
    "alerting": (alerting_config_from_params, alerting_config_to_params),
    "recommend": (recommend_config_from_params, recommend_config_to_params),
}


def full_thresholds() -> dict:
    return {
        "ei_total": {"red_threshold": 9.0, "amber_threshold": 7.5},
        "ei_aeration": {"red_threshold": 6.5, "amber_threshold": 5.5},
        "fcr": {"red_threshold": 1.8, "amber_threshold": 1.55},
        "oei": {"red_threshold": 45.0, "amber_threshold": 58.0},
        "mortality_rate": {"red_threshold": 15.0, "amber_threshold": 9.0},
    }


def scenarios() -> list[tuple[str, dict]]:
    """(이름, params_json) 목록. 실무에서 실제로 들어올 수 있는 문서 형태를 모은다."""
    return [
        # 비어 있음 → 전 지표 엔진 기본값.
        ("empty", {}),
        # 마이그레이션이 넣는 기본 문서(전 지표 서브키).
        ("seeded-default", {
            "ei": {"included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0},
            "fcr": {"included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0},
            "oei": {"included_quality_flags": ["ok"], "min_biomass_kg": 0.0,
                    "do_band_method": "sample_count", "oei_scale_factor": 1.0,
                    "clamp_max": 100.0},
            "mortality": {"moving_avg_window_days": 7},
        }),
        # 실증 보정 후(값이 전부 기본값과 다름).
        ("tuned", {
            "ei": {"included_quality_flags": ["ok", "suspect"], "min_biomass_delta_kg": 12.5},
            "fcr": {"included_quality_flags": ["ok"], "min_biomass_delta_kg": 3.0},
            "oei": {"included_quality_flags": ["ok", "suspect"], "min_biomass_kg": 5.0,
                    "do_band_method": "time_weighted", "oei_scale_factor": 250.0,
                    "clamp_max": 1000.0},
            "mortality": {"moving_avg_window_days": 3},
            "alerting": {"do_low_mg_l": 3.5, "mortality_spike_ratio": 1.8,
                         "mortality_spike_min_count": 8,
                         "kpi_red_metrics": ["ei_total", "oei"],
                         "thresholds": full_thresholds()},
            "recommend": {"included_feed_quality_flags": ["ok", "suspect"],
                          "target_feed_rate_pct_of_biomass": 0.025,
                          "max_feed_adjustment_ratio": 0.1,
                          "do_low_margin_mg_l": 0.5,
                          "do_high_margin_mg_l": 0.4,
                          "high_water_temp_c": 31.5},
        }),
        # 서브키 일부만 있는 문서(나머지 지표는 기본값).
        ("partial-metrics", {"oei": {"oei_scale_factor": 12.5}}),
        # 서브 params 의 키 일부만 있는 문서(나머지 키는 기본값).
        ("partial-keys", {
            "ei": {"min_biomass_delta_kg": 4.0},
            "recommend": {"high_water_temp_c": 29.0},
        }),
        # sprint-0 평면 EI 문서(하위호환 폴백 — 서브키가 하나도 없다).
        ("flat-legacy-ei", {"included_quality_flags": ["ok", "suspect"],
                            "min_biomass_delta_kg": 2.0}),
        # alerting 만 있는 문서(평면 폴백으로 오판하면 안 된다).
        ("alerting-only", {"alerting": {"do_low_mg_l": 4.0}}),
        # thresholds 를 지표 일부만 지정(나머지는 기본값으로 채워야 한다).
        ("thresholds-partial-metrics", {
            "alerting": {"thresholds": {"fcr": {"red_threshold": 2.0,
                                                "amber_threshold": 1.7}}},
        }),
        # thresholds 자체가 없는 alerting.
        ("thresholds-absent", {"alerting": {"mortality_spike_min_count": 3}}),
        # --- 거부돼야 하는 문서들 ---
        ("unknown-key-ei", {"ei": {"min_biomass_delta_kg": 1.0, "typo_key": 1}}),
        ("unknown-key-oei", {"oei": {"oei_scale_facter": 2.0}}),
        ("unknown-key-alerting", {"alerting": {"do_low": 3.0}}),
        ("unknown-key-recommend", {"recommend": {"high_water_temp": 30}}),
        ("unknown-threshold-metric", {
            "alerting": {"thresholds": {"ei_totl": {"red_threshold": 1,
                                                    "amber_threshold": 2}}},
        }),
        ("unknown-threshold-key", {
            "alerting": {"thresholds": {"fcr": {"red_threshold": 2.0, "amber": 1.7}}},
        }),
        # 임계값 쌍 중 한쪽만 준 문서 — 원본은 KeyError 로 거부한다.
        ("threshold-missing-amber", {
            "alerting": {"thresholds": {"fcr": {"red_threshold": 2.0}}},
        }),
        ("threshold-missing-red", {
            "alerting": {"thresholds": {"oei": {"amber_threshold": 55.0}}},
        }),
    ]


def build() -> dict:
    cases = []
    for name, params in scenarios():
        for metric, (from_params, to_params) in PARSERS.items():
            case = {"name": f"{name}/{metric}", "metric": metric, "params": params}
            try:
                config = from_params(params)
            except Exception:
                # 문구는 계약이 아니다(리포트에 박히지 않는다). 거부 여부만 고정한다.
                case["rejects"] = True
                cases.append(case)
                continue
            case["rejects"] = False
            case["expected"] = config_to_json(config)
            # 라운드트립: to∘from 이 같은 값을 되돌려야 한다(설정을 저장했다 다시 읽어도
            # 산출이 달라지지 않는다는 뜻이다).
            case["roundTrip"] = config_to_json(from_params({metric: to_params(config)}))
            cases.append(case)
    return {"generatedBy": "culiver_kpi.config (python original)", "cases": cases}


if __name__ == "__main__":
    json.dump(build(), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
