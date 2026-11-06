/**
 * KPI config 매핑 — `mrv_kpi_config.params_json` ↔ 지표별 Config 객체.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/config.py
 * 산식 자체는 여기서 정의하지 않는다(산식은 energy/feed/oxygen/mortality/scope2).
 * 여기서는 파라미터/버전만 다룬다.
 *
 * params_json 문서 구조(지표별 서브키, 단일 버전 공유):
 * ```jsonc
 * {
 *   "ei":        { "included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0 },
 *   "fcr":       { "included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0 },
 *   "oei":       { "included_quality_flags": ["ok"], "min_biomass_kg": 0.0,
 *                  "do_band_method": "sample_count", "oei_scale_factor": 1.0, "clamp_max": 100.0 },
 *   "mortality": { "moving_avg_window_days": 7 }
 * }
 * ```
 *
 * 하위호환: 서브키가 하나도 없는 평면 문서는 EI 평면 params 로 간주해 폴백한다.
 *
 * 확장(이식본 전용, 원본 Python 에 없음): 최상위 `baseline` 블록. 지표 산출에는 쓰이지
 * 않고 기준선 잠금 전 입력 충분성 판정이 읽는다. 아래 EXTENSION_KEYS 주석 참고.
 *
 * 버전 규약(★ 반드시 준수):
 *   - 기본 버전은 DEFAULT_CONFIG_VERSION = '2026.1.0' (SemVer-유사: YYYY.MAJOR.MINOR).
 *   - 산식/파라미터 의미가 바뀌면 산식만 고치지 말고 **반드시**:
 *       1) 변경을 고정하는 단위테스트를 추가하고,
 *       2) mrv_kpi_config 에 새 version 행을 추가(effective_from 지정)하며,
 *       3) 어떤 기간에 어떤 version 이 적용됐는지 mrv_kpi_snapshots.config_version 으로 추적.
 *   - 버전 증가 기준:
 *       · MINOR: 산출값을 바꾸지 않는 기본값/문서 보정.
 *       · MAJOR: 산출값이 달라지는 산식/계수 보정(실증 튜닝 등).
 *         ★ OEI oei_scale_factor 실증 보정은 산출값이 바뀌므로 MAJOR 증가 필수(ADR 0003).
 *       · YEAR: 배출계수·규제 기준 갱신 등 연 단위 개정.
 *   - config_version 은 산출 로직 입력이 아니라 **결과에 실려 추적**되는 메타데이터다.
 */

import { DEFAULT_KPI_THRESHOLDS, KpiValueError } from "./status"
import type { KpiThresholds, MetricThresholds } from "./status"
import {
  DEFAULT_ALERTING_CONFIG,
  DEFAULT_EI_CONFIG,
  DEFAULT_FCR_CONFIG,
  DEFAULT_MORTALITY_CONFIG,
  DEFAULT_OEI_CONFIG,
  DEFAULT_RECOMMEND_CONFIG,
} from "./types"
import type {
  AlertingConfig,
  EiConfig,
  FcrConfig,
  MortalityConfig,
  OeiConfig,
  RecommendConfig,
} from "./types"

/** 산출 버전. 전 지표 공유. 변경 시 위 '버전 규약' 절차를 따른다. */
export const DEFAULT_CONFIG_VERSION = "2026.1.0"

export type ParamsJson = Record<string, unknown>

/** 지표별 서브키 이름. 평면 문서(하위호환) 판별에 사용한다. */
const METRIC_KEYS = ["ei", "fcr", "oei", "mortality", "alerting", "recommend"] as const

/**
 * 지표가 아니면서 최상위에 놓이는 블록. **원본 Python 에는 없는 이식본 확장이다.**
 *
 * 이 목록이 필요한 이유는 `isNestedDoc` 의 판정 방식 때문이다. 아래 함수는 "지표 서브키가
 * 하나도 없으면 평면 EI 문서"로 보고 **최상위 문서 전체를** `rejectUnknown` 에 넘긴다.
 * 그래서 확장 블록을 여기에 등재하지 않으면, 그 블록만 적힌 문서
 * (예: `{"baseline": {...}}`)가 평면 EI 문서로 오판되어 6종 파서 전부가
 * `KpiValueError` 를 던진다 — 그 org 의 `/kpi`·리포트·알림이 통째로 422 가 된다.
 *
 * 등재된 블록의 내용은 이 파일이 검사하지 않는다. 각 블록의 소비자가 자기 스키마로
 * 검증한다(`baseline` → `lib/mrv/baseline-readiness.ts`). 잘못된 확장 블록이 지표 산출을
 * 세우지 않게 하려는 의도적 분리다.
 */
const EXTENSION_KEYS = ["baseline"] as const

/** 중첩 문서 판별에 쓰는 최상위 허용 키 전체(지표 + 확장). */
const NESTED_DOC_KEYS = [...METRIC_KEYS, ...EXTENSION_KEYS] as const

/**
 * params_json 이 서브키 문서인지(평면 EI 문서가 아닌지) 판별.
 * 서브키 중 하나라도 있으면 '중첩 문서'로 본다. 하나도 없으면 평면 EI 문서로 간주.
 */
function isNestedDoc(params: ParamsJson): boolean {
  return NESTED_DOC_KEYS.some((k) => k in params)
}

/** 지표 서브 params 추출. 중첩 문서면 해당 서브키(없으면 {}), 평면 문서면 전체를 반환. */
function subParams(params: ParamsJson, metricKey: string): ParamsJson {
  if (isNestedDoc(params)) {
    const sub = params[metricKey]
    return sub && typeof sub === "object" ? (sub as ParamsJson) : {}
  }
  return params
}

/** 알 수 없는 키를 방어적으로 거부(오탈자 조기 발견). */
function rejectUnknown(sub: ParamsJson, known: readonly string[], label: string): void {
  const unknown = Object.keys(sub).filter((k) => !known.includes(k))
  if (unknown.length > 0) {
    throw new KpiValueError(
      `unknown ${label} params_json keys: ${JSON.stringify(unknown.sort())}`,
    )
  }
}

function num(sub: ParamsJson, key: string, fallback: number): number {
  const v = sub[key]
  return v === undefined ? fallback : Number(v)
}

function strv(sub: ParamsJson, key: string, fallback: string): string {
  const v = sub[key]
  return v === undefined ? fallback : String(v)
}

function strList(sub: ParamsJson, key: string, fallback: readonly string[]): string[] {
  const v = sub[key]
  return v === undefined ? [...fallback] : (v as unknown[]).map(String)
}

// ---------------------------------------------------------------------------
// EI — 평면 문서 하위호환 포함
// ---------------------------------------------------------------------------

export function eiConfigFromParams(params: ParamsJson): EiConfig {
  const sub = subParams(params, "ei")
  rejectUnknown(sub, ["included_quality_flags", "min_biomass_delta_kg"], "EiConfig")
  return {
    includedQualityFlags: strList(
      sub,
      "included_quality_flags",
      DEFAULT_EI_CONFIG.includedQualityFlags,
    ),
    minBiomassDeltaKg: num(sub, "min_biomass_delta_kg", DEFAULT_EI_CONFIG.minBiomassDeltaKg),
  }
}

/** EiConfig → params(평면 서브-객체). 라운드트립(from∘to = 항등)을 보장한다. */
export function eiConfigToParams(config: EiConfig): ParamsJson {
  return {
    included_quality_flags: [...config.includedQualityFlags],
    min_biomass_delta_kg: config.minBiomassDeltaKg,
  }
}

// ---------------------------------------------------------------------------
// FCR
// ---------------------------------------------------------------------------

export function fcrConfigFromParams(params: ParamsJson): FcrConfig {
  const sub = subParams(params, "fcr")
  rejectUnknown(sub, ["included_quality_flags", "min_biomass_delta_kg"], "FcrConfig")
  return {
    includedQualityFlags: strList(
      sub,
      "included_quality_flags",
      DEFAULT_FCR_CONFIG.includedQualityFlags,
    ),
    minBiomassDeltaKg: num(sub, "min_biomass_delta_kg", DEFAULT_FCR_CONFIG.minBiomassDeltaKg),
  }
}

export function fcrConfigToParams(config: FcrConfig): ParamsJson {
  return {
    included_quality_flags: [...config.includedQualityFlags],
    min_biomass_delta_kg: config.minBiomassDeltaKg,
  }
}

// ---------------------------------------------------------------------------
// OEI (ADR 0003)
// ---------------------------------------------------------------------------

export function oeiConfigFromParams(params: ParamsJson): OeiConfig {
  const sub = subParams(params, "oei")
  rejectUnknown(
    sub,
    [
      "included_quality_flags",
      "min_biomass_kg",
      "do_band_method",
      "oei_scale_factor",
      "clamp_max",
    ],
    "OeiConfig",
  )
  return {
    includedQualityFlags: strList(
      sub,
      "included_quality_flags",
      DEFAULT_OEI_CONFIG.includedQualityFlags,
    ),
    minBiomassKg: num(sub, "min_biomass_kg", DEFAULT_OEI_CONFIG.minBiomassKg),
    doBandMethod: strv(sub, "do_band_method", DEFAULT_OEI_CONFIG.doBandMethod),
    oeiScaleFactor: num(sub, "oei_scale_factor", DEFAULT_OEI_CONFIG.oeiScaleFactor),
    clampMax: num(sub, "clamp_max", DEFAULT_OEI_CONFIG.clampMax),
  }
}

export function oeiConfigToParams(config: OeiConfig): ParamsJson {
  return {
    included_quality_flags: [...config.includedQualityFlags],
    min_biomass_kg: config.minBiomassKg,
    do_band_method: config.doBandMethod,
    oei_scale_factor: config.oeiScaleFactor,
    clamp_max: config.clampMax,
  }
}

// ---------------------------------------------------------------------------
// Mortality
// ---------------------------------------------------------------------------

export function mortalityConfigFromParams(params: ParamsJson): MortalityConfig {
  const sub = subParams(params, "mortality")
  rejectUnknown(sub, ["moving_avg_window_days"], "MortalityConfig")
  return {
    movingAvgWindowDays: Math.trunc(
      num(sub, "moving_avg_window_days", DEFAULT_MORTALITY_CONFIG.movingAvgWindowDays),
    ),
  }
}

export function mortalityConfigToParams(config: MortalityConfig): ParamsJson {
  return { moving_avg_window_days: config.movingAvgWindowDays }
}

// ---------------------------------------------------------------------------
// Alerting / 신호등 임계값
// ---------------------------------------------------------------------------

const THRESHOLD_METRICS = [
  "ei_total",
  "ei_aeration",
  "fcr",
  "oei",
  "mortality_rate",
] as const

function kpiThresholdsFromDict(raw: unknown, fallback: KpiThresholds): KpiThresholds {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== "object") {
    throw new KpiValueError(`thresholds must be an object, got ${typeof raw}`)
  }
  const doc = raw as Record<string, unknown>
  rejectUnknown(doc, THRESHOLD_METRICS as unknown as string[], "KpiThresholds")

  const out = {} as Record<string, MetricThresholds>
  for (const metric of THRESHOLD_METRICS) {
    const sub = doc[metric]
    const base = fallback[metric]
    if (sub === undefined || sub === null) {
      out[metric] = base
      continue
    }
    const subDoc = sub as ParamsJson
    rejectUnknown(subDoc, ["red_threshold", "amber_threshold"], `MetricThresholds(${metric})`)
    // 임계값은 쌍으로만 의미가 있다. 한쪽만 적힌 문서를 나머지 기본값으로 메우면
    // 운영자가 의도하지 않은 조합(예: red 만 올리고 amber 는 그대로)이 조용히 만들어져,
    // 신호등이 설정한 적 없는 기준으로 판정하게 된다. 원본과 같이 거부한다
    // (원본은 KeyError 로 500 이 났고, 여기서는 422 로 원인을 알려 준다).
    for (const required of ["red_threshold", "amber_threshold"] as const) {
      if (subDoc[required] === undefined || subDoc[required] === null) {
        throw new KpiValueError(
          `MetricThresholds(${metric}) requires both red_threshold and amber_threshold; ` +
            `'${required}' is missing`,
        )
      }
    }
    out[metric] = {
      redThreshold: num(subDoc, "red_threshold", base.redThreshold),
      amberThreshold: num(subDoc, "amber_threshold", base.amberThreshold),
    }
  }
  return out as unknown as KpiThresholds
}

function kpiThresholdsToDict(thresholds: KpiThresholds): ParamsJson {
  const out: ParamsJson = {}
  for (const metric of THRESHOLD_METRICS) {
    out[metric] = {
      red_threshold: thresholds[metric].redThreshold,
      amber_threshold: thresholds[metric].amberThreshold,
    }
  }
  return out
}

export function alertingConfigFromParams(params: ParamsJson): AlertingConfig {
  const sub = subParams(params, "alerting")
  rejectUnknown(
    sub,
    [
      "do_low_mg_l",
      "mortality_spike_ratio",
      "mortality_spike_min_count",
      "kpi_red_metrics",
      "thresholds",
    ],
    "AlertingConfig",
  )
  return {
    doLowMgL: num(sub, "do_low_mg_l", DEFAULT_ALERTING_CONFIG.doLowMgL),
    mortalitySpikeRatio: num(
      sub,
      "mortality_spike_ratio",
      DEFAULT_ALERTING_CONFIG.mortalitySpikeRatio,
    ),
    mortalitySpikeMinCount: Math.trunc(
      num(sub, "mortality_spike_min_count", DEFAULT_ALERTING_CONFIG.mortalitySpikeMinCount),
    ),
    kpiRedMetrics: strList(sub, "kpi_red_metrics", DEFAULT_ALERTING_CONFIG.kpiRedMetrics),
    thresholds: kpiThresholdsFromParams(sub),
  }
}

function kpiThresholdsFromParams(sub: ParamsJson): KpiThresholds {
  return kpiThresholdsFromDict(sub["thresholds"], DEFAULT_KPI_THRESHOLDS)
}

export function alertingConfigToParams(config: AlertingConfig): ParamsJson {
  return {
    do_low_mg_l: config.doLowMgL,
    mortality_spike_ratio: config.mortalitySpikeRatio,
    mortality_spike_min_count: config.mortalitySpikeMinCount,
    kpi_red_metrics: [...config.kpiRedMetrics],
    thresholds: kpiThresholdsToDict(config.thresholds),
  }
}

// ---------------------------------------------------------------------------
// Recommend — 추천(운전 레시피) 파라미터
// ---------------------------------------------------------------------------

export function recommendConfigFromParams(params: ParamsJson): RecommendConfig {
  const sub = subParams(params, "recommend")
  rejectUnknown(
    sub,
    [
      "included_feed_quality_flags",
      "target_feed_rate_pct_of_biomass",
      "max_feed_adjustment_ratio",
      "do_low_margin_mg_l",
      "do_high_margin_mg_l",
      "high_water_temp_c",
    ],
    "RecommendConfig",
  )
  return {
    includedFeedQualityFlags: strList(
      sub,
      "included_feed_quality_flags",
      DEFAULT_RECOMMEND_CONFIG.includedFeedQualityFlags,
    ),
    targetFeedRatePctOfBiomass: num(
      sub,
      "target_feed_rate_pct_of_biomass",
      DEFAULT_RECOMMEND_CONFIG.targetFeedRatePctOfBiomass,
    ),
    maxFeedAdjustmentRatio: num(
      sub,
      "max_feed_adjustment_ratio",
      DEFAULT_RECOMMEND_CONFIG.maxFeedAdjustmentRatio,
    ),
    doLowMarginMgL: num(sub, "do_low_margin_mg_l", DEFAULT_RECOMMEND_CONFIG.doLowMarginMgL),
    doHighMarginMgL: num(sub, "do_high_margin_mg_l", DEFAULT_RECOMMEND_CONFIG.doHighMarginMgL),
    highWaterTempC: num(sub, "high_water_temp_c", DEFAULT_RECOMMEND_CONFIG.highWaterTempC),
  }
}

export function recommendConfigToParams(config: RecommendConfig): ParamsJson {
  return {
    included_feed_quality_flags: [...config.includedFeedQualityFlags],
    target_feed_rate_pct_of_biomass: config.targetFeedRatePctOfBiomass,
    max_feed_adjustment_ratio: config.maxFeedAdjustmentRatio,
    do_low_margin_mg_l: config.doLowMarginMgL,
    do_high_margin_mg_l: config.doHighMarginMgL,
    high_water_temp_c: config.highWaterTempC,
  }
}
