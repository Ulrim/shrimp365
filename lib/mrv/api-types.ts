/**
 * MRV 플랫폼 API 계약 타입.
 *
 * 원본: mrv-platform/apps/web/src/types/api.ts — 이식하며 한 줄도 바꾸지 않았다.
 * 서버(app/api/mrv/**)와 화면(app/mrv/**)이 같은 파일을 참조하므로, 계약이 어긋나면
 * 타입 체크에서 바로 드러난다(원본은 FastAPI/Pydantic 과 이 파일이 따로 놀 수 있었다).
 * JSON 키를 snake_case 로 유지하는 것도 그 때문이다 — 원본 API 응답 형태를 그대로 지킨다.
 */

/*
 * 백엔드 OpenAPI 계약의 손수 미러 (스프린트 0).
 * 원천: docs/design/sprint-0.md 2.4절. 계약 타입을 임의로 변경하지 말 것.
 * 백엔드 OpenAPI가 준비되면 생성 타입으로 교체한다.
 */

export type KpiMetricStatus = "green" | "amber" | "red" | "na";

export interface KpiMetric {
  value: number | null; // null = 산출 불가 → 카드에 "산출 불가" 표기
  unit: string; // "kWh/kg"
  status: KpiMetricStatus;
}

export type KpiMetrics = {
  ei_total: KpiMetric | null;
  ei_aeration: KpiMetric | null;
  oei: KpiMetric | null;
  fcr: KpiMetric | null;
  mortality_rate: KpiMetric | null;
};

/**
 * 폐사율 일자/이동평균 확장(phase-1 1.3). 응답에 오면 사용, 없으면 undefined.
 * 카드는 누적률(mortality_rate)만 표시하고, 이 시계열은 drill-down/차트 용도(Phase 2).
 */
export interface DailyMortalityPoint {
  date: string; // UTC 일자 (YYYY-MM-DD)
  dead_count: number;
  daily_rate_pct: number | null;
}
export interface MovingAvgMortalityPoint {
  date: string;
  ma_rate_pct: number | null;
}

export interface KpiResponse {
  site_id: string;
  org_id: string;
  period: { from: string; to: string; granularity: string };
  kpi_config: { version: string; params: Record<string, unknown> };
  metrics: KpiMetrics;
  inputs: {
    total_power_kwh: number;
    aeration_power_kwh: number;
    biomass_start_kg: number;
    biomass_end_kg: number;
    biomass_delta_kg: number;
    included_reading_count: number;
    excluded_reading_count: number;
  };
  provenance: {
    source_meter_ids: string[];
    source_biomass_refs: string[];
    kpi_snapshot_id: string | null;
  };
  /** 폐사율 확장 시계열(선택). 백엔드가 반환하면 채워진다. */
  mortality_daily?: DailyMortalityPoint[];
  mortality_moving_avg?: MovingAvgMortalityPoint[];
  generated_at: string;
}

// KpiCard가 실제로 받는 최소 props (지표 1개 슬롯)
export type KpiMetricKey =
  | "ei_total"
  | "ei_aeration"
  | "oei"
  | "fcr"
  | "mortality_rate";

export interface KpiCardProps {
  title: string; // "전력집약도(EI)"
  metricKey: KpiMetricKey;
  metric: KpiMetric | null; // metrics[metricKey]
  configVersion: string; // kpi_config.version (근거 표기)
  period: { from: string; to: string };
  /**
   * 지표 방향성 표기. 지표별로 다르다:
   *   - EI(ei_total/ei_aeration)·FCR·폐사율(mortality_rate) = "낮을수록 좋음"
   *   - OEI(oei) = "높을수록 좋음"
   * 값 해석의 맥락을 사용자에게 알려 준다(산식 재계산 아님, 단순 라벨).
   */
  betterWhen?: "lower" | "higher";
}

// ---------------------------------------------------------------------------
// 기준선(baseline) 잠금 — phase-1 2.3절 계약 (슬라이스 C)
// ---------------------------------------------------------------------------

/** POST /sites/{siteId}/baseline/lock 요청 본문 */
export interface BaselineLockRequest {
  period: { from: string; to: string };
}

/**
 * GET /sites/{siteId}/baseline (현재 locked baseline)
 * POST /sites/{siteId}/baseline/lock (201) 응답.
 * metrics 값은 백엔드가 잠근 스냅샷 스칼라값 — 프론트에서 재계산 금지.
 */
export interface BaselineResponse {
  id: string;
  site_id: string;
  org_id: string;
  period: { from: string; to: string; granularity: string };
  status: "draft" | "locked";
  metrics: KpiMetrics;
  kpi_config: { version: string };
  provenance: { kpi_snapshot_id: string | null };
  locked_by: string | null;
  locked_at: string | null;
}

// ---------------------------------------------------------------------------
// 수기 입력 — feed_logs / mortality_logs (MASTER 화면4, 슬라이스 A/B 데이터원)
// ---------------------------------------------------------------------------

/** 입식 사이클(배치). 급이/폐사 입력의 대상 선택지. */
export interface Batch {
  id: string;
  tank_id: string;
  species: string;
  stocked_count: number;
  stocked_at: string;
  closed_at: string | null;
}

/** POST /sites/{siteId}/feed-logs 요청 */
export interface FeedLogRequest {
  batch_id: string;
  ts: string; // ISO8601 UTC
  feed_kg: number; // > 0
}

export interface FeedLogResponse {
  id: string;
  batch_id: string;
  ts: string;
  feed_kg: number;
}

/** POST /sites/{siteId}/mortality-logs 요청 */
export interface MortalityLogRequest {
  batch_id: string;
  ts: string; // ISO8601 UTC
  dead_count: number; // >= 0 정수
  cause_note?: string;
}

export interface MortalityLogResponse {
  id: string;
  batch_id: string;
  ts: string;
  dead_count: number;
  cause_note: string | null;
}

// ---------------------------------------------------------------------------
// 시계열 조회 — GET /sites/{siteId}/readings (phase-2 4.1/4.3절, 슬라이스 I)
// 백엔드 응답은 snake_case(ReadingsResponse: site_id/meter_id/quality_flag 등)이지만,
// FE 데이터 계약(phase-2.md 4.3절 ReadingSeries/DashboardFilterState)은 camelCase로 정의되어
// 있으므로 이 타입은 FE 카멜케이스 계약을 그대로 따른다. 와이어(snake_case) → 이 타입으로의
// 변환은 훅(features/dashboard/hooks/useSiteReadings.ts) 내부에서만 수행한다(재계산 아님, 단순 매핑).
// ---------------------------------------------------------------------------

export type ReadingQualityFlag = "ok" | "suspect" | "bad";
export type ReadingGranularity = "raw" | "hourly" | "daily";
export type ReadingMeterType = "power" | "do" | "temp" | "ph" | "orp" | "ec";

/** 단일 표시 포인트(원본 1행 또는 집계 1버킷). value는 KPI 산식에 투입되지 않는 표시 전용값. */
export interface ReadingPoint {
  ts: string; // ISO8601 UTC
  value: number;
  qualityFlag: ReadingQualityFlag;
  meterId?: string | null;
}

/** GET /sites/{siteId}/readings 응답(FE 계약, phase-2 4.1절 백엔드 응답의 카멜케이스 미러). */
export interface ReadingsResponse {
  siteId: string;
  meterId: string | null;
  type: string;
  granularity: ReadingGranularity;
  unit: string;
  points: ReadingPoint[];
}

// ---------------------------------------------------------------------------
// 알림(Alert) — GET /sites/{siteId}/alerts, POST /alerts/{id}/ack,
// PATCH /sites/{siteId}/alert-subscriptions (phase-2 1.6/1.7절, 슬라이스 H)
// ---------------------------------------------------------------------------

export type AlertType = "do_low" | "mortality_spike" | "kpi_red";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "ack";
/** GET /alerts?status= 필터 값(all은 FE 전용 조회 옵션, 백엔드도 동일하게 지원). */
export type AlertStatusFilter = "open" | "ack" | "all";

/** 알림 근거(payload) — 트리거된 값/임계값 등. 지표별 필드는 가변적이므로 열린 형태로 둔다. */
export interface AlertPayload {
  metric?: string;
  value?: number;
  threshold?: number;
  config_version?: string;
  [key: string]: unknown;
}

export interface AlertItem {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  payload: AlertPayload;
  status: AlertStatus;
  created_at: string;
  acked_by: string | null;
  acked_at: string | null;
}

export interface AlertsResponse {
  site_id: string;
  org_id: string;
  items: AlertItem[];
  total: number;
}

/** PATCH 요청 본문(부분 갱신). */
export interface AlertSubscriptionUpdateRequest {
  do_low?: boolean;
  mortality_spike?: boolean;
  kpi_red?: boolean;
}

export interface AlertSubscriptionsResponse {
  site_id: string;
  alert_enabled_types: Record<AlertType, boolean>;
}

// ---------------------------------------------------------------------------
// 전·후(A/B) 비교 — GET /sites/{siteId}/comparison (phase-2 3.2/3.3절, 슬라이스 J)
// ---------------------------------------------------------------------------

export type ComparisonDirection = "lower_is_better" | "higher_is_better";
export type ComparisonMetricKey =
  | "ei_total"
  | "ei_aeration"
  | "oei"
  | "fcr"
  | "mortality_rate";

export interface ComparisonPeriodMetrics {
  period: { from: string; to: string };
  config_version: string;
  metrics: Record<string, number | null>;
}

export interface ComparisonRow {
  delta: number | null;
  improvement_pct: number | null;
  direction: ComparisonDirection;
}

export interface ComparisonProvenance {
  baseline_id: string;
  current_kpi_snapshot_id: string | null;
}

/** GET /sites/{siteId}/comparison 응답(백엔드 그대로, phase-2 3.2절). */
export interface ComparisonResponse {
  site_id: string;
  baseline: ComparisonPeriodMetrics;
  current: ComparisonPeriodMetrics;
  comparison: Record<string, ComparisonRow>;
  provenance: ComparisonProvenance;
}

/** FE 표시용 1개 지표 행(phase-2 3.3절). */
export interface ComparisonMetricRow {
  key: ComparisonMetricKey;
  label: string;
  baselineValue: number | null;
  currentValue: number | null;
  deltaValue: number | null;
  improvementPct: number | null;
  direction: ComparisonDirection;
}

/** FE 표시용 뷰모델(phase-2 3.3절) — apiFetch 응답을 그대로 매핑(재계산 아님). */
export interface ComparisonViewModel {
  baselinePeriod: { from: string; to: string };
  currentPeriod: { from: string; to: string };
  rows: ComparisonMetricRow[];
  baselineConfigVersion: string;
  currentConfigVersion: string;
}

// ---------------------------------------------------------------------------
// 추천(운전 레시피) 보드 — GET /sites/{siteId}/recommendations,
// POST /recipes/{id}/versions (phase-2 2.3/2.4절, 슬라이스 K)
// ---------------------------------------------------------------------------

export type RecipeType = "feed" | "oxygen" | "circulation";

/** 추천값(백엔드 그대로) — 필드가 null이면 근거 부족으로 추천 불가. */
export interface RecommendationParams {
  feed_kg_per_day?: number | null;
  oxygen_target_do_mg_l?: number | null;
  circulation_setting?: string | null;
  [key: string]: unknown;
}

/** 근거 drill-down 참조(지표별 참조 ID 목록). additive 필드 — 없을 수 있음. */
export type RecommendationSourceRefs = Record<string, readonly string[]>;

/** GET /sites/{siteId}/recommendations 응답의 items[] 1건(백엔드 그대로, 재계산 금지). */
export interface RecommendationItem {
  type: RecipeType;
  recipe_id: string;
  current_version: number;
  params: RecommendationParams;
  rationale: string;
  source_refs?: RecommendationSourceRefs;
  config_version: string;
  generated_at: string;
}

export type RecommendationStatus = "recommend_only";

/** GET /sites/{siteId}/recommendations 응답. */
export interface RecommendationsResponse {
  site_id: string;
  items: RecommendationItem[];
  status: RecommendationStatus;
}

/** POST /recipes/{id}/versions 요청 본문(수동 버전 추가, require_writer). */
export interface AddRecipeVersionRequest {
  params: Record<string, unknown>;
  rationale: string;
}

/** POST /recipes/{id}/versions 응답(201, 새 recipe_versions 행). */
export interface AddRecipeVersionResponse {
  id: string;
  recipe_id: string;
  version: number;
  params: Record<string, unknown>;
  rationale: string;
  created_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 인증 — Supabase JWT 클레임 (디버그 전용, ADR 0005)
// org_id/role/user_id는 Supabase JWT에 없다(Auth Hook 미채택) — 권한 게이팅은
// GET /auth/me(useAuthMe/AuthMeResponse)를 소스로 한다. 여기 남은 클레임은
// UI 디버그(세션 만료 확인 등)에만 쓰인다.
// ---------------------------------------------------------------------------

export type UserRole = "owner" | "operator" | "viewer";

/** Supabase JWT payload 디버그용 최소 클레임. 그 외 클레임은 무시. */
export interface AuthClaims {
  sub?: string;
  email?: string;
  exp?: number;
}

// ---------------------------------------------------------------------------
// MRV 리포트 — POST /sites/{siteId}/mrv-reports/generate, GET /mrv-reports/{id},
// GET /mrv-reports/{id}/pdf, GET /sites/{siteId}/mrv-reports, GET /kpi-snapshots/{id}
// (phase-3 1.4~1.7절, 슬라이스 M-FE, MASTER 화면10). 산식 재계산 금지 — 백엔드 응답을
// 그대로 표시한다. 백엔드 스키마 원천: apps/api/app/schemas/mrv_report.py,
// apps/api/app/schemas/kpi_snapshot.py(읽기 전용 참고, 이 파일은 수정하지 않음).
// ---------------------------------------------------------------------------

/** KpiPeriod(백엔드 공용) — from/to/granularity. granularity는 항상 "period" 고정값. */
export interface MrvPeriod {
  from: string;
  to: string;
  granularity: string;
}

/** before_json/after_json 구조(1.4절). ei_total/ei_aeration/scope2_tco2e는 null 가능(산출 불가). */
export interface MrvReportPeriodSummary {
  period: MrvPeriod;
  config_version: string;
  ei_total: number | null;
  ei_aeration: number | null;
  total_power_kwh: number;
  aeration_power_kwh: number;
  biomass_delta_kg: number;
  scope2_tco2e: number | null;
  kpi_snapshot_id: string | null;
}

/** 리포트에 실린 배출계수 근거 투영(1.5절 응답). */
export interface MrvReportEmissionFactor {
  version: string;
  source: string;
  year: number;
}

/** 측정경계·가정(1.6절 — 자동 생성, 자유 입력 아님). */
export interface MrvReportBoundary {
  site_id: string;
  site_name: string;
  included_meter_ids: string[];
  included_quality_flags: string[];
  biomass_source_refs: Record<string, string[]>;
  config_version: { before: string; after: string };
  assumptions: string[];
}

/** POST /sites/{siteId}/mrv-reports/generate 요청 본문(1.5절). */
export interface MrvReportGenerateRequest {
  after_period: { from: string; to: string };
  emission_factor_id?: string | null;
}

/** POST .../generate(201) · GET /mrv-reports/{id}(200) 공용 응답(1.5절). 재계산 금지. */
export interface MrvReportResponse {
  id: string;
  site_id: string;
  org_id: string;
  baseline_id: string;
  period: MrvPeriod;
  before: MrvReportPeriodSummary;
  after: MrvReportPeriodSummary;
  reduction_tco2e: number | null;
  formula_text: string;
  emission_factor: MrvReportEmissionFactor;
  boundary: MrvReportBoundary;
  pdf_available: boolean;
  generated_by: string;
  generated_at: string;
}

/** GET /sites/{siteId}/mrv-reports 응답(화면10 이력 목록). */
export interface MrvReportListResponse {
  items: MrvReportResponse[];
  total: number;
}

/** GET/POST /emission-factors 행(1.1절, 전역 설정 — org_id 없음, append-only). */
export interface EmissionFactor {
  id: string;
  factor_tco2e_per_mwh: number;
  source: string;
  year: number;
  version: string;
  effective_from: string;
  created_at: string;
}

/** GET /emission-factors 응답 — effective_from 내림차순(items[0]이 활성값). */
export interface EmissionFactorListResponse {
  items: EmissionFactor[];
}

/**
 * GET /kpi-snapshots/{id} 응답(1.7절 drill-down 종착점) — kpi_snapshots 1행 그대로.
 * before.kpi_snapshot_id/after.kpi_snapshot_id를 클릭해 여기로 들어가면 스칼라 5종 +
 * inputs_json + provenance_json + config_version까지 원본 근거를 역추적할 수 있다.
 */
export interface KpiSnapshotDetail {
  id: string;
  site_id: string;
  tank_id: string | null;
  org_id: string;
  period: MrvPeriod;
  ei_total: number | null;
  ei_aeration: number | null;
  oei: number | null;
  fcr: number | null;
  mortality_rate: number | null;
  config_version: string;
  inputs_json: Record<string, unknown>;
  provenance_json: Record<string, unknown>;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// 요금제(plan) — GET /auth/me (phase-2 QA 갭 해소).
// JWT 클레임에는 plan이 없다(조직 plan은 organizations 테이블에만 존재).
// PRO 이상 기능(전·후 비교, 추천 보드)의 선제 UI 게이팅(메뉴 노출 여부)에 사용한다.
// 최종 강제는 여전히 백엔드 403(이 값은 UI 힌트일 뿐).
// ---------------------------------------------------------------------------

export type Plan = "START" | "PRO" | "ENTERPRISE";

/** GET /auth/me 응답. */
export interface AuthMeResponse {
  org_id: string;
  role: UserRole;
  user_id: string;
  plan: Plan;
}

// ---------------------------------------------------------------------------
// SOP 라이브러리 — GET /sop, GET /sop/{id}, POST /sites/{siteId}/sop/{sopId}/checklist-runs,
// GET /sites/{siteId}/sop/checklist-runs (phase-3 2절, MASTER 화면8, PRO 이상).
// 콘텐츠(제목/본문/체크리스트 정의)는 정적 파일 기반(백엔드가 파일을 읽어 노출) — 편집 API
// 없음. 실행 기록(checklist-runs)만 append-only DB 테이블(증빙). 산식 없음(순수 조회/기록).
// ---------------------------------------------------------------------------

export type SopCategory = "normal" | "water_quality" | "do_drop" | "mortality_spike";

/** GET /sop 응답 items[] 1건. */
export interface SopSummary {
  id: string;
  title: string;
  category: SopCategory;
  summary: string;
}

export interface SopListResponse {
  items: SopSummary[];
}

/** SOP 상세의 체크리스트 항목 "정의"(정적 콘텐츠). 실행 기록의 item_id가 이 id를 참조한다. */
export interface SopChecklistItemDef {
  id: string;
  label: string;
}

/** GET /sop/{id} 응답. */
export interface SopDetail {
  id: string;
  title: string;
  category: SopCategory;
  body_markdown: string;
  checklist_items: SopChecklistItemDef[];
}

/** POST 요청 items[] 1건(2.2절 items_json 구조). */
export interface ChecklistRunItemInput {
  item_id: string;
  checked: boolean;
  note?: string;
}

/** POST /sites/{siteId}/sop/{sopId}/checklist-runs 요청 본문. */
export interface ChecklistRunRequest {
  items: ChecklistRunItemInput[];
}

/** 실행 기록 1건에 담긴 항목(응답, 2.2절 items_json 그대로 반영). */
export interface ChecklistRunItemRecord {
  item_id: string;
  checked: boolean;
  note: string | null;
}

/**
 * POST(201)/GET 이력 목록의 공통 실행 기록 shape(2.2절 DB 컬럼: id/site_id/org_id/sop_id/
 * items_json/performed_by/performed_at). append-only — 수정 API 없음.
 * 백엔드 구현(apps/api/app/schemas/sop.py::ChecklistRunResponse)과 필드 대조 확인됨.
 */
export interface ChecklistRunResponse {
  id: string;
  site_id: string;
  org_id: string;
  sop_id: string;
  items: ChecklistRunItemRecord[];
  performed_by: string;
  performed_at: string;
}

/**
 * GET /sites/{siteId}/sop/checklist-runs?sop_id=&from=&to= 응답. {items, total} shape은
 * 백엔드 구현(apps/api/app/schemas/sop.py::ChecklistRunListResponse)과 대조 확인됨.
 */
export interface ChecklistRunListResponse {
  items: ChecklistRunResponse[];
  total: number;
}

// ---------------------------------------------------------------------------
// 온보딩 마법사 — GET /sites/{siteId}/onboarding-status, POST/GET /sites/{siteId}/meters,
// GET /sites, PATCH /organizations/{orgId}/plan (phase-3 7절, MASTER 화면16, 공통·플랜무관).
// 신규 상태 테이블 없음(7.3절 — 매 요청 파생 계산). 산식 없음(존재 여부 판정, 순수 조회/기록).
// ---------------------------------------------------------------------------

export type OnboardingStepKey =
  | "install_kit"
  | "sensor_mapping"
  | "baseline_locked"
  | "plan_active";

export interface OnboardingStepStatus {
  done: boolean;
  detail: string;
}

/**
 * GET /sites/{siteId}/onboarding-status 응답(7.3절). current_step은 아직 끝나지 않은 첫
 * 단계 — 4단계 전부 완료면 null(백엔드 구현 apps/api/app/schemas/onboarding.py와 대조 확인됨).
 */
export interface OnboardingStatus {
  steps: Record<OnboardingStepKey, OnboardingStepStatus>;
  current_step: OnboardingStepKey | null;
}

/** meters.type — 기존 ReadingMeterType과 동일 열거값(계측기 종류, phase-1/2 재사용). */
export type MeterType = ReadingMeterType;

/**
 * GET/POST /sites/{siteId}/meters 1행(7.2절). unit은 계측기 종류별 자유 문자열(예:
 * "kWh_interval","mg_l"). 백엔드 구현(apps/api/app/schemas/meter.py::MeterResponse)과 필드
 * 대조 확인됨 — org_id 포함, label/certification_info는 nullable, certification_info는
 * 자유 JSON 객체(문자열 아님, MASTER 9장 규제훅 "자리만").
 */
export interface Meter {
  id: string;
  site_id: string;
  org_id: string;
  type: MeterType;
  unit: string;
  is_aeration: boolean;
  tank_id: string | null;
  label: string | null;
  certification_info?: Record<string, unknown> | null;
}

/** POST /sites/{siteId}/meters 요청 본문(7.2절). */
export interface MeterCreateRequest {
  type: MeterType;
  unit: string;
  is_aeration: boolean;
  tank_id?: string | null;
  label?: string | null;
  certification_info?: Record<string, unknown> | null;
}

/** MeterListResponse — {items, total} (백엔드 구현과 대조 확인됨). */
export interface MeterListResponse {
  items: Meter[];
  total: number;
}

// ---------------------------------------------------------------------------
// 승인형 제어 콘솔 — POST /control-actions, .../approve, .../reject, .../apply,
// GET /control-actions, GET /control-actions/{id} (phase-3 3절, MASTER 화면11,
// ENTERPRISE). "적용(apply)"은 human-in-the-loop 기록일 뿐 실제 액추에이터 제어가 아니다
// (3.0절). 산식 없음 — 승인 게이트 상태 전이(pending→approved→applied, 또는 →rejected)를
// 백엔드가 물리적으로 강제하고, FE는 그 상태를 그대로 표시·전이 요청만 한다(재계산 금지).
// ---------------------------------------------------------------------------

export type ControlActionStatus = "pending" | "approved" | "rejected" | "applied";
/** GET /control-actions?status= 필터 값(all은 FE 전용 조회 옵션). */
export type ControlActionStatusFilter = ControlActionStatus | "all";

/** control_actions 1행(3.1절). recommended_json은 제안 시점 recipe_versions.params_json 스냅샷. */
export interface ControlAction {
  id: string;
  tank_id: string;
  recipe_version_id: string;
  site_id: string;
  org_id: string;
  recommended_json: Record<string, unknown>;
  status: ControlActionStatus;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  result_json: Record<string, unknown> | null;
  created_at: string;
}

/** GET /control-actions 응답. */
export interface ControlActionListResponse {
  items: ControlAction[];
  total: number;
}

/** POST /control-actions 요청 본문(3.2절, require_writer + ENTERPRISE). */
export interface ControlActionProposeRequest {
  tank_id: string;
  recipe_version_id: string;
}

/** POST /control-actions/{id}/reject 요청 본문. */
export interface ControlActionRejectRequest {
  note: string;
}

/** POST /control-actions/{id}/apply 요청 본문. result_json은 자유 필드(운영자 관측/비고). */
export interface ControlActionApplyRequest {
  result_json: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 멀티사이트 벤치마크 — GET /sites/kpi-benchmark?from=&to= (phase-3 4.2절, MASTER 화면12,
// ENTERPRISE). 신규 산식 없음 — compute_site_kpi_results를 site별로 반복 호출한 결과를
// 그대로 나열한다. 정렬/랭킹/하이라이트는 FE 표시 로직(단순 비교, 신규 산식 아님).
// ---------------------------------------------------------------------------

export interface SiteBenchmarkMetrics {
  ei_total: number | null;
  ei_aeration: number | null;
  oei: number | null;
  fcr: number | null;
  mortality_rate: number | null;
}

/** GET /sites/kpi-benchmark 응답 sites[] 1건. */
export interface SiteBenchmarkRow {
  site_id: string;
  site_name: string;
  config_version: string;
  metrics: SiteBenchmarkMetrics;
}

/** GET /sites/kpi-benchmark 응답. */
export interface SiteKpiBenchmark {
  period: { from: string; to: string };
  sites: SiteBenchmarkRow[];
}

// ---------------------------------------------------------------------------
// 감사 로그 뷰어 — GET /audit-logs?entity=&action=&from=&to=&limit=&offset= (phase-3 5절,
// MASTER 화면14, ENTERPRISE). 신규 테이블 없음(Rule 9로 이미 쌓이고 있는 audit_logs 조회만).
// 읽기 전용 — viewer도 접근 가능(쓰기 게이트가 아니라 투명성 자체가 목적).
// ---------------------------------------------------------------------------

/** audit_logs 1행. diff는 {before, after} 등 자유 구조(entity별로 상이) — pretty-print만 한다. */
export interface AuditLogEntry {
  id: string;
  entity: string;
  entity_id: string;
  action: string;
  actor_id: string;
  diff: Record<string, unknown> | null;
  ts: string;
}

/** GET /audit-logs 응답. */
export interface AuditLogListResponse {
  items: AuditLogEntry[];
  total: number;
}

/** GET /sites 응답 items[] 1건(4.2절, org 소속 site 요약). region/ras_type은 nullable(백엔드 구현 대조 확인됨). */
export interface SiteSummary {
  id: string;
  name: string;
  region: string | null;
  ras_type: string | null;
}

export interface SitesListResponse {
  items: SiteSummary[];
  total: number;
}

/** PATCH /organizations/{orgId}/plan 요청 본문(7.4절, owner 한정). */
export interface OrgPlanUpdateRequest {
  plan: Plan;
}

/**
 * PATCH /organizations/{orgId}/plan 응답(id/plan — 백엔드 구현 apps/api/app/schemas/
 * organization.py::PlanUpdateResponse와 대조 확인됨). 성공 시 GET /auth/me 캐시도 함께
 * 무효화해 plan 변경을 즉시 반영한다(훅에서 처리).
 */
export interface OrgPlanUpdateResponse {
  id: string;
  plan: Plan;
}
