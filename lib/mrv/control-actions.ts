/**
 * 제어 액션 공통 조회/전이 헬퍼.
 * 원본: apps/api/app/routers/control_actions.py + services/tenancy.py
 *
 * 상태 전이는 pending → approved → applied 한 방향뿐이고, 거절은 pending 에서만 된다.
 * 여기서 막는 것은 API 계층의 이중 방어이며, 최종 방어선은 DB CHECK 제약이다
 * (적용은 승인 시각을, 승인은 승인자를 반드시 동반한다).
 */

import { HttpError } from "./http"
import { T, type MrvDb } from "./db"

export const CONTROL_ACTION_COLUMNS =
  "id, tank_id, recipe_version_id, site_id, org_id, recommended_json, status, " +
  "approved_by, approved_at, applied_at, result_json, created_at"

export type ControlActionRow = {
  id: string
  tank_id: string
  recipe_version_id: string
  site_id: string
  org_id: string
  recommended_json: Record<string, unknown>
  status: "pending" | "approved" | "rejected" | "applied"
  approved_by: string | null
  approved_at: string | null
  applied_at: string | null
  result_json: Record<string, unknown> | null
  created_at: string
}

/** 액션을 org 스코프에서 해석. 없거나 타 org 면 404(존재 사실도 숨긴다). */
export async function resolveControlActionForOrg(
  db: MrvDb,
  controlActionId: string,
  orgId: string,
): Promise<ControlActionRow> {
  const { data, error } = await db
    .from(T.controlActions)
    .select(CONTROL_ACTION_COLUMNS)
    .eq("id", controlActionId)
    .maybeSingle()
  if (error) throw error
  const row = data as ControlActionRow | null
  if (!row || row.org_id !== orgId) {
    throw new HttpError(404, `control action not found: ${controlActionId}`)
  }
  return row
}
