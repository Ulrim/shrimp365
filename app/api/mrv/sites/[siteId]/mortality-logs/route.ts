/**
 * POST /api/mrv/sites/{siteId}/mortality-logs — 폐사 기록 수기 입력(폐사율의 분자).
 * 원본: apps/api/app/routers/logs.py::create_mortality_log
 *
 * feed-logs 와 같은 규율: owner/operator 만, 배치 소유권 확인, 감사 로그 필수.
 * 급이량과 달리 폐사 개체수는 0 을 허용한다(그날 폐사가 없었다는 기록도 증빙이다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { resolveBatchForSite, resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      batch_id?: string
      ts?: string
      dead_count?: number
      cause_note?: string | null
    }
    if (!body.batch_id) throw new HttpError(422, "batch_id is required")
    if (!body.ts) throw new HttpError(422, "ts is required")
    const ts = parseInstant(body.ts, "ts")
    if (
      typeof body.dead_count !== "number" ||
      !Number.isInteger(body.dead_count) ||
      body.dead_count < 0
    ) {
      throw new HttpError(422, "dead_count must be an integer >= 0")
    }

    const batch = await resolveBatchForSite(auth.db, body.batch_id, siteId, auth.orgId)

    const row = {
      id: newId("mort"),
      batch_id: batch.id,
      org_id: auth.orgId,
      ts: ts.toISOString(),
      dead_count: body.dead_count,
      cause_note: body.cause_note ?? null,
    }
    const { error } = await auth.db.from(T.mortalityLogs).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "mortality_logs",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          batch_id: row.batch_id,
          ts: row.ts,
          dead_count: row.dead_count,
          cause_note: row.cause_note,
        },
      },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
