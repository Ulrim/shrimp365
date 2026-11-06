/**
 * GET /api/mrv/sop — SOP 목록(PRO 이상).
 * 원본: apps/api/app/routers/sop.py::list_sop
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { listSopSummaries } from "@/lib/mrv/sop-content"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")
    return NextResponse.json({ items: listSopSummaries() })
  })
}
