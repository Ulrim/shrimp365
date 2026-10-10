/**
 * 리포트 + 참조 배출계수 로드(org 스코프 재검증 포함).
 * 원본 `routers/mrv_reports.py` 가 여러 엔드포인트에서 반복하던 조회를 한곳에 모았다.
 */

import { HttpError } from "./http"
import { T, type MrvDb } from "./db"
import type { EmissionFactorRow, MrvReportRow } from "./mrv-report-service"

export async function loadReportForOrg(
  db: MrvDb,
  reportId: string,
  orgId: string,
): Promise<{ report: MrvReportRow; emissionFactor: EmissionFactorRow }> {
  const { data, error } = await db
    .from(T.reports)
    .select("*")
    .eq("id", reportId)
    .maybeSingle()
  if (error) throw error

  const report = data as MrvReportRow | null
  // 리포트는 사이트 내부 운영 정보다. 타 org 에는 존재 사실도 숨긴다(403 이 아니라 404).
  if (!report || report.org_id !== orgId) {
    throw new HttpError(404, `mrv report not found: ${reportId}`)
  }

  const { data: efData, error: efError } = await db
    .from(T.emissionFactors)
    .select("*")
    .eq("id", report.emission_factor_id)
    .maybeSingle()
  if (efError) throw efError
  if (!efData) {
    // 배출계수는 append-only 이고 리포트가 RESTRICT 로 참조하므로 여기 오면 DB 가 깨진 것이다.
    throw new HttpError(500, "referenced emission factor missing")
  }

  return { report, emissionFactor: efData as EmissionFactorRow }
}
