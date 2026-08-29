/**
 * readings-service — 대시보드 차트용 시계열 조회/집계.
 * 원본: mrv-platform/apps/api/app/services/readings_service.py
 *
 * ★ 이 응답의 value 는 **차트 표시 전용**이며 KPI 산식에 절대 투입되지 않는다.
 *   KPI 는 언제나 원본 readings 를 엔진에 그대로 넣는다(kpi-service.ts).
 */

import { HttpError } from "./http"
import { T, fetchAll, type MrvDb } from "./db"
import { resolveMeterForSite, resolveTankForSite } from "./tenancy"

/** raw 조회 상한. 넘으면 기간을 좁히거나 granularity 를 쓰라고 422 로 돌려보낸다. */
export const RAW_ROW_CAP = 5000

/** 타입별 표시 단위(원 저장 단위와 별개인 차트 표시용 단위). */
const DISPLAY_UNIT: Record<string, string> = {
  power: "kWh",
  do: "mg/L",
  temp: "degC",
  ph: "pH",
  orp: "mV",
  ec: "mS/cm",
}

export const VALID_GRANULARITIES = ["raw", "hourly", "daily"] as const
export type Granularity = (typeof VALID_GRANULARITIES)[number]

type WirePoint = {
  ts: string
  value: number
  quality_flag: string
  meter_id: string | null
}

/**
 * 조회 대상 계측기 해석.
 *   - meter_id 단일: 그 계측기 하나. 응답의 meter_id 는 그 값, type 은 계측기의 type.
 *   - tank_id + type: 그 수조의 해당 타입 계측기 전체(0개 이상). 여러 계측기를 병합
 *     조회하므로 응답 최상위 meter_id 는 null 이고, 포인트마다 meter_id 가 실린다.
 */
async function resolveMeterIds(
  db: MrvDb,
  siteId: string,
  orgId: string,
  meterId: string | null,
  tankId: string | null,
  type: string | null,
): Promise<{ meterIds: string[]; responseMeterId: string | null; responseType: string }> {
  if (meterId) {
    const meter = await resolveMeterForSite(db, meterId, siteId, orgId)
    return { meterIds: [meter.id], responseMeterId: meter.id, responseType: meter.type }
  }
  const tank = await resolveTankForSite(db, tankId as string, siteId, orgId)
  const meters = await fetchAll<{ id: string }>((f, t) =>
    db
      .from(T.meters)
      .select("id")
      .eq("tank_id", tank.id)
      .eq("type", type as string)
      .order("id", { ascending: true })
      .range(f, t),
  )
  return {
    meterIds: meters.map((m) => m.id),
    responseMeterId: null,
    responseType: type as string,
  }
}

async function queryRaw(
  db: MrvDb,
  meterIds: string[],
  from: Date,
  to: Date,
): Promise<WirePoint[]> {
  // 먼저 개수만 세어 상한을 확인한다 — 상한을 넘는 결과를 통째로 끌어온 뒤 버리면
  // 그 조회 자체가 이미 DB 와 네트워크를 낭비한 것이다.
  const { count, error: countError } = await db
    .from(T.readings)
    .select("meter_id", { count: "exact", head: true })
    .in("meter_id", meterIds)
    .gte("time", from.toISOString())
    .lt("time", to.toISOString())
  if (countError) throw countError

  const total = count ?? 0
  if (total > RAW_ROW_CAP) {
    throw new HttpError(
      422,
      `raw result exceeds cap (${total} > ${RAW_ROW_CAP} rows); ` +
        "narrow the range or use granularity",
    )
  }

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
      .gte("time", from.toISOString())
      .lt("time", to.toISOString())
      .order("time", { ascending: true })
      .order("meter_id", { ascending: true })
      .range(f, t),
  )
  return rows.map((r) => ({
    ts: new Date(r.time).toISOString(),
    value: r.value,
    quality_flag: r.quality_flag,
    meter_id: r.meter_id,
  }))
}

/**
 * hourly|daily 집계. 계산은 DB 함수(mrv_aggregate_readings)가 한다 — 집계를 앱으로
 * 끌고 오면 원본 행을 전부 전송해야 해서 집계를 도입한 이유가 사라진다.
 * power 는 합, 그 외 타입은 평균이다(전력은 누적량, 나머지는 상태량이므로).
 */
async function queryAggregated(
  db: MrvDb,
  meterIds: string[],
  from: Date,
  to: Date,
  granularity: Granularity,
  type: string,
): Promise<WirePoint[]> {
  const { data, error } = await db.rpc("mrv_aggregate_readings", {
    p_meter_ids: meterIds,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_granularity: granularity,
    p_sum: type === "power",
  })
  if (error) throw error

  const rows = (data ?? []) as {
    meter_id: string
    bucket: string
    value: number
    quality_flag: string
  }[]
  return rows.map((r) => ({
    ts: new Date(r.bucket).toISOString(),
    value: Number(r.value),
    quality_flag: r.quality_flag,
    meter_id: r.meter_id,
  }))
}

/**
 * [from, to) 시계열을 조회/집계해 응답 형태로 돌려준다.
 * ⚠ 호출 전에 resolveSiteForOrg 로 site 소유권이 검증되어 있어야 한다.
 */
export async function getSiteReadings(params: {
  db: MrvDb
  siteId: string
  orgId: string
  meterId: string | null
  tankId: string | null
  type: string | null
  from: Date
  to: Date
  granularity: Granularity
}) {
  const { db, siteId, orgId, meterId, tankId, type, from, to, granularity } = params

  const { meterIds, responseMeterId, responseType } = await resolveMeterIds(
    db,
    siteId,
    orgId,
    meterId,
    tankId,
    type,
  )
  const unit = DISPLAY_UNIT[responseType] ?? responseType

  const points =
    meterIds.length === 0
      ? []
      : granularity === "raw"
        ? await queryRaw(db, meterIds, from, to)
        : await queryAggregated(db, meterIds, from, to, granularity, responseType)

  return {
    site_id: siteId,
    meter_id: responseMeterId,
    type: responseType,
    granularity,
    unit,
    points,
  }
}
