/**
 * POST /api/mrv/sites/{siteId}/mrv-reports/generate — MRV 리포트 생성.
 * 원본: apps/api/app/routers/mrv_reports.py::generate_mrv_report_endpoint
 *
 * 이 엔드포인트의 산출물이 곧 과제의 탄소저감 성과 증빙이다. 그래서 리포트는
 * append-only 다 — 수정 경로를 두지 않고, 다시 만들면 새 리포트가 발급된다.
 * 권한: PRO 이상 + owner/operator.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { generateMrvReport, mrvReportToResponse } from "@/lib/mrv/mrv-report-service"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requirePlan(requireWriter(await authorizeMrv(req)), "PRO", "ENTERPRISE")

    const body = (await req.json()) as {
      after_period?: { from?: string; to?: string }
      emission_factor_id?: string | null
      /** 맞춤 서식(ENTERPRISE). 서식은 보여 주기만 바꾼다 — 산식·계수·기간은 못 건드린다. */
      template_id?: string | null
    }
    if (!body.after_period?.from || !body.after_period?.to) {
      throw new HttpError(422, "after_period.from and after_period.to are required")
    }
    const from = parseInstant(body.after_period.from, "after_period.from")
    const to = parseInstant(body.after_period.to, "after_period.to")
    if (from.getTime() >= to.getTime()) {
      throw new HttpError(422, "'from' must be strictly before 'to'")
    }

    // 맞춤 서식은 ENTERPRISE 기능(사양서 화면 13번). 고르지 않으면 PRO 도 기본 서식으로 발행한다.
    if (body.template_id) requirePlan(auth, "ENTERPRISE")

    const site = await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const result = await generateMrvReport({
      db: auth.db,
      site,
      orgId: auth.orgId,
      userId: auth.userId,
      afterPeriodFrom: from,
      afterPeriodTo: to,
      emissionFactorId: body.emission_factor_id ?? null,
      templateId: body.template_id ?? null,
    })

    return NextResponse.json(
      mrvReportToResponse(result.report, result.emissionFactor),
      { status: 201 },
    )
  })
}
