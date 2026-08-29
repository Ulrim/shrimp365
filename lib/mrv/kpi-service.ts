/**
 * kpi-service — DB 행을 KPI 엔진 입력으로 조립하고 4종 compute_* 를 호출한다.
 *
 * 원본: mrv-platform/apps/api/app/services/kpi_service.py
 *
 * ★ 산식은 여기서 절대 쓰지 않는다. `lib/mrv/kpi` 의 computeEi/computeFcr/computeOei/
 * computeMortality 를 호출만 한다. 이 파일의 책임은 순수한 '조립':
 *   1) DB 행(readings/meters/feed_logs/mortality_logs/batches/tanks/harvest/kpi_config)을
 *      엔진 입력 타입으로 변환,
 *   2) 4종 엔진 호출,
 *   3) 결과를 API 응답(KpiResponse)으로 매핑(status/inputs/provenance 포함).
 *
 * 결정론: generated_at 은 응답 메타데이터일 뿐 산출 입력이 아니다.
 */

import {
  DEFAULT_CONFIG_VERSION,
  alertingConfigFromParams,
  classifyMetricStatus,
  computeEi,
  computeFcr,
  computeMortality,
  computeOei,
  eiConfigFromParams,
  eiConfigToParams,
  fcrConfigFromParams,
  fcrConfigToParams,
  mortalityConfigFromParams,
  mortalityConfigToParams,
  oeiConfigFromParams,
  oeiConfigToParams,
  METRIC_DIRECTIONS,
} from "./kpi"
import type {
  BiomassPoint,
  DoBand,
  DoReading,
  EiResult,
  FcrResult,
  FeedReading,
  KpiThresholds,
  MortalityReading,
  MortalityResult,
  OeiResult,
  ParamsJson,
  PowerReading,
} from "./kpi"
import { T, fetchAll, type MrvDb } from "./db"
import type { KpiMetric, KpiResponse } from "./api-types"

// ---------------------------------------------------------------------------
// 조립 헬퍼
// ---------------------------------------------------------------------------

/**
 * 활성 kpi_config = effective_from 이 가장 최근인 행.
 * 행이 없으면 엔진 기본값 + DEFAULT_CONFIG_VERSION 으로 동작한다(빈 DB 에서도 산출은 된다).
 */
async function loadActiveKpiConfig(
  db: MrvDb,
): Promise<{ version: string; params: ParamsJson }> {
  const { data, error } = await db
    .from(T.kpiConfig)
    .select("version, params_json")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as { version: string; params_json: ParamsJson } | null
  if (!row) return { version: DEFAULT_CONFIG_VERSION, params: {} }
  return { version: row.version, params: row.params_json ?? {} }
}

/** 지표 슬롯 생성. 신호등 판정은 엔진(classifyMetricStatus)에만 맡긴다. */
function metric(
  value: number | null,
  unit: string,
  metricKey: keyof KpiThresholds,
  thresholds: KpiThresholds,
): KpiMetric {
  return {
    value,
    unit,
    status: classifyMetricStatus(value, METRIC_DIRECTIONS[metricKey], thresholds[metricKey]),
  }
}

type HarvestRow = { id: string; ts: string; biomass_kg: number }

/**
 * 기간 내 harvest_logs(시각 오름차순)에서 개시/마감 생체량 시점을 고른다.
 *   - 2행 이상: 가장 이른 시점=개시, 가장 늦은 시점=마감.
 *   - 1행: 개시=마감 → delta=0 → 산출 불가(엔진이 null 을 낸다).
 *   - 0행: 둘 다 0kg 더미 → 산출 불가.
 * 결정론적이며, 산식이 아니라 '데이터 선택'이다.
 */
function pickBiomassBounds(harvests: HarvestRow[]): [BiomassPoint, BiomassPoint] {
  if (harvests.length >= 2) {
    const first = harvests[0]
    const last = harvests[harvests.length - 1]
    return [
      { ts: new Date(first.ts), biomassKg: first.biomass_kg, sourceRef: first.id },
      { ts: new Date(last.ts), biomassKg: last.biomass_kg, sourceRef: last.id },
    ]
  }
  if (harvests.length === 1) {
    const only = harvests[0]
    const point: BiomassPoint = {
      ts: new Date(only.ts),
      biomassKg: only.biomass_kg,
      sourceRef: only.id,
    }
    return [point, point]
  }
  const empty: BiomassPoint = { ts: new Date(0), biomassKg: 0.0, sourceRef: "none" }
  return [empty, empty]
}

/** 4종 KPI 원본 산출 결과 묶음(응답/스냅샷 공용). */
export type SiteKpiComputation = {
  ei: EiResult
  fcr: FcrResult
  /** tank 의 DO 목표대역이 설정돼 있지 않으면 null(= OEI 산출 대상 아님). */
  oei: OeiResult | null
  mortality: MortalityResult
  configVersion: string
  paramsOut: ParamsJson
  tankId: string | null
}

/**
 * site 의 4종 KPI(EI/FCR/OEI/mortality)를 기간 [from, to) 로 산출한다.
 * ⚠ 호출 전에 resolveSiteForOrg 로 site 소유권이 검증되어 있어야 한다.
 */
export async function computeSiteKpiResults(
  db: MrvDb,
  siteId: string,
  periodFrom: Date,
  periodTo: Date,
): Promise<SiteKpiComputation> {
  const { version: configVersion, params } = await loadActiveKpiConfig(db)

  const eiConfig = eiConfigFromParams(params)
  const fcrConfig = fcrConfigFromParams(params)
  const oeiConfig = oeiConfigFromParams(params)
  const mortalityConfig = mortalityConfigFromParams(params)

  // 응답에 실어 보낼 파라미터 문서. DB 에 설정이 없으면 엔진 기본값을 직렬화해 보여 준다
  // (화면이 "어떤 파라미터로 계산했는가"를 항상 표시할 수 있어야 한다).
  const paramsOut: ParamsJson =
    Object.keys(params).length > 0
      ? { ...params }
      : {
          ei: eiConfigToParams(eiConfig),
          fcr: fcrConfigToParams(fcrConfig),
          oei: oeiConfigToParams(oeiConfig),
          mortality: mortalityConfigToParams(mortalityConfig),
        }

  // --- 계측기와 계측값 ---
  const meters = await fetchAll<{ id: string; type: string; is_aeration: boolean }>(
    (f, t) =>
      db.from(T.meters).select("id, type, is_aeration").eq("site_id", siteId).range(f, t),
  )
  const meterType = new Map(meters.map((m) => [m.id, m.type]))
  const aerationByMeter = new Map(meters.map((m) => [m.id, m.is_aeration]))
  const meterIds = meters.map((m) => m.id)

  const powerReadings: PowerReading[] = []
  const doReadings: DoReading[] = []
  if (meterIds.length > 0) {
    const rows = await fetchAll<{
      time: string
      meter_id: string
      value: number
      quality_flag: string
    }>((f, t) =>
      db
        .from(T.readings)
        .select("time, meter_id, value, quality_flag")
        .in("meter_id", meterIds)
        .gte("time", periodFrom.toISOString())
        .lte("time", periodTo.toISOString())
        .order("time", { ascending: true })
        .range(f, t),
    )
    for (const r of rows) {
      const mtype = meterType.get(r.meter_id)
      if (mtype === "power") {
        powerReadings.push({
          meterId: r.meter_id,
          ts: new Date(r.time),
          kwh: r.value,
          isAeration: Boolean(aerationByMeter.get(r.meter_id)),
          qualityFlag: r.quality_flag,
        })
      } else if (mtype === "do") {
        doReadings.push({
          meterId: r.meter_id,
          ts: new Date(r.time),
          doMgL: r.value,
          qualityFlag: r.quality_flag,
        })
      }
    }
  }

  // --- 생체량(EI/FCR 분모) ---
  const harvests = await fetchAll<HarvestRow>((f, t) =>
    db
      .from(T.harvestLogs)
      .select("id, ts, biomass_kg")
      .eq("site_id", siteId)
      .gte("ts", periodFrom.toISOString())
      .lte("ts", periodTo.toISOString())
      .order("ts", { ascending: true })
      .range(f, t),
  )
  const [biomassStart, biomassEnd] = pickBiomassBounds(harvests)

  // --- 배치와 수기 기록 ---
  const tanks = await fetchAll<{
    id: string
    target_do_min: number | null
    target_do_max: number | null
  }>((f, t) =>
    db
      .from(T.tanks)
      .select("id, target_do_min, target_do_max")
      .eq("site_id", siteId)
      .order("id", { ascending: true })
      .range(f, t),
  )
  const tankIds = tanks.map((t) => t.id)

  let batches: { id: string; stocked_count: number }[] = []
  if (tankIds.length > 0) {
    batches = await fetchAll<{ id: string; stocked_count: number }>((f, t) =>
      db.from(T.batches).select("id, stocked_count").in("tank_id", tankIds).range(f, t),
    )
  }
  const batchIds = batches.map((b) => b.id)
  const stockedCount = batches.reduce((acc, b) => acc + Number(b.stocked_count), 0)

  const feedReadings: FeedReading[] = []
  const mortalityReadings: MortalityReading[] = []
  if (batchIds.length > 0) {
    const feedRows = await fetchAll<{
      id: string
      batch_id: string
      ts: string
      feed_kg: number
      quality_flag: string
    }>((f, t) =>
      db
        .from(T.feedLogs)
        .select("id, batch_id, ts, feed_kg, quality_flag")
        .in("batch_id", batchIds)
        .order("ts", { ascending: true })
        .range(f, t),
    )
    for (const f of feedRows) {
      feedReadings.push({
        sourceRef: f.id,
        batchId: f.batch_id,
        ts: new Date(f.ts),
        feedKg: f.feed_kg,
        qualityFlag: f.quality_flag,
      })
    }

    const mortRows = await fetchAll<{
      id: string
      batch_id: string
      ts: string
      dead_count: number
    }>((f, t) =>
      db
        .from(T.mortalityLogs)
        .select("id, batch_id, ts, dead_count")
        .in("batch_id", batchIds)
        .order("ts", { ascending: true })
        .range(f, t),
    )
    for (const m of mortRows) {
      mortalityReadings.push({
        sourceRef: m.id,
        batchId: m.batch_id,
        ts: new Date(m.ts),
        deadCount: m.dead_count,
      })
    }
  }

  // DO 목표대역이 설정된 첫 수조를 OEI 기준으로 삼는다(id 오름차순 — 결정론적 선택).
  let band: DoBand | null = null
  let tankId: string | null = null
  for (const t of tanks) {
    if (t.target_do_min !== null && t.target_do_max !== null) {
      band = { doMin: t.target_do_min, doMax: t.target_do_max }
      tankId = t.id
      break
    }
  }

  const ei = computeEi(
    powerReadings,
    biomassStart,
    biomassEnd,
    periodFrom,
    periodTo,
    eiConfig,
    configVersion,
  )
  const fcr = computeFcr(
    feedReadings,
    biomassStart,
    biomassEnd,
    periodFrom,
    periodTo,
    fcrConfig,
    configVersion,
  )
  const mortality = computeMortality(
    mortalityReadings,
    stockedCount,
    periodFrom,
    periodTo,
    mortalityConfig,
    configVersion,
  )
  const oei =
    band === null
      ? null
      : computeOei(
          doReadings,
          powerReadings,
          biomassStart,
          biomassEnd,
          band,
          periodFrom,
          periodTo,
          oeiConfig,
          configVersion,
        )

  return { ei, fcr, oei, mortality, configVersion, paramsOut, tankId }
}

/**
 * site 의 4종 KPI 를 산출해 API 응답으로 감싼다.
 * live read-only 계산이므로 provenance.kpi_snapshot_id 는 null 이다
 * (영속화는 기준선 잠금·스냅샷 경로에서만 일어난다).
 */
export async function computeSiteKpi(
  db: MrvDb,
  siteId: string,
  orgId: string,
  periodFrom: Date,
  periodTo: Date,
): Promise<KpiResponse> {
  const comp = await computeSiteKpiResults(db, siteId, periodFrom, periodTo)
  return kpiComputationToResponse(comp, siteId, orgId, periodFrom, periodTo)
}

/** SiteKpiComputation → KpiResponse. 기준선/리포트 경로도 이 매핑을 재사용한다. */
export function kpiComputationToResponse(
  comp: SiteKpiComputation,
  siteId: string,
  orgId: string,
  periodFrom: Date,
  periodTo: Date,
): KpiResponse {
  const { ei, fcr, oei, mortality: mort } = comp
  const thresholds = alertingConfigFromParams(comp.paramsOut).thresholds

  return {
    site_id: siteId,
    org_id: orgId,
    period: {
      from: periodFrom.toISOString(),
      to: periodTo.toISOString(),
      granularity: "period",
    },
    kpi_config: { version: comp.configVersion, params: comp.paramsOut },
    metrics: {
      ei_total: metric(ei.eiTotal, "kWh/kg", "ei_total", thresholds),
      ei_aeration: metric(ei.eiAeration, "kWh/kg", "ei_aeration", thresholds),
      oei: metric(oei?.oei ?? null, "index", "oei", thresholds),
      fcr: metric(fcr.fcr, "kg/kg", "fcr", thresholds),
      mortality_rate: metric(mort.cumulativeRatePct, "%", "mortality_rate", thresholds),
    },
    inputs: {
      total_power_kwh: ei.totalPowerKwh,
      aeration_power_kwh: ei.aerationPowerKwh,
      biomass_start_kg: ei.biomassStartKg,
      biomass_end_kg: ei.biomassEndKg,
      biomass_delta_kg: ei.biomassDeltaKg,
      included_reading_count: ei.includedReadingCount,
      excluded_reading_count: ei.excludedReadingCount,
    },
    provenance: {
      source_meter_ids: [...ei.sourceMeterIds],
      source_biomass_refs: [...ei.sourceBiomassRefs],
      kpi_snapshot_id: null,
    },
    mortality_daily: mort.daily.map((d) => ({
      date: d.date,
      dead_count: d.deadCount,
      daily_rate_pct: d.dailyRatePct,
    })),
    mortality_moving_avg: mort.movingAvg.map((p) => ({
      date: p.date,
      ma_rate_pct: p.maRatePct,
    })),
    generated_at: new Date().toISOString(),
  }
}
