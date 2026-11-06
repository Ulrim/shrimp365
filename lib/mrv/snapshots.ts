/**
 * kpi_snapshots 영속화 — 원본 `apps/api/app/services/snapshots.py` 의 이식본.
 *
 * append-only: 생성만 하고 수정하지 않는다. writer 는 기준선 잠금·MRV 리포트 생성이며,
 * live KPI 조회(GET /kpi)는 스냅샷을 만들지 않는다.
 *
 * inputs_json/provenance_json 에 각 산출 결과의 근거 필드를 그대로 직렬화한다 —
 * 리포트의 모든 숫자가 원천 계측값까지 역추적 가능해야 한다는 요구가 이 형태의 이유다.
 *
 * ★ 산식과 무관하다. 이미 산출된 결과(SiteKpiComputation)를 직렬화만 한다.
 */

import { T, newId, type MrvDb } from "./db"
import type { SiteKpiComputation } from "./kpi-service"

function eiInputs(comp: SiteKpiComputation) {
  const ei = comp.ei
  return {
    total_power_kwh: ei.totalPowerKwh,
    aeration_power_kwh: ei.aerationPowerKwh,
    biomass_start_kg: ei.biomassStartKg,
    biomass_end_kg: ei.biomassEndKg,
    biomass_delta_kg: ei.biomassDeltaKg,
    included_reading_count: ei.includedReadingCount,
    excluded_reading_count: ei.excludedReadingCount,
    /**
     * 산입된 전력이 **어떻게 얻어진 값인가**(실측/계산값/어림값/미기재).
     *
     * MRV 리포트는 이 집계를 `boundary_json` 에 따로 얼려 넣지만, **기준선 스냅샷에는
     * 그 boundary 가 없다.** 잠긴 기준선은 불변이고 이후 모든 감축량의 원점이 되므로,
     * "그 원점의 전력이 계량기 실측이었나" 를 되짚을 기록이 스냅샷에 남아야 한다 —
     * 이 칸이 그 유일한 자리다. 옛 스냅샷에는 이 칸이 없다(없는 것은 없는 대로 둔다).
     */
    measurement_basis: comp.eiMeasurementBasis,
    /**
     * 분모로 쓰인 생체량 두 점이 **어떻게 얻어진 값인가**(실측 출하·계측량/계산생체량/
     * 어림값/미기재).
     *
     * 위 `measurement_basis` 와 **같은 이유**로 여기 있다. 그쪽이 분자(전력)에 대해 하는
     * 일을 이것이 분모(생산량)에 대해 한다 — 잠긴 기준선은 불변이고 이후 모든 전·후
     * 비교의 원점이므로, "그 원점의 생산량이 저울에 올린 출하량이었나" 를 되짚을 기록이
     * 스냅샷에 남아야 한다. 옛 스냅샷에는 이 칸이 없다(없는 것은 없는 대로 둔다).
     */
    biomass_basis: comp.eiBiomassBasis,
  }
}

function fcrInputs(comp: SiteKpiComputation) {
  const fcr = comp.fcr
  return {
    total_feed_kg: fcr.totalFeedKg,
    biomass_start_kg: fcr.biomassStartKg,
    biomass_end_kg: fcr.biomassEndKg,
    biomass_delta_kg: fcr.biomassDeltaKg,
    included_feed_count: fcr.includedFeedCount,
    excluded_feed_count: fcr.excludedFeedCount,
  }
}

function oeiInputs(comp: SiteKpiComputation) {
  const oei = comp.oei
  if (oei === null) return null
  return {
    do_in_band_fraction: oei.doInBandFraction,
    do_total_samples: oei.doTotalSamples,
    do_in_band_samples: oei.doInBandSamples,
    do_excluded_samples: oei.doExcludedSamples,
    aeration_power_kwh: oei.aerationPowerKwh,
    biomass_delta_kg: oei.biomassDeltaKg,
    band_min: oei.bandMin,
    band_max: oei.bandMax,
    oei_raw: oei.oeiRaw,
    scale_factor: oei.scaleFactor,
    method: oei.method,
  }
}

function mortalityInputs(comp: SiteKpiComputation) {
  const mort = comp.mortality
  return {
    cumulative_rate_pct: mort.cumulativeRatePct,
    total_dead_count: mort.totalDeadCount,
    stocked_count: mort.stockedCount,
    daily: mort.daily.map((d) => ({
      date: d.date,
      dead_count: d.deadCount,
      daily_rate_pct: d.dailyRatePct,
    })),
    moving_avg: mort.movingAvg.map((p) => ({
      date: p.date,
      ma_rate_pct: p.maRatePct,
    })),
  }
}

/** SiteKpiComputation 을 kpi_snapshots 에 저장하고 snapshot_id 를 돌려준다. */
export async function persistKpiSnapshot(
  db: MrvDb,
  params: {
    siteId: string
    orgId: string
    periodStart: Date
    periodEnd: Date
    comp: SiteKpiComputation
  },
): Promise<string> {
  const { siteId, orgId, periodStart, periodEnd, comp } = params
  const snapshotId = newId("snap")
  const { ei, oei, mortality: mort } = comp

  const { error } = await db.from(T.kpiSnapshots).insert({
    id: snapshotId,
    site_id: siteId,
    tank_id: comp.tankId,
    org_id: orgId,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    ei_total: ei.eiTotal,
    ei_aeration: ei.eiAeration,
    oei: oei?.oei ?? null,
    fcr: comp.fcr.fcr,
    mortality_rate: mort.cumulativeRatePct,
    config_version: comp.configVersion,
    inputs_json: {
      ei: eiInputs(comp),
      fcr: fcrInputs(comp),
      oei: oeiInputs(comp),
      mortality: mortalityInputs(comp),
    },
    provenance_json: {
      source_meter_ids: [...ei.sourceMeterIds],
      source_biomass_refs: [...ei.sourceBiomassRefs],
      source_feed_refs: [...comp.fcr.sourceFeedRefs],
      source_do_meter_ids: oei ? [...oei.sourceDoMeterIds] : null,
      source_aeration_meter_ids: oei ? [...oei.sourceAerationMeterIds] : null,
      source_mortality_refs: [...mort.sourceRefs],
      stocked_count: mort.stockedCount,
      tank_id: comp.tankId,
    },
  })
  if (error) throw error
  return snapshotId
}
