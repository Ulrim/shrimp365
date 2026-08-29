/**
 * GET /api/mrv/sites/{siteId}/batches — 수기입력 폼의 배치 선택 목록.
 * 원본: apps/api/app/routers/batches.py
 *
 * batches 는 site 를 직접 갖지 않고 tank 를 경유하므로, 이 사이트의 수조를 먼저 찾아
 * 그 수조들의 배치만 모은다. 읽기이므로 역할 제한은 없다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { T, fetchAll } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const tanks = await fetchAll<{ id: string }>((f, t) =>
      auth.db.from(T.tanks).select("id").eq("site_id", siteId).range(f, t),
    )
    if (tanks.length === 0) return NextResponse.json([])

    const rows = await fetchAll<{
      id: string
      tank_id: string
      species: string
      stocked_count: number
      stocked_at: string
      closed_at: string | null
    }>((f, t) =>
      auth.db
        .from(T.batches)
        .select("id, tank_id, species, stocked_count, stocked_at, closed_at")
        .in(
          "tank_id",
          tanks.map((x) => x.id),
        )
        .order("stocked_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json(rows)
  })
}
