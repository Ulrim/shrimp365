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
 * ★ 이 모듈은 의존성이 없는 순수 모듈로 유지할 것. 설정 화면(`"use client"`)과 인쇄
 *   리포트 렌더러와 라우트가 같이 import 한다 — `next/server` 나 DB 를 끌고 들어오면
 *   클라이언트 번들이 깨진다.
 *
 * ── 플래그의 의미(ADR 0001 + lib/mrv/ingestion.ts) ───────────────────────────
 *   ok      : `value` 가 구간 kWh 다. 그대로 합산해도 되는 값.
 *   suspect : 구간값을 낼 수 없어 **적산 원값을 보존한 채** 앉은 값. 첫 적산 지침
 *             (직전 값이 DB 에만 있고 배치에는 없는 경우)과 계량기 교체·카운터 롤오버가
 *             여기 온다. 숫자 자체는 12,000 kWh 처럼 구간값과 자릿수가 다르다.
 *   bad     : 구간값을 아예 낼 수 없어 **0.0 으로 앉은** 값. 이력이 전혀 없는 첫 적산
 *             지침, 간격이 비정상인 순시전력이 여기 온다.
 *
 * 기본 설정은 `["ok"]` 이고(supabase/migrations/mrv_platform.sql 의 시드 행),
 * 그래서 지금은 안전하다. 이 파일은 그 기본값을 넓히는 순간을 대비한다.
 */

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
 * `recommend.included_feed_quality_flags` 가 함께 있는 것은 같은 플래그 집합을 쓰기
 * 때문이다(`mrv_feed_logs.quality_flag` 도 ok/suspect/bad 다). 급이 추천은 증빙 수치는
 * 아니지만, 오염된 급이량으로 뽑은 추천이 운전 지시가 되므로 같은 자리에서 본다.
 */
export const QUALITY_FLAG_PARAM_PATHS: readonly { block: string; key: string }[] = [
  { block: "ei", key: "included_quality_flags" },
  { block: "fcr", key: "included_quality_flags" },
  { block: "oei", key: "included_quality_flags" },
  { block: "recommend", key: "included_feed_quality_flags" },
]

/** 발견된 산입 목록 1건. `path` 는 `"ei.included_quality_flags"` 꼴. */
export type QualityFlagList = {
  path: string
  block: string
  key: string
  /** 원값 그대로(검증 전). 배열이 아니거나 문자열이 아닌 원소가 섞여 있을 수 있다. */
  raw: unknown
}

/**
 * `params_json` 에서 플래그 산입 목록이 **적힌** 자리만 모은다.
 *
 * 적히지 않은 자리는 돌려주지 않는다 — 엔진이 기본값(`["ok"]`)을 쓰므로 검사할 것도,
 * 경고할 것도 없다. 평면 문서(하위호환 EI params)도 함께 본다: 서브키가 하나도 없는
 * 문서는 엔진이 최상위를 EI params 로 읽으므로, 그 자리의 목록도 EI 분자에 닿는다.
 */
export function findQualityFlagLists(params: unknown): QualityFlagList[] {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return []
  const doc = params as Record<string, unknown>
  const out: QualityFlagList[] = []

  for (const { block, key } of QUALITY_FLAG_PARAM_PATHS) {
    const sub = doc[block]
    if (sub === null || typeof sub !== "object" || Array.isArray(sub)) continue
    const value = (sub as Record<string, unknown>)[key]
    if (value === undefined) continue
    out.push({ path: `${block}.${key}`, block, key, raw: value })
  }

  // 평면 문서(하위호환). `lib/mrv/kpi/config.ts::isNestedDoc` 와 같은 판정이어야 한다 —
  // 여기서 다르게 보면 엔진은 읽는 목록을 이 검사가 못 보고 지나친다.
  const nestedKeys = ["ei", "fcr", "oei", "mortality", "alerting", "recommend", "baseline"]
  const isNested = nestedKeys.some((k) => k in doc)
  if (!isNested && doc["included_quality_flags"] !== undefined) {
    out.push({
      path: "included_quality_flags",
      block: "ei",
      key: "included_quality_flags",
      raw: doc["included_quality_flags"],
    })
  }

  return out
}

/** 검사 결과 1건. */
export type QualityFlagIssue =
  | { kind: "not_a_list"; path: string }
  | { kind: "empty"; path: string }
  | { kind: "unknown_flags"; path: string; flags: string[] }
  | { kind: "risky_flags"; path: string; flags: QualityFlag[] }

/**
 * 산입 목록들을 검사한다. **거부 판정은 하지 않는다** — 무엇이 어떤 종류의 문제인지만
 * 돌려주고, 거부할지 경고할지는 호출자(쓰기 경계 / 화면)가 정한다.
 *
 * `not_a_list` / `unknown_flags` / `empty` 는 거부 대상이고 `risky_flags` 는 경고
 * 대상이라는 구분은 `app/api/mrv/kpi-config/route.ts` 에 적어 두었다.
 */
export function inspectQualityFlagLists(params: unknown): QualityFlagIssue[] {
  const issues: QualityFlagIssue[] = []

  for (const entry of findQualityFlagLists(params)) {
    if (!Array.isArray(entry.raw)) {
      issues.push({ kind: "not_a_list", path: entry.path })
      continue
    }
    if (entry.raw.length === 0) {
      issues.push({ kind: "empty", path: entry.path })
      continue
    }

    const unknown: string[] = []
    const risky: QualityFlag[] = []
    for (const item of entry.raw) {
      // 엔진의 strList 는 `String(item)` 으로 뭉개므로(lib/mrv/kpi/config.ts), 저장
      // 전에는 문자열이 아닌 원소도 알 수 없는 값으로 본다 — `true` 가 `"true"` 가 되어
      // 어떤 계측값에도 맞지 않는 목록이 조용히 저장되는 것이 지금의 동작이다.
      if (typeof item !== "string" || !(QUALITY_FLAGS as readonly string[]).includes(item)) {
        unknown.push(typeof item === "string" ? item : JSON.stringify(item) ?? String(item))
      } else if (RISKY_QUALITY_FLAGS.includes(item as QualityFlag)) {
        risky.push(item as QualityFlag)
      }
    }

    if (unknown.length > 0) {
      issues.push({ kind: "unknown_flags", path: entry.path, flags: unknown.sort() })
    }
    if (risky.length > 0) {
      // 사전순(bad, suspect)이 아니라 RISKY_QUALITY_FLAGS 순서(suspect, bad)로 둔다 —
      // 경고를 읽는 사람이 먼저 봐야 하는 것은 수치를 키우는 suspect 다. 감사 로그·
      // 설정 화면·인쇄 리포트가 모두 이 순서를 그대로 쓴다.
      issues.push({
        kind: "risky_flags",
        path: entry.path,
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
): { path: string; flags: QualityFlag[] }[] {
  const out: { path: string; flags: QualityFlag[] }[] = []
  for (const issue of inspectQualityFlagLists(params)) {
    if (issue.kind === "risky_flags") out.push({ path: issue.path, flags: issue.flags })
  }
  return out
}

/** 목록이 기본값(`["ok"]`)과 같은가. 리포트·화면이 "기본값이 아님" 을 표시하는 기준. */
export function isDefaultQualityFlagList(flags: readonly unknown[] | null | undefined): boolean {
  if (!Array.isArray(flags)) return false
  return flags.length === 1 && flags[0] === "ok"
}

/**
 * 플래그 하나를 산입했을 때 **무슨 일이 생기는지** 한 문장으로.
 *
 * 색이나 아이콘이 아니라 글자로 적는다(프로젝트 규칙). "위험합니다" 로 끝내지 않고
 * 어느 수치가 어느 방향으로 틀어지는지까지 적는다 — 운영자가 그 문장을 읽고 넣을지
 * 말지를 판단할 수 있어야 경고가 제 일을 한다.
 */
export function qualityFlagRiskText(flag: QualityFlag): string {
  switch (flag) {
    case "suspect":
      return (
        "suspect 는 구간값을 낼 수 없어 계량기 적산 원값을 그대로 보존한 건입니다" +
        "(첫 적산 지침, 계량기 교체·카운터 롤오버). 산입하면 12,000 kWh 같은 적산 원값이" +
        " 한 구간의 사용량으로 EI 분자와 Scope2 배출량에 통째로 더해져 두 수치가 실제보다" +
        " 크게 나옵니다. 화면과 리포트에는 값이 커졌다는 것 말고 아무 표시도 남지 않습니다."
      )
    case "bad":
      return (
        "bad 는 구간값을 아예 낼 수 없어 0.0 으로 앉은 건입니다(이력 없는 첫 적산 지침," +
        " 간격이 비정상인 순시전력). 산입하면 실제로 쓴 전력이 빠진 채 '사용량 0 구간'" +
        " 으로 합산되어, 포함 계측값 수는 늘지만 EI 는 실제보다 작게 나옵니다."
      )
    case "ok":
      return "ok 는 구간 kWh 로 정규화가 끝난 값입니다(기본 산입 대상)."
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
 */
export const EMPTY_QUALITY_FLAG_LIST_REASON =
  "빈 산입 목록은 KPI 를 '산출 불가(null)' 로 만들지 않습니다. 포함되는 계측값이 0 건이 " +
  "되어 분자가 0 으로 합산되므로, EI 는 0 kWh/kg · Scope2 배출량은 0 tCO2e 로 산출되고 " +
  "감축량이 기준선 전량으로 잡힙니다. 산출 불가를 의도한 것이라면 기간이나 계측기를 " +
  "조정해야 하고, 이 목록을 비우는 것으로는 그렇게 되지 않습니다."
