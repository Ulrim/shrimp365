/**
 * GET/POST /api/mrv/report-templates — 맞춤 리포트 서식. (ENTERPRISE, 사양서 화면 13번)
 * 원본: 없다.
 *
 * 서식은 **보여 주기만** 바꾼다 — 어떤 절을 넣고, 표에 어떤 지표를 올리고, 표지에 무엇을
 * 적을지. 산식·배출계수·기간은 서식이 건드리지 못한다(lib/mrv/report-template.ts).
 * 요약과 산식 전문은 뺄 수 없다 — 그것이 없는 문서는 증빙이 아니다.
 *
 * 조직 범위다(사이트별이 아니다). 같은 법인이 사이트마다 다른 서식으로 보고할 이유가
 * 없고, 있다면 서식을 둘 만들면 된다.
 *
 * 수정·삭제는 두지 않는다. 발행된 리포트가 서식을 `template_json` 에 얼려 들고 있으므로
 * 서식을 고쳐도 옛 리포트는 안전하지만, 그래도 "어느 서식으로 뽑았는가" 가 이름으로
 * 추적되려면 서식은 append-only 가 맞다. 고치려면 새 서식을 만든다(배출계수와 같다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner, requirePlan } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import { checkTemplate } from "@/lib/mrv/report-template"

const COLUMNS = "id, org_id, name, sections, metrics, cover_title, cover_note, is_default, created_at"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    // 읽기는 PRO 도 허용한다 — 리포트 생성 화면이 "서식을 고를 수 있는가" 를 알려면 목록이
    // 보여야 하고, 고르는 순간(생성)은 ENTERPRISE 게이트가 막는다.
    const auth = await authorizeMrv(req)
    const rows = await fetchAll((f, t) =>
      auth.db
        .from(T.reportTemplates)
        .select(COLUMNS)
        .eq("org_id", auth.orgId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json({ items: rows, total: rows.length })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(requirePlan(await authorizeMrv(req), "ENTERPRISE"))
    const body = (await req.json()) as Record<string, unknown>

    const checked = checkTemplate(body)
    if (!checked.ok) throw new HttpError(422, checked.detail)

    const isDefault = body.is_default === true
    if (isDefault) {
      // 기본 서식은 하나다. 기존 기본을 내린다 — 이것이 이 창구의 유일한 update 이고,
      // 서식 내용이 아니라 "어느 것이 기본인가" 라는 조직 설정이다.
      const { error } = await auth.db
        .from(T.reportTemplates)
        .update({ is_default: false })
        .eq("org_id", auth.orgId)
        .eq("is_default", true)
      if (error) throw error
    }

    const row = {
      id: newId("rpt-tpl"),
      org_id: auth.orgId,
      ...checked.value,
      is_default: isDefault,
      created_by: auth.userId,
    }
    const { error } = await auth.db.from(T.reportTemplates).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "report_templates",
      entityId: row.id,
      action: "create",
      diff: { before: null, after: { ...checked.value, is_default: isDefault } },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
