/**
 * GET /api/mrv/sites/{siteId}/comparison — 잠긴 기준선 vs 현재 기간 KPI.
 * 원본: apps/api/app/routers/comparison.py
 *
 * 기준선은 저장된 값을 그대로 읽는다(재계산하지 않는다) — 기준선을 다시 계산하면
 * 그 사이 데이터가 보정됐을 때 "원점"이 조용히 움직여 비교 자체가 무의미해진다.
 *
 * 권한: PRO 이상 + viewer 차단. viewer 차단에 requireWriter 를 재사용하지 않는 이유는
 * 그 헬퍼가 쓰기 게이트(owner/operator 만 허용)라 viewer 아닌 다른 읽기 역할까지
 * 과도하게 막기 때문이다 — 계약이 말하는 "viewer만" 차단을 그대로 구현한다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parsePeriod } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { computeSiteKpiResults } from "@/lib/mrv/kpi-service"
import { METRIC_DIRECTION, compareMetric } from "@/lib/mrv/kpi"
import type { BaselineRow } from "@/lib/mrv/baseline"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE")
    if (auth.role === "viewer") {
      throw new HttpError(403, "viewer role cannot access comparison")
    }
    const { from, to } = parsePeriod(new URL(req.url), "compare_from", "compare_to")

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const { data, error } = await auth.db
      .from(T.baselines)
      .select("*")
      .eq("site_id", siteId)
      .eq("status", "locked")
      .maybeSingle()
    if (error) throw error
    if (!data) throw new HttpError(404, "baseline not locked")
    const bsl = data as BaselineRow

    const comp = await computeSiteKpiResults(auth.db, siteId, from, to)

    const baselineMetrics: Record<string, number | null> = {
      ei_total: bsl.ei_total,
      ei_aeration: bsl.ei_aeration,
      oei: bsl.oei,
      fcr: bsl.fcr,
      mortality_rate: bsl.mortality_rate,
    }
    const currentMetrics: Record<string, number | null> = {
      ei_total: comp.ei.eiTotal,
      ei_aeration: comp.ei.eiAeration,
      oei: comp.oei?.oei ?? null,
      fcr: comp.fcr.fcr,
      mortality_rate: comp.mortality.cumulativeRatePct,
    }

    const comparison: Record<string, unknown> = {}
    for (const [name, direction] of Object.entries(METRIC_DIRECTION)) {
      const result = compareMetric(baselineMetrics[name], currentMetrics[name], direction)
      comparison[name] = {
        delta: result.delta,
        improvement_pct: result.improvementPct,
        direction: result.direction,
      }
    }

    return NextResponse.json({
      site_id: siteId,
      baseline: {
        period: {
          from: bsl.period_start,
          to: bsl.period_end,
          granularity: "period",
        },
        config_version: bsl.config_version,
        metrics: baselineMetrics,
      },
      current: {
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
          granularity: "period",
        },
        config_version: comp.configVersion,
        metrics: currentMetrics,
      },
      comparison,
      provenance: {
        baseline_id: bsl.id,
        current_kpi_snapshot_id: null,
      },
    })
  })
}
