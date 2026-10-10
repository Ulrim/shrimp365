/**
 * Feed Conversion Ratio (FCR) — MASTER 3.2 ③ 산식 구현.
 *
 * FCR = 기간 내 총 급이량(kg) / 기간 내 증체량(kg) = Σ(feed_kg) / Δbiomass_kg
 * 단위: 무차원(kg/kg). 낮을수록 우수.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/feed.py
 * ★ 이 모듈은 산식의 단일 진실 공급원이다. 순수·결정론.
 * 분모 Δbiomass 는 EI(energy.ts)와 동일한 BiomassPoint 개념을 재사용한다.
 */

import { isIncluded, requirePeriod, sortedUnique } from "./internal"
import { KpiValueError } from "./status"
import type { BiomassPoint, FcrConfig, FcrResult, FeedReading } from "./types"

/**
 * 총 급이량 / Δ증체량 (MASTER 3.2 ③). 순수·결정론.
 *
 * 규칙:
 *   - [periodStart, periodEnd) 밖 또는 qualityFlag ∉ included 인 feed 는 제외.
 *   - totalFeedKg = 포함된 feed.feedKg 합.
 *   - biomassDeltaKg = biomassEnd - biomassStart.
 *   - biomassDeltaKg <= config.minBiomassDeltaKg → fcr = null
 *     (0/음수 나눗셈 방지: 생산량이 없거나 감소했으면 FCR 은 정의되지 않음).
 *
 * 방어(데이터 정합):
 *   - 포함된 feed 의 feedKg 가 비유한(NaN/Infinity)/음수 → KpiValueError
 *     (급이량은 물리적으로 음수일 수 없고, 비유한값은 조용히 FCR 을 오염시킨다).
 *   - 생체량이 비유한 → KpiValueError.
 *   - periodStart >= periodEnd → KpiValueError(빈/역전 기간).
 */
export function computeFcr(
  feedReadings: readonly FeedReading[],
  biomassStart: BiomassPoint,
  biomassEnd: BiomassPoint,
  periodStart: Date,
  periodEnd: Date,
  config: FcrConfig,
  configVersion: string,
): FcrResult {
  requirePeriod(periodStart, periodEnd)

  for (const point of [biomassStart, biomassEnd]) {
    if (!Number.isFinite(point.biomassKg)) {
      throw new KpiValueError(
        `biomassKg must be finite, got ${point.biomassKg} (ref=${point.sourceRef})`,
      )
    }
  }

  let totalFeedKg = 0.0
  let includedCount = 0
  let excludedCount = 0
  const includedFeedRefs = new Set<string>()

  for (const reading of feedReadings) {
    if (
      !isIncluded(
        reading.ts,
        reading.qualityFlag,
        config.includedQualityFlags,
        periodStart,
        periodEnd,
      )
    ) {
      excludedCount += 1
      continue
    }
    if (!Number.isFinite(reading.feedKg)) {
      throw new KpiValueError(
        `included feed has non-finite feedKg: sourceRef=${reading.sourceRef} ` +
          `ts=${reading.ts.toISOString()} feedKg=${reading.feedKg}`,
      )
    }
    if (reading.feedKg < 0.0) {
      throw new KpiValueError(
        "included feed has negative feedKg (physically impossible): " +
          `sourceRef=${reading.sourceRef} ts=${reading.ts.toISOString()} feedKg=${reading.feedKg}`,
      )
    }
    includedCount += 1
    totalFeedKg += reading.feedKg
    includedFeedRefs.add(reading.sourceRef)
  }

  const biomassDeltaKg = biomassEnd.biomassKg - biomassStart.biomassKg

  // 산출 불가: 생산량이 없거나(0) 감소(음수)했거나 임계 미달.
  const fcr =
    biomassDeltaKg <= config.minBiomassDeltaKg ? null : totalFeedKg / biomassDeltaKg

  return {
    fcr,
    totalFeedKg,
    biomassStartKg: biomassStart.biomassKg,
    biomassEndKg: biomassEnd.biomassKg,
    biomassDeltaKg,
    periodStart,
    periodEnd,
    includedFeedCount: includedCount,
    excludedFeedCount: excludedCount,
    sourceFeedRefs: sortedUnique(includedFeedRefs),
    sourceBiomassRefs: [biomassStart.sourceRef, biomassEnd.sourceRef],
    configVersion,
  }
}
