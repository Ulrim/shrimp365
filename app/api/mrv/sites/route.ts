/**
 * GET /api/mrv/sites — org 소속 사이트 목록.
 * 원본: apps/api/app/routers/sites.py::list_sites
 *
 * 플랜 게이팅은 없다 — 단일 사이트 조직도 자기 사이트 목록은 볼 권리가 있고,
 * 온보딩 화면도 이 목록이 있어야 시작된다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { T, fetchAll } from "@/lib/mrv/db"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    const rows = await fetchAll<{
      id: string
      name: string
      region: string | null
      ras_type: string | null
    }>((f, t) =>
      auth.db
        .from(T.sites)
        .select("id, name, region, ras_type")
        .eq("org_id", auth.orgId)
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json({ items: rows, total: rows.length })
  })
}
