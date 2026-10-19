/**
 * 계측 품질 플래그 — 값의 정의와, 그 산입 목록을 넓혔을 때 실제로 무슨 일이 생기는지.
 *
 * ── 왜 이 파일이 따로 있는가 ─────────────────────────────────────────────────
 * 플래그를 **만드는 곳**은 수집 정규화(`lib/mrv/ingestion.ts`)이고, 그것을 **쓰는 곳**은
 * KPI 엔진(`lib/mrv/kpi/*`)이다. 엔진은 원본 Python 과 차분검증된 코드라(scripts/mrv/
 * verify-config.mjs) 거기에 화이트리스트를 더하면 원본과 갈라진다 — 그래서 "어떤 플래그가
 * 존재하며 그중 어느 것이 위험한가" 라는 지식을 엔진 밖, 설정을 **저장하는 경계**와
 * 그것을 **사람에게 보여 주는 화면**이 공유할 수 있는 자리에 둔다.
 *
 * 이 파일은 **값의 의미**를 담고, 문서의 **모양**(배열인가·빈 배열인가·최상위 블록
 * 이름이 맞는가)은 `lib/mrv/kpi-params-shape.ts` 가 담는다. 목록 자리의 좌표도 거기에
 * 있다 — 품질 플래그 네 자리와 `alerting.kpi_red_metrics` 가 같은 `strList` 를 쓰므로,
 * 좌표를 두 곳에 적으면 한쪽만 늘어나는 날이 온다(실제로 그래서 `kpi_red_metrics` 의
 * 500 이 남아 있었다).
 *
 * ★ 이 모듈은 의존성이 없는 순수 모듈로 유지할 것. 설정 화면(`"use client"`)과 인쇄
 *   리포트 렌더러와 라우트가 같이 import 한다 — `next/server` 나 DB 를 끌고 들어오면
 *   클라이언트 번들이 깨진다.
 *
 * ── 플래그의 의미(ADR 0001 + lib/mrv/ingestion.ts) ───────────────────────────
 *   ok      : 정규화가 끝난 값. 그대로 합산해도 되는 값.
 *   suspect : 정규화가 **원값을 보존한 채** 앉힌 값. 전력계의 첫 적산 지침·계량기
 *             교체·카운터 롤오버(적산 원값 그대로), 음수 구간 전력량(음수 그대로),
 *             0~20 mg/L 를 벗어난 DO(그 값 그대로)가 여기 온다.
 *   bad     : 값을 아예 낼 수 없어 **0.0 으로 앉은** 값. 이력이 전혀 없는 첫 적산 지침,
 *             간격이 비정상인 순시전력이 여기 온다.
 *
 * ★ "suspect = 적산 원값" 이 전부가 아니다. 음수 구간 전력량도 suspect 이고, 그것을
 *   산입하면 EI 분자가 **줄어든다** — 산입의 방향은 플래그만으로 정해지지 않는다
 *   (ADR 0001 의 예외 표 참조). 아래 경고 문구는 흔한 쪽(적산 원값)을 적되 그것이
 *   유일한 경우라고 말하지 않는다.
 *
 * 기본 설정은 `["ok"]` 이고(supabase/migrations/mrv_platform.sql 의 시드 행),
 * 그래서 지금은 안전하다. 이 파일은 그 기본값을 넓히는 순간을 대비한다.
 */

import {
  STRING_LIST_PARAM_PATHS,
  findStringListParams,
  paramsShapeIssueText,
  type ParamsShapeIssue,
} from "./kpi-params-shape"

/** 수집 정규화가 만들어 낼 수 있는 플래그 전체. DB 에는 이 밖의 값이 들어오지 않는다. */
export const QUALITY_FLAGS = ["ok", "suspect", "bad"] as const

export type QualityFlag = (typeof QUALITY_FLAGS)[number]

/** 엔진 기본값(`lib/mrv/kpi/types.ts` 의 DEFAULT_*_CONFIG)과 같아야 한다. */
export const DEFAULT_INCLUDED_QUALITY_FLAGS: readonly QualityFlag[] = ["ok"]

/**
 * 산입 목록에 들어가면 KPI 를 오염시키는 플래그.
 * **금지가 아니다** — 넣을 정당한 이유가 있을 수 있다(예: 계량기 교체 직후 기간을
 * 수기로 보정해 두고 원값 건까지 포함해 재산출). 다만 그 선택은 기록과 경고를 남긴다.
 */
export const RISKY_QUALITY_FLAGS: readonly QualityFlag[] = ["suspect", "bad"]

/**
 * `params_json` 안에서 플래그 산입 목록이 놓이는 자리 전부.
 *
 * `lib/mrv/kpi-params-shape.ts` 의 `STRING_LIST_PARAM_PATHS` 에서 **골라 낸다** —
 * 목록을 따로 적으면 엔진에 플래그 자리가 하나 더 생기는 날 한쪽만 늘어난다.
 */
export const QUALITY_FLAG_PARAM_PATHS: readonly { block: string; key: string }[] =
  STRING_LIST_PARAM_PATHS.filter((p) => p.contents === "quality_flags").map(
    ({ block, key }) => ({ block, key }),
  )

/** 품질 플래그 산입 목록이 붙는 블록. 블록마다 거르는 대상과 틀어지는 수치가 다르다. */
export type QualityFlagBlock = "ei" | "fcr" | "oei" | "recommend"

/** 발견된 산입 목록 1건. `path` 는 `"ei.included_quality_flags"` 꼴. */
export type QualityFlagList = {
  path: string
  block: QualityFlagBlock
  key: string
  /** 원값 그대로(검증 전). 배열이 아니거나 문자열이 아닌 원소가 섞여 있을 수 있다. */
  raw: unknown
}

/**
 * `params_json` 에서 플래그 산입 목록이 **적힌** 자리만 모은다.
 *
 * 적히지 않은 자리는 돌려주지 않는다 — 엔진이 기본값(`["ok"]`)을 쓰므로 검사할 것도,
 * 경고할 것도 없다.
 *
 * ★ 평면 문서(서브키 없이 최상위에 적은 옛 EI params)는 보지 않는다. 전에는 "그 자리의
 *   목록도 EI 분자에 닿는다" 는 주석과 함께 함께 봤지만 **그것이 사실이 아니었다** —
 *   평면 문서는 최상위 전체가 6종 파서에 모두 넘겨져 `mortality` 파서가 거부하므로
 *   (`lib/mrv/kpi/config.ts`), 어떤 평면 문서도 저장되지 않고 SQL 로 들어가면 그 org 의
 *   `/kpi` 가 통째로 422 다. 즉 평면 문서에는 "조용히 오염된 수치" 가 존재할 수 없다.
 *   평면 문서 자체는 모양 검사가 이유를 적어 거부한다(`FLAT_PARAMS_DOC_REASON`).
 */
export function findQualityFlagLists(params: unknown): QualityFlagList[] {
  return findStringListParams(params)
    .filter((entry) => entry.contents === "quality_flags")
    .map((entry) => ({
      path: entry.path,
      block: entry.block as QualityFlagBlock,
      key: entry.key,
      raw: entry.raw,
    }))
}

/**
 * 플래그 **값**의 검사 결과 1건.
 *
 * 모양 문제(배열 아님·빈 배열·문자열 아닌 원소)는 여기 오지 않는다 —
 * `inspectParamsShape`(lib/mrv/kpi-params-shape.ts)가 먼저 본다.
 */
export type QualityFlagIssue =
  | { kind: "unknown_flags"; path: string; block: QualityFlagBlock; flags: string[] }
  | { kind: "risky_flags"; path: string; block: QualityFlagBlock; flags: QualityFlag[] }

/**
 * 산입 목록들의 **값**을 검사한다. **거부 판정은 하지 않는다** — 무엇이 어떤 종류의
 * 문제인지만 돌려주고, 거부할지 경고할지는 호출자(쓰기 경계 / 화면)가 정한다.
 *
 * `unknown_flags` 는 거부 대상이고 `risky_flags` 는 경고 대상이라는 구분은
 * `app/api/mrv/kpi-config/route.ts` 에 적어 두었다.
 */
export function inspectQualityFlagLists(params: unknown): QualityFlagIssue[] {
  const issues: QualityFlagIssue[] = []

  for (const entry of findQualityFlagLists(params)) {
    // 모양은 이 함수의 책임이 아니다. 배열이 아니면 값을 볼 수 없으므로 건너뛴다
    // (그 문서는 모양 검사에서 이미 422 다).
    if (!Array.isArray(entry.raw)) continue

    const unknown: string[] = []
    const risky: QualityFlag[] = []
    for (const item of entry.raw) {
      if (typeof item !== "string") continue // 모양 검사가 거부한다.
      if (!(QUALITY_FLAGS as readonly string[]).includes(item)) {
        unknown.push(item)
      } else if (RISKY_QUALITY_FLAGS.includes(item as QualityFlag)) {
        risky.push(item as QualityFlag)
      }
    }

    if (unknown.length > 0) {
      issues.push({
        kind: "unknown_flags",
        path: entry.path,
        block: entry.block,
        flags: unknown.sort(),
      })
    }
    if (risky.length > 0) {
      // 사전순(bad, suspect)이 아니라 RISKY_QUALITY_FLAGS 순서(suspect, bad)로 둔다 —
      // 경고를 읽는 사람이 먼저 봐야 하는 것은 수치를 키우는 suspect 다. 감사 로그·
      // 설정 화면·인쇄 리포트가 모두 이 순서를 그대로 쓴다.
      issues.push({
        kind: "risky_flags",
        path: entry.path,
        block: entry.block,
        flags: RISKY_QUALITY_FLAGS.filter((f) => risky.includes(f)),
      })
    }
  }

  return issues
}

/**
 * 위험 산입(suspect/bad)만 골라낸다.
 *
 * 화면과 쓰기 경계가 같은 판정을 쓰게 하려고 따로 둔다 — 한쪽이 `inspectQualityFlagLists`
 * 의 결과를 자기 식으로 걸러 내기 시작하면, 저장은 막지 않은 것을 화면이 경고하지 않거나
 * 그 반대가 되는 날이 온다.
 */
export function collectQualityFlagRisks(
  params: unknown,
): { path: string; block: QualityFlagBlock; flags: QualityFlag[] }[] {
  const out: { path: string; block: QualityFlagBlock; flags: QualityFlag[] }[] = []
  for (const issue of inspectQualityFlagLists(params)) {
    if (issue.kind === "risky_flags") {
      out.push({ path: issue.path, block: issue.block, flags: issue.flags })
    }
  }
  return out
}

/** 모르는 플래그 값을 거부하는 이유. 쓰기 경계의 422 문구와 화면이 같이 쓴다. */
export const UNKNOWN_QUALITY_FLAG_REASON =
  `수집 정규화가 만드는 값은 ${QUALITY_FLAGS.join(", ")} 셋뿐입니다` +
  "(lib/mrv/ingestion.ts). 그 밖의 값은 어떤 계측값에도 맞지 않으므로, 적힌 의도가 " +
  '무엇이었든 결과는 그 지표를 조용히 빈 목록으로 돌리는 것입니다("OK", "okay" 같은 ' +
  "오탈자가 전부 여기 옵니다)."

/**
 * 플래그 값 문제 1건을 사람이 읽는 한 문장으로.
 * 쓰기 경계의 422 문구와 설정 화면의 경고가 같은 함수를 쓴다.
 */
export function qualityFlagIssueText(issue: QualityFlagIssue): string {
  switch (issue.kind) {
    case "unknown_flags":
      return (
        `params_json.${issue.path} 에 모르는 플래그 ${JSON.stringify(issue.flags)} 가 ` +
        `있습니다. 허용 값은 ${JSON.stringify([...QUALITY_FLAGS])} 입니다 — ` +
        UNKNOWN_QUALITY_FLAG_REASON
      )
    case "risky_flags":
      return issue.flags.map((flag) => qualityFlagRiskText(flag, issue.block)).join(" ")
  }
}

/**
 * 목록이 기본값(`["ok"]`)과 같은가. 리포트·화면이 "기본값이 아님" 을 표시하는 기준.
 *
 * **집합으로 본다.** `["ok","ok"]` 는 `["ok"]` 와 완전히 같게 동작하므로(엔진은
 * `includes` 로만 쓴다 — lib/mrv/kpi/internal.ts) 기본값이 아니라고 경고하면 거짓이다.
 * 배열이 아니거나 비어 있으면 기본값이 아니다(둘 다 쓰기 경계가 거부하는 모양이지만,
 * SQL 로 들어간 옛 행을 화면이 읽을 수 있으므로 여기서 판정만 해 둔다).
 */
export function isDefaultQualityFlagList(flags: readonly unknown[] | null | undefined): boolean {
  if (!Array.isArray(flags) || flags.length === 0) return false
  return flags.every((f) => f === "ok")
}

/**
 * 블록이 **무엇을 거르는 목록인가**. 경고 문구의 주어다.
 *
 * 전에는 이 구분이 없어 네 블록이 같은 문장을 썼고, 그 문장이 EI 를 주어로 적고 있었다 —
 * `oei.included_quality_flags` 를 바꾸면 "실제로 쓴 **전력**이 빠져 **EI** 가 작게
 * 나옵니다" 가 떴는데 그 목록이 거르는 것은 **DO 계측값과 폭기 전력**이다. 틀린 수치
 * 이름을 적는 경고는 경고가 아니라 오정보다.
 */
const BLOCK_SUBJECT: Record<QualityFlagBlock, string> = {
  ei: "EI(에너지 집약도)와 Scope2 배출량의 분자가 되는 **전력 계측값**을 거르는 목록입니다",
  fcr: "FCR 의 분자가 되는 **급이 기록**(mrv_feed_logs)을 거르는 목록입니다",
  oei:
    "OEI 의 **DO 계측값**(목표대역 유지율)과 **폭기 전력**(분모)을 함께 거르는 " +
    "목록입니다(lib/mrv/kpi/oxygen.ts)",
  recommend: "**급이 추천**이 참고하는 최근 급이 기록을 거르는 목록입니다",
}

/**
 * 급이 기록 쪽에 공통으로 붙는 사실.
 * 지금 수집 경로는 급이 기록에 `ok` 만 적는다(app/api/mrv/sites/[siteId]/feed-logs/
 * route.ts 가 `quality_flag: "ok"` 를 박고, CSV 수집에는 이 칸이 없다). 그래서 이 목록을
 * 넓혀도 더 산입되는 건은 SQL 로 직접 넣은 기록뿐이다 — 그 사실을 적지 않으면 운영자가
 * "넓혔는데 아무것도 안 바뀐다" 를 설정 오류로 오해한다.
 */
const FEED_FLAG_NOTE =
  "다만 지금 수집 경로는 급이 기록에 ok 만 적으므로(수기 입력·CSV 모두), 이 목록을 " +
  "넓혀 실제로 더 산입되는 건은 SQL 로 직접 넣은 기록뿐입니다."

/**
 * (플래그 × 블록) 하나를 산입했을 때 **무슨 일이 생기는지** 문장으로.
 *
 * 색이나 아이콘이 아니라 글자로 적는다(프로젝트 규칙). "위험합니다" 로 끝내지 않고
 * 어느 수치가 어느 방향으로 틀어지는지까지 적는다 — 운영자가 그 문장을 읽고 넣을지
 * 말지를 판단할 수 있어야 경고가 제 일을 한다. 그러려면 **어느 수치인지가 맞아야 한다.**
 */
export function qualityFlagRiskText(flag: QualityFlag, block: QualityFlagBlock): string {
  if (flag === "ok") {
    return `ok 는 정규화가 끝난 값입니다(기본 산입 대상). 이 목록은 ${BLOCK_SUBJECT[block]}.`
  }

  switch (block) {
    case "ei":
      return flag === "suspect"
        ? "suspect 는 구간값을 낼 수 없어 원값을 그대로 보존한 전력 계측값입니다" +
            "(첫 적산 지침, 계량기 교체·카운터 롤오버, 음수 구간값). 산입하면 12,000 kWh " +
            "같은 적산 원값이 한 구간의 사용량으로 EI 분자와 Scope2 배출량에 통째로 " +
            "더해져 두 수치가 실제보다 크게 나옵니다(음수 구간값이 섞여 있으면 반대로 " +
            "작아집니다 — ADR 0001 의 예외 표). 화면과 리포트에는 값이 달라졌다는 것 " +
            "말고 아무 표시도 남지 않습니다."
        : "bad 는 구간값을 아예 낼 수 없어 0.0 으로 앉은 전력 계측값입니다(이력 없는 첫 " +
            "적산 지침, 간격이 비정상인 순시전력). 산입하면 실제로 쓴 전력이 빠진 채 " +
            "'사용량 0 구간' 으로 합산되어, 포함 계측값 수는 늘지만 EI 는 실제보다 작게 " +
            "나옵니다. Scope2 배출량도 함께 작아집니다."

    case "fcr":
      return flag === "suspect"
        ? "suspect 급이 기록을 산입하면 그 기록의 feed_kg 가 FCR 의 분자(총 급이량)에 " +
            `그대로 더해져 FCR 이 실제보다 크게 나옵니다. ${FEED_FLAG_NOTE}`
        : "bad 급이 기록을 산입하면 값을 믿을 수 없는 기록이 FCR 의 분자(총 급이량)에 " +
            `더해져 FCR 이 실제 사육 성적과 무관한 값이 됩니다. ${FEED_FLAG_NOTE}`

    case "oei":
      return flag === "suspect"
        ? "이 목록은 OEI 의 DO 계측값과 폭기 전력을 함께 거릅니다. suspect DO 는 " +
            "0~20 mg/L 를 벗어난 값(센서 이상)이라 산입하면 전부 목표대역 밖으로 세어져 " +
            "**DO 목표대역 유지율이 실제보다 낮게** 나옵니다. suspect 폭기 전력은 적산 " +
            "원값이라 산입하면 OEI 의 분모(생산 kg당 폭기 전력)가 커집니다. 두 방향 " +
            "모두 **OEI 를 실제보다 낮게** 만듭니다."
        : "이 목록은 OEI 의 DO 계측값과 폭기 전력을 함께 거릅니다. DO 정규화는 bad 를 " +
            "만들지 않으므로(ok/suspect 뿐 — lib/mrv/ingestion.ts) 여기서 더 산입되는 " +
            "것은 폭기 전력의 0.0 건입니다. 실제로 쓴 폭기 전력이 0 으로 합산되어 OEI 의 " +
            "분모가 작아지고, **OEI 가 실제보다 높게(좋게)** 나옵니다."

    case "recommend":
      return flag === "suspect"
        ? "suspect 급이 기록을 산입하면 최근 일평균 급이량이 그 기록만큼 커지고, 그 " +
            "평균에서 나온 **급이 추천량이 실제 필요량보다 많게** 제시됩니다. 추천은 " +
            `증빙 수치가 아니지만 그대로 운전 지시가 됩니다. ${FEED_FLAG_NOTE}`
        : "bad 급이 기록을 산입하면 값을 믿을 수 없는 기록이 최근 일평균 급이량에 " +
            "섞이고, 그 평균에서 나온 **급이 추천량이 실제 필요량과 무관한 값**이 " +
            `됩니다. ${FEED_FLAG_NOTE}`
  }
}

/**
 * 빈 목록이 왜 거부 대상인가.
 *
 * ★ "모든 계측값이 빠져 EI 가 null 이 된다" 가 아니다. `lib/mrv/kpi/energy.ts` 를 보면
 *   null 은 **Δbiomass 가 임계 이하일 때만** 나오고, 분자는 포함 건이 0 건이면 그냥
 *   `0.0` 이다. 즉 Δbiomass 가 정상인 기간에 빈 목록을 두면 EI 가 산출 불가가 아니라
 *   **0 kWh/kg** 으로, Scope2 배출량은 0 tCO2e 로 산출된다 — 감축량은 기준선 전량이
 *   된다. 조용히 null 이 되는 것보다 나쁘다. 그래서 저장 단계에서 막는다.
 *
 * 이 문장은 쓰기 경계(422)·설정 화면·인쇄 리포트가 **같이 쓴다.** 세 곳이 각자 적으면
 * 화면으로 본 사람과 인쇄물로 본 사람이 다른 사실을 알게 된다.
 */
export const EMPTY_QUALITY_FLAG_LIST_REASON =
  "빈 산입 목록은 KPI 를 '산출 불가(null)' 로 만들지 않습니다. 포함되는 계측값이 0 건이 " +
  "되어 분자가 0 으로 합산되므로, EI 는 0 kWh/kg · Scope2 배출량은 0 tCO2e 로 산출되고 " +
  "감축량이 기준선 전량으로 잡힙니다. 산출 불가를 의도한 것이라면 기간이나 계측기를 " +
  "조정해야 하고, 이 목록을 비우는 것으로는 그렇게 되지 않습니다."

/**
 * 인쇄 리포트와 리포트 화면이 **같이 쓰는** 문구.
 *
 * 두 곳이 각자 문장을 지으면 화면으로 본 사람과 인쇄물로 본 사람이 다른 사실을 알게
 * 된다(인쇄 리포트는 흑백 복사가 기본이라 색으로 보탤 수도 없다 — 글자가 전부다).
 */
export const REPORT_NON_DEFAULT_FLAGS_HEADLINE =
  "★ 기본 설정(ok)이 아닙니다 — 이 리포트의 수치는 기본값과 다른 산입 범위로 산출됐습니다."

/**
 * 「포함 품질 플래그」 칸이 **아예 없는** 옛 리포트에 적는 문구.
 *
 * ★ 칸이 없는 것과 빈 배열은 다른 사실이다. `boundary_json` 에 그 칸이 없는 리포트는
 *   이 칸을 넣기 전에 발행된 것이고, 그때 어떤 목록이 쓰였는지 **리포트 자신은 모른다.**
 *   그것을 빈 배열로 뭉개면 "EI 0 · Scope2 0 · 감축량 전량" 이라는 강한 거짓 주장을
 *   옛 리포트에 인쇄하게 된다. 모르는 것은 모른다고 적는다.
 */
export const REPORT_MISSING_FLAGS_NOTE =
  "이 리포트에는 산입 품질 플래그가 기록되지 않았습니다(이 칸을 넣기 전에 발행된 " +
  "리포트입니다). 어떤 계측값이 산입됐는지는 「적용 kpi_config 버전」으로 되짚어야 합니다."

/**
 * 리포트의 「포함 품질 플래그」 줄이 담는 것은 **EI 의 산입 목록 하나뿐**이라는 사실.
 *
 * 설정 화면이 "이 상태로 만든 리포트에 표시가 함께 인쇄됩니다" 라고 약속하면
 * `fcr`/`oei`/`recommend` 에만 위험이 있을 때 그 약속이 거짓이 된다 — 화면은 빨간
 * 경고를 띄우는데 인쇄물은 `ok` 를 평범하게 찍는다. 리포트의 그 칸은 생성 시점에
 * `ei.included_quality_flags` 만 얼려 넣기 때문이다(lib/mrv/mrv-report-service.ts).
 */
export const REPORT_COVERS_EI_FLAGS_ONLY =
  "MRV 리포트의 「포함 품질 플래그」 줄에는 EI 의 산입 목록만 기록됩니다 — " +
  "fcr · oei · recommend 의 산입 범위는 리포트에 드러나지 않으므로, 이 화면이 그것을 " +
  "확인할 수 있는 유일한 자리입니다."

/**
 * 모양 문제 1건의 **전체 문구.**
 *
 * `paramsShapeIssueText` 는 모양만 설명한다 — "빈 배열입니다" 까지다. 품질 플래그 목록이
 * 비었을 때 **왜 그것이 거부 대상인가**는 플래그의 의미에 속하므로 여기서 붙인다.
 * 쓰기 경계의 422 문구와 설정 화면이 이 함수 하나를 쓴다. 전에는 인쇄 리포트만
 * `EMPTY_QUALITY_FLAG_LIST_REASON` 을 적고 화면은 아무 설명도 붙이지 않아, 같은 상태를
 * 두 곳이 다르게 설명했다.
 */
export function kpiParamsShapeIssueText(issue: ParamsShapeIssue): string {
  const base = paramsShapeIssueText(issue)
  if (issue.kind === "empty_list" && issue.contents === "quality_flags") {
    return `${base} ${EMPTY_QUALITY_FLAG_LIST_REASON}`
  }
  return base
}
