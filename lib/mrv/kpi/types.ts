/**
 * KPI 엔진 입출력 계약.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/types.py
 * 모든 타입은 읽기 전용(readonly)으로 두어 산출 중 상태 변형을 원천 차단한다.
 *
 * 경계 규약:
 * - 입력 전력값(PowerReading.kwh)은 ADR 0001 에 따라 **이미 interval kWh 로 정규화**된 값이다.
 *   → 엔진은 정렬/차분/롤오버/보간 없이 순수 합산만 한다(결정론).
 * - 모든 기간 필터는 [periodStart, periodEnd) 반열림(end 미포함)이다. 인접 기간 경계에서
 *   같은 계측값이 두 번 집계되지 않게 하기 위함이며 전 지표가 이 규약을 공유한다.
 */

import type { KpiThresholds } from "./status"
import { DEFAULT_KPI_THRESHOLDS } from "./status"

/** UTC 기준 일자를 "YYYY-MM-DD" 문자열로 표현한다(결정론적 버킷 키 + 직렬화 무손실). */
export type UtcDate = string

// ============================================================================
// 공통 입력
// ============================================================================

/** 단일 전력 계측값. 근거 추적(readings→meters)이 가능하도록 meterId 를 보존한다. */
export type PowerReading = {
  /** 근거 추적용 ID (readings→meters 역추적, drill-down) */
  readonly meterId: string
  /** 계측 시각(UTC). 기간 필터 [start, end) 판단용 */
  readonly ts: Date
  /** 계측 간격 증분 전력량(kWh). ADR 0001 로 정규화된 값 */
  readonly kwh: number
  /** 폭기(블로워) 서브미터 여부 → eiAeration 분자 구분 */
  readonly isAeration: boolean
  /** 데이터 정합 플래그: 'ok' | 'suspect' | 'bad' */
  readonly qualityFlag: string
}

/** 생체량 시점값. EI 분모 Δbiomass 의 개시/마감 근거. */
export type BiomassPoint = {
  readonly ts: Date
  /** 시점 생체량(kg) */
  readonly biomassKg: number
  /** 근거 참조 ID (harvest_logs.id 등) — drill-down 용 */
  readonly sourceRef: string
}

// ============================================================================
// EI — Energy Intensity (MASTER 3.2 ①)
// ============================================================================

/** EI 산출 파라미터. kpi_config.params_json.ei 에서 로드된다. */
export type EiConfig = {
  /** KPI 에 포함할 qualityFlag 화이트리스트. 기본은 'ok' 만. */
  readonly includedQualityFlags: readonly string[]
  /** 이 값 이하의 biomassDelta 는 산출 불가(0 나눗셈 방지). */
  readonly minBiomassDeltaKg: number
}

export const DEFAULT_EI_CONFIG: EiConfig = {
  includedQualityFlags: ["ok"],
  minBiomassDeltaKg: 0.0,
}

/**
 * EI 산출 결과 + 근거/중간값(검증 추적성).
 * eiTotal/eiAeration 이 null 이면 '산출 불가'(biomassDelta <= min).
 * 나머지 필드는 항상 채워져 원천 reading 까지 역추적(drill-down)이 가능하다.
 */
export type EiResult = {
  // --- 산출 지표 (null = 산출 불가) ---
  readonly eiTotal: number | null // kWh/kg
  readonly eiAeration: number | null // kWh/kg
  // --- 산출 근거/중간값 ---
  readonly totalPowerKwh: number // 분자(총전력)
  readonly aerationPowerKwh: number // 분자(폭기전력)
  readonly biomassStartKg: number
  readonly biomassEndKg: number
  readonly biomassDeltaKg: number // 분모 Δbiomass
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly includedReadingCount: number
  readonly excludedReadingCount: number
  /** 근거 계측기 목록 (정렬·중복제거, drill-down) */
  readonly sourceMeterIds: readonly string[]
  /** 근거 생체량 참조 (개시/마감, drill-down) */
  readonly sourceBiomassRefs: readonly string[]
  /** 적용된 kpi_config.version */
  readonly configVersion: string
}

// ============================================================================
// FCR — Feed Conversion Ratio (MASTER 3.2 ③)
// ============================================================================

/** 단일 급이 기록. 근거 추적(feed_logs.id)이 가능하도록 sourceRef 를 보존한다. */
export type FeedReading = {
  readonly sourceRef: string
  readonly batchId: string
  readonly ts: Date
  /** 급이량(kg). 음수/비유한 불가(포함 시 KpiValueError) */
  readonly feedKg: number
  /** 데이터 정합 플래그(수기 입력 검증 결과). 기본 'ok' */
  readonly qualityFlag: string
}

export type FcrConfig = {
  readonly includedQualityFlags: readonly string[]
  readonly minBiomassDeltaKg: number
}

export const DEFAULT_FCR_CONFIG: FcrConfig = {
  includedQualityFlags: ["ok"],
  minBiomassDeltaKg: 0.0,
}

/** FCR 산출 결과 + 근거/중간값. fcr 이 null 이면 '산출 불가'. */
export type FcrResult = {
  readonly fcr: number | null // 무차원(kg/kg)
  readonly totalFeedKg: number // 분자 Σ(feedKg)
  readonly biomassStartKg: number
  readonly biomassEndKg: number
  readonly biomassDeltaKg: number
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly includedFeedCount: number
  readonly excludedFeedCount: number
  readonly sourceFeedRefs: readonly string[]
  readonly sourceBiomassRefs: readonly string[]
  readonly configVersion: string
}

// ============================================================================
// OEI — Oxygen Efficiency Index (MASTER 3.2 ②, ADR 0003)
// ============================================================================

/** 단일 용존산소(DO) 계측값. */
export type DoReading = {
  readonly meterId: string
  readonly ts: Date
  /** 용존산소(mg/L). 비유한 불가 */
  readonly doMgL: number
  readonly qualityFlag: string
}

/** DO 목표대역. tanks.target_do_min/max 근거. */
export type DoBand = {
  readonly doMin: number
  readonly doMax: number
}

export type OeiConfig = {
  readonly includedQualityFlags: readonly string[]
  /** Δbiomass 이하이면 OEI=null */
  readonly minBiomassKg: number
  /** ADR 0003: v1 은 개수 비율('sample_count'). 'time_weighted' 는 예약 */
  readonly doBandMethod: string
  /** ★ 제안 스케일 계수(실증 보정 대상, 보정 시 version↑) */
  readonly oeiScaleFactor: number
  /** 0~100 지수 상한 */
  readonly clampMax: number
}

export const DEFAULT_OEI_CONFIG: OeiConfig = {
  includedQualityFlags: ["ok"],
  minBiomassKg: 0.0,
  doBandMethod: "sample_count",
  oeiScaleFactor: 1.0,
  clampMax: 100.0,
}

/** OEI 산출 결과 + 근거/중간값. oei 가 null 이면 '산출 불가'. */
export type OeiResult = {
  readonly oei: number | null // 0~100
  readonly doInBandFraction: number | null // t_in_band/t_total (0~1)
  readonly doTotalSamples: number
  readonly doInBandSamples: number
  readonly doExcludedSamples: number
  readonly aerationPowerKwh: number
  readonly biomassDeltaKg: number
  readonly bandMin: number
  readonly bandMax: number
  /** 스케일 전 원값(검증 추적) */
  readonly oeiRaw: number | null
  readonly scaleFactor: number
  readonly method: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly sourceDoMeterIds: readonly string[]
  readonly sourceAerationMeterIds: readonly string[]
  readonly sourceBiomassRefs: readonly string[]
  readonly configVersion: string
}

// ============================================================================
// Mortality — 폐사율 (MASTER 3.2 ④)
// ============================================================================

/** 단일 폐사 기록. 근거 추적(mortality_logs.id). */
export type MortalityReading = {
  readonly sourceRef: string
  readonly batchId: string
  readonly ts: Date
  /** 폐사 개체수(음수 불가) */
  readonly deadCount: number
}

export type MortalityConfig = {
  /** 이동평균 창(기본 7일, MASTER 명시). day_boundary 는 UTC 고정(v1). */
  readonly movingAvgWindowDays: number
}

export const DEFAULT_MORTALITY_CONFIG: MortalityConfig = {
  movingAvgWindowDays: 7,
}

/** 일일 폐사 집계(UTC 일 버킷). */
export type DailyMortality = {
  readonly date: UtcDate
  readonly deadCount: number
  /** deadCount/stockedCount*100. stocked<=0 → null */
  readonly dailyRatePct: number | null
}

/** 7일(창) 이동평균 점. */
export type MovingAvgPoint = {
  readonly date: UtcDate
  readonly maRatePct: number | null
}

/** 폐사율 산출 결과 + 근거/중간값. cumulativeRatePct 가 null 이면 '산출 불가'. */
export type MortalityResult = {
  readonly cumulativeRatePct: number | null
  readonly totalDeadCount: number
  readonly stockedCount: number
  /** 일자 오름차순 */
  readonly daily: readonly DailyMortality[]
  /** daily 와 동일 일자축 */
  readonly movingAvg: readonly MovingAvgPoint[]
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly sourceRefs: readonly string[]
  readonly configVersion: string
}

// ============================================================================
// Alerting / 신호등 파라미터
// ============================================================================

/**
 * 알림 임계치 + 신호등 임계값 파라미터. kpi_config.params_json.alerting 에서 로드.
 * doLowMgL/mortalitySpike*: 알림 배치가 소비하는 임계치 — 이 타입은 보관만 한다.
 */
export type AlertingConfig = {
  readonly doLowMgL: number
  readonly mortalitySpikeRatio: number
  readonly mortalitySpikeMinCount: number
  /** 'kpi_red' 알림이 감시할 지표 목록 */
  readonly kpiRedMetrics: readonly string[]
  readonly thresholds: KpiThresholds
}

export const DEFAULT_ALERTING_CONFIG: AlertingConfig = {
  doLowMgL: 3.0,
  mortalitySpikeRatio: 2.0,
  mortalitySpikeMinCount: 5,
  kpiRedMetrics: ["ei_total", "fcr", "mortality_rate", "oei"],
  thresholds: DEFAULT_KPI_THRESHOLDS,
}

// ============================================================================
// Recommendation — 추천(운전 레시피) 엔진
// ============================================================================

export type RecommendConfig = {
  // --- 급이(feed) ---
  readonly includedFeedQualityFlags: readonly string[]
  /** 목표 급이율(생체량 대비 일일 비율, 3% 기본) */
  readonly targetFeedRatePctOfBiomass: number
  /** 최근 평균 대비 1회 조정폭 상한(±5%) */
  readonly maxFeedAdjustmentRatio: number
  // --- 산소(oxygen) ---
  readonly doLowMarginMgL: number
  readonly doHighMarginMgL: number
  // --- 순환(circulation) ---
  /** 이 이상이면 순환 증가 권장(RAS 새우 고수온 스트레스 기준) */
  readonly highWaterTempC: number
}

export const DEFAULT_RECOMMEND_CONFIG: RecommendConfig = {
  includedFeedQualityFlags: ["ok"],
  targetFeedRatePctOfBiomass: 0.03,
  maxFeedAdjustmentRatio: 0.05,
  doLowMarginMgL: 0.3,
  doHighMarginMgL: 0.3,
  highWaterTempC: 30.0,
}

/** 추천 산출에 필요한 현재 상태(서비스가 조립; 산식은 여기 없음). */
export type RecommendationInput = {
  readonly doLatest: DoReading | null
  readonly doBand: DoBand
  readonly waterTempLatest: number | null
  readonly biomassLatestKg: number | null
  readonly feedHistory: readonly FeedReading[]
  readonly aerationPowerRecentKwh: number
  readonly periodStart: Date
  readonly periodEnd: Date
}

export type CirculationSetting = "normal" | "increase" | "reduce"

/** 추천 산출 결과. 값 필드가 null 이면 '추천 불가'(근거 부족) — 에러 아님. */
export type RecommendationOutput = {
  readonly feedKgPerDay: number | null
  readonly oxygenTargetDoMgL: number | null
  readonly circulationSetting: CirculationSetting | null
  /** 근거 설명(사람이 읽는 한국어 텍스트, 감사용) */
  readonly rationale: string
  /** 근거 drill-down(지표별 참조 ID) */
  readonly sourceRefs: Readonly<Record<string, readonly string[]>>
  readonly configVersion: string
}
