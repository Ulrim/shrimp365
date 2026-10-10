/**
 * Oxygen Efficiency Index (OEI) — MASTER 3.2 ② 산식 구현. ★ ADR 0003 전제.
 *
 * OEI = (DO 목표대역 유지율) / (생산 kg당 폭기 전력)
 *     = (t_in_band / t_total) / (aeration_kWh / biomass_kg)  → 0~100 지수로 스케일링
 * 높을수록 우수. MASTER 3.2 ② 가 명시한 '제안값'이며, 실증 1단계에서 스케일 계수를
 * OeiConfig.oeiScaleFactor 로 보정한다(산식 코드 불변, kpi_config version↑ — ADR 0003).
 *
 * DO 유지율 산정 규약(ADR 0003 Accepted):
 *   - v1 = 유효 샘플 개수 비율(sample-count fraction). 정렬/보간 없는 순수·결정론.
 *     doInBandFraction = (대역 내 유효 샘플 수) / (전체 유효 샘플 수).
 *   - 'time_weighted' 방식은 OeiConfig.doBandMethod 로 예약(불규칙 샘플 확인 시 version↑).
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/oxygen.py
 */

import { isIncluded, requirePeriod, sortedUnique } from "./internal"
import { KpiValueError } from "./status"
import type {
  BiomassPoint,
  DoBand,
  DoReading,
  OeiConfig,
  OeiResult,
  PowerReading,
} from "./types"

/**
 * MASTER 3.2 ② (제안 산식). 순수·결정론. 상세 규약은 ADR 0003.
 *
 * 산출:
 *   - doInBandFraction = (대역 내 유효 샘플 수) / (전체 유효 샘플 수)  [ADR 0003 v1]
 *     대역 내 = band.doMin <= doMgL <= band.doMax (양끝 포함).
 *   - aerationPowerKwh = 포함된 isAeration reading.kwh 합.
 *   - biomassDeltaKg = biomassEnd - biomassStart.
 *   - oeiRaw = doInBandFraction / (aerationPowerKwh / biomassDeltaKg).
 *   - oei = min(oeiRaw * oeiScaleFactor, clampMax)  (0~clampMax 지수).
 *
 * 경계(→ null): 유효 DO 샘플 0 / aerationPowerKwh=0 / biomassDelta<=minBiomassKg.
 * 방어(→ KpiValueError): band.doMin>=band.doMax / 비유한 입력 / period 역전.
 */
export function computeOei(
  doReadings: readonly DoReading[],
  aerationReadings: readonly PowerReading[], // isAeration=true 만 유효
  biomassStart: BiomassPoint,
  biomassEnd: BiomassPoint,
  band: DoBand,
  periodStart: Date,
  periodEnd: Date,
  config: OeiConfig,
  configVersion: string,
): OeiResult {
  requirePeriod(periodStart, periodEnd)

  // band 방어: 비유한 + 역전(하한 >= 상한)은 대역 정의 불가.
  if (!Number.isFinite(band.doMin) || !Number.isFinite(band.doMax)) {
    throw new KpiValueError(
      `DO band bounds must be finite: doMin=${band.doMin} doMax=${band.doMax}`,
    )
  }
  if (band.doMin >= band.doMax) {
    throw new KpiValueError(
      `band.doMin must be strictly less than band.doMax: ${band.doMin} >= ${band.doMax}`,
    )
  }

  for (const point of [biomassStart, biomassEnd]) {
    if (!Number.isFinite(point.biomassKg)) {
      throw new KpiValueError(
        `biomassKg must be finite, got ${point.biomassKg} (ref=${point.sourceRef})`,
      )
    }
  }

  // --- DO 유지율 (개수 비율, ADR 0003 v1) ---
  let doTotalSamples = 0
  let doInBandSamples = 0
  let doExcludedSamples = 0
  const doMeterIds = new Set<string>()

  for (const reading of doReadings) {
    if (
      !isIncluded(
        reading.ts,
        reading.qualityFlag,
        config.includedQualityFlags,
        periodStart,
        periodEnd,
      )
    ) {
      doExcludedSamples += 1
      continue
    }
    if (!Number.isFinite(reading.doMgL)) {
      throw new KpiValueError(
        `included DO reading has non-finite doMgL: meterId=${reading.meterId} ` +
          `ts=${reading.ts.toISOString()} doMgL=${reading.doMgL}`,
      )
    }
    doTotalSamples += 1
    doMeterIds.add(reading.meterId)
    if (band.doMin <= reading.doMgL && reading.doMgL <= band.doMax) {
      doInBandSamples += 1
    }
  }

  // --- 폭기 전력(분모 항) — isAeration=false 는 기여하지 않으므로 제외 ---
  let aerationPowerKwh = 0.0
  const aerationMeterIds = new Set<string>()
  for (const reading of aerationReadings) {
    if (!reading.isAeration) continue
    if (
      !isIncluded(
        reading.ts,
        reading.qualityFlag,
        config.includedQualityFlags,
        periodStart,
        periodEnd,
      )
    ) {
      continue
    }
    if (!Number.isFinite(reading.kwh)) {
      throw new KpiValueError(
        `included aeration reading has non-finite kwh: meterId=${reading.meterId} ` +
          `ts=${reading.ts.toISOString()} kwh=${reading.kwh}`,
      )
    }
    aerationPowerKwh += reading.kwh
    aerationMeterIds.add(reading.meterId)
  }

  const biomassDeltaKg = biomassEnd.biomassKg - biomassStart.biomassKg

  // --- 유지율/OEI 산출 (경계 → null) ---
  const doInBandFraction =
    doTotalSamples === 0 ? null : doInBandSamples / doTotalSamples

  let oeiRaw: number | null
  let oei: number | null
  if (
    doInBandFraction === null ||
    aerationPowerKwh === 0.0 ||
    biomassDeltaKg <= config.minBiomassKg
  ) {
    // 산출 불가: 유효 DO 0 / 폭기 전력 0(분모 정의 불가) / 생산 정규화 불가.
    oeiRaw = null
    oei = null
  } else {
    // oeiRaw = (t_in_band/t_total) / (aeration_kWh / biomass_kg)
    //        = doInBandFraction * biomassDeltaKg / aerationPowerKwh
    oeiRaw = (doInBandFraction * biomassDeltaKg) / aerationPowerKwh
    const scaled = oeiRaw * config.oeiScaleFactor
    // clampMax 상한만 적용(0~clampMax 지수). 하한은 산식상 자연히 >= 0.
    oei = scaled <= config.clampMax ? scaled : config.clampMax
  }

  return {
    oei,
    doInBandFraction,
    doTotalSamples,
    doInBandSamples,
    doExcludedSamples,
    aerationPowerKwh,
    biomassDeltaKg,
    bandMin: band.doMin,
    bandMax: band.doMax,
    oeiRaw,
    scaleFactor: config.oeiScaleFactor,
    method: config.doBandMethod,
    periodStart,
    periodEnd,
    sourceDoMeterIds: sortedUnique(doMeterIds),
    sourceAerationMeterIds: sortedUnique(aerationMeterIds),
    sourceBiomassRefs: [biomassStart.sourceRef, biomassEnd.sourceRef],
    configVersion,
  }
}
