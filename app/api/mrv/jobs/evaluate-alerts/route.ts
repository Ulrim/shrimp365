/**
 * 알림 배치 평가 실행 창구 — 원본 `apps/api/worker.py` 가 하던 일을 여기서 한다.
 *
 * 원본은 상주 워커 프로세스가 APScheduler 로 15분마다 `job_evaluate_alerts` 를 돌렸다.
 * 이 배포 형태에는 상주 프로세스가 없으므로, 같은 일을 **스케줄러가 때려 주는 라우트**로
 * 옮긴다. Vercel Cron 이 `vercel.json` 의 일정대로 GET 을 보내고, 그 밖의 스케줄러
 * (Supabase pg_cron, 외부 모니터링 등)나 사람이 손으로 돌릴 때는 POST 를 쓴다. 둘 다
 * 같은 함수를 부르고 같은 응답을 낸다.
 *
 * ★ 인증은 세션이 아니라 CRON_SECRET 이다(스케줄러에는 사람 세션이 없다).
 *   이 창구는 모든 조직의 사이트를 평가하므로 어떤 사용자 세션으로도 열어서는 안 된다.
 *   비밀값이 설정돼 있지 않으면 **열어 두지 않고 503 으로 닫는다** — 설정을 깜빡한 배포에서
 *   인증 없는 전 조직 접근 창구가 조용히 열려 있는 것이 가장 나쁜 결과다.
 *
 * 응답은 무엇이 만들어졌는지 요약만 준다(알림 본문은 조직별 조회 API 로 본다).
 */

import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { handleRoute, HttpError } from "@/lib/mrv/http"
import { mrvDb } from "@/lib/mrv/db"
import { jobEvaluateAlerts } from "@/lib/mrv/alert-jobs"

/** 배치가 사이트를 많이 돌면 기본 실행 시간을 넘길 수 있다. */
export const maxDuration = 300
export const dynamic = "force-dynamic"

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다(길이 노출은 감수한다).
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function authorizeCron(req: NextRequest): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    throw new HttpError(
      503,
      "CRON_SECRET is not configured; alert evaluation endpoint is disabled",
    )
  }
  // Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 를 붙여 보낸다.
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
    const result = await jobEvaluateAlerts(mrvDb())

    // 사이트 단위 실패는 배치를 멈추지 않지만 조용히 넘어가서도 안 된다.
    if (result.failures.length > 0) {
      console.error("[mrv] alert evaluation partial failure", result.failures)
    }

    return NextResponse.json({
      evaluated_sites: result.evaluatedSites,
      created_count: result.created.length,
      created: result.created.map((a) => ({
        id: a.id,
        site_id: a.siteId,
        type: a.type,
        severity: a.severity,
      })),
      failed_sites: result.failures.length,
      duration_ms: Date.now() - startedAt,
    })
  })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
