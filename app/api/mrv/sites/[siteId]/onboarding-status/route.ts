/**
 * GET /api/mrv/sites/{siteId}/onboarding-status — 온보딩 진행 상태.
 * 원본: apps/api/app/routers/onboarding.py
 *
 * 별도 상태 테이블을 두지 않고 매 요청마다 기존 데이터에서 파생 계산한다.
 * 상태를 따로 저장하면 실제 데이터와 어긋나는 순간(동기화 버그)이 반드시 생기는데,
 * 파생 계산에는 그 어긋남 자체가 존재할 수 없다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"

const STEP_ORDER = ["install_kit", "sensor_mapping", "baseline_locked", "plan_active"] as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const [apiKeys, meters, baseline] = await Promise.all([
      auth.db.from(T.apiKeys).select("id", { count: "exact", head: true }).eq("site_id", siteId),
      auth.db.from(T.meters).select("id", { count: "exact", head: true }).eq("site_id", siteId),
      auth.db
        .from(T.baselines)
        .select("id")
        .eq("site_id", siteId)
        .eq("status", "locked")
        .maybeSingle(),
    ])
    if (apiKeys.error) throw apiKeys.error
    if (meters.error) throw meters.error
    if (baseline.error) throw baseline.error

    const apiKeyCount = apiKeys.count ?? 0
    const meterCount = meters.count ?? 0
    const hasBaseline = Boolean(baseline.data)
    const plan = auth.plan

    const steps = {
      install_kit: {
        done: apiKeyCount > 0,
        detail: apiKeyCount > 0 ? "api_keys 1개 이상 발급됨" : "발급된 api_keys 없음",
      },
      sensor_mapping: {
        done: meterCount > 0,
        detail: meterCount > 0 ? `meters ${meterCount}개 등록됨` : "등록된 meters 없음",
      },
      baseline_locked: {
        done: hasBaseline,
        detail: hasBaseline ? "잠긴 baseline 있음" : "잠긴 baseline 없음",
      },
      plan_active: {
        done: plan !== "START",
        detail: `현재 플랜: ${plan}${plan === "START" ? "(무료/평가)" : ""}`,
      },
    }

    // 아직 끝나지 않은 첫 단계가 지금 할 일이다. 전부 끝났으면 null.
    const currentStep = STEP_ORDER.find((key) => !steps[key].done) ?? null

    return NextResponse.json({ site_id: siteId, steps, current_step: currentStep })
  })
}
