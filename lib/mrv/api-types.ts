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

import type {
  MetricUnavailabilityEvidence,
  MetricUnavailabilityReason,
} from "./metric-unavailability";

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

/**
 * 지표별 「산출 불가」 사유. 값이 null 인 지표만 키로 들어온다 — 산출된 지표에 사유를
 * 실으면 화면이 값 옆에 사유처럼 적는다.
 *
 * `evidence` 는 그 판정에 쓴 근거 수치다. 화면이 `reasons` 를 그대로 쓰든
 * `metricUnavailabilityReasons(key, evidence)` 로 다시 만들든 **같은 모듈의 출력**이므로
 * 화면 · 인쇄물 · API 가 갈릴 수 없다(lib/mrv/metric-unavailability.ts).
 */
export interface KpiUnavailability {
  evidence: MetricUnavailabilityEvidence;
  metrics: Partial<Record<KpiMetricKey, { reasons: MetricUnavailabilityReason[] }>>;
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
  /**
   * 지표별 '산출 불가' 사유(값이 null 인 지표만). **선택이다** — 이 칸을 넣기 전에
   * 저장된 응답이나 이 칸을 모르는 호출자가 있을 수 있고, 없는 것을 빈 객체로 읽으면
   * 화면이 "사유가 없다"(=조건을 다 만족했다)는 거짓을 적게 된다.
   */
  unavailability?: KpiUnavailability;
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
  /**
   * 값이 null 일 때 **왜 산출되지 않았는가**를 확정하는 근거(`KpiResponse.unavailability`
   * 의 `evidence`). 카드가 사유를 지어내지 않고 이 근거에서 만든다.
   *
   * 없으면(`undefined`) 카드는 "근거가 실려 있지 않아 확정할 수 없다" 고 적는다 —
   * 추측한 사유를 적지 않는다. 잠긴 기준선처럼 스칼라값만 있는 자리가 그렇다.
   */
  unavailabilityEvidence?: MetricUnavailabilityEvidence;
  /**
   * 근거가 없는 자리에서 "그 사유는 어디에 적혀 있는가" 를 알려 주는 한 줄.
   * `lib/mrv/metric-unavailability.ts` 의 `UNAVAILABILITY_LOOKUP_*` 중 하나를 넘긴다.
   */
  unavailabilityLookupNote?: string;
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

/**
 * GET /sites/{siteId}/baseline/readiness 의 검사 1건.
 *
 * severity: blocking = 통과해야 잠긴다(사유를 적으면 강행 가능, 단 all_metrics_null 제외).
 *           warning  = 막지 않지만 사람이 봐야 한다. info = 상태 알림.
 * observed/threshold 는 판정에 실제로 쓴 값이다 — 되돌릴 수 없는 결정이라 숫자를 숨기지 않는다.
 */
export interface BaselineReadinessCheck {
  id: string;
  severity: "blocking" | "warning" | "info";
  passed: boolean;
  message: string;
  observed?: number | null;
  threshold?: number | null;
}

/**
 * GET /sites/{siteId}/baseline/readiness 응답 — 잠그기 전 입력 충분성 점검.
 * 잠금 라우트와 **같은 판정 함수**를 쓰므로 여기서 ok 면 잠금도 통과한다.
 */
export interface BaselineReadinessResponse {
  site_id: string;
  period: { from: string; to: string };
  config_version: string;
  /** 차단 항목이 하나도 없는가. */
  ok: boolean;
  /** 사유를 적어도 넘길 수 없는 항목이 있는가. */
  fatal: boolean;
  /** 임계값이 kpi_config 에서 왔는지 코드 기본값인지. */
  policy_source: "kpi_config" | "default";
  policy: {
    min_period_days: number;
    min_readings_per_meter_day: number;
    min_feed_logs: number;
    max_excluded_reading_ratio: number;
  };
  checks: BaselineReadinessCheck[];
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
  /**
   * 지표별 '산출 불가' 사유(값이 null 인 지표만). **현재(After) 기간에만 실린다** —
   * 기준선(Before)은 잠긴 스냅샷에서 복사한 스칼라값이라 그 기간의 근거 수치가 이
   * 응답에 없다. 없는 것을 추측해 채우면 화면이 거짓 사유를 적는다.
   */
  unavailability?: KpiUnavailability;
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
  /**
   * 현재(After) 값이 산출되지 않은 사유. 서버가 내려 준 것을 그대로 담는다(뷰모델은
   * 사유를 짓지 않는다 — 산식도 문구도 재생산 금지라는 이 파일의 규약과 같은 이유다).
   */
  currentUnavailability?: MetricUnavailabilityReason[];
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
  /**
   * EI 의 산입 품질 플래그(`ei.included_quality_flags`). **옛 리포트에는 이 칸이 없다** —
   * 그래서 optional 이다. `undefined`(기록 없음)와 `[]`(빈 목록으로 산출됨)는 다른
   * 사실이므로 화면·인쇄물이 다르게 적는다(lib/mrv/quality-flags.ts 의
   * REPORT_MISSING_FLAGS_NOTE / EMPTY_QUALITY_FLAG_LIST_REASON).
   *
   * ⚠ 이 칸은 **EI 의 목록만** 담는다. fcr/oei/recommend 의 산입 범위는 리포트에
   * 들어가지 않는다(REPORT_COVERS_EI_FLAGS_ONLY).
   */
  included_quality_flags?: string[];
  /**
   * After 기간에 **산입된** 전력의 자료유형 집계 — 이 리포트의 EI·Scope2 배출량의 분자가
   * 계량기 실측인지, 산식으로 계산한 값인지.
   *
   * **옛 리포트에는 이 칸이 없다**(이 집계를 넣기 전에 발행된 것들). 그래서 optional 이고
   * `unknown` 이다 — `undefined`(기록 없음)를 0 집계로 뭉개면 "전부 실측" 이라는 거짓이
   * 된다. 읽는 쪽은 `readMeasurementBasisTally`(lib/mrv/measurement-basis.ts) 하나를 써서
   * 화면과 인쇄물이 같은 판정을 내린다.
   *
   * ⚠ **After 기간만** 담는다. Before(기준선)의 전력 자료유형은 잠긴 스냅샷의
   * `inputs_json.ei.measurement_basis` 에 있다(lib/mrv/snapshots.ts).
   */
  after_power_measurement_basis?: unknown;
  /**
   * After 기간의 **분모로 쓰인 생체량 두 점의 산정 근거** — 이 리포트의 EI·FCR 의 분모가
   * 실측 출하·계측량인지, 입식수 × 최종평균개체중으로 계산한 값인지.
   *
   * 전력 자료유형(`after_power_measurement_basis`)이 **분자**에 대해 하는 일을 **분모**에
   * 대해 한다. 둘을 함께 읽어야 "EI 가 낮은 것이 전기를 덜 쓴 결과인가, 생산량을 넉넉히
   * 가정한 결과인가" 가 갈린다.
   *
   * **집계가 아니라 두 점이다** — 기간에 수확 기록이 50건 있어도 Δbiomass 를 만든 것은
   * 양 끝 두 건뿐이다(lib/mrv/production-basis.ts).
   *
   * **옛 리포트에는 이 칸이 없다.** 그래서 optional 이고 `unknown` 이다 — `undefined`(기록
   * 없음)를 'measured' 로 뭉개면 "분모는 전부 실측" 이라는 거짓이 된다. 읽는 쪽은
   * `readBiomassBasis`(lib/mrv/production-basis.ts) 하나를 써서 화면과 인쇄물이 같은
   * 판정을 내린다.
   *
   * ⚠ **After 기간만** 담는다(전력 자료유형과 같은 이유).
   */
  after_biomass_basis?: unknown;
  /**
   * After 기간의 '산출 불가' 사유를 확정하는 근거 수치(생성 시점에 얼린 것).
   *
   * **옛 리포트에는 이 칸이 없다**(이 칸을 넣기 전에 발행된 것들). 그래서 optional 이고,
   * 없으면 화면·인쇄물이 "이 리포트는 그 근거를 담기 전에 발행됐다" 고 적는다
   * (UNAVAILABILITY_LOOKUP_OLD_REPORT) — 지금 다시 계산해 채우면 발행된 증빙이 사후에
   * 달라진다.
   *
   * ⚠ Before(기준선)의 근거는 여기 없다. 잠긴 스냅샷의 inputs_json 에 있다.
   */
  after_metric_evidence?: MetricUnavailabilityEvidence;
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
  /** 이 플랫폼이 새 리포트에 이 계수를 쓰기 시작하는 시점(데이터 연도는 `year`). */
  effective_from: string;
  created_at: string;
  /**
   * 사용 중단 시점. 비어 있지 않으면 **활성 계수 자동 선택에서 제외**된다.
   * 과거 리포트가 참조하는 행일 수 있어 삭제하지 않고 이 열로만 표시한다 —
   * 지우면 그 리포트의 계수 근거가 사라진다.
   */
  deprecated_at: string | null;
  /**
   * 온실가스 범위. 같은 승인분이 **CO2e 판과 CO2 판으로 둘 다 공표된다**
   * (2023년도분: CO2e 0.4173 / CO2 만 0.4149). 섞이면 되짚을 수 없다.
   */
  gas_scope: "CO2e" | "CO2";
  /**
   * 계수가 설명하는 기준 기간. 단년도는 두 값이 같고, 3년 평균은 다르다
   * (2024년 승인분 = 2020~2022 평균). 둘 다 있거나 둘 다 없다.
   * 사람이 읽는 대표 연도는 `year`, 기계가 읽는 기준 기간은 이 둘이다.
   */
  basis_from_year: number | null;
  basis_to_year: number | null;
  /** 공표 문서명. 검증기관에 제시하는 것이 이것이다. */
  document_name: string | null;
  issuing_body: string | null;
  /** 공표일(YYYY-MM-DD). */
  published_on: string | null;
  source_url: string | null;
  /**
   * GHG Protocol Scope 2 산정 방식. 지금 플랫폼의 계수는 전부 location_based 다.
   * ⚠ 이 값이 market-based 산정을 구현하지는 않는다(REC·PPA 테이블이 필요한 별건).
   */
  method: "location_based" | "market_based";
}

/** POST /emission-factors 요청 본문. 출처 칸은 전부 선택이지만 비면 검증에서 요구받는다. */
export interface EmissionFactorCreateRequest {
  factor_tco2e_per_mwh: number;
  source: string;
  year: number;
  version: string;
  effective_from: string;
  gas_scope?: "CO2e" | "CO2";
  basis_from_year?: number | null;
  basis_to_year?: number | null;
  document_name?: string | null;
  issuing_body?: string | null;
  published_on?: string | null;
  source_url?: string | null;
  method?: "location_based" | "market_based";
}

/**
 * GET /emission-factors 응답 — effective_from 내림차순.
 * ⚠ `items[0]` 이 곧 활성값은 아니다. 활성값은 **사용 중단(`deprecated_at`)이 아니고
 * 적용 시점(`effective_from`)이 이미 지난 첫 행**이다 — 서버의 자동 선택
 * (`lib/mrv/mrv-report-service.ts::loadEmissionFactor`)과 같은 기준이어야 한다.
 * 미래 날짜로 미리 등록해 둔 계수는 그 날짜가 되기 전까지 활성이 아니다.
 */
export interface EmissionFactorListResponse {
  items: EmissionFactor[];
}

/**
 * GET /kpi-config 행.
 *
 * `org_id`는 **nullable이고 null은 「플랫폼 기본값」**이다(조직 전용 행이 없을 때만
 * 쓰인다 — supabase/migrations/mrv_kpi_config_org_scope.sql). 목록에는 내 조직의 행과
 * 기본값 행만 온다.
 *
 * `params_json`은 엔진이 해석하는 자유 JSON이라 구조를 타입으로 묶지 않는다 —
 * 묶으면 엔진이 키를 더하는 날 화면이 먼저 깨진다. 화면은 표시만 한다.
 *
 * `created_at`/`created_by`/`note`는 쓰기 창구(POST) 이전에 SQL로 들어간 행에서는
 * null이다. 추정값으로 메우지 않는다 — 화면이 "등록 기록 없음"으로 적는다.
 */
export interface KpiConfigEntry {
  id: string;
  org_id: string | null;
  version: string;
  params_json: Record<string, unknown>;
  effective_from: string;
  created_at: string | null;
  created_by: string | null;
  note: string | null;
}

/**
 * GET /kpi-config 응답 — effective_from 내림차순.
 * `active_version`은 지금 KPI 판정에 실제로 쓰이는 버전이다. 화면이 items[0]을 보고
 * 다시 고르지 않도록 서버가 못 박아 준다(정렬 규칙이 둘로 갈리면 화면이 거짓말을 한다).
 * `active_scope`는 그 버전이 조직 전용 행인지 플랫폼 기본값인지다.
 */
export interface KpiConfigListResponse {
  items: KpiConfigEntry[];
  active_version: string | null;
  active_scope: "org" | "platform_default" | null;
}

/**
 * POST /kpi-config 요청 본문(owner 전용, append-only).
 *
 * 기존 행을 고치는 창구는 없다 — 과거 스냅샷이 어떤 파라미터로 산출됐는지
 * (`mrv_kpi_snapshots.config_version`) 추적 가능해야 하므로 새 `version` 행만 더한다.
 */
export interface KpiConfigCreateRequest {
  version: string;
  params_json: Record<string, unknown>;
  effective_from: string;
  /** 왜 바꾸는지. 감사 로그의 note 로 남는다. */
  note?: string | null;
}

/**
 * 산입 품질 플래그 위험 기록 1건.
 * `suspect`/`bad` 를 포함한 저장은 **거부되지 않는다**(정당한 이유가 있을 수 있다).
 * 대신 감사 로그와 응답에 "무엇을 포함했고 그 결과 어느 수치가 어떻게 틀어지는가"가 남는다.
 */
export interface QualityFlagRisk {
  /** 예: `"ei.included_quality_flags"`. */
  path: string;
  /** 어느 지표의 목록인가. 경고 문장이 블록마다 다르다(거르는 대상이 다르다). */
  block: "ei" | "fcr" | "oei" | "recommend";
  flags: ("suspect" | "bad")[];
  /** 사람이 읽는 결과 설명. */
  effect: string;
}

/**
 * POST /kpi-config 응답. 저장된 행 + 위험 산입 기록 + **무엇이 바뀌었는지**.
 *
 * `active`는 저장한 행이 지금 활성인가다(서버가 저장 뒤에 선택 규칙을 한 번 더 돌려
 * 확인한 값이다 — 추측이 아니다). `audit_recorded: false`는 설정 행은 저장됐지만
 * 감사 로그 한 줄이 남지 않았다는 뜻이다. 화면은 그 사실을 숨기지 말 것.
 */
export interface KpiConfigCreateResponse extends KpiConfigEntry {
  quality_flag_risks: QualityFlagRisk[];
  active: boolean;
  active_version: string | null;
  audit_recorded: boolean;
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
// 수조 — GET/POST /sites/{siteId}/tanks, PATCH /sites/{siteId}/tanks/{tankId}
// 원본에 없는 창구다. `target_do_min`/`target_do_max` 가 OEI 의 유일한 산출 조건인데
// 그 둘을 넣을 길이 DB 직접 수정뿐이었다. 사정은 app/api/mrv/sites/[siteId]/tanks/route.ts.
// ---------------------------------------------------------------------------

/** 수조. `target_do_*` 가 둘 다 있어야 그 수조가 OEI 의 기준 대역이 된다. */
export interface Tank {
  id: string;
  site_id: string;
  org_id: string;
  name: string;
  volume_m3: number | null;
  target_do_min: number | null;
  target_do_max: number | null;
}

export interface TankListResponse {
  items: Tank[];
  total: number;
}

// ---------------------------------------------------------------------------
// 장비 수집 키 — GET /api-keys?site_id=, POST /api-keys/{id}/revoke
// 원본에 없는 창구다. 발급(페어링 승인)만 있고 **끊는 경로가 없어서** 단말을 분실하면
// DB 직접 수정이 유일한 방법이었다. 자세한 사정은 app/api/mrv/api-keys/route.ts.
// ---------------------------------------------------------------------------

/**
 * 발급된 장비 수집 키 1건.
 *
 * ★ 원문 키도 해시도 들어 있지 않다(서버가 내보내지 않는다). 이 타입에 그런 칸을
 *   더하려 하지 말 것 — 목록을 열 수 있는 사람이 장비가 될 수 있으면 폐기 기능에
 *   의미가 없다.
 */
export interface MrvApiKey {
  id: string;
  site_id: string;
  /** 사람이 알아보는 이름. 페어링 때 비웠으면 장비 일련번호로 채워져 있다. */
  label: string | null;
  revoked: boolean;
  created_at: string;
  /**
   * 마지막으로 인증을 통과한 시각. **매 요청이 아니라 몇 분에 한 번만 갱신된다**
   * (계측값이 올라올 때마다 UPDATE 를 치면 수집 경로의 쓰기가 헛돈다). 분 단위
   * 정확도를 가정하지 말 것 — "이 장비가 아직 살아 있는가" 를 묻는 칸이다.
   * null 은 한 번도 쓰이지 않았다는 뜻이다(페어링만 하고 장비가 아직 안 올라온 상태).
   */
  last_used_at: string | null;
  /**
   * 끊은 시각. `revoked` 가 true 인데 이 칸이 null 이면 폐기 창구가 생기기 전에
   * SQL 직접 수정으로 끊긴 행이며, 끊긴 시각을 아는 기록이 없다는 뜻이다.
   */
  revoked_at: string | null;
  revoked_by: string | null;
}

export interface MrvApiKeyListResponse {
  items: MrvApiKey[];
  total: number;
}

/** POST /api-keys/{id}/revoke 요청 본문. 사유는 선택이며 감사 로그의 note 로 남는다. */
export interface MrvApiKeyRevokeRequest {
  reason?: string | null;
}

/**
 * POST /api-keys/{id}/revoke 응답 — 끊긴 키 행 + 기록 여부.
 *
 * `audit_recorded: false`는 **키는 끊겼고 감사 로그 한 줄이 남지 않았다**는 뜻이다.
 * 키 행이 `revoked_at`/`revoked_by`를 들고 있으므로 "누가 언제" 는 남는다.
 * 화면은 이 사실을 숨기지 말 것 — 끊긴 것을 "실패"로 적는 것이 가장 나쁜 선택이다.
 */
export interface MrvApiKeyRevokeResponse extends MrvApiKey {
  audit_recorded: boolean;
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
  /**
   * 이 사업장에서 산출되지 않은 지표의 사유(값이 null 인 지표만). 표의 '산출 불가' 칸이
   * 사업장마다 **다른 이유**일 수 있어 사업장별로 싣는다 — 표 아래에 한 문단으로
   * 뭉개면 어느 사업장 이야기인지 알 수 없다.
   */
  unavailability?: KpiUnavailability;
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

// ---------------------------------------------------------------------------
// 사람이 넣는 계측값 — POST /sites/{siteId}/readings
// (게이트웨이 창구 POST /ingest/readings 와 같은 응답 모양이다. 전력은 이 운영에서
//  수기 입력이므로 이 창구가 EI·Scope2·기준선의 유일한 전력 근거가 된다.)
// ---------------------------------------------------------------------------

/** 사람이 넣을 수 있는 출처. 'device' 는 게이트웨이 창구 전용이라 받지 않는다. */
export type ManualReadingSource = "manual" | "csv";

/** 계측 원표현. 저장 규약은 구간 kWh 이고 변환은 수집 계층이 한다(ADR 0001). */
export type ReadingKind =
  | "interval_kwh"
  | "cumulative_kwh"
  | "instant_kw"
  | "do_mg_l";

export interface ReadingsCreateRequest {
  source: ManualReadingSource;
  readings: {
    meter_id: string;
    /** ISO8601. 구간값은 **구간의 끝 시각**이다(ADR 0001: Δ는 뒤 시각에 붙는다). */
    ts: string;
    value: number;
    reading_kind: ReadingKind;
  }[];
}

export interface ReadingsIngestResult {
  /** 새로 저장된 건수. */
  accepted: number;
  /** 이미 같은 (계측기, 시각) 이 있어 흡수된 건수. */
  deduped: number;
  rejected: { index: number; reason: string }[];
  /**
   * 저장된 건들의 quality_flag 분포. 'ok' 만 KPI 산입 목록에 든다 — 적산 지침의 첫
   * 건처럼 구간값을 낼 수 없는 건은 'suspect' 로 들어가 EI 에서 빠진다.
   */
  quality: { ok: number; suspect: number; bad: number };
}
