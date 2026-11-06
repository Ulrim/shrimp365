/**
 * POST /api/mrv/control-actions/{id}/approve — pending → approved.
 * 원본: apps/api/app/routers/control_actions.py::approve_control_action
 *
 * pending 이 아닌 상태에서 호출하면 409 다. 승인은 되돌릴 수 없는 결정이므로 이미 진행된
 * 액션을 다시 승인 상태로 되돌리는 경로를 두지 않는다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import { resolveControlActionForOrg } from "@/lib/mrv/control-actions"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ controlActionId: string }> },
) {
  return handleRoute(async () => {
    const { controlActionId } = await params
    const auth = requirePlan(requireWriter(await authorizeMrv(req)), "ENTERPRISE")

    const ca = await resolveControlActionForOrg(auth.db, controlActionId, auth.orgId)
    if (ca.status !== "pending") throw new HttpError(409, "invalid transition")

    const approvedAt = new Date().toISOString()
    const { error } = await auth.db
      .from(T.controlActions)
      .update({ status: "approved", approved_by: auth.userId, approved_at: approvedAt })
      .eq("id", ca.id)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "control_actions",
      entityId: ca.id,
      action: "approve",
      diff: {
        before: { status: ca.status },
        after: { status: "approved", approved_by: auth.userId, approved_at: approvedAt },
      },
    })

    return NextResponse.json({
      ...ca,
      status: "approved",
      approved_by: auth.userId,
      approved_at: approvedAt,
    })
  })
}
