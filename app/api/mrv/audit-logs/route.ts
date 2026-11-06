/**
 * GET /api/mrv/audit-logs — 감사 로그 조회(ENTERPRISE).
 * 원본: apps/api/app/routers/audit_logs.py
 *
 * 읽기 전용이라 역할 제한을 두지 않는다 — 누가 무엇을 바꿨는지 투명하게 보는 것 자체가
 * 이 화면의 목적이므로 viewer 도 볼 수 있어야 한다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requirePlan(await authorizeMrv(req), "ENTERPRISE")
    const url = new URL(req.url)

    const entity = url.searchParams.get("entity")
    const action = url.searchParams.get("action")
    const fromRaw = url.searchParams.get("from")
    const toRaw = url.searchParams.get("to")
    const limit = Number(url.searchParams.get("limit") ?? 50)
    const offset = Number(url.searchParams.get("offset") ?? 0)

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new HttpError(422, "limit must be an integer between 1 and 200")
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new HttpError(422, "offset must be an integer >= 0")
    }

    let query = auth.db
      .from(T.auditLogs)
      .select("id, entity, entity_id, action, actor_id, diff_json, ts", { count: "exact" })
      .eq("org_id", auth.orgId)
    if (entity) query = query.eq("entity", entity)
    if (action) query = query.eq("action", action)
    if (fromRaw) query = query.gte("ts", parseInstant(fromRaw, "from").toISOString())
    if (toRaw) query = query.lte("ts", parseInstant(toRaw, "to").toISOString())

    const { data, error, count } = await query
      .order("ts", { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error

    const rows = (data ?? []) as {
      id: string
      entity: string
      entity_id: string
      action: string
      actor_id: string
      diff_json: Record<string, unknown>
      ts: string
    }[]

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        entity: r.entity,
        entity_id: r.entity_id,
        action: r.action,
        actor_id: r.actor_id,
        diff: r.diff_json,
        ts: r.ts,
      })),
      total: count ?? 0,
    })
  })
}
