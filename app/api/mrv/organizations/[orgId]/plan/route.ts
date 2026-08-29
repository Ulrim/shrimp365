/**
 * PATCH /api/mrv/organizations/{orgId}/plan — 요금제 변경(owner 전용).
 * 원본: apps/api/app/routers/organizations.py::update_organization_plan
 *
 * plan 값만 반영한다. 결제 게이트웨이 연동은 범위 밖이며, 결제 확인 뒤 운영자가 호출하는
 * 것을 전제한다. 플랜이 곧 기능 게이팅의 근거이므로 변경은 반드시 감사 로그에 남는다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"

const PLANS = ["START", "PRO", "ENTERPRISE"] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  return handleRoute(async () => {
    const { orgId } = await params
    const auth = requireOwner(await authorizeMrv(req))
    if (orgId !== auth.orgId) throw new HttpError(404, "organization not found")

    const body = (await req.json()) as { plan?: string }
    if (!body.plan || !(PLANS as readonly string[]).includes(body.plan)) {
      throw new HttpError(422, `plan must be one of ${PLANS.join(", ")}`)
    }

    const beforePlan = auth.plan
    const { error } = await auth.db
      .from(T.organizations)
      .update({ plan: body.plan })
      .eq("id", orgId)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId,
      actorId: auth.userId,
      entity: "organizations",
      entityId: orgId,
      action: "plan_change",
      diff: { before: { plan: beforePlan }, after: { plan: body.plan } },
    })

    return NextResponse.json({ org_id: orgId, plan: body.plan })
  })
}
