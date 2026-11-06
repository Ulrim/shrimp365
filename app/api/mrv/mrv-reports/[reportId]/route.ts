/**
 * GET /api/mrv/mrv-reports/{reportId} — 리포트 재조회(생성 응답과 같은 형태).
 * 원본: apps/api/app/routers/mrv_reports.py::get_mrv_report
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { loadReportForOrg } from "@/lib/mrv/mrv-report-loader"
import { mrvReportToResponse } from "@/lib/mrv/mrv-report-service"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  return handleRoute(async () => {
    const { reportId } = await params
    const auth = await authorizeMrv(req)
    const { report, emissionFactor } = await loadReportForOrg(
      auth.db,
      reportId,
      auth.orgId,
    )
    return NextResponse.json(mrvReportToResponse(report, emissionFactor))
  })
}
