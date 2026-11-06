/**
 * GET /api/mrv/sop/{sopId} — SOP 상세(본문 + 체크리스트 정의, PRO 이상).
 * 원본: apps/api/app/routers/sop.py::get_sop
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { getSopDetail } from "@/lib/mrv/sop-content"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sopId: string }> },
) {
  return handleRoute(async () => {
    const { sopId } = await params
    requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")

    const detail = getSopDetail(sopId)
    if (!detail) throw new HttpError(404, `sop not found: ${sopId}`)

    return NextResponse.json({
      id: detail.id,
      title: detail.title,
      category: detail.category,
      body_markdown: detail.body_markdown,
      checklist_items: detail.checklist_items,
    })
  })
}
