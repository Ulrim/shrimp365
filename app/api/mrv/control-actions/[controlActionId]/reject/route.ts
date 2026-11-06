/**
 * POST /api/mrv/control-actions/{id}/reject — pending → rejected.
 * 원본: apps/api/app/routers/control_actions.py::reject_control_action
 *
 * 거절 사유(note)는 감사 로그에 남는다 — 왜 반영하지 않았는지가 반영 이력만큼 중요하다.
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

    const body = (await req.json().catch(() => ({}))) as { note?: string | null }
    const ca = await resolveControlActionForOrg(auth.db, controlActionId, auth.orgId)
    if (ca.status !== "pending") throw new HttpError(409, "invalid transition")

    const { error } = await auth.db
      .from(T.controlActions)
      .update({ status: "rejected" })
      .eq("id", ca.id)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "control_actions",
      entityId: ca.id,
      action: "reject",
      diff: { before: { status: ca.status }, after: { status: "rejected" } },
      note: body.note ?? null,
    })

    return NextResponse.json({ ...ca, status: "rejected" })
  })
}
