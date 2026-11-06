/**
 * GET   /api/mrv/sites/{siteId}/experiments/{experimentId} — 실험 + **지금 산출한** 결과
 * PATCH /api/mrv/sites/{siteId}/experiments/{experimentId} — 끝내기(concluded / abandoned)
 * 원본: 없다. 사정은 lib/mrv/experiments.ts.
 *
 * 결과는 저장하지 않고 조회 때마다 두 구간을 라이브로 산출한다. 실험 결과는 발행물이
 * 아니라 조회이고, 원천 기록이 보정되면 두 값이 함께 움직이는 것이 맞다. 발행이 필요하면
 * MRV 리포트로 낸다.
 *
 * 응답의 `result` 는 기준선 비교(`../comparison`)와 **같은 모양**이다 — 화면이 같은
 * 뷰모델(`toComparisonViewModel`)과 같은 표로 그린다. 두 비교가 다른 표로 보이면
 * "기준선 비교는 믿고 실험은 안 믿는" 인상을 준다. `baseline` 자리에 대조군, `current`
 * 자리에 처리군이 들어간다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { buildKpiUnavailability, computeSiteKpiResults } from "@/lib/mrv/kpi-service"
import { METRIC_DIRECTION, compareMetric } from "@/lib/mrv/kpi"
import { checkConclusion } from "@/lib/mrv/experiments"
import { EXPERIMENT_COLUMNS } from "../route"

type ExperimentRow = {
  id: string
  site_id: string
  org_id: string
  name: string
  hypothesis: string | null
  control_from: string
  control_to: string
  treatment_from: string
  treatment_to: string
  status: "running" | "concluded" | "abandoned"
  conclusion: string | null
  concluded_at: string | null
  created_by: string
  created_at: string
}

async function loadExperiment(
  auth: Awaited<ReturnType<typeof authorizeMrv>>,
  siteId: string,
  experimentId: string,
): Promise<ExperimentRow> {
  const { data, error } = await auth.db
    .from(T.experiments)
    .select(EXPERIMENT_COLUMNS)
    .eq("id", experimentId)
    .maybeSingle()
  if (error) throw error
  const row = data as ExperimentRow | null
  if (!row) throw new HttpError(404, `experiment not found: ${experimentId}`)
  if (row.org_id !== auth.orgId) throw new HttpError(403, "experiment does not belong to your organization")
  if (row.site_id !== siteId) throw new HttpError(404, "experiment does not belong to this site")
  return row
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; experimentId: string }> },
) {
  return handleRoute(async () => {
    const { siteId, experimentId } = await params
    const auth = requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")
    if (auth.role === "viewer") throw new HttpError(403, "viewer role cannot access experiments")
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const exp = await loadExperiment(auth, siteId, experimentId)

    const control = await computeSiteKpiResults(
      auth.db, siteId, auth.orgId, new Date(exp.control_from), new Date(exp.control_to),
    )
    const treatment = await computeSiteKpiResults(
      auth.db, siteId, auth.orgId, new Date(exp.treatment_from), new Date(exp.treatment_to),
    )
    // 사유 조립이 받는 키 집합과 같아야 한다(ei_total · ei_aeration · oei · fcr · mortality_rate).
    type Metrics = Parameters<typeof buildKpiUnavailability>[1]
    const metricsOf = (c: typeof control): Metrics => ({
      ei_total: c.ei.eiTotal,
      ei_aeration: c.ei.eiAeration,
      oei: c.oei?.oei ?? null,
      fcr: c.fcr.fcr,
      mortality_rate: c.mortality.cumulativeRatePct,
    })
    const controlMetrics = metricsOf(control)
    const treatmentMetrics = metricsOf(treatment)

    const comparison: Record<string, unknown> = {}
    for (const [name, direction] of Object.entries(METRIC_DIRECTION)) {
      const key = name as keyof Metrics
      const r = compareMetric(controlMetrics[key], treatmentMetrics[key], direction)
      comparison[name] = { delta: r.delta, improvement_pct: r.improvementPct, direction: r.direction }
    }

    return NextResponse.json({
      ...exp,
      result: {
        site_id: siteId,
        baseline: {
          period: { from: exp.control_from, to: exp.control_to, granularity: "period" },
          config_version: control.configVersion,
          metrics: controlMetrics,
          // 대조군도 라이브 산출이므로 사유를 낼 수 있다(기준선 비교와 다른 점).
          unavailability: buildKpiUnavailability(control, controlMetrics),
        },
        current: {
          period: { from: exp.treatment_from, to: exp.treatment_to, granularity: "period" },
          config_version: treatment.configVersion,
          metrics: treatmentMetrics,
          unavailability: buildKpiUnavailability(treatment, treatmentMetrics),
        },
        comparison,
        provenance: { baseline_id: null, current_kpi_snapshot_id: null, experiment_id: exp.id },
      },
    })
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; experimentId: string }> },
) {
  return handleRoute(async () => {
    const { siteId, experimentId } = await params
    const auth = requireWriter(requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE"))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const before = await loadExperiment(auth, siteId, experimentId)
    if (before.status !== "running") {
      throw new HttpError(409, `이미 끝난 실험입니다(${before.status}). 다시 열 수 없습니다 — 새 실험을 만드십시오.`)
    }

    const body = (await req.json().catch(() => ({}))) as { status?: unknown; conclusion?: unknown }
    const checked = checkConclusion(body)
    if (!checked.ok) throw new HttpError(422, checked.detail)

    const concludedAt = new Date().toISOString()
    const { error } = await auth.db
      .from(T.experiments)
      .update({ status: checked.status, conclusion: checked.conclusion, concluded_at: concludedAt })
      .eq("id", experimentId)
      .eq("status", "running")
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "experiments",
      entityId: experimentId,
      action: checked.status === "concluded" ? "conclude" : "abandon",
      diff: {
        before: { status: "running" },
        after: { status: checked.status, conclusion: checked.conclusion, concluded_at: concludedAt },
      },
    })
    return NextResponse.json({ ...before, status: checked.status, conclusion: checked.conclusion, concluded_at: concludedAt })
  })
}
