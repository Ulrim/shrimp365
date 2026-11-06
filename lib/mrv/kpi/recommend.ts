/**
 * 추천(운전 레시피) 엔진 — MASTER 3.2 하단 "추천 로직", phase-2 슬라이스 K.
 *
 * 급이(feed)·산소(oxygen)·순환(circulation) 3종 룰 기반 추천을 산출한다.
 * 원본: mrv-platform/packages/kpi/culiver_kpi/recommend.py
 *
 * ★ 이 모듈은 추천 산식의 단일 진실 공급원이다. 순수·결정론(rationale 문자열까지 동일).
 * 근거 부족 시에도 에러 없이 값=null + rationale 사유로 반환(대시보드 "추천 불가" 표시용).
 *
 * --- 판정 규칙 요약(잠정, 실증 튜닝 대상 — RecommendConfig 로 파라미터화) ---
 *
 * 1) 급이(feedKgPerDay):
 *    - 필요 근거: feedHistory(기간 내 qualityFlag 포함분 1건 이상) + biomassLatestKg(>0).
 *      둘 중 하나라도 없으면 null.
 *    - recentAvgFeedKgPerDay = Σ(포함 feedKg) / 포함된 서로 다른 UTC 일수.
 *    - targetFeedKg = biomassLatestKg * config.targetFeedRatePctOfBiomass.
 *    - 최근 평균에서 목표 방향으로 이동하되, 1회 조정폭을 recentAvg 의
 *      ±config.maxFeedAdjustmentRatio 로 제한(급격한 변경 방지 — 실무적 안전장치).
 *    - feedKgPerDay = recentAvg + clamp(target - recentAvg, -cap, +cap).
 *
 * 2) 산소(oxygenTargetDoMgL):
 *    - 필요 근거: doLatest 존재. 없으면 null.
 *    - doLatest <= doBand.doMin + marginLow  → 목표를 doBand.doMax 로 상향
 *      (하한 근접 = 위험, 여유 확보를 위해 목표를 상단으로 올려 폭기 강화 유도).
 *    - doLatest >= doBand.doMax - marginHigh → 목표를 대역 중앙으로 하향
 *      (상한 근접 = 과폭기 가능성, 에너지 절감).
 *    - 그 외(대역 중앙권) → 목표를 대역 하한으로 유지(불필요한 과폭기 방지).
 *
 * 3) 순환(circulationSetting): 'normal' | 'increase' | 'reduce'.
 *    - 필요 근거: waterTempLatest 또는 doLatest 중 하나라도 있어야 함. 둘 다 없으면 null.
 *    - waterTempLatest >= config.highWaterTempC → 'increase'(고수온, 최우선 판단).
 *    - 그 외 doLatest 존재 시: 하한 근접 → 'increase', 상한 근접 → 'reduce', 그 외 'normal'.
 *    - waterTempLatest 만 있고 doLatest 없고 고수온도 아니면 → 'normal'.
 */

import { clamp, fixed, utcDate } from "./internal"
import { KpiValueError } from "./status"
import type {
  CirculationSetting,
  DoBand,
  DoReading,
  FeedReading,
  RecommendConfig,
  RecommendationInput,
  RecommendationOutput,
  UtcDate,
} from "./types"

/** 급이 추천값 + rationale 조각 + sourceRefs. 근거 부족 시 (null, 사유, []). */
function recommendFeed(
  feedHistory: readonly FeedReading[],
  biomassLatestKg: number | null,
  periodStart: Date,
  periodEnd: Date,
  config: RecommendConfig,
): { value: number | null; rationale: string; refs: string[] } {
  const includedRefs = new Set<string>()
  const days = new Set<UtcDate>()
  let totalFeedKg = 0.0
  let includedCount = 0

  for (const reading of feedHistory) {
    if (!config.includedFeedQualityFlags.includes(reading.qualityFlag)) continue
    const t = reading.ts.getTime()
    if (t < periodStart.getTime() || t >= periodEnd.getTime()) continue
    if (!Number.isFinite(reading.feedKg)) {
      throw new KpiValueError(
        `included feed has non-finite feedKg: sourceRef=${reading.sourceRef} feedKg=${reading.feedKg}`,
      )
    }
    if (reading.feedKg < 0.0) {
      throw new KpiValueError(
        `included feed has negative feedKg: sourceRef=${reading.sourceRef} feedKg=${reading.feedKg}`,
      )
    }
    includedCount += 1
    includedRefs.add(reading.sourceRef)
    days.add(utcDate(reading.ts))
    totalFeedKg += reading.feedKg
  }

  const refs = Array.from(includedRefs).sort()

  if (includedCount === 0) {
    return { value: null, rationale: "최근 급이 이력이 없어 급이 추천을 산출할 수 없습니다.", refs }
  }
  if (
    biomassLatestKg === null ||
    !Number.isFinite(biomassLatestKg) ||
    biomassLatestKg <= 0.0
  ) {
    return {
      value: null,
      rationale: "최근 생체량 데이터가 없어 급이 추천을 산출할 수 없습니다.",
      refs,
    }
  }

  const dayCount = days.size
  const recentAvgFeedKgPerDay = totalFeedKg / dayCount
  const targetFeedKg = biomassLatestKg * config.targetFeedRatePctOfBiomass

  const cap = recentAvgFeedKgPerDay * config.maxFeedAdjustmentRatio
  const diff = clamp(targetFeedKg - recentAvgFeedKgPerDay, -cap, cap)
  const feedKgPerDay = recentAvgFeedKgPerDay + diff

  const rationale =
    `최근 ${dayCount}일 평균 급이량 ${fixed(recentAvgFeedKgPerDay, 2)}kg/일, ` +
    `생체량 ${fixed(biomassLatestKg, 2)}kg 기준 목표 급이율 ` +
    `${fixed(config.targetFeedRatePctOfBiomass * 100, 1)}%(=${fixed(targetFeedKg, 2)}kg/일) 대비 ` +
    `1회 조정폭 상한 ${fixed(config.maxFeedAdjustmentRatio * 100, 1)}%를 적용해 ` +
    `${fixed(feedKgPerDay, 2)}kg/일을 권장합니다.`

  return { value: feedKgPerDay, rationale, refs }
}

/** 산소(DO 목표) 추천값 + rationale 조각 + sourceRefs. 근거 부족 시 (null, 사유, []). */
function recommendOxygen(
  doLatest: DoReading | null,
  doBand: DoBand,
  config: RecommendConfig,
): { value: number | null; rationale: string; refs: string[] } {
  if (doLatest === null) {
    return {
      value: null,
      rationale: "현재 DO 계측값이 없어 산소 목표 추천을 산출할 수 없습니다.",
      refs: [],
    }
  }
  if (!Number.isFinite(doLatest.doMgL)) {
    throw new KpiValueError(`doLatest.doMgL must be finite, got ${doLatest.doMgL}`)
  }

  const refs = [doLatest.meterId]
  const doMgL = doLatest.doMgL

  if (doMgL <= doBand.doMin + config.doLowMarginMgL) {
    const target = doBand.doMax
    return {
      value: target,
      rationale:
        `현재 DO ${fixed(doMgL, 2)}mg/L 가 목표대역 하한(${fixed(doBand.doMin, 2)}mg/L) 근접(여유폭 ` +
        `${fixed(config.doLowMarginMgL, 2)}mg/L 이내)이므로 안전 여유 확보를 위해 목표를 ` +
        `상한 ${fixed(target, 2)}mg/L 로 상향 조정합니다.`,
      refs,
    }
  }
  if (doMgL >= doBand.doMax - config.doHighMarginMgL) {
    const target = (doBand.doMin + doBand.doMax) / 2.0
    return {
      value: target,
      rationale:
        `현재 DO ${fixed(doMgL, 2)}mg/L 가 목표대역 상한(${fixed(doBand.doMax, 2)}mg/L) 근접(여유폭 ` +
        `${fixed(config.doHighMarginMgL, 2)}mg/L 이내)이므로 과폭기 방지를 위해 목표를 ` +
        `대역 중앙 ${fixed(target, 2)}mg/L 로 하향 조정합니다.`,
      refs,
    }
  }
  const target = doBand.doMin
  return {
    value: target,
    rationale:
      `현재 DO ${fixed(doMgL, 2)}mg/L 가 목표대역 중앙권이므로 불필요한 과폭기를 방지하기 ` +
      `위해 목표를 대역 하한 ${fixed(target, 2)}mg/L 로 유지합니다.`,
    refs,
  }
}

/** 순환 추천 + rationale 조각. 근거 부족 시 (null, 사유). */
function recommendCirculation(
  doLatest: DoReading | null,
  doBand: DoBand,
  waterTempLatest: number | null,
  config: RecommendConfig,
): { value: CirculationSetting | null; rationale: string } {
  if (doLatest === null && waterTempLatest === null) {
    return {
      value: null,
      rationale: "현재 DO/수온 계측값이 모두 없어 순환 추천을 산출할 수 없습니다.",
    }
  }

  if (waterTempLatest !== null) {
    if (!Number.isFinite(waterTempLatest)) {
      throw new KpiValueError(`waterTempLatest must be finite, got ${waterTempLatest}`)
    }
    if (waterTempLatest >= config.highWaterTempC) {
      return {
        value: "increase",
        rationale:
          `현재 수온 ${fixed(waterTempLatest, 2)}°C 가 고수온 기준` +
          `(${fixed(config.highWaterTempC, 2)}°C) 이상이므로 순환을 강화합니다.`,
      }
    }
  }

  if (doLatest !== null) {
    if (!Number.isFinite(doLatest.doMgL)) {
      throw new KpiValueError(`doLatest.doMgL must be finite, got ${doLatest.doMgL}`)
    }
    const doMgL = doLatest.doMgL
    if (doMgL <= doBand.doMin + config.doLowMarginMgL) {
      return {
        value: "increase",
        rationale: `현재 DO ${fixed(doMgL, 2)}mg/L 가 목표대역 하한 근접이므로 순환을 강화합니다.`,
      }
    }
    if (doMgL >= doBand.doMax - config.doHighMarginMgL) {
      return {
        value: "reduce",
        rationale: `현재 DO ${fixed(doMgL, 2)}mg/L 가 목표대역 상한 근접이므로 순환을 완화합니다.`,
      }
    }
  }

  return { value: "normal", rationale: "현재 수온/DO 가 안정 범위이므로 순환 설정을 유지합니다." }
}

/**
 * 급이·산소·순환 룰 기반 추천(MASTER 3.2 하단 "추천 로직"). 순수·결정론.
 *
 * 세 항목을 독립적으로 산출하고 각 rationale 문장을 이어붙여 전체 rationale 을 구성한다.
 * 모든 값 산출 불가 시에도 에러 없이 값 null + rationale 사유를 반환한다.
 *
 * 방어(데이터 정합):
 *   - periodStart >= periodEnd → KpiValueError(빈/역전 기간).
 *   - doBand.doMin >= doBand.doMax → KpiValueError(대역 정의 불가, oxygen.ts 규약 재사용).
 *   - 포함된 feedKg/DO/수온이 비유한 또는 feedKg 음수 → KpiValueError.
 */
export function computeRecommendation(
  inputs: RecommendationInput,
  config: RecommendConfig,
  configVersion: string,
): RecommendationOutput {
  if (inputs.periodStart.getTime() >= inputs.periodEnd.getTime()) {
    throw new KpiValueError(
      "periodStart must be strictly before periodEnd: " +
        `${inputs.periodStart.toISOString()} >= ${inputs.periodEnd.toISOString()}`,
    )
  }
  if (!Number.isFinite(inputs.doBand.doMin) || !Number.isFinite(inputs.doBand.doMax)) {
    throw new KpiValueError(
      `DO band bounds must be finite: doMin=${inputs.doBand.doMin} doMax=${inputs.doBand.doMax}`,
    )
  }
  if (inputs.doBand.doMin >= inputs.doBand.doMax) {
    throw new KpiValueError(
      "doBand.doMin must be strictly less than doBand.doMax: " +
        `${inputs.doBand.doMin} >= ${inputs.doBand.doMax}`,
    )
  }

  const feed = recommendFeed(
    inputs.feedHistory,
    inputs.biomassLatestKg,
    inputs.periodStart,
    inputs.periodEnd,
    config,
  )
  const oxygen = recommendOxygen(inputs.doLatest, inputs.doBand, config)
  const circulation = recommendCirculation(
    inputs.doLatest,
    inputs.doBand,
    inputs.waterTempLatest,
    config,
  )

  const rationale = [
    `[급이] ${feed.rationale}`,
    `[산소] ${oxygen.rationale}`,
    `[순환] ${circulation.rationale}`,
  ].join(" ")

  return {
    feedKgPerDay: feed.value,
    oxygenTargetDoMgL: oxygen.value,
    circulationSetting: circulation.value,
    rationale,
    sourceRefs: { feed: feed.refs, do: oxygen.refs },
    configVersion,
  }
}
