/**
 * Mortality Rate (폐사율) — MASTER 3.2 ④ 산식 구현.
 *
 * 폐사율(%) = (기간 내 폐사 개체수 / 기초 입식 개체수) × 100
 * 누적 폐사율 / 일일 폐사율 / 7일 이동평균 모두 산출한다. 낮을수록 우수.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/mortality.py
 * ★ 이 모듈은 산식의 단일 진실 공급원이다. 순수·결정론.
 * 일/7일 시계열은 UTC 일 경계로 버킷팅한다.
 */

import { inPeriod, requirePeriod, sortedUnique, utcDate, utcDateMinusDays } from "./internal"
import { KpiValueError } from "./status"
import type {
  DailyMortality,
  MortalityConfig,
  MortalityReading,
  MortalityResult,
  MovingAvgPoint,
  UtcDate,
} from "./types"

/**
 * MASTER 3.2 ④ (폐사율). 순수·결정론.
 *
 * 규칙:
 *   - [periodStart, periodEnd) 밖 record 는 제외.
 *   - cumulativeRatePct = Σdead / stockedCount * 100.
 *   - stockedCount <= 0 → 모든 rate(cumulative/daily/ma) = null(0 나눗셈 방지).
 *   - daily: UTC 일 버킷 deadCount 합 → dailyRatePct(일자 오름차순).
 *   - movingAvg: 각 daily 일자에서 최근 windowDays(캘린더 일) dailyRate 평균.
 *     버킷이 없는 캘린더 일은 dead=0(rate=0)으로 간주 → 결정론적.
 *
 * 방어(데이터 정합):
 *   - deadCount 음수/비유한 → KpiValueError(폐사 개체수는 음수일 수 없음).
 *   - stockedCount 음수 → KpiValueError. (0 은 '산출 불가'로 null 처리, 오류 아님)
 *   - movingAvgWindowDays < 1 → KpiValueError.
 *   - periodStart >= periodEnd → KpiValueError(빈/역전 기간).
 */
export function computeMortality(
  mortalityReadings: readonly MortalityReading[],
  stockedCount: number,
  periodStart: Date,
  periodEnd: Date,
  config: MortalityConfig,
  configVersion: string,
): MortalityResult {
  requirePeriod(periodStart, periodEnd)
  if (stockedCount < 0) {
    throw new KpiValueError(`stockedCount must be >= 0, got ${stockedCount}`)
  }
  const windowDays = config.movingAvgWindowDays
  if (windowDays < 1) {
    throw new KpiValueError(`movingAvgWindowDays must be >= 1, got ${windowDays}`)
  }

  // UTC 일 버킷: date → deadCount 합. 결정론적(Map 조회는 순서 무관).
  const dailyBucket = new Map<UtcDate, number>()
  let totalDeadCount = 0
  const includedRefs = new Set<string>()

  for (const reading of mortalityReadings) {
    if (!inPeriod(reading.ts, periodStart, periodEnd)) continue
    const dc = reading.deadCount
    if (!Number.isFinite(dc)) {
      throw new KpiValueError(
        `deadCount must be finite: sourceRef=${reading.sourceRef} ` +
          `ts=${reading.ts.toISOString()} deadCount=${dc}`,
      )
    }
    if (dc < 0) {
      throw new KpiValueError(
        "deadCount must be >= 0 (physically impossible negative): " +
          `sourceRef=${reading.sourceRef} ts=${reading.ts.toISOString()} deadCount=${dc}`,
      )
    }
    const bucketDate = utcDate(reading.ts)
    dailyBucket.set(bucketDate, (dailyBucket.get(bucketDate) ?? 0) + dc)
    totalDeadCount += dc
    includedRefs.add(reading.sourceRef)
  }

  const haveStock = stockedCount > 0

  // --- 누적 폐사율 ---
  const cumulativeRatePct = haveStock ? (totalDeadCount / stockedCount) * 100.0 : null

  // --- 일일 시계열(일자 오름차순) ---
  const sortedDates = Array.from(dailyBucket.keys()).sort()
  const daily: DailyMortality[] = sortedDates.map((d) => {
    const dead = dailyBucket.get(d) ?? 0
    return {
      date: d,
      deadCount: dead,
      dailyRatePct: haveStock ? (dead / stockedCount) * 100.0 : null,
    }
  })

  // --- 이동평균: 각 daily 일자에서 최근 windowDays 캘린더 일 dailyRate 평균 ---
  // 평균(dailyRate over window) = (Σ window dead / stocked * 100) / windowDays.
  // 버킷 없는 캘린더 일은 dead=0 으로 결정론적으로 처리한다.
  const movingAvg: MovingAvgPoint[] = sortedDates.map((d) => {
    if (!haveStock) return { date: d, maRatePct: null }
    let windowDead = 0
    for (let k = 0; k < windowDays; k += 1) {
      windowDead += dailyBucket.get(utcDateMinusDays(d, k)) ?? 0
    }
    return {
      date: d,
      maRatePct: ((windowDead / stockedCount) * 100.0) / windowDays,
    }
  })

  return {
    cumulativeRatePct,
    totalDeadCount,
    stockedCount,
    daily,
    movingAvg,
    periodStart,
    periodEnd,
    sourceRefs: sortedUnique(includedRefs),
    configVersion,
  }
}
