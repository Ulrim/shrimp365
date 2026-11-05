/**
 * 리포트 주간/월간 자동 생성 실행 창구. (사양서 화면 6번 "자동 생성 · 이메일 발송")
 *
 * `/api/mrv/jobs/evaluate-alerts` 와 같은 모양이다 — Vercel Cron 이 `vercel.json` 의
 * 일정대로 GET 을 보내고, 그 밖의 스케줄러나 사람이 손으로 돌릴 때는 POST 를 쓴다.
 * 둘 다 같은 함수를 부르고 같은 응답을 낸다.
 *
 * ★ 인증은 세션이 아니라 CRON_SECRET 이다. 이 창구는 **모든 조직**의 일정을 돌며
 *   리포트를 만들고 메일을 보내므로 어떤 사용자 세션으로도 열어서는 안 된다. 비밀값이
 *   없으면 503 으로 닫는다 — 설정을 깜빡한 배포에서 전 조직 리포트가 조용히 발송되는
 *   것이 가장 나쁜 결과다.
 *
 * 하루에 한 번 두드려도 된다(Vercel Hobby 상한). 기간 규칙이 `last_period_end` 로
 * 중복을 막으므로 월요일/1일이 아닌 날에는 아무것도 만들지 않는다(lib/mrv/report-jobs.ts).
 */

import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { handleRoute, HttpError } from "@/lib/mrv/http"
import { mrvDb } from "@/lib/mrv/db"
import { jobGenerateReports } from "@/lib/mrv/report-jobs"

/** 일정이 많으면 리포트 산출(KPI 두 기간 + 스냅샷)이 기본 실행 시간을 넘길 수 있다. */
export const maxDuration = 300
export const dynamic = "force-dynamic"

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function authorizeCron(req: NextRequest): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    throw new HttpError(503, "CRON_SECRET is not configured; report generation endpoint is disabled")
  }
  const header = req.headers.get("authorization") ?? ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (!constantTimeEquals(bearer, secret)) {
    throw new HttpError(401, "invalid or missing cron credentials")
  }
}

async function run(req: NextRequest): Promise<NextResponse> {
  return handleRoute(async () => {
    authorizeCron(req)
    const startedAt = Date.now()
    const result = await jobGenerateReports(mrvDb())

    if (result.failures.length > 0) {
      console.error(`[mrv] 리포트 자동 생성: 일정 ${result.failures.length}건 실패`)
      for (const f of result.failures) console.error(`  - ${f}`)
    }

    return NextResponse.json({
      evaluated_schedules: result.evaluatedSchedules,
      generated: result.generated,
      outcomes: result.outcomes.map((o) => ({
        schedule_id: o.scheduleId,
        site_id: o.siteId,
        cadence: o.cadence,
        status: o.status,
        report_id: o.reportId,
        period: o.period,
        deliveries: o.deliveries,
        error: o.error,
      })),
      failures: result.failures,
      elapsed_ms: Date.now() - startedAt,
    })
  })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
