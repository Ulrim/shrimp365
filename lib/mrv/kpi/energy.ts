/**
 * Energy Intensity (EI) — MASTER 3.2 ① 산식 구현.
 *
 * EI = 기간 내 총 전력사용량(kWh) / 기간 내 생산량(kg) = Σ(power_kWh) / Δbiomass_kg
 * 단위: kWh/kg. 총전력 EI(eiTotal)와 폭기전력 EI(eiAeration)를 동시에 산출한다.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/energy.py
 * ★ 이 모듈은 산식의 단일 진실 공급원이다. API/화면 어디에도 산식을 중복하지 말 것.
 * 순수·결정론: 동일 입력 → 동일 출력. now()/난수/외부 상태 금지.
 * 입력 전제: PowerReading.kwh 는 ADR 0001 로 이미 interval kWh 로 정규화되어 있다.
 */

import { isIncluded, requireFinite, requirePeriod, sortedUnique } from "./internal"
import { KpiValueError } from "./status"
import type { BiomassPoint, EiConfig, EiResult, PowerReading } from "./types"

/**
 * 총전력 EI 와 폭기전력 EI 를 동시에 산출(MASTER 3.2 ①). 순수·결정론.
 *
 * 규칙:
 *   - [periodStart, periodEnd) 범위 밖 또는 qualityFlag ∉ included 인 reading 은 제외.
 *   - totalPowerKwh    = 포함된 모든 reading.kwh 합.
 *   - aerationPowerKwh = 포함된 reading 중 isAeration=true 의 kwh 합.
 *   - biomassDeltaKg   = biomassEnd.biomassKg - biomassStart.biomassKg.
 *   - biomassDeltaKg <= config.minBiomassDeltaKg 이면 eiTotal/eiAeration = null
 *     (0/음수 나눗셈 방지: 생산량이 없거나 감소했으면 EI 는 정의되지 않음).
 *
 * 방어(데이터 정합):
 *   - 포함된 reading 의 kwh 나 생체량이 비유한(NaN/Infinity)이면 KpiValueError.
 *     비유한 값은 EI 를 조용히 오염(NaN 전파)시키므로 산출 자체를 거부한다.
 *   - periodStart >= periodEnd 이면 KpiValueError(빈/역전 기간).
 */
export function computeEi(
  powerReadings: readonly PowerReading[],
  biomassStart: BiomassPoint,
  biomassEnd: BiomassPoint,
  periodStart: Date,
  periodEnd: Date,
  config: EiConfig,
  configVersion: string,
): EiResult {
  requirePeriod(periodStart, periodEnd)

  for (const point of [biomassStart, biomassEnd]) {
    if (!Number.isFinite(point.biomassKg)) {
      throw new KpiValueError(
        `biomassKg must be finite, got ${point.biomassKg} (ref=${point.sourceRef})`,
      )
    }
  }

  let totalPowerKwh = 0.0
  let aerationPowerKwh = 0.0
  let includedCount = 0
  let excludedCount = 0
  const includedMeterIds = new Set<string>()

  for (const reading of powerReadings) {
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
    if (!Number.isFinite(reading.kwh)) {
      throw new KpiValueError(
        `included reading has non-finite kwh: meterId=${reading.meterId} ` +
          `ts=${reading.ts.toISOString()} kwh=${reading.kwh}`,
      )
    }
    includedCount += 1
    totalPowerKwh += reading.kwh
    if (reading.isAeration) aerationPowerKwh += reading.kwh
    includedMeterIds.add(reading.meterId)
  }

  const biomassDeltaKg = biomassEnd.biomassKg - biomassStart.biomassKg

  let eiTotal: number | null
  let eiAeration: number | null
  if (biomassDeltaKg <= config.minBiomassDeltaKg) {
    // 산출 불가: 생산량이 없거나(0) 감소(음수)했거나 임계 미달.
    eiTotal = null
    eiAeration = null
  } else {
    eiTotal = totalPowerKwh / biomassDeltaKg
    eiAeration = aerationPowerKwh / biomassDeltaKg
  }

  return {
    eiTotal,
    eiAeration,
    totalPowerKwh,
    aerationPowerKwh,
    biomassStartKg: biomassStart.biomassKg,
    biomassEndKg: biomassEnd.biomassKg,
    biomassDeltaKg,
    periodStart,
    periodEnd,
    includedReadingCount: includedCount,
    excludedReadingCount: excludedCount,
    sourceMeterIds: sortedUnique(includedMeterIds),
    sourceBiomassRefs: [biomassStart.sourceRef, biomassEnd.sourceRef],
    configVersion,
  }
}

// requireFinite 는 다른 엔진 모듈과 시그니처를 맞추기 위해 재노출한다(내부 전용).
export { requireFinite }
