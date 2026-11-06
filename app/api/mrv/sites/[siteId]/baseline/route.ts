/**
 * GET /api/mrv/sites/{siteId}/baseline — 현재 잠긴 기준선(없으면 404).
 * 원본: apps/api/app/routers/baseline.py::get_baseline
 *
 * 이 값이 MRV 리포트의 'Before' 이자 전·후 비교의 기준이다. 수정/삭제 경로를 만들지
 * 않는 것 자체가 API 계층의 방어선이며, DB 트리거가 그 아래를 한 번 더 막는다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { baselineRowToResponse, type BaselineRow } from "@/lib/mrv/baseline"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const { data, error } = await auth.db
      .from(T.baselines)
      .select("*")
      .eq("site_id", siteId)
      .eq("status", "locked")
      .maybeSingle()
    if (error) throw error
    if (!data) throw new HttpError(404, "no locked baseline for this site")

    return NextResponse.json(baselineRowToResponse(data as BaselineRow))
  })
}
