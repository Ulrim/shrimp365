/**
 * GET /api/mrv/sites/{siteId}/recommendations — 급이·산소·순환 추천 3종.
 * 원본: apps/api/app/routers/recommendations.py::get_site_recommendations
 *
 * 조회할 때마다 라이브로 계산하되, 결과가 직전 버전과 다를 때만 새 레시피 버전을 남긴다.
 * 응답 status 가 'recommend_only' 인 것은 이 단계가 "추천만" 한다는 뜻이다 — 실제 설비
 * 적용은 승인형 제어 콘솔(ENTERPRISE)을 거친다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { computeSiteRecommendations } from "@/lib/mrv/recommendation-service"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const generatedAt = new Date().toISOString()
    const items = await computeSiteRecommendations(
      auth.db,
      siteId,
      auth.orgId,
      auth.userId,
    )

    return NextResponse.json({
      site_id: siteId,
      items: items.map((item) => ({ ...item, generated_at: generatedAt })),
      status: "recommend_only",
    })
  })
}
