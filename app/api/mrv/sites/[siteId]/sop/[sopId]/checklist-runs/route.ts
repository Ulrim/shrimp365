/**
 * POST /api/mrv/sites/{siteId}/sop/{sopId}/checklist-runs — 점검 실행 기록.
 * 원본: apps/api/app/routers/sop.py::create_checklist_run
 *
 * append-only 다. 재점검은 수정이 아니라 새 기록이며, 그래야 "언제 무엇을 점검했는가"가
 * 시간순으로 남아 증빙이 된다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { sopExists } from "@/lib/mrv/sop-content"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; sopId: string }> },
) {
  return handleRoute(async () => {
    const { siteId, sopId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    // SOP 콘텐츠는 DB 밖에 있으므로 FK 가 아니라 존재 확인으로 참조를 지킨다.
    if (!sopExists(sopId)) throw new HttpError(404, `sop not found: ${sopId}`)

    const body = (await req.json()) as {
      items?: { item_id?: string; checked?: boolean; note?: string | null }[]
    }
    if (!Array.isArray(body.items)) throw new HttpError(422, "items array is required")

    const items = body.items.map((item) => {
      if (!item.item_id) throw new HttpError(422, "each item requires item_id")
      if (typeof item.checked !== "boolean") {
        throw new HttpError(422, "each item requires a boolean 'checked'")
      }
      return { item_id: item.item_id, checked: item.checked, note: item.note ?? null }
    })

    const row = {
      id: newId("scr"),
      site_id: siteId,
      org_id: auth.orgId,
      sop_id: sopId,
      items_json: items,
      performed_by: auth.userId,
      performed_at: new Date().toISOString(),
    }
    const { error } = await auth.db.from(T.sopChecklistRuns).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "sop_checklist_runs",
      entityId: row.id,
      action: "create",
      diff: { before: null, after: { sop_id: sopId, items } },
    })

    return NextResponse.json(
      {
        id: row.id,
        site_id: row.site_id,
        org_id: row.org_id,
        sop_id: row.sop_id,
        items: row.items_json,
        performed_by: row.performed_by,
        performed_at: row.performed_at,
      },
      { status: 201 },
    )
  })
}
