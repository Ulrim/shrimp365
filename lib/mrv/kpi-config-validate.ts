/**
 * KPI 설정 쓰기 경계의 **검증 순서**를 담는 자리.
 *
 * ── 왜 라우트에서 꺼냈는가 ──────────────────────────────────────────────────
 * 이 검사들의 **순서가 규약**이다. 순서가 어긋나면 응답이 422 가 아니라 **500** 이 되고,
 * 500 은 고칠 자리를 알려 주지 않는다. 그런 사고가 이미 두 번 났다 — 처음에는 엔진을 먼저
 * 돌려서, 두 번째는 모양 선검사가 `strList` 를 쓰는 다섯 자리 중 네 자리만 덮어서.
 * 라우트 안에 있는 동안 그 순서를 검사할 길이 없었다(라우트는 `next/server`·인증·DB 를
 * 끌고 들어와 단독으로 돌릴 수 없다). 그래서 **DB 도 요청도 모르는 순수 함수**로 꺼내,
 * `scripts/mrv/verify-kpi-config-write.mjs` 가 순서까지 고정한다.
 *
 * 던지는 것은 두 종류다.
 *   · `HttpError(422, …)` — 이 모듈이 직접 판정한 거부. 문구가 고칠 자리를 가리킨다.
 *   · `KpiValueError`     — 엔진이 거부한 문서. `handleRoute` 가 422 로 옮긴다
 *                           (lib/mrv/http.ts). 문구는 엔진의 것이다.
 */

import { HttpError } from "./http"
import {
  collectQualityFlagRisks,
  inspectQualityFlagLists,
  kpiParamsShapeIssueText,
  qualityFlagIssueText,
  qualityFlagRiskText,
  type QualityFlag,
  type QualityFlagBlock,
} from "./quality-flags"
import { inspectParamsShape } from "./kpi-params-shape"
import {
  METRIC_DIRECTIONS,
  alertingConfigFromParams,
  eiConfigFromParams,
  fcrConfigFromParams,
  mortalityConfigFromParams,
  oeiConfigFromParams,
  recommendConfigFromParams,
} from "./kpi"
import type { KpiConfigRow } from "./kpi-config-source"

/** 감사 로그와 응답에 남길 위험 산입 기록. */
export type QualityFlagRisk = {
  path: string
  block: QualityFlagBlock
  flags: QualityFlag[]
  effect: string
}

/**
 * `effective_from` 이 미래여도 받아 주는 허용 폭.
 *
 * 0 으로 두면 브라우저와 서버의 시계가 몇 밀리초만 어긋나도 "지금" 을 적은 요청이 422 가
 * 된다. 그 몇 초가 설정 적용 시점에 주는 영향은 없으므로 시계 오차만큼만 받아 준다.
 * 이 폭 안에서 등록된 행이 **아직 활성이 아닐 수는 있다** — 그래서 라우트는 추측하지 않고
 * 저장 뒤에 선택 규칙을 한 번 더 돌려 `active` 를 실제로 확인해 싣는다.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000

/**
 * 목록 자리의 **모양**을 검사한다. 엔진 확인보다 **먼저** 돌아야 한다.
 *
 * 엔진의 `strList` 는 `(v as unknown[]).map(String)` 이라, 목록 자리에 문자열이 적혀
 * 있으면(`"kpi_red_metrics": "ei_total"`) `.map` 이 없어 TypeError 를 던진다. 그건
 * HttpError 도 KpiValueError 도 아니므로 handleRoute 가 **500** 으로 내보낸다.
 *
 * ★ 전에는 이 선검사가 품질 플래그 네 자리만 덮었고, `strList` 를 쓰는 **다섯 번째
 *   자리**인 `alerting.kpi_red_metrics` 가 빠져 있었다. 이제 좌표 목록은
 *   `STRING_LIST_PARAM_PATHS` 한 곳에 있고 다섯 자리가 같은 검사를 거친다.
 *
 * 최상위 블록 이름도 여기서 본다. 엔진의 `rejectUnknown` 은 **알려진 블록 안쪽만** 보므로
 * `{"ei":{...},"recomend":{...}}` 는 엔진을 그대로 통과하고, 그 블록은 통째로 무시된 채
 * 저장된다 — 저장은 성공하고 바뀌는 것은 없다.
 *
 * 빈 배열의 처리가 종류마다 다른 것이 의도다.
 *   · 품질 플래그 목록이 비면 **거부**한다. 포함 건이 0 건이 되어 분자가 0 으로
 *     합산되고, EI 0 kWh/kg · Scope2 0 tCO2e · 감축량 기준선 전량이라는 **그럴듯한
 *     거짓 성과**가 산출된다(EMPTY_QUALITY_FLAG_LIST_REASON).
 *   · `alerting.kpi_red_metrics` 가 비면 **허용**한다. 그것은 "kpi_red 알림을 쓰지
 *     않는다" 는 뜻이고, 틀린 수치를 만들지 않는다(알림이 생기지 않을 뿐이며 사이트별
 *     구독 스위치 `alert_enabled_types` 와 같은 성질의 선택이다).
 */
function assertParamsShape(params: Record<string, unknown>): void {
  for (const issue of inspectParamsShape(params)) {
    if (issue.kind === "empty_list" && issue.contents === "metric_names") continue
    throw new HttpError(422, kpiParamsShapeIssueText(issue))
  }
}

/**
 * 플래그 **값**을 검사하고, 위험 산입 기록을 모아 돌려준다.
 *
 * 거부/경고의 갈림:
 *   - 모르는 플래그 값 → **거부(422).** 수집 정규화는 ok/suspect/bad 세 값만 만든다
 *     (lib/mrv/ingestion.ts). 그 밖의 값은 어떤 계측값에도 맞지 않으므로, 적힌 의도가
 *     무엇이었든 결과는 "그 지표를 조용히 빈 목록으로 돌리는 것"이다. 오탈자(`"OK"`,
 *     `"okay"`)가 전부 여기로 온다.
 *   - suspect/bad 포함 → **허용.** 정당한 이유가 있을 수 있다(계량기 교체 구간을 수기로
 *     보정해 두고 원값 건까지 포함해 재산출하는 등). 대신 감사 로그에 무엇을 포함했고
 *     그것이 어떤 결과를 내는지까지 남기고, 설정 화면이 경고를 띄운다.
 *
 * `effect` 문장은 **(플래그 × 블록)** 으로 갈린다 — 같은 플래그 집합이 네 자리에 쓰이는데
 * 거르는 대상이 서로 다르다(`oei` 는 DO 계측값과 폭기 전력, `fcr`·`recommend` 는 급이
 * 기록). 블록을 넘기지 않으면 EI 를 주어로 적은 문장이 엉뚱한 목록에 붙는다.
 */
function validateQualityFlagValues(params: Record<string, unknown>): QualityFlagRisk[] {
  for (const issue of inspectQualityFlagLists(params)) {
    if (issue.kind === "unknown_flags") {
      throw new HttpError(422, qualityFlagIssueText(issue))
    }
  }

  // 경고 대상은 화면과 같은 판정을 쓴다(lib/mrv/quality-flags.ts) — 저장이 통과시킨
  // 것과 화면이 경고하는 것이 갈리지 않게 하려고 거르는 함수를 공유한다.
  return collectQualityFlagRisks(params).map((risk) => ({
    path: risk.path,
    block: risk.block,
    flags: risk.flags,
    effect: risk.flags.map((flag) => qualityFlagRiskText(flag, risk.block)).join(" "),
  }))
}

/**
 * `alerting.kpi_red_metrics` 의 **지표명**을 검사한다.
 *
 * 모양만 맞고 이름이 틀린 목록(`["ei_totla"]`)은 엔진을 통과한다 — `strList` 는 문자열
 * 배열이면 그대로 받고, 지표명을 아는 것은 알림 배치다. 그 배치는 모르는 이름을 만나면
 * `KpiValueError` 를 던지고, 그것이 **사이트마다 잡혀 `failures` 로 모인다**
 * (lib/mrv/alert-jobs.ts) — 즉 저장은 성공하고, 그 뒤로 **그 org 의 알림 평가가 전부
 * 실패하며**, 그 사실은 스케줄 로그에만 남는다. 저장 시점에 막는 편이 낫다.
 */
function assertKpiRedMetrics(params: Record<string, unknown>): void {
  const alerting = params["alerting"]
  if (alerting === null || typeof alerting !== "object" || Array.isArray(alerting)) return
  const raw = (alerting as Record<string, unknown>)["kpi_red_metrics"]
  if (!Array.isArray(raw)) return // 모양 검사가 이미 거부했다.

  const known = Object.keys(METRIC_DIRECTIONS)
  const unknown = raw
    .filter((m): m is string => typeof m === "string" && !known.includes(m))
    .sort()
  if (unknown.length > 0) {
    throw new HttpError(
      422,
      `params_json.alerting.kpi_red_metrics 에 모르는 지표명 ${JSON.stringify(unknown)} ` +
        `가 있습니다. 허용 값은 ${JSON.stringify(known)} 입니다 — 모르는 이름이 저장되면 ` +
        "그 조직의 알림 평가가 사이트마다 실패하고, 그 사실은 스케줄 로그에만 남습니다.",
    )
  }
}

/**
 * 엔진이 이 문서를 읽을 수 있는지 미리 확인한다.
 *
 * 6종 파서를 전부 돌리는 이유: 엔진의 `rejectUnknown` 은 오탈자 하나에도
 * `KpiValueError` 를 던지고, 그러면 **그 org 의 `/kpi`·리포트·알림이 통째로 422 가 된다**
 * (lib/mrv/kpi/config.ts 의 EXTENSION_KEYS 주석이 설명하는 그 사고다). 저장 뒤에 그걸
 * 알게 되면 되돌릴 행이 이미 활성 설정이므로, 저장 전에 같은 파서로 확인한다.
 */
function assertEngineCanRead(params: Record<string, unknown>): void {
  eiConfigFromParams(params)
  fcrConfigFromParams(params)
  oeiConfigFromParams(params)
  mortalityConfigFromParams(params)
  alertingConfigFromParams(params)
  recommendConfigFromParams(params)
}

/**
 * `params_json` 전체 검증. **순서가 규약이다 — 모양 → 값 → 지표명 → 엔진.**
 *
 * 모양을 먼저 보는 이유는 엔진이 모양 오류에 TypeError 를 내 500 으로 나가기
 * 때문이고, 값·지표명을 엔진보다 먼저 보는 이유는 엔진의 거부 문구가
 * "unknown MortalityConfig params_json keys" 처럼 **고칠 자리를 알려 주지 않기**
 * 때문이다. 어느 순서든 통과하지 못한 문서는 저장되지 않는다.
 *
 * @returns 거부하지 않은 위험 산입 기록(감사 로그·응답·화면이 같이 쓴다).
 */
export function validateKpiParamsJson(params: Record<string, unknown>): QualityFlagRisk[] {
  assertParamsShape(params)
  const risks = validateQualityFlagValues(params)
  assertKpiRedMetrics(params)
  assertEngineCanRead(params)
  return risks
}

/**
 * `effective_from` 을 검사한다.
 *
 * ── 왜 검사가 필요한가 ─────────────────────────────────────────────────────
 * 활성 판정에 `effective_from <= now()` 가 없어서 2030 년을 적은 행이 **지금 바로** 활성이
 * 됐다(그 조건은 lib/mrv/kpi-config-source.ts 에 생겼다). 그리고 지금 활성 행보다 과거인
 * 시각을 적으면 **아무 효과 없이 201** 이 돌아와 운영자가 "되돌렸다" 고 믿게 된다.
 *
 * ── 정한 것: 예약 등록을 지원하지 않는다 ───────────────────────────────────
 * 미래 시각은 거부한다. 「예약 활성」을 지원하는 쪽을 고르지 않은 이유는 이 표의 성질이다 —
 * KPI 설정은 **요청 시점의 활성 설정으로 과거 기간까지 소급 계산**된다. 그래서 "다음 달
 * 1일부터 적용" 이라고 적어도 그날이 되면 지난 3월의 신호등 판정까지 새 파라미터로
 * 바뀐다. 즉 예약은 운영자가 기대하는 「그날 이후의 데이터에만 적용」을 주지 못하고,
 * 기다리는 동안은 아무 효과도 없는 행이 목록에 놓인다. 지원했다는 말이 그 자체로 오해를
 * 만드는 기능이라 두지 않는다. 승인 절차를 거쳐 **적용할 그 시점에** 등록하는 것이 이
 * 표의 사용법이다(배출계수와 다른 점은 아래 ★).
 *
 * 과거 시각도 **그 행이 활성이 될 수 없으면** 거부한다. 선택 규칙이 「org 행 중 가장 늦은
 * effective_from」이므로, 지금 활성 행보다 이르거나 같은 시각으로 들어온 행은 지금도
 * 앞으로도 쓰이지 않는다 — 영원히 죽은 행을 201 로 받아 주는 것은 거짓 성공이다.
 * 같은 시각도 거부하는 것은 동률을 만들지 않으려는 것이다(동률 자체는 선택 규칙이
 * 결정론적으로 깨지만, 운영자가 그 결과를 예측할 수는 없다).
 *
 * ★ 배출계수(`mrv_emission_factors`)는 **같은 규약을 쓰지 않는다.** 그쪽은 외부에서
 *   공표된 값이고 "2025-12-18 공표분" 처럼 적용 시작일이 값의 일부라, 다음 해 계수를
 *   미리 등록해 두는 것이 정상적인 일이다. 그래서 그 표는 미래 등록을 허용하되 **활성
 *   선택에서 `effective_from <= now()` 를 보도록** 고쳤다(lib/mrv/mrv-report-service.ts).
 *   두 표에서 다른 결정을 내린 근거가 이것이다 — 하나는 소급 적용되는 내부 파라미터이고
 *   하나는 시점이 값에 붙어 있는 외부 공표값이다.
 */
export function assertEffectiveFrom(
  effectiveFrom: Date,
  now: Date,
  latestOrgRow: KpiConfigRow | null,
): void {
  if (effectiveFrom.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) {
    throw new HttpError(
      422,
      `effective_from (${effectiveFrom.toISOString()}) 이 미래입니다. 예약 등록은 ` +
        "지원하지 않습니다 — KPI 설정은 요청 시점의 활성 설정으로 과거 기간까지 소급 " +
        "계산되므로, 미래 시각을 적어도 그날 이후의 데이터에만 적용되지는 않습니다. " +
        "적용할 시점에 등록하십시오.",
    )
  }
  if (
    latestOrgRow !== null &&
    new Date(latestOrgRow.effective_from).getTime() >= effectiveFrom.getTime()
  ) {
    throw new HttpError(
      422,
      `effective_from (${effectiveFrom.toISOString()}) 이 이 조직의 기존 설정 ` +
        `'${latestOrgRow.version}' (${latestOrgRow.effective_from}) 보다 이르거나 ` +
        "같습니다. 활성 설정은 effective_from 이 가장 늦은 행이므로 이 행은 지금도 " +
        "앞으로도 쓰이지 않습니다 — 되돌리려면 되돌릴 파라미터를 담아 **더 늦은** " +
        "effective_from 으로 새 version 을 등록하십시오(이 표는 append-only 입니다).",
    )
  }
}
