/**
 * GET /api/mrv/sites/{siteId}/readings — 대시보드 차트용 시계열.
 * 원본: apps/api/app/routers/readings.py
 *
 * meter_id 단일 조회이거나 tank_id+type 조합이어야 한다 — 둘 다 없으면 사이트의 모든
 * 계측값을 뜻하게 되는데, 그건 차트가 쓸 수 있는 형태가 아니다(422 로 되돌린다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parsePeriod } from "@/lib/mrv/http"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import {
  VALID_GRANULARITIES,
  getSiteReadings,
  type Granularity,
} from "@/lib/mrv/readings-service"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    const url = new URL(req.url)

    const meterId = url.searchParams.get("meter_id")
    const tankId = url.searchParams.get("tank_id")
    const type = url.searchParams.get("type")
    const granularity = (url.searchParams.get("granularity") ?? "raw") as Granularity

    if (!meterId && !(tankId && type)) {
      throw new HttpError(
        422,
        "either 'meter_id' or both 'tank_id' and 'type' are required",
      )
    }
    if (!(VALID_GRANULARITIES as readonly string[]).includes(granularity)) {
      throw new HttpError(
        422,
        `granularity must be one of ${VALID_GRANULARITIES.join(", ")}`,
      )
    }
    const { from, to } = parsePeriod(url)

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    return NextResponse.json(
      await getSiteReadings({
        db: auth.db,
        siteId,
        orgId: auth.orgId,
        meterId,
        tankId,
        type,
        from,
        to,
        granularity,
      }),
    )
  })
}
