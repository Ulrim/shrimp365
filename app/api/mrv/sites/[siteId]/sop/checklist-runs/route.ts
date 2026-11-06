/**
 * GET /api/mrv/sites/{siteId}/sop/checklist-runs — 점검 실행 기록 조회(PRO 이상).
 * 원본: apps/api/app/routers/sop.py::list_checklist_runs
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const url = new URL(req.url)
    const sopId = url.searchParams.get("sop_id")
    const fromRaw = url.searchParams.get("from")
    const toRaw = url.searchParams.get("to")

    const rows = await fetchAll<{
      id: string
      site_id: string
      org_id: string
      sop_id: string
      items_json: unknown[]
      performed_by: string
      performed_at: string
    }>((f, t) => {
      let q = auth.db
        .from(T.sopChecklistRuns)
        .select("id, site_id, org_id, sop_id, items_json, performed_by, performed_at")
        .eq("site_id", siteId)
      if (sopId) q = q.eq("sop_id", sopId)
      if (fromRaw) {
        q = q.gte("performed_at", parseInstant(fromRaw, "from").toISOString())
      }
      if (toRaw) q = q.lte("performed_at", parseInstant(toRaw, "to").toISOString())
      return q.order("performed_at", { ascending: false }).range(f, t)
    })

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        site_id: r.site_id,
        org_id: r.org_id,
        sop_id: r.sop_id,
        items: r.items_json,
        performed_by: r.performed_by,
        performed_at: r.performed_at,
      })),
      total: rows.length,
    })
  })
}
