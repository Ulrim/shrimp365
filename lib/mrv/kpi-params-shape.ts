/**
 * `kpi_config.params_json` 의 **모양** 검사 — 엔진에 넘기기 전에 거르는 자리.
 *
 * ── 왜 이 파일이 따로 있는가 ─────────────────────────────────────────────────
 * KPI 엔진(`lib/mrv/kpi/`)은 원본 Python 과 차분검증된 코드라 한 줄도 고치지 않는다
 * (scripts/mrv/verify-config.mjs). 그래서 엔진이 가진 **두 구멍**을 엔진 밖에서 막는다.
 *
 * ① `strList()` 는 `(v as unknown[]).map(String)` 이다. 목록 자리에 문자열이 적혀 있으면
 *    (`"kpi_red_metrics": "ei_total"`) `.map` 이 없어 **TypeError** 가 나고, 그것은
 *    HttpError 도 KpiValueError 도 아니므로 라우트가 **500** 으로 내보낸다 — 고칠 자리를
 *    알려 주지 않는 응답이다. 그래서 목록 자리의 모양을 먼저 본다.
 *
 *    ★ 이 검사가 **`strList` 를 쓰는 다섯 자리 전부**를 덮어야 한다. 전에는 품질 플래그
 *      네 자리만 덮었고 `alerting.kpi_red_metrics` 가 빠져 있어서, 같은 500 이 그 키로
 *      그대로 남아 있었다. 그 다섯 자리가 `STRING_LIST_PARAM_PATHS` 다 —
 *      엔진에 여섯 번째 `strList` 가 생기면 차분 검증이 FAIL 한다
 *      (scripts/mrv/verify-kpi-config-write.mjs).
 *
 * ② `rejectUnknown()` 은 **알려진 블록 안쪽만** 본다. 최상위 미지 키는 아무도 보지 않아
 *    `{"ei":{...},"recomend":{...}}` 처럼 **블록 이름을 틀린 문서가 201 로 통과하고 효과는
 *    0** 이었다. 잎 키 오탈자는 422 로 막는데 블록 이름 오탈자는 통과하는 비대칭이고,
 *    운영자는 바꿨다고 믿은 채 아무 일도 일어나지 않는다. 그래서 최상위 키도 본다.
 *
 * ★ 이 모듈은 의존성이 없는 순수 모듈로 유지할 것(`lib/mrv/quality-flags.ts` 와 같은
 *   규약). 설정 화면(`"use client"`)·인쇄 리포트 렌더러·라우트가 같이 import 한다 —
 *   `next/server` 나 DB 나 KPI 엔진을 끌고 들어오면 클라이언트 번들이 깨진다.
 */

/**
 * `params_json` 최상위에 놓일 수 있는 블록 전부.
 *
 * **정본은 `lib/mrv/kpi/config.ts` 의 `NESTED_DOC_KEYS`**(= METRIC_KEYS + EXTENSION_KEYS)
 * 이고 여기는 그 사본이다. 엔진은 고치지 않으므로 그 상수를 export 해서 가져올 수 없고,
 * 이 모듈은 엔진을 import 하지 않는다(위 ★). 그래서 사본을 두고 **두 목록이 어긋나면
 * FAIL 하는 검증**을 붙였다 — `scripts/mrv/verify-kpi-config-write.mjs` 가 엔진 자신을
 * 오라클로 써서 확인한다(알려진 블록 하나만 적힌 문서는 어느 파서도 거부하지 않고,
 * 모르는 블록이 적힌 문서는 평면 문서로 오판되어 거부된다 — 그 차이로 목록을 복원한다).
 *
 * ── 평면 문서(하위호환)는 이 검사가 거부한다 ────────────────────────────────
 * 엔진에는 "서브키가 하나도 없으면 최상위를 EI params 로 읽는다" 는 하위호환 분기가
 * 있지만 **그 분기로 저장되는 문서는 없다.** 평면 문서는 최상위 전체가 6종 파서에 모두
 * 넘겨지고, `mortality` 파서가 `included_quality_flags` 를 모르는 키로 거부한다. 즉 어떤
 * 평면 문서도 `assertEngineCanRead` 를 통과하지 못하고, 설령 SQL 로 DB 에 들어가면 그
 * org 의 `/kpi` 가 통째로 422 가 된다. 그래서 이 검사가 **"평면 문서는 지원하지 않는다"**
 * 를 먼저, 이유를 적어 거부한다 — 엔진의 `unknown MortalityConfig params_json keys` 는
 * 고칠 자리를 알려 주지 않는다.
 */
export const KPI_PARAM_TOP_LEVEL_KEYS: readonly string[] = [
  // 지표 블록(METRIC_KEYS)
  "ei",
  "fcr",
  "oei",
  "mortality",
  "alerting",
  "recommend",
  // 확장 블록(EXTENSION_KEYS) — 지표 산출에는 쓰이지 않는다.
  "baseline",
]

/** 목록 자리에 들어가는 값의 종류. 거부 규칙이 종류마다 다르다(아래 `empty_list` 참조). */
export type StringListContents = "quality_flags" | "metric_names"

/**
 * 엔진이 `strList()` 로 읽는 자리 **전부**.
 *
 * `recommend.included_feed_quality_flags` 가 품질 플래그로 분류된 것은 같은 플래그 집합을
 * 쓰기 때문이다(`mrv_feed_logs.quality_flag` 도 ok/suspect/bad 다). 급이 추천은 증빙
 * 수치는 아니지만 오염된 급이량으로 뽑은 추천이 운전 지시가 되므로 같은 자리에서 본다.
 */
export const STRING_LIST_PARAM_PATHS: readonly {
  block: string
  key: string
  contents: StringListContents
}[] = [
  { block: "ei", key: "included_quality_flags", contents: "quality_flags" },
  { block: "fcr", key: "included_quality_flags", contents: "quality_flags" },
  { block: "oei", key: "included_quality_flags", contents: "quality_flags" },
  { block: "recommend", key: "included_feed_quality_flags", contents: "quality_flags" },
  { block: "alerting", key: "kpi_red_metrics", contents: "metric_names" },
]

/** 문서에서 발견된 목록 자리 1건. `path` 는 `"ei.included_quality_flags"` 꼴. */
export type StringListParam = {
  path: string
  block: string
  key: string
  contents: StringListContents
  /** 원값 그대로(검증 전). 배열이 아닐 수도, 문자열 아닌 원소가 섞여 있을 수도 있다. */
  raw: unknown
}

/** 문서가 블록 사전인지. 배열도 null 도 아닌 객체여야 한다. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * `params_json` 에서 목록 자리가 **적힌** 곳만 모은다.
 *
 * 적히지 않은 자리는 돌려주지 않는다 — 엔진이 기본값을 쓰므로 검사할 것도 경고할 것도
 * 없다(`strList` 는 `undefined` 를 fallback 으로 바꾼다).
 */
export function findStringListParams(params: unknown): StringListParam[] {
  const doc = asRecord(params)
  if (doc === null) return []

  const out: StringListParam[] = []
  for (const { block, key, contents } of STRING_LIST_PARAM_PATHS) {
    const sub = asRecord(doc[block])
    if (sub === null) continue
    const value = sub[key]
    if (value === undefined) continue
    out.push({ path: `${block}.${key}`, block, key, contents, raw: value })
  }
  return out
}

/** 최상위에 있는 미지 블록 이름(정렬된 사본). 전부 알려진 키면 빈 배열. */
export function unknownTopLevelKeys(params: unknown): string[] {
  const doc = asRecord(params)
  if (doc === null) return []
  return Object.keys(doc)
    .filter((k) => !KPI_PARAM_TOP_LEVEL_KEYS.includes(k))
    .sort()
}

/** 모양 검사 결과 1건. **거부 판정은 하지 않는다** — 호출자가 정한다. */
export type ParamsShapeIssue =
  | { kind: "unknown_top_level_keys"; keys: string[] }
  | { kind: "not_a_list"; path: string; contents: StringListContents }
  | { kind: "empty_list"; path: string; contents: StringListContents }
  | {
      kind: "non_string_items"
      path: string
      contents: StringListContents
      items: string[]
    }

/**
 * 문서의 모양을 검사한다. 엔진을 돌리기 **전에** 통과해야 하는 검사다.
 *
 * 값의 **의미**는 보지 않는다 — 플래그 값이 ok/suspect/bad 중 하나인지는
 * `lib/mrv/quality-flags.ts`, 지표명이 실제 지표인지는 엔진의 `METRIC_DIRECTIONS` 가
 * 판단한다. 여기서는 "엔진에 넣어도 TypeError 가 나지 않는 모양인가" 만 본다.
 */
export function inspectParamsShape(params: unknown): ParamsShapeIssue[] {
  const issues: ParamsShapeIssue[] = []

  const unknownKeys = unknownTopLevelKeys(params)
  if (unknownKeys.length > 0) {
    issues.push({ kind: "unknown_top_level_keys", keys: unknownKeys })
  }

  for (const entry of findStringListParams(params)) {
    if (!Array.isArray(entry.raw)) {
      issues.push({ kind: "not_a_list", path: entry.path, contents: entry.contents })
      continue
    }
    if (entry.raw.length === 0) {
      issues.push({ kind: "empty_list", path: entry.path, contents: entry.contents })
      continue
    }
    // 문자열이 아닌 원소는 `String(item)` 으로 뭉개진다 — `true` 가 `"true"` 가 되어
    // 어떤 값에도 맞지 않는 목록이 조용히 저장되는 것이 엔진의 동작이다.
    const nonStrings = entry.raw
      .filter((item) => typeof item !== "string")
      .map((item) => JSON.stringify(item) ?? String(item))
    if (nonStrings.length > 0) {
      issues.push({
        kind: "non_string_items",
        path: entry.path,
        contents: entry.contents,
        items: nonStrings,
      })
    }
  }

  return issues
}

/**
 * 블록 이름 오탈자를 거부하는 이유.
 *
 * 화면과 거부 응답이 같은 문장을 쓰도록 상수로 둔다 — 운영자가 보는 글자가 갈리면
 * 한쪽만 읽은 사람이 다른 사실을 알게 된다.
 */
export const UNKNOWN_TOP_LEVEL_KEY_REASON =
  "엔진은 알려진 블록 안쪽만 검사하므로, 블록 이름이 틀린 문서는 거부되지 않고 " +
  "**그 블록이 통째로 무시된 채** 저장됩니다. 저장은 성공하고 바뀌는 것은 없습니다. " +
  `최상위에 놓일 수 있는 블록은 ${KPI_PARAM_TOP_LEVEL_KEYS.join(", ")} 뿐입니다.`

/** 평면 문서(서브키 없이 EI 파라미터를 최상위에 적은 옛 형식)를 거부하는 이유. */
export const FLAT_PARAMS_DOC_REASON =
  "서브키 없이 파라미터를 최상위에 적는 옛 평면 형식은 지원하지 않습니다 — 그 문서는 " +
  "6종 파서에 모두 넘겨져 mortality 파서가 거부하므로, 저장되더라도 그 조직의 /kpi · " +
  "리포트 · 알림이 통째로 422 가 됩니다. 파라미터는 지표 블록 안에 적어야 합니다 " +
  '(예: {"ei": {"included_quality_flags": ["ok"]}}).'

/**
 * 모양 문제 1건을 사람이 읽는 한 문장으로.
 *
 * 쓰기 경계의 422 문구와 설정 화면의 경고가 **같은 함수**를 쓴다. 두 곳이 각자 문장을
 * 지으면, 저장이 거부한 이유와 화면이 설명하는 이유가 갈리는 날이 온다.
 */
export function paramsShapeIssueText(issue: ParamsShapeIssue): string {
  switch (issue.kind) {
    case "unknown_top_level_keys": {
      // 평면 문서는 "모르는 블록" 으로 오지만 원인이 다르다 — 블록을 안 쓴 것이다.
      const looksFlat = issue.keys.some((k) =>
        STRING_LIST_PARAM_PATHS.some((p) => p.key === k),
      )
      return (
        `params_json 최상위에 모르는 키 ${JSON.stringify(issue.keys)} 가 있습니다. ` +
        (looksFlat ? FLAT_PARAMS_DOC_REASON : UNKNOWN_TOP_LEVEL_KEY_REASON)
      )
    }
    case "not_a_list":
      return (
        `params_json.${issue.path} 는 문자열 배열이어야 합니다. 배열이 아닌 값은 엔진 ` +
        "안에서 TypeError 를 내 500 으로 나갑니다."
      )
    case "empty_list":
      return `params_json.${issue.path} 가 빈 배열입니다.`
    case "non_string_items":
      return (
        `params_json.${issue.path} 에 문자열이 아닌 원소 ${JSON.stringify(issue.items)} ` +
        "가 있습니다. 엔진이 String() 으로 뭉개므로 어떤 값에도 맞지 않는 목록이 " +
        "조용히 저장됩니다."
      )
  }
}
