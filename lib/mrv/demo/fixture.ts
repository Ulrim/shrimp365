/**
 * 공개 데모(/mrv/demo)가 쓰는 시연 자료.
 *
 * ── 무엇인가 ──────────────────────────────────────────────────────────────
 * 로컬 Supabase 스텁(무안 양식장 · 수조 2 · 계측기 3 · 30일 시계열)에 프로덕션 빌드를 띄우고
 * 실제 API 를 불러 받은 응답을 **그대로** 담은 JSON 이다(fixture.json). 숫자는 전부 산식
 * 엔진(lib/mrv/kpi)과 증빙 계층(기준선 비교 · Scope 2 market-based · 리포트 서식)이 낸 값이다.
 *
 * ── 왜 서버를 부르지 않는가 ───────────────────────────────────────────────
 * 데모는 로그인 없이 열린다. 익명 요청이 조직 자료에 닿는 길을 하나라도 열면 멀티테넌시
 * 격리가 깨지므로, 데모는 API 를 한 번도 부르지 않고 이 파일만 읽는다. 그래서 어떤 값도
 * 실제 고객 자료가 아니고, 값의 크기 자체에는 의미가 없다 — 화면이 그 사실을 적는다.
 *
 * ── 다시 만들려면 ─────────────────────────────────────────────────────────
 * 스텁 위에서 리포트 · 증서 · 서식 · 실험 · 제어 액션 · 알림을 만든 뒤 각 GET 응답을 모아
 * fixture.json 에 쓴다(2026-11-06 캡처). 화면 코드는 응답 모양(lib/mrv/api-types)만 알므로
 * 다시 캡처해도 화면은 바뀌지 않는다. 절대 규칙 1·6 — 화면은 재계산하지 않는다.
 */

import raw from "./fixture.json"
import type {
  AlertsResponse,
  ComparisonResponse,
  ControlActionListResponse,
  ExperimentResultResponse,
  KpiResponse,
  MeterListResponse,
  MrvReportResponse,
  RecommendationsResponse,
  SiteSummary,
} from "@/lib/mrv/api-types"
import type { WireReadingsResponse } from "@/lib/mrv/ui/use-site-readings"

export type DemoFixture = {
  readonly generated_at: string
  readonly note: string
  readonly site: SiteSummary
  readonly period: { readonly from: string; readonly to: string }
  readonly kpi: KpiResponse
  readonly meters: MeterListResponse
  /** 계측기 id → GET /sites/{id}/readings?meter_id=…&granularity=daily 응답(wire 모양). */
  readonly readings: Record<string, WireReadingsResponse>
  readonly comparison: ComparisonResponse
  readonly report: MrvReportResponse
  readonly experiment: ExperimentResultResponse
  readonly alerts: AlertsResponse
  readonly recommendations: RecommendationsResponse
  readonly control_actions: ControlActionListResponse
}

export const DEMO_FIXTURE: DemoFixture = raw as unknown as DemoFixture
