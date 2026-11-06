/**
 * GET /api/mrv/sites/{siteId}/mrv-reports — 리포트 이력 목록(PRO 이상).
 * 원본: apps/api/app/routers/mrv_reports.py::list_site_mrv_reports
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
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

    const rows = await fetchAll<{
      id: string
      site_id: string
      period_start: string
      period_end: string
      reduction_tco2e: number | null
      generated_by: string
      generated_at: string
    }>((f, t) =>
      auth.db
        .from(T.reports)
        .select(
          "id, site_id, period_start, period_end, reduction_tco2e, generated_by, generated_at",
        )
        .eq("site_id", siteId)
        .order("generated_at", { ascending: false })
        .range(f, t),
    )

    return NextResponse.json({
      site_id: siteId,
      items: rows.map((r) => ({
        id: r.id,
        site_id: r.site_id,
        period: { from: r.period_start, to: r.period_end, granularity: "period" },
        reduction_tco2e: r.reduction_tco2e,
        generated_by: r.generated_by,
        generated_at: r.generated_at,
      })),
      total: rows.length,
    })
  })
}
