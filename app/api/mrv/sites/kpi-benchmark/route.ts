/**
 * GET /api/mrv/sites/kpi-benchmark — org 의 모든 사이트 KPI 횡단 비교(ENTERPRISE).
 * 원본: apps/api/app/routers/sites.py::get_sites_kpi_benchmark
 *
 * 새 산식은 없다. 사이트마다 기존 computeSiteKpiResults 를 반복 호출할 뿐이다
 * — 벤치마크 전용 계산을 따로 만들면 산식이 두 벌이 되어 값이 갈린다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan } from "@/lib/mrv/auth"
import { handleRoute, parsePeriod } from "@/lib/mrv/http"
import { T, fetchAll } from "@/lib/mrv/db"
import { buildKpiUnavailability, computeSiteKpiResults } from "@/lib/mrv/kpi-service"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requirePlan(await authorizeMrv(req), "ENTERPRISE")
    const { from, to } = parsePeriod(new URL(req.url))

    const sites = await fetchAll<{ id: string; name: string }>((f, t) =>
      auth.db
        .from(T.sites)
        .select("id, name")
        .eq("org_id", auth.orgId)
        .order("id", { ascending: true })
        .range(f, t),
    )

    const entries = []
    for (const site of sites) {
      const comp = await computeSiteKpiResults(auth.db, site.id, auth.orgId, from, to)
      const metrics = {
        ei_total: comp.ei.eiTotal,
        ei_aeration: comp.ei.eiAeration,
        oei: comp.oei?.oei ?? null,
        fcr: comp.fcr.fcr,
        mortality_rate: comp.mortality.cumulativeRatePct,
      }
      entries.push({
        site_id: site.id,
        site_name: site.name,
        config_version: comp.configVersion,
        metrics,
        /**
         * 이 사업장에서 산출되지 않은 지표의 사유. 사업장마다 사유가 다르므로(한 곳은
         * DO 목표대역이 없고 다른 곳은 생산량 기록이 없다) 행마다 싣는다 — 새 산식이
         * 아니고, 이미 산출된 결과의 근거를 모아 문장으로 만든 것이다.
         */
        unavailability: buildKpiUnavailability(comp, metrics),
      })
    }

    return NextResponse.json({
      period: { from: from.toISOString(), to: to.toISOString(), granularity: "period" },
      sites: entries,
    })
  })
}
