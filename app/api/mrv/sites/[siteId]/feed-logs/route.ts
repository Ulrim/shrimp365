/**
 * POST /api/mrv/sites/{siteId}/feed-logs — 급이 기록 수기 입력(FCR 의 분자).
 * 원본: apps/api/app/routers/logs.py::create_feed_log
 *
 * owner/operator 만 쓸 수 있고(viewer 403), 배치가 이 사이트·조직의 것인지 확인한 뒤
 * 감사 로그를 남긴다. 감사 기록이 곧 이 수치의 출처 증빙이다.
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
      feed_kg?: number
      source?: string
    }
    if (!body.batch_id) throw new HttpError(422, "batch_id is required")
    if (!body.ts) throw new HttpError(422, "ts is required")
    const ts = parseInstant(body.ts, "ts")
    // 급이량은 0 이하일 수 없다 — 0 을 허용하면 FCR 분자에 의미 없는 행이 쌓인다.
    if (typeof body.feed_kg !== "number" || !(body.feed_kg > 0)) {
      throw new HttpError(422, "feed_kg must be greater than 0")
    }

    const batch = await resolveBatchForSite(auth.db, body.batch_id, siteId, auth.orgId)

    const row = {
      id: newId("feed"),
      batch_id: batch.id,
      org_id: auth.orgId,
      ts: ts.toISOString(),
      feed_kg: body.feed_kg,
      source: body.source ?? "manual",
      quality_flag: "ok",
    }
    const { error } = await auth.db.from(T.feedLogs).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "feed_logs",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          batch_id: row.batch_id,
          ts: row.ts,
          feed_kg: row.feed_kg,
          source: row.source,
        },
      },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
