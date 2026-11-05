/**
 * GET/POST /api/mrv/sites/{siteId}/experiments — 비교실험(A/B) 목록·구성.
 * 원본: 없다. 사정은 lib/mrv/experiments.ts.
 *
 * 권한: PRO 이상(전·후 비교와 같다) + 쓰기는 owner/operator. 실험을 구성하는 것은
 * 운영 작업이다 — 결과가 발행물이 아니라 조회이므로 owner 로 좁히지 않는다.
 *
 * 수정은 **상태 전이만** 둔다(`[experimentId]/route.ts` PATCH). 구간이나 이름을 나중에
 * 고치면 "그 실험" 이 무엇이었는지가 바뀐다. 잘못 만들었으면 abandoned 로 접고 새로 만든다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { checkExperiment } from "@/lib/mrv/experiments"

export const EXPERIMENT_COLUMNS =
  "id, site_id, org_id, name, hypothesis, control_from, control_to, treatment_from, " +
  "treatment_to, status, conclusion, concluded_at, created_by, created_at"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const rows = await fetchAll((f, t) =>
      auth.db
        .from(T.experiments)
        .select(EXPERIMENT_COLUMNS)
        .eq("site_id", siteId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json({ items: rows, total: rows.length })
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE"))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as Record<string, unknown>
    const checked = checkExperiment(body)
    if (!checked.ok) throw new HttpError(422, checked.detail)
    const v = checked.value

    const row = {
      id: newId("exp"),
      site_id: siteId,
      org_id: auth.orgId,
      name: v.name,
      hypothesis: v.hypothesis,
      control_from: v.control_from.toISOString(),
      control_to: v.control_to.toISOString(),
      treatment_from: v.treatment_from.toISOString(),
      treatment_to: v.treatment_to.toISOString(),
      status: "running" as const,
      conclusion: null as string | null,
      concluded_at: null as string | null,
      created_by: auth.userId,
    }
    const { error } = await auth.db.from(T.experiments).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "experiments",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          name: row.name,
          hypothesis: row.hypothesis,
          control: { from: row.control_from, to: row.control_to },
          treatment: { from: row.treatment_from, to: row.treatment_to },
        },
      },
    })
    return NextResponse.json(row, { status: 201 })
  })
}
