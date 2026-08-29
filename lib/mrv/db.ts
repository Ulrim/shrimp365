/**
 * MRV 데이터 접근 — Supabase service-role 클라이언트와 테이블 이름 상수.
 *
 * 원본은 SQLAlchemy 세션으로 자체 PostgreSQL 에 붙고, 요청마다 `SET app.current_org_id`
 * 를 걸어 RLS 가 테넌트를 좁히게 했다. 이식본은 shrimp365 가 이미 쓰는 방식을 따른다:
 * 라우트가 service-role 로 붙고(RLS 우회), org 스코프는 authorizeMrv() 가 확정한
 * org_id 로 **질의마다 명시적으로** 좁힌다.
 *
 * ⚠ service-role 은 RLS 를 우회하므로, 이 클라이언트를 쓰는 경로에서는 라우트의 권한
 * 확인이 곧 유일한 방어선이다. org_id 필터 없는 질의를 절대 만들지 말 것.
 * (RLS 는 그래도 남겨 둔다 — 다른 경로로 DB 에 닿았을 때의 2차 방어선이다.)
 *
 * 클라이언트 번들에 들어가면 안 되므로 서버(라우트 핸들러) 밖에서 import 하지 말 것.
 */

import { createAdminClient } from "@/lib/supabase-server"

/** shrimp365 의 public 스키마와 섞이지 않도록 모든 MRV 테이블에는 접두사가 붙어 있다. */
export const T = {
  organizations: "mrv_organizations",
  users: "mrv_users",
  sites: "mrv_sites",
  tanks: "mrv_tanks",
  batches: "mrv_batches",
  meters: "mrv_meters",
  readings: "mrv_readings",
  feedLogs: "mrv_feed_logs",
  mortalityLogs: "mrv_mortality_logs",
  harvestLogs: "mrv_harvest_logs",
  kpiConfig: "mrv_kpi_config",
  kpiSnapshots: "mrv_kpi_snapshots",
  baselines: "mrv_baselines",
  recipes: "mrv_recipes",
  recipeVersions: "mrv_recipe_versions",
  controlActions: "mrv_control_actions",
  emissionFactors: "mrv_emission_factors",
  reports: "mrv_reports",
  sopChecklistRuns: "mrv_sop_checklist_runs",
  alerts: "mrv_alerts",
  auditLogs: "mrv_audit_logs",
  apiKeys: "mrv_api_keys",
} as const

export type MrvDb = ReturnType<typeof createAdminClient>

export function mrvDb(): MrvDb {
  return createAdminClient()
}

/**
 * Supabase 는 한 번에 최대 1000행만 준다. 계측값(readings)은 그보다 훨씬 많을 수 있는데
 * 그냥 조회하면 1001번째부터 조용히 잘려 **KPI 가 틀린 값으로 계산된다**(오류도 나지
 * 않는다 — 가장 위험한 형태의 버그다). 범위를 나눠 끝까지 읽는다.
 * shrimp365 의 관제센터 라우트가 쓰는 fetchAll 과 같은 방식이다.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break // 마지막 페이지
  }
  return out
}

/** 새 행 id. 원본이 String(64) 로 두었던 자리이며 uuid 가 그 안에 들어간다. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}
