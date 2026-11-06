/**
 * 계측기 등록/조회 — 온보딩의 "설치키트 → 센서 매핑" 단계.
 * 원본: apps/api/app/routers/meters.py
 *
 * 수정/삭제 경로는 원본과 마찬가지로 두지 않는다. 계측기 교체는 운영 이벤트라
 * 신중해야 하고, 잘못 바꾸면 과거 KPI 의 근거가 통째로 흔들린다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg, resolveTankForSite } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"

const METER_TYPES = ["power", "do", "temp", "ph", "orp", "ec"] as const
const METER_COLUMNS =
  "id, site_id, org_id, type, unit, is_aeration, tank_id, label, certification_info"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const rows = await fetchAll((f, t) =>
      auth.db
        .from(T.meters)
        .select(METER_COLUMNS)
        .eq("site_id", siteId)
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json({ items: rows, total: rows.length })
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      type?: string
      unit?: string
      is_aeration?: boolean
      tank_id?: string | null
      label?: string | null
      certification_info?: Record<string, unknown> | null
    }
    if (!body.type || !(METER_TYPES as readonly string[]).includes(body.type)) {
      throw new HttpError(422, `type must be one of ${METER_TYPES.join(", ")}`)
    }
    if (!body.unit) throw new HttpError(422, "unit is required")

    // tank 를 지정했다면 그 수조가 이 사이트의 것인지 확인한다(3중 방어).
    if (body.tank_id) {
      await resolveTankForSite(auth.db, body.tank_id, siteId, auth.orgId)
    }

    const row = {
      id: newId("mtr"),
      site_id: siteId,
      org_id: auth.orgId,
      type: body.type,
      unit: body.unit,
      is_aeration: body.is_aeration ?? false,
      tank_id: body.tank_id ?? null,
      label: body.label ?? null,
      certification_info: body.certification_info ?? null,
    }
    const { error } = await auth.db.from(T.meters).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "meters",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          type: row.type,
          unit: row.unit,
          is_aeration: row.is_aeration,
          tank_id: row.tank_id,
          label: row.label,
          certification_info: row.certification_info,
        },
      },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
