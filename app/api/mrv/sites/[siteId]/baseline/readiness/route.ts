/**
 * GET /api/mrv/sites/{siteId}/baseline/readiness?from=&to= — 잠그기 전 충분성 점검.
 *
 * 원본에는 없는 창구다. 기준선 잠금은 되돌릴 수 없는데(ADR 0002) 잠금 라우트가 입력
 * 충분성을 전혀 보지 않아 **계측값 몇 건짜리 기준선도 영구히 박혔다.** 막는 것만으로는
 * 부족하다 — 운영자가 **누르기 전에** 무엇이 모자란지 보고 기간을 다시 고를 수 있어야
 * 하므로, 같은 판정을 읽기 전용으로 먼저 돌려 주는 창구를 둔다.
 *
 * 이 창구는 아무것도 쓰지 않는다. 산출도 다시 하지 않는다 — 잠금 라우트와 **같은 함수**로
 * 같은 판정을 낸다(`assessBaselineReadiness`). 두 곳이 갈라지면 "미리보기는 통과라고
 * 했는데 잠금은 거부한다" 가 생기므로, 판정은 한 곳에만 둔다.
 *
 * 읽기이므로 viewer 도 볼 수 있다. 잠금만 owner/operator 다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute, parsePeriod } from "@/lib/mrv/http"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { computeSiteKpiResults } from "@/lib/mrv/kpi-service"
import { assessBaselineReadiness } from "@/lib/mrv/baseline-readiness"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    const { from, to } = parsePeriod(new URL(req.url))

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const comp = await computeSiteKpiResults(auth.db, siteId, from, to)
    const readiness = assessBaselineReadiness(
      comp,
      { from, to },
      // 활성 설정을 다시 읽지 않는다. 엔진이 방금 쓴 그 문서를 그대로 받는다 —
      // 둘 사이에 설정이 바뀌면 판정과 산출이 다른 기준을 쓰게 된다.
      comp.paramsOut,
    )

    return NextResponse.json({
      site_id: siteId,
      period: { from: from.toISOString(), to: to.toISOString() },
      config_version: comp.configVersion,
      ok: readiness.ok,
      fatal: readiness.fatal,
      policy_source: readiness.policySource,
      policy: {
        min_period_days: readiness.policy.minPeriodDays,
        min_power_readings: readiness.policy.minPowerReadings,
        min_feed_logs: readiness.policy.minFeedLogs,
        max_excluded_reading_ratio: readiness.policy.maxExcludedReadingRatio,
      },
      checks: readiness.checks,
    })
  })
}
