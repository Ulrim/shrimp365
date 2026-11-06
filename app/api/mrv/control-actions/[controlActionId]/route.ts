/**
 * GET /api/mrv/control-actions/{id} — 제어 액션 단건 조회(ENTERPRISE).
 * 원본: apps/api/app/routers/control_actions.py::get_control_action
 * 읽기이므로 viewer 도 볼 수 있다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { resolveControlActionForOrg } from "@/lib/mrv/control-actions"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ controlActionId: string }> },
) {
  return handleRoute(async () => {
    const { controlActionId } = await params
    const auth = requirePlan(await authorizeMrv(req), "ENTERPRISE")
    return NextResponse.json(
      await resolveControlActionForOrg(auth.db, controlActionId, auth.orgId),
    )
  })
}
