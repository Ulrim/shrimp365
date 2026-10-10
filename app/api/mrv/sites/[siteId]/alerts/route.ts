/**
 * GET /api/mrv/sites/{siteId}/alerts — 알림 목록(status 필터).
 * 원본: apps/api/app/routers/alerts.py::list_site_alerts
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { alertRowToItem, type AlertRow } from "@/lib/mrv/alerts"

const VALID_STATUS_FILTERS = ["open", "ack", "all"] as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    const url = new URL(req.url)

    const statusFilter = url.searchParams.get("status") ?? "open"
    if (!(VALID_STATUS_FILTERS as readonly string[]).includes(statusFilter)) {
      throw new HttpError(422, `status must be one of ${VALID_STATUS_FILTERS.join(", ")}`)
    }
    const limit = Number(url.searchParams.get("limit") ?? 50)
    const offset = Number(url.searchParams.get("offset") ?? 0)
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new HttpError(422, "limit must be an integer between 1 and 500")
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new HttpError(422, "offset must be an integer >= 0")
    }

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    let query = auth.db
      .from(T.alerts)
      .select("*", { count: "exact" })
      .eq("site_id", siteId)
    if (statusFilter !== "all") query = query.eq("status", statusFilter)

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error

    return NextResponse.json({
      site_id: siteId,
      org_id: auth.orgId,
      items: ((data ?? []) as AlertRow[]).map(alertRowToItem),
      total: count ?? 0,
    })
  })
}
