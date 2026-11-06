/**
 * GET /api/mrv/sites/{siteId}/kpi — 사이트 KPI 산출(EI/OEI/FCR/폐사율).
 * 원본: apps/api/app/routers/kpi.py
 *
 * 방어 흐름:
 *   1) authorizeMrv     — 세션 → org_id/role/plan.
 *   2) resolveSiteForOrg — 이 사이트가 그 org 의 것인지 재검증(404/403).
 *   3) computeSiteKpi    — 조립 후 KPI 엔진 호출.
 *
 * 응답에는 값만이 아니라 산출 파라미터·기간·근거 참조 ID 가 함께 실린다. 리포트의 모든
 * 숫자가 원천 계측값까지 역추적 가능해야 한다는 요구가 이 형태의 이유다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute, parsePeriod } from "@/lib/mrv/http"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { computeSiteKpi } from "@/lib/mrv/kpi-service"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    const { from, to } = parsePeriod(new URL(req.url))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    return NextResponse.json(
      await computeSiteKpi(auth.db, siteId, auth.orgId, from, to),
    )
  })
}
