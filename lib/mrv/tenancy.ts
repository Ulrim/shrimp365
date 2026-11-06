/**
 * 테넌시 재검증 — 원본 `apps/api/app/services/tenancy.py` 의 이식본.
 *
 * RLS 를 신뢰하되 방어적으로 한 번 더 확인한다. service-role 로 붙는 이식본에서는
 * RLS 가 우회되므로, 이 계층이 사실상 org 격리의 실행 지점이다 — 원본보다 더 중요해졌다.
 *
 * 불일치/부재 처리 규칙(원본 그대로):
 *   - 대상이 아예 없으면 → 404.
 *   - 있으나 타 org 소속이면 → 403(존재 사실은 노출, 접근만 거부).
 *   - 있으나 다른 site 소속이면 → 404(이 사이트의 것이 아님).
 */

import { HttpError } from "./http"
import { T, type MrvDb } from "./db"

export type SiteRow = {
  id: string
  org_id: string
  name: string
  region: string | null
  ras_type: string | null
  alert_enabled_types: Record<string, boolean>
}

export type TankRow = {
  id: string
  site_id: string
  org_id: string
  name: string
  volume_m3: number | null
  target_do_min: number | null
  target_do_max: number | null
}

export type BatchRow = {
  id: string
  tank_id: string
  org_id: string
  species: string
  stocked_count: number
  stocked_at: string
  closed_at: string | null
}

export type MeterRow = {
  id: string
  site_id: string
  org_id: string
  type: string
  unit: string
  sub_meter_of: string | null
  is_aeration: boolean
  tank_id: string | null
  label: string | null
  certification_info: Record<string, unknown> | null
}

/** site_id 를 org 스코프에서 해석. 없으면 404, 타 org 면 403. */
export async function resolveSiteForOrg(
  db: MrvDb,
  siteId: string,
  orgId: string,
): Promise<SiteRow> {
  const { data, error } = await db
    .from(T.sites)
    .select("id, org_id, name, region, ras_type, alert_enabled_types")
    .eq("id", siteId)
    .maybeSingle()
  if (error) throw error
  const site = data as SiteRow | null
  if (!site) throw new HttpError(404, `site not found: ${siteId}`)
  if (site.org_id !== orgId) {
    throw new HttpError(403, "site does not belong to your organization")
  }
  return site
}

/** tank_id 가 요청 org·site 스코프에 속하는지 재검증. */
export async function resolveTankForSite(
  db: MrvDb,
  tankId: string,
  siteId: string,
  orgId: string,
): Promise<TankRow> {
  const { data, error } = await db
    .from(T.tanks)
    .select("id, site_id, org_id, name, volume_m3, target_do_min, target_do_max")
    .eq("id", tankId)
    .maybeSingle()
  if (error) throw error
  const tank = data as TankRow | null
  if (!tank) throw new HttpError(404, `tank not found: ${tankId}`)
  if (tank.org_id !== orgId) {
    throw new HttpError(403, "tank does not belong to your organization")
  }
  if (tank.site_id !== siteId) {
    throw new HttpError(404, "tank does not belong to this site")
  }
  return tank
}

/**
 * batch_id 가 요청 org·site 스코프에 속하는지 재검증(수기입력 3중 방어).
 * batch 는 site 를 직접 갖지 않고 tank 를 거치므로 tank 까지 따라가 확인한다.
 */
export async function resolveBatchForSite(
  db: MrvDb,
  batchId: string,
  siteId: string,
  orgId: string,
): Promise<BatchRow> {
  const { data, error } = await db
    .from(T.batches)
    .select("id, tank_id, org_id, species, stocked_count, stocked_at, closed_at")
    .eq("id", batchId)
    .maybeSingle()
  if (error) throw error
  const batch = data as BatchRow | null
  if (!batch) throw new HttpError(404, `batch not found: ${batchId}`)
  if (batch.org_id !== orgId) {
    throw new HttpError(403, "batch does not belong to your organization")
  }

  const { data: tankData, error: tankError } = await db
    .from(T.tanks)
    .select("id, site_id")
    .eq("id", batch.tank_id)
    .maybeSingle()
  if (tankError) throw tankError
  const tank = tankData as { id: string; site_id: string } | null
  if (!tank || tank.site_id !== siteId) {
    throw new HttpError(404, "batch does not belong to this site")
  }
  return batch
}

/** meter_id 가 요청 org·site 스코프에 속하는지 재검증. */
export async function resolveMeterForSite(
  db: MrvDb,
  meterId: string,
  siteId: string,
  orgId: string,
): Promise<MeterRow> {
  const { data, error } = await db
    .from(T.meters)
    .select(
      "id, site_id, org_id, type, unit, sub_meter_of, is_aeration, tank_id, label, certification_info",
    )
    .eq("id", meterId)
    .maybeSingle()
  if (error) throw error
  const meter = data as MeterRow | null
  if (!meter) throw new HttpError(404, `meter not found: ${meterId}`)
  if (meter.org_id !== orgId) {
    throw new HttpError(403, "meter does not belong to your organization")
  }
  if (meter.site_id !== siteId) {
    throw new HttpError(404, "meter does not belong to this site")
  }
  return meter
}
