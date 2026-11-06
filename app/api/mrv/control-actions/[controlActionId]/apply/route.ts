/**
 * POST /api/mrv/control-actions/{id}/apply — approved → applied.
 * 원본: apps/api/app/routers/control_actions.py::apply_control_action
 *
 * ★ 승인 게이트의 실행 지점이다. approved 가 아니면 무조건 409 — 승인 없이 설비에 값이
 * 반영되는 경로는 존재하지 않는다. DB CHECK 제약이 그 아래를 한 번 더 막는다.
 *
 * 이 호출은 "시스템이 설비를 제어했다"가 아니라 "운영자가 직접 반영했고 그 결과를
 * 기록한다"는 뜻이다. result_json 이 그 결과 기록이다.
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

    const body = (await req.json().catch(() => ({}))) as {
      result_json?: Record<string, unknown> | null
    }
    const ca = await resolveControlActionForOrg(auth.db, controlActionId, auth.orgId)
    if (ca.status !== "approved") {
      throw new HttpError(409, "control action not approved")
    }

    const appliedAt = new Date().toISOString()
    const resultJson = body.result_json ?? null
    const { error } = await auth.db
      .from(T.controlActions)
      .update({ status: "applied", applied_at: appliedAt, result_json: resultJson })
      .eq("id", ca.id)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "control_actions",
      entityId: ca.id,
      action: "apply",
      diff: {
        before: { status: ca.status },
        after: { status: "applied", applied_at: appliedAt, result_json: resultJson },
      },
    })

    return NextResponse.json({
      ...ca,
      status: "applied",
      applied_at: appliedAt,
      result_json: resultJson,
    })
  })
}
