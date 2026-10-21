/**
 * 지표 정의의 **출처와 확정 여부** — 「잠정」의 정본.
 *
 * ── 왜 이 파일이 따로 있는가 ─────────────────────────────────────────────────
 * 사용자가 준 MRV 계산표 「지표정의」 시트는 다섯 지표를 두 종류로 가른다.
 *
 *   · EI(ei_total/ei_aeration) · FCR · 폐사율 — 사업계획서의 지표 정의를 **수식화**한 것.
 *     정의와 단위가 확정돼 있다.
 *   · OEI — 사업계획서(5·15쪽)가 "전력 대비 적정 DO 유지 안정성" 이라는 **개념만 명시**하고
 *     **단위 미확정**으로 남긴 것. 그 시트는 "정식 산식·단위·승인 DO 임계치를 확정한 뒤
 *     구현합니다. 임의 점수를 부여하지 않습니다." 라고 적어 두었다.
 *
 * 그런데 플랫폼은 OEI 를 **산출하고, 신호등을 켜고, 기본 설정으로 빨간 알림까지 보낸다.**
 * 그 사실을 아는 것은 지금까지 코드 주석뿐이었다 — `lib/mrv/kpi/oxygen.ts` 는 스스로
 * "MASTER 3.2 ② 가 명시한 '제안값'" 이고 스케일 계수는 "실증 1단계에서 보정" 이라고 적고
 * 있고(ADR 0003), `lib/mrv/kpi/status.ts` 는 OEI 임계값을 "실증 전 지수" 라고 적고 있다.
 * **사람 앞에 나가는 화면·인쇄 리포트·알림은 그 말을 하지 않았다.** 심사위원이 우리 리포트의
 * OEI 신호등과 사업계획서의 "산식 미확정" 을 나란히 보면 바로 지적하는 자리다.
 *
 * 그래서 그 사실을 **한 곳**에 둔다. 같은 사실을 세 곳이 각자 적으면 화면으로 본 사람과
 * 인쇄물로 본 사람이 다른 사실을 알게 된다 — `lib/mrv/quality-flags.ts` 와
 * `lib/mrv/measurement-basis.ts` 가 같은 이유로 있는 모듈이고, 이 파일은 그 선례를 따른다.
 *
 * ★ 이 모듈은 **순수 모듈**로 유지할 것. KPI 카드·멀티사이트 표·비교표·설정 화면·알림
 *   센터(모두 `"use client"`)와 인쇄 리포트 렌더러가 같이 import 한다 — `next/server` 나
 *   DB 를 끌고 들어오면 클라이언트 번들이 깨진다.
 *
 * ── 엔진 상수를 **베끼지 않고 import 하는 이유** ────────────────────────────
 * 아래 `isDefaultWatchedKpiRedMetric`/`DEFAULT_KPI_RED_METRICS` 는 엔진의
 * `DEFAULT_ALERTING_CONFIG` 를 **그대로 읽는다**. 같은 목록을 사본으로 적어 두면 엔진
 * 기본값이 바뀌는 날 화면만 옛 사실을 말한다(이 저장소에 이미 쓰이지 않는 사본이 하나
 * 있다 — `quality-flags.ts` 의 `DEFAULT_INCLUDED_QUALITY_FLAGS`). `lib/mrv/kpi/types.ts` 는
 * `./status` 하나만 import 하고 그 파일은 아무것도 import 하지 않으므로, 이 import 로 끌려
 * 오는 것은 순수 상수·타입뿐이다.
 *
 * `lib/mrv/kpi/` 는 원본 Python 과 차분검증되는 디렉터리라(scripts/mrv/verify-config.mjs)
 * **읽기만 한다.** 이 파일은 거기에 한 줄도 쓰지 않는다.
 *
 * ── 이 모듈이 하지 않는 일 ──────────────────────────────────────────────────
 * OEI 를 감추거나 신호등을 끄거나 산식을 고치지 않는다. 값은 그대로 내고, **그 값이
 * 무엇인지 정확히 말하는 것**이 전부다. 끄는 결정은 사람이 한다.
 */

import { DEFAULT_ALERTING_CONFIG } from "./kpi/types"
import type { KpiMetricKey } from "./api-types"

/** 신호등 판정 대상 5개 지표. `lib/mrv/kpi/status.ts` 의 `METRIC_DIRECTIONS` 와 같은 명명. */
export const PROVENANCE_METRIC_KEYS: readonly KpiMetricKey[] = [
  "ei_total",
  "ei_aeration",
  "fcr",
  "oei",
  "mortality_rate",
]

/**
 * 지표 정의가 **어디서 왔는가.**
 *   - `business_plan` : 사업계획서의 지표 정의를 수식화한 것.
 *   - `proposed`      : 사업계획서에 산식이 없고, 개발의뢰서가 **제안한** 산식.
 */
export type MetricDefinitionOrigin = "business_plan" | "proposed"

/**
 * 정의가 **확정인가.**
 *   - `confirmed`   : 산식과 단위가 정해져 있다.
 *   - `provisional` : 무엇인가가 미확정이다(`unresolved` 가 그것을 적는다).
 */
export type MetricDefinitionStatus = "confirmed" | "provisional"

export type MetricProvenance = {
  key: KpiMetricKey
  origin: MetricDefinitionOrigin
  status: MetricDefinitionStatus
  /** 정의 출처를 사람이 읽는 문장으로. 어느 문서 몇 쪽인지까지 적는다. */
  sourceText: string
  /**
   * 미확정인 것들. `status === "confirmed"` 면 빈 배열.
   * "주의하세요" 가 아니라 **무엇이 미확정인지**를 적는 자리다.
   */
  unresolved: readonly string[]
}

/**
 * 지표 5종의 정의 출처와 확정 여부.
 *
 * 「지표정의」 시트가 가른 대로다. EI·FCR·폐사율의 `sourceText` 가 짧은 것은 적을 것이
 * 없기 때문이지, 덜 중요해서가 아니다 — 확정된 정의에는 덧붙일 사실이 없다.
 */
export const METRIC_PROVENANCE: Record<KpiMetricKey, MetricProvenance> = {
  ei_total: {
    key: "ei_total",
    origin: "business_plan",
    status: "confirmed",
    sourceText:
      "사업계획서의 전력집약도 정의를 수식화한 것입니다(총 전력 kWh ÷ 생산 kg). " +
      "산식과 단위(kWh/kg)가 확정돼 있습니다.",
    unresolved: [],
  },
  ei_aeration: {
    key: "ei_aeration",
    origin: "business_plan",
    status: "confirmed",
    sourceText:
      "사업계획서의 전력집약도 정의를 폭기 전력에 한정해 수식화한 것입니다" +
      "(폭기 전력 kWh ÷ 생산 kg). 산식과 단위(kWh/kg)가 확정돼 있습니다.",
    unresolved: [],
  },
  fcr: {
    key: "fcr",
    origin: "business_plan",
    status: "confirmed",
    sourceText:
      "사업계획서의 사료요구율 정의를 수식화한 것입니다(총 급이 kg ÷ 생산 kg). " +
      "산식과 단위(kg/kg)가 확정돼 있습니다.",
    unresolved: [],
  },
  oei: {
    key: "oei",
    origin: "proposed",
    status: "provisional",
    sourceText:
      "사업계획서(5·15쪽)는 '전력 대비 적정 DO 유지 안정성' 이라는 개념만 적었고 " +
      "산식과 단위를 정하지 않았습니다. 지금 산출되는 값은 개발의뢰서 MASTER 3.2 ② 의 " +
      "제안 산식 — (DO 목표대역 유지율) ÷ (생산 kg당 폭기 전력) 을 0~100 으로 스케일링한 " +
      "것입니다(lib/mrv/kpi/oxygen.ts · ADR 0003).",
    unresolved: ["정식 산식", "지수의 단위", "승인 DO 목표대역 임계치"],
  },
  mortality_rate: {
    key: "mortality_rate",
    origin: "business_plan",
    status: "confirmed",
    sourceText:
      "사업계획서의 폐사율 정의를 수식화한 것입니다(누적 폐사 개체 ÷ 입식 개체). " +
      "산식과 단위(%)가 확정돼 있습니다.",
    unresolved: [],
  },
}

/** 정의가 잠정인 지표인가. 화면·리포트가 표시를 붙일지 정하는 단 하나의 기준. */
export function isProvisionalMetric(key: KpiMetricKey): boolean {
  return METRIC_PROVENANCE[key].status === "provisional"
}

/** 정의가 잠정인 지표 전부. 지금은 OEI 하나다. */
export const PROVISIONAL_METRIC_KEYS: readonly KpiMetricKey[] =
  PROVENANCE_METRIC_KEYS.filter((key) => METRIC_PROVENANCE[key].status === "provisional")

/**
 * 알림 payload 등의 문자열을 지표 키로 좁힌다. 모르는 값은 `null`.
 *
 * 알림 payload 의 `metric` 은 자유 문자열이다(`lib/mrv/alert-jobs.ts` 가
 * `alerting.kpi_red_metrics` 에 적힌 이름을 그대로 싣는다). 캐스팅으로 좁히면 모르는
 * 이름에 `METRIC_PROVENANCE[...]` 가 `undefined` 를 돌려주고 화면이 거기서 죽는다.
 */
export function asMetricKey(raw: unknown): KpiMetricKey | null {
  if (typeof raw !== "string") return null
  return (PROVENANCE_METRIC_KEYS as readonly string[]).includes(raw)
    ? (raw as KpiMetricKey)
    : null
}

// ---------------------------------------------------------------------------
// 값 옆에 붙는 짧은 표시
// ---------------------------------------------------------------------------

/**
 * 값 옆 한 칸에 들어가는 표시. **색이 아니라 글자다**(인쇄물은 흑백 복사가 기본이고,
 * 화면에서도 색만으로는 알리지 않는다는 규칙이다).
 */
export const PROVISIONAL_METRIC_MARK = "잠정 지표"

/**
 * 표시 옆에 한 줄로 붙는 이유. 짧게 끝내되 **무엇이 미확정인지**까지는 적는다 —
 * "잠정" 이라는 네 글자만으로는 이 숫자를 어떻게 읽어야 하는지 알 수 없다.
 */
export function provisionalMetricShortNote(key: KpiMetricKey): string | null {
  const reason = provisionalMetricReason(key)
  return reason === null ? null : `${PROVISIONAL_METRIC_MARK} — ${reason}`
}

/**
 * 같은 내용에서 「잠정 지표」 네 글자만 뗀 것.
 *
 * 표시(`PROVISIONAL_METRIC_MARK`)를 **바로 옆에** 이미 달아 둔 자리에서 쓴다 — KPI 카드가
 * 그렇다. 거기서 `provisionalMetricShortNote` 를 쓰면 배지 바로 아래 문단이 "잠정 지표 —
 * 잠정 지표 …" 로 읽힌다. 표(머리글에만 표시가 있고 설명은 표 아래에 떨어져 있는 자리)는
 * 반대로 문단이 혼자 읽혀야 하므로 `provisionalMetricShortNote` 를 쓴다.
 */
export function provisionalMetricReason(key: KpiMetricKey): string | null {
  const meta = METRIC_PROVENANCE[key]
  if (meta.status !== "provisional") return null
  return (
    "산식이 사업계획서에 없는 제안값입니다. " +
    `미확정: ${meta.unresolved.join(" · ")}.`
  )
}

// ---------------------------------------------------------------------------
// 사실 문장들 — 세 곳이 나눠 쓰지 않고 같이 쓴다
// ---------------------------------------------------------------------------

/** OEI 산식이 사업계획서에 없다는 사실 그 자체. */
export const OEI_FORMULA_NOT_IN_BUSINESS_PLAN = METRIC_PROVENANCE.oei.sourceText

/** 무엇이 미확정인가. 셋이고, 셋 다 적는다. */
export const OEI_UNRESOLVED_TEXT = `미확정인 것은 셋입니다 — ${METRIC_PROVENANCE.oei.unresolved.join(
  " · ",
)}. 「지표정의」 시트가 "정식 산식·단위·승인 DO 임계치를 확정한 뒤 구현한다" 고 둔 자리입니다.`

/**
 * 스케일 계수가 가정이라는 사실. 이것이 보정되면 **지나간 기간의 값까지 달라진다** —
 * 그것이 ADR 0003 이 MAJOR version 상향을 요구하는 이유다.
 */
export const OEI_SCALE_FACTOR_NOTE =
  "0~100 으로 만드는 스케일 계수(oei.oei_scale_factor)는 실증 1단계에서 보정할 예정입니다" +
  "(ADR 0003). 보정하면 같은 기간을 다시 산출한 값이 지금과 달라지므로, 리포트에 실린 " +
  "값은 그 리포트에 적힌 kpi_config version 안에서만 같은 값입니다."

/**
 * **그래서 이 숫자를 어떻게 읽어야 하는가.** 이 한 문장이 이 모듈의 목적이다 —
 * "잠정이니 주의하라" 는 읽는 사람에게 아무 판단 근거도 주지 않는다.
 */
export const OEI_HOW_TO_READ =
  "그래서 OEI 는 절대 수준으로 읽을 수 없습니다 — 'OEI 72' 가 어떤 성능인지 말해 주는 " +
  "승인된 기준이 없습니다. 읽을 수 있는 것은 같은 kpi_config version · 같은 DO 목표대역 " +
  "안에서 기간끼리의 상대 변화뿐이고, 다른 사업장이나 다른 version 의 값과 나란히 두어 " +
  "우열을 주장할 수 없습니다."

/**
 * 사이트 벤치마크 표의 OEI 열이 **사업장끼리의 우열 비교로 읽히는** 자리에 붙이는 사실.
 *
 * 그 표는 열마다 최고/최저 배지를 단다. EI·FCR·폐사율은 단위가 확정된 지표라 그 비교가
 * 성립하지만, OEI 는 (1) 산식이 제안값이고 (2) 분자가 **사업장마다 다른 DO 목표대역**의
 * 유지율이다(`lib/mrv/kpi-service.ts` 가 사이트의 수조 목표대역을 쓴다). 목표대역이 다른
 * 두 사업장의 OEI 는 같은 척도의 값이 아니다 — 그 사실을 적지 않으면 배지가 순위 주장이
 * 된다.
 */
export const OEI_CROSS_SITE_RANKING_NOTE =
  "OEI 열의 최고 · 최저 배지는 사업장 간 우열 판정이 아닙니다. OEI 의 분자인 DO 목표대역 " +
  "유지율은 사업장마다 설정한 목표대역을 기준으로 산출되므로, 목표대역이 다른 두 사업장의 " +
  "OEI 는 같은 척도의 값이 아닙니다. 산식 version 이 다른 행끼리도 같습니다 — 배지는 이 " +
  "표에 실린 숫자의 크기 순서일 뿐입니다."

/**
 * 신호등 임계값이 실증 전 가정이라는 사실 — **5개 지표 전부**에 해당한다
 * (`lib/mrv/kpi/status.ts` 의 "임계값 선정 근거(잠정치 — 실증 전 가정)" 주석).
 *
 * OEI 만의 문제로 적지 않는다. EI·FCR 의 임계값도 사업계획서 1.1 의 평균치에서 잡은
 * 가정이고, 그것을 OEI 쪽에만 적으면 나머지 넷이 검증된 기준을 가진 것처럼 읽힌다.
 */
export const KPI_THRESHOLD_ASSUMPTION_NOTE =
  "신호등(정상 · 주의 · 경고)의 임계값은 5개 지표 모두 실증 전 가정치입니다" +
  "(lib/mrv/kpi/status.ts). EI·FCR 은 사업계획서 1.1 의 평균치에서 잡았고, OEI 는 산식 " +
  "자체가 제안값이라 임계값에도 근거 문헌이 없습니다. 임계값은 kpi_config 새 version 으로 " +
  "보정되며, 보정하면 이미 지나간 기간의 판정까지 소급해 달라집니다."

// ---------------------------------------------------------------------------
// 인쇄 리포트 + 리포트 화면이 **같이 쓰는** 절
// ---------------------------------------------------------------------------

/**
 * 리포트의 「지표 정의」 절 제목.
 *
 * 리포트는 값 옆의 표시만으로 끝내지 않는다 — 심사위원이 읽는 문서이므로 한 번은
 * 분명히 적는다. 인쇄물은 흑백 복사가 기본이라 **글자가 전부**다.
 */
export const REPORT_PROVISIONAL_METRIC_HEADING =
  "지표 정의의 확정 여부 — OEI 는 잠정 지표입니다"

/**
 * 그 절의 본문. 화면과 인쇄가 **같은 배열**을 돌린다 — 두 곳이 각자 문장을 지으면
 * 화면으로 본 사람과 인쇄물로 본 사람이 다른 사실을 알게 된다.
 *
 * 네 번째 줄은 **이 리포트에 OEI 가 실려 있지 않다는 사실**을 적는다. 비교표는 EI·전력·
 * 생산량·Scope2 만 싣는다(lib/mrv/ui/mrv-meta.ts · lib/mrv/report-html.ts). 그것을 적지
 * 않으면 읽는 사람이 위 세 줄을 비교표의 어떤 숫자에 대한 말로 찾다가 못 찾는다 —
 * 그리고 실제로 OEI 가 실려 있는 자리(스냅샷 근거와 플랫폼 화면)를 그냥 지나친다.
 */
export const REPORT_PROVISIONAL_METRIC_LINES: readonly string[] = [
  OEI_FORMULA_NOT_IN_BUSINESS_PLAN,
  OEI_UNRESOLVED_TEXT,
  OEI_SCALE_FACTOR_NOTE,
  OEI_HOW_TO_READ,
  KPI_THRESHOLD_ASSUMPTION_NOTE,
  "이 리포트의 Before/After 비교표에는 OEI 가 실려 있지 않습니다 — 비교표는 EI · 전력 · " +
    "생산량 · Scope2 배출량만 싣습니다. OEI 가 실려 있는 자리는 이 리포트가 참조하는 " +
    "KPI 스냅샷(아래에 ID 가 적힌 Before · After 스냅샷의 inputs_json.oei)과 플랫폼 " +
    "화면의 KPI 카드 · 전후 비교표 · 사이트 벤치마크이며, 위 내용은 그 값들에 그대로 " +
    "적용됩니다.",
  "EI(총 · 폭기) · FCR · 폐사율의 정의와 단위는 사업계획서 정의를 수식화한 것으로 " +
    "확정돼 있습니다 — 위 내용은 그 세 지표의 값이 아니라 OEI 와, 다섯 지표 공통의 " +
    "신호등 임계값에 대한 것입니다.",
]

// ---------------------------------------------------------------------------
// 알림 — 사실을 알리고, 빠져나갈 길을 보이게
// ---------------------------------------------------------------------------

/**
 * kpi_red 알림의 **기본 감시 목록.** 엔진 상수를 그대로 읽는다(사본을 두지 않는다).
 *
 * ★ 이 목록에 `oei` 가 들어 있다 — 즉 조직이 아무 설정도 하지 않으면 **기본값으로 OEI
 *   빨간 알림이 나간다.** 그 기본값은 `lib/mrv/kpi/` 안이라 이 작업 범위에서 고칠 수
 *   없고(차분검증), 고치는 것이 맞는지는 엔진 원본과 함께 다룰 별건이다. 여기서 하는
 *   일은 그 사실을 **사실대로 알리고 빠져나갈 길을 적는 것**이다.
 */
export const DEFAULT_KPI_RED_METRICS: readonly string[] =
  DEFAULT_ALERTING_CONFIG.kpiRedMetrics

/** 설정이 없을 때 이 지표로 kpi_red 알림이 나가는가. */
export function isDefaultWatchedKpiRedMetric(key: KpiMetricKey): boolean {
  return DEFAULT_KPI_RED_METRICS.includes(key)
}

/** `params_json` 에서 읽어 낸 감시 목록. `fromDefault` 면 조직이 적은 목록이 없다는 뜻. */
export type KpiRedWatchlist = {
  metrics: readonly string[]
  fromDefault: boolean
  /** 적혀 있지만 배열이 아니다 — 쓰기 경계가 422 로 거부하는 모양(SQL 로 들어간 옛 행). */
  unreadable: boolean
}

/**
 * `params_json.alerting.kpi_red_metrics` 를 읽는다.
 *
 * 엔진의 `strList` 와 **같은 폴백 규약**이다(lib/mrv/kpi/config.ts) — 키가 없으면
 * 기본값, 있으면 그 값. 다르게 읽으면 화면이 "감시 중" 이라고 적는 목록과 알림 작업이
 * 실제로 쓰는 목록이 갈린다.
 *
 * 배열이 아닌 값은 엔진에서 TypeError 가 되므로(그래서 쓰기 경계가 모양을 선검사한다 —
 * `lib/mrv/kpi-params-shape.ts`) 여기서는 `unreadable` 로만 돌려주고 추측하지 않는다.
 */
export function readKpiRedWatchlist(params: unknown): KpiRedWatchlist {
  const base = { metrics: DEFAULT_KPI_RED_METRICS, fromDefault: true, unreadable: false }
  if (typeof params !== "object" || params === null) return base
  const alerting = (params as Record<string, unknown>)["alerting"]
  if (typeof alerting !== "object" || alerting === null) return base
  const raw = (alerting as Record<string, unknown>)["kpi_red_metrics"]
  if (raw === undefined) return base
  if (!Array.isArray(raw)) {
    return { metrics: DEFAULT_KPI_RED_METRICS, fromDefault: true, unreadable: true }
  }
  return { metrics: raw.map(String), fromDefault: false, unreadable: false }
}

/**
 * 감시 목록에서 빼는 길. **경로를 사실대로 적는다** — 이 화면은 읽기 전용이므로
 * "여기서 끄십시오" 라고 쓸 수 없고, 어디로 가야 하는지 적지 않으면 운영자는 끄는 길이
 * 없다고 결론 낸다.
 */
export const KPI_RED_WATCHLIST_OPT_OUT =
  "감시 목록에서 빼려면 params_json.alerting.kpi_red_metrics 에 그 지표명을 제외한 " +
  "목록을 담아 새 version 을 등록하십시오(POST /api/mrv/kpi-config · owner 권한 · 등록한 " +
  "조직에만 적용됩니다). 이 표는 append-only 라 기존 행을 고치는 길은 없습니다. 목록을 " +
  "빈 배열로 두면 kpi_red 알림 자체를 쓰지 않는 선택이고, 그래도 지표 값과 신호등은 " +
  "그대로 산출됩니다."

/**
 * 설정 화면이 적는 한 문단 — "OEI 는 잠정 지표이고 지금 감시 목록에 들어 있는가".
 *
 * 들어 있지 않으면 **들어 있지 않다고 적는다.** 있지도 않은 알림을 경고하면 운영자가
 * 끄려고 들어왔다가 끌 것을 못 찾는다.
 */
export function provisionalMetricWatchlistNote(
  key: KpiMetricKey,
  watchlist: KpiRedWatchlist,
): string | null {
  const meta = METRIC_PROVENANCE[key]
  if (meta.status !== "provisional") return null
  const label = key.toUpperCase()
  const watched = watchlist.metrics.includes(key)

  if (!watched) {
    return (
      `${label} 는 잠정 지표입니다(${meta.unresolved.join(" · ")} 미확정). 지금 적용 중인 ` +
      `설정의 kpi_red 감시 목록에는 ${label} 가 없으므로 ${label} 로는 알림이 생성되지 ` +
      `않습니다 — 값과 신호등은 그대로 산출됩니다. 엔진 기본 감시 목록에는 ` +
      `${isDefaultWatchedKpiRedMetric(key) ? "들어 있습니다" : "없습니다"}` +
      `(${DEFAULT_KPI_RED_METRICS.join(", ")}).`
    )
  }

  const scope = watchlist.fromDefault
    ? "이 조직이 적은 감시 목록이 없어 엔진 기본값을 쓰고 있습니다 — 즉 아무 설정도 하지 " +
      `않은 상태에서 ${label} 빨간 알림이 나갑니다`
    : `이 조직의 설정에 적힌 감시 목록에 ${label} 가 들어 있습니다`
  const unreadable = watchlist.unreadable
    ? " (적혀 있는 값이 배열이 아니어서 읽을 수 없고, 엔진은 그 입력에서 TypeError 를 " +
      "던집니다 — 위 「쓰기 창구가 거부하는 모양」 경고를 함께 보십시오.)"
    : ""

  return (
    `${label} 는 잠정 지표입니다(${meta.unresolved.join(" · ")} 미확정). ` +
    `그런데 ${scope}(기본값: ${DEFAULT_KPI_RED_METRICS.join(", ")}).${unreadable} ` +
    "알림이 떴다는 것은 값이 kpi_config 의 임계값 아래로 내려갔다는 사실이고, 승인된 " +
    `기준에 미달했다는 판정이 아닙니다. ${KPI_RED_WATCHLIST_OPT_OUT}`
  )
}

/**
 * 알림 센터의 구독 설정 옆에 적는 한 줄 — **빠져나갈 길이 있는 자리를 가리킨다.**
 *
 * 알림 센터의 `kpi_red` 스위치는 그 종류 전체를 끈다. 지표 하나만 빼는 길은
 * `kpi_config` 쪽이고, 그 화면(`/mrv/settings`)이 지금 적용 중인 목록과 빼는 방법을
 * 적는다. 여기서 같은 설명을 다시 쓰지 않고 자리만 가리키는 이유는, 알림 센터에는
 * `params_json` 이 없어 "지금 무엇이 감시 중인가" 를 사실대로 말할 수 없기 때문이다 —
 * 모르는 것을 추측해 적는 대신 아는 곳으로 보낸다.
 */
export function alertCenterKpiRedWatchlistPointer(): string | null {
  const provisionalByDefault = PROVISIONAL_METRIC_KEYS.filter((key) =>
    isDefaultWatchedKpiRedMetric(key),
  )
  // 기본 목록에 잠정 지표가 하나도 없으면 적을 사실이 없다. 빈 목록으로 "잠정 지표 가
  // 들어 있습니다" 같은 문장을 만들지 않는다.
  if (provisionalByDefault.length === 0) return null
  return (
    "kpi_red 알림은 kpi_config 의 감시 목록(alerting.kpi_red_metrics)에 적힌 지표로 " +
    `생성됩니다. 엔진 기본 목록에는 잠정 지표 ${provisionalByDefault
      .map((key) => key.toUpperCase())
      .join(" · ")} 가 들어 있습니다 — 아래 스위치는 kpi_red 알림을 종류째 끄고, ` +
    "지표 하나만 빼려면 설정 화면의 「KPI 산식 설정」에 적힌 경로를 따르십시오."
  )
}

/**
 * 알림 목록·상세가 알림 한 건에 붙이는 문장. 판정 지표가 잠정일 때만 돌려준다.
 *
 * 알림은 append-only 이고 payload 는 발생 시점에 얼린 것이므로, 이 문장은 payload 를
 * 고치지 않고 **읽는 자리에서** 붙인다.
 */
export function provisionalAlertNote(metricRaw: unknown): string | null {
  const key = asMetricKey(metricRaw)
  if (key === null) return null
  const meta = METRIC_PROVENANCE[key]
  if (meta.status !== "provisional") return null
  // 목록 뒤에 조사를 붙이지 않는다 — "승인 DO 목표대역 임계치 가 미확정" 이 된다.
  return (
    `판정 지표 ${key.toUpperCase()} 는 잠정 지표입니다 — 산식이 사업계획서에 없는 ` +
    `제안값이고, 미확정인 것은 ${meta.unresolved.length}가지입니다: ` +
    `${meta.unresolved.join(" · ")}. 이 알림은 값이 kpi_config 의 임계값 아래로 ` +
    "내려갔다는 사실이며, 승인된 기준에 미달했다는 판정이 아닙니다."
  )
}
