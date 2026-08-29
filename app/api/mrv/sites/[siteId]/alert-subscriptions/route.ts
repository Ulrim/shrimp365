/**
 * 알림 구독 스위치 조회/갱신.
 * 원본: apps/api/app/routers/alerts.py::get_alert_subscriptions / update_alert_subscriptions
 *
 * 채널(이메일·푸시) 개념은 없고 알림 종류별 on/off 만 있다. 갱신은 PATCH 의미대로
 * 보낸 키만 덮어쓴다 — 스위치 하나를 끄려고 나머지 상태를 다시 보내게 하지 않는다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { DEFAULT_ALERT_ENABLED_TYPES } from "@/lib/mrv/alerts"

const ALERT_TYPES = ["do_low", "mortality_spike", "kpi_red"] as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    const site = await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    return NextResponse.json({
      site_id: siteId,
      alert_enabled_types: {
        ...DEFAULT_ALERT_ENABLED_TYPES,
        ...(site.alert_enabled_types ?? {}),
      },
    })
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    const site = await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as Record<string, unknown>
    const changes: Record<string, boolean> = {}
    for (const type of ALERT_TYPES) {
      const value = body[type]
      if (value === undefined || value === null) continue
      if (typeof value !== "boolean") {
        throw new HttpError(422, `${type} must be a boolean`)
      }
      changes[type] = value
    }

    const before = { ...DEFAULT_ALERT_ENABLED_TYPES, ...(site.alert_enabled_types ?? {}) }
    const updated = { ...before, ...changes }

    const { error } = await auth.db
      .from(T.sites)
      .update({ alert_enabled_types: updated })
      .eq("id", siteId)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "sites",
      entityId: siteId,
      action: "update_alert_subscriptions",
      diff: { before, after: updated },
    })

    return NextResponse.json({ site_id: siteId, alert_enabled_types: updated })
  })
}
