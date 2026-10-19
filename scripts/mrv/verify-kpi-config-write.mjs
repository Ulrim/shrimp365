/**
 * KPI 설정 **쓰기 경계**의 가드 검증.
 *
 * 차분 검증이 아니다 — 원본 Python 에는 kpi_config 쓰기 창구가 없어 상대가 없다
 * (원본 엔드포인트 41개에 조회/수정이 둘 다 없었다). 그래서 사양 기반 단위 검증이며,
 * 고정하는 것은 **엔진을 고치지 않고 엔진 밖에서 막는다**는 구조가 실제로 성립하는가다.
 *
 * 고정하는 것 다섯 가지:
 *
 *   ① `KPI_PARAM_TOP_LEVEL_KEYS` 가 엔진의 `NESTED_DOC_KEYS` 와 **같다.**
 *      엔진(`lib/mrv/kpi/config.ts`)은 한 줄도 고치지 않으므로 그 상수를 export 해서
 *      가져올 수 없고, 사본을 두는 대신 두 목록이 어긋나면 여기서 FAIL 한다.
 *      두 방향으로 본다 — 엔진 **원문을 파싱**해서 목록을 꺼내 비교하고, 엔진 **자신을
 *      오라클로** 써서 다시 확인한다(알려진 블록 하나만 적힌 문서는 어느 파서도 거부하지
 *      않고, 모르는 블록이 적힌 문서는 평면 문서로 오판되어 거부된다).
 *
 *   ② `STRING_LIST_PARAM_PATHS` 가 엔진의 `strList()` 호출 자리 **전부**를 덮는다.
 *      이 목록이 네 자리만 덮고 있던 동안 `alerting.kpi_red_metrics` 에 문자열을 적으면
 *      500 이 났다. 자리 수가 늘어나면 FAIL 한다.
 *
 *   ③ 각 자리에 문자열을 적으면 엔진이 **TypeError** 를 던진다 — 즉 모양 선검사가
 *      없으면 500 이 난다는 사실 자체를 고정한다. 선검사를 지우면 이 항목이 FAIL 한다.
 *
 *   ④ 모양·값 검사가 실제 사고 입력들을 잡는다(검수에서 재현된 입력을 그대로 쓴다).
 *
 *   ⑤ 활성 설정 선택 규칙(org 행 우선 · 없으면 플랫폼 기본값)이 성립한다.
 *
 * 실행:
 *   node scripts/mrv/verify-kpi-config-write.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-kpicfg-"))

const failures = []
let checked = 0

function check(name, fn) {
  checked += 1
  try {
    const problem = fn()
    if (problem) failures.push(`${name}: ${problem}`)
  } catch (err) {
    failures.push(`${name}: 예외 — ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** fn 이 던지는 오류를 돌려준다(던지지 않으면 null). */
function thrown(fn) {
  try {
    fn()
    return null
  } catch (err) {
    return err
  }
}

try {
  for (const f of [
    "kpi-params-shape.ts",
    "quality-flags.ts",
    "kpi-config-source.ts",
    "kpi-config-validate.ts",
  ]) {
    copyFileSync(join(ROOT, "lib/mrv", f), join(outDir, f))
  }
  // kpi-config-validate 는 http.ts 를 import 하고 그 파일은 next/server 를 끌고 온다.
  // 여기서 보는 것은 **던지는 종류와 순서**뿐이므로 HttpError 만 같은 모양으로 놓는다.
  writeFileSync(
    join(outDir, "http.ts"),
    [
      "export class HttpError extends Error {",
      "  readonly status: number",
      "  constructor(status: number, detail: string) {",
      "    super(detail)",
      "    this.name = 'HttpError'",
      "    this.status = status",
      "  }",
      "}",
      "",
    ].join("\n"),
  )
  // kpi-config-source 는 db.ts(Supabase 클라이언트)를 import 한다. 여기서 검사하는 것은
  // 순수 함수(선택 규칙)뿐이므로 타입만 맞는 껍데기를 놓는다.
  writeFileSync(
    join(outDir, "db.ts"),
    [
      "/* eslint-disable @typescript-eslint/no-explicit-any */",
      "export type MrvDb = any",
      "export const T = { kpiConfig: 'mrv_kpi_config' }",
      "",
    ].join("\n"),
  )
  execFileSync("mkdir", ["-p", join(outDir, "kpi")])
  for (const f of [
    "index.ts", "types.ts", "status.ts", "internal.ts", "config.ts",
    "energy.ts", "feed.ts", "oxygen.ts", "mortality.ts", "recommend.ts",
    "scope2.ts", "comparison.ts",
  ]) {
    copyFileSync(join(ROOT, "lib/mrv/kpi", f), join(outDir, "kpi", f))
  }

  execFileSync(
    "npx",
    [
      "tsc",
      join(outDir, "quality-flags.ts"),
      join(outDir, "kpi-params-shape.ts"),
      join(outDir, "kpi-config-source.ts"),
      join(outDir, "kpi-config-validate.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--strict",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const shape = require(join(outDir, "out", "kpi-params-shape.js"))
  const flags = require(join(outDir, "out", "quality-flags.js"))
  const source = require(join(outDir, "out", "kpi-config-source.js"))
  const engine = require(join(outDir, "out", "kpi", "config.js"))
  const validate = require(join(outDir, "out", "kpi-config-validate.js"))

  const engineSrc = readFileSync(join(ROOT, "lib/mrv/kpi/config.ts"), "utf8")

  // ── ① 최상위 블록 목록이 엔진의 NESTED_DOC_KEYS 와 같은가 ────────────────
  check("① 엔진 원문의 METRIC_KEYS + EXTENSION_KEYS 와 일치", () => {
    const pick = (name) => {
      const m = engineSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
      if (!m) return null
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
    }
    const metric = pick("METRIC_KEYS")
    const ext = pick("EXTENSION_KEYS")
    if (metric === null || ext === null) {
      return "엔진 원문에서 METRIC_KEYS/EXTENSION_KEYS 를 찾지 못했다(이름이 바뀌었으면 이 검증도 함께 고칠 것)"
    }
    const want = [...metric, ...ext].slice().sort()
    const got = [...shape.KPI_PARAM_TOP_LEVEL_KEYS].slice().sort()
    return JSON.stringify(want) === JSON.stringify(got)
      ? null
      : `엔진 ${JSON.stringify(want)} ≠ 사본 ${JSON.stringify(got)}`
  })

  check("① 엔진 자신을 오라클로 쓴 재확인", () => {
    // 알려진 블록 하나만 적힌 문서는 '중첩 문서' 로 판정되어 어느 파서도 거부하지 않는다.
    for (const key of shape.KPI_PARAM_TOP_LEVEL_KEYS) {
      const err = thrown(() => engine.eiConfigFromParams({ [key]: {} }))
      if (err !== null) return `'${key}' 는 엔진이 아는 블록이 아니다: ${err.message}`
    }
    // 모르는 블록이 적힌 문서는 평면 문서로 오판되어 거부된다. 이 비대칭이 ① 의 근거다.
    for (const key of ["recomend", "ei2", "mortalty", "alert", "baselines"]) {
      const err = thrown(() => engine.eiConfigFromParams({ [key]: {} }))
      if (err === null) return `'${key}' 가 엔진에서 알려진 블록으로 통과했다(목록이 낡았다)`
    }
    return null
  })

  // ── ② strList 자리 수 ────────────────────────────────────────────────────
  check("② strList 호출 자리를 전부 덮는다", () => {
    const calls = engineSrc.match(/strList\(/g) ?? []
    // 선언(`function strList(`) 한 번을 뺀 나머지가 호출 자리다.
    const callCount = calls.length - 1
    if (callCount !== shape.STRING_LIST_PARAM_PATHS.length) {
      return (
        `엔진의 strList 호출 ${callCount}곳 ≠ STRING_LIST_PARAM_PATHS ` +
        `${shape.STRING_LIST_PARAM_PATHS.length}곳 — 자리가 늘었으면 목록에 더할 것 ` +
        "(한 자리만 빠져도 그 키로 500 이 난다)"
      )
    }
    for (const { key } of shape.STRING_LIST_PARAM_PATHS) {
      if (!engineSrc.includes(`"${key}"`)) return `엔진 원문에 '${key}' 가 없다`
    }
    return null
  })

  // ── ③ 모양 선검사가 없으면 500 이라는 사실 ───────────────────────────────
  const PARSER_BY_BLOCK = {
    ei: engine.eiConfigFromParams,
    fcr: engine.fcrConfigFromParams,
    oei: engine.oeiConfigFromParams,
    alerting: engine.alertingConfigFromParams,
    recommend: engine.recommendConfigFromParams,
  }
  check("③ 목록 자리에 문자열을 적으면 엔진이 TypeError 를 던진다", () => {
    for (const { block, key, path } of shape.STRING_LIST_PARAM_PATHS.map((p) => ({
      ...p,
      path: `${p.block}.${p.key}`,
    }))) {
      const parser = PARSER_BY_BLOCK[block]
      if (parser === undefined) return `${block} 파서를 모른다`
      const err = thrown(() => parser({ [block]: { [key]: "ok" } }))
      if (err === null) return `${path}: 문자열인데 엔진이 통과시켰다`
      if (!(err instanceof TypeError)) {
        return `${path}: TypeError 가 아니라 ${err.constructor.name}(${err.message})`
      }
      // 같은 입력을 모양 검사는 422 거리로 잡아야 한다.
      const issues = shape.inspectParamsShape({ [block]: { [key]: "ok" } })
      if (!issues.some((i) => i.kind === "not_a_list" && i.path === path)) {
        return `${path}: 모양 검사가 not_a_list 로 잡지 않는다 — 이 입력은 500 으로 나간다`
      }
    }
    return null
  })

  // ── ④ 실제 사고 입력들 ──────────────────────────────────────────────────
  const kinds = (doc) => shape.inspectParamsShape(doc).map((i) => `${i.kind}:${i.path ?? "top"}`)

  check("④-a kpi_red_metrics 에 문자열 — 검수에서 500 이 난 입력", () => {
    const got = kinds({ alerting: { kpi_red_metrics: "ei_total" } })
    return got.includes("not_a_list:alerting.kpi_red_metrics")
      ? null
      : `잡지 못했다: ${JSON.stringify(got)}`
  })

  check("④-b 블록 이름 오탈자 — 검수에서 201 로 통과한 입력", () => {
    const issues = shape.inspectParamsShape({
      ei: { included_quality_flags: ["ok"] },
      recomend: { target_feed_rate_pct_of_biomass: 3 },
    })
    const unknown = issues.find((i) => i.kind === "unknown_top_level_keys")
    if (unknown === undefined) return "최상위 미지 키를 잡지 못했다"
    if (JSON.stringify(unknown.keys) !== JSON.stringify(["recomend"])) {
      return `키 목록이 다르다: ${JSON.stringify(unknown.keys)}`
    }
    // 엔진은 이 문서를 통과시킨다 — 그것이 이 검사가 필요한 이유다.
    const err = thrown(() =>
      [
        engine.eiConfigFromParams,
        engine.fcrConfigFromParams,
        engine.oeiConfigFromParams,
        engine.mortalityConfigFromParams,
        engine.alertingConfigFromParams,
        engine.recommendConfigFromParams,
      ].forEach((p) =>
        p({ ei: { included_quality_flags: ["ok"] }, recomend: { x: 1 } }),
      ),
    )
    return err === null
      ? null
      : `엔진이 이 문서를 거부한다 — 전제가 바뀌었으면 주석도 함께 고칠 것: ${err.message}`
  })

  check("④-c 평면 문서는 이유를 적어 거부한다", () => {
    const issues = shape.inspectParamsShape({ included_quality_flags: ["ok"] })
    const unknown = issues.find((i) => i.kind === "unknown_top_level_keys")
    if (unknown === undefined) return "잡지 못했다"
    const text = shape.paramsShapeIssueText(unknown)
    return text.includes("평면 형식") ? null : `이유를 적지 않는다: ${text}`
  })

  check("④-d 빈 목록: 품질 플래그는 이유까지 적고, 지표명은 종류를 구분한다", () => {
    const flagIssue = shape
      .inspectParamsShape({ ei: { included_quality_flags: [] } })
      .find((i) => i.kind === "empty_list")
    if (flagIssue === undefined || flagIssue.contents !== "quality_flags") {
      return "품질 플래그 빈 목록을 잡지 못했다"
    }
    const text = flags.kpiParamsShapeIssueText(flagIssue)
    if (!text.includes(flags.EMPTY_QUALITY_FLAG_LIST_REASON)) {
      return "화면·거부 문구가 EMPTY_QUALITY_FLAG_LIST_REASON 를 쓰지 않는다(인쇄물과 갈린다)"
    }
    const metricIssue = shape
      .inspectParamsShape({ alerting: { kpi_red_metrics: [] } })
      .find((i) => i.kind === "empty_list")
    if (metricIssue === undefined || metricIssue.contents !== "metric_names") {
      return "지표명 빈 목록의 종류가 metric_names 가 아니다(쓰기 경계가 구분해 허용한다)"
    }
    return null
  })

  check("④-e 문자열 아닌 원소", () => {
    const got = kinds({ ei: { included_quality_flags: [true, 1] } })
    return got.includes("non_string_items:ei.included_quality_flags")
      ? null
      : `잡지 못했다: ${JSON.stringify(got)}`
  })

  check("④-f 기본 시드 문서는 아무 문제도 없다", () => {
    const seed = {
      ei: { included_quality_flags: ["ok"], min_biomass_delta_kg: 0.0 },
      fcr: { included_quality_flags: ["ok"], min_biomass_delta_kg: 0.0 },
      oei: {
        included_quality_flags: ["ok"],
        min_biomass_kg: 0.0,
        do_band_method: "sample_count",
        oei_scale_factor: 1.0,
        clamp_max: 100.0,
      },
      mortality: { moving_avg_window_days: 7 },
    }
    const got = kinds(seed)
    if (got.length > 0) return `문제를 만들어 냈다: ${JSON.stringify(got)}`
    const risks = flags.collectQualityFlagRisks(seed)
    return risks.length === 0 ? null : `위험을 만들어 냈다: ${JSON.stringify(risks)}`
  })

  check("④-g 모르는 플래그 값", () => {
    const issues = flags.inspectQualityFlagLists({
      ei: { included_quality_flags: ["ok", "OK"] },
    })
    const unknown = issues.find((i) => i.kind === "unknown_flags")
    return unknown !== undefined && JSON.stringify(unknown.flags) === JSON.stringify(["OK"])
      ? null
      : `잡지 못했다: ${JSON.stringify(issues)}`
  })

  // ── ④-h 경고 문구가 블록마다 맞는 수치를 적는가 ─────────────────────────
  check("④-h oei 경고가 EI 를 주어로 적지 않는다", () => {
    const text = flags.qualityFlagRiskText("suspect", "oei")
    // "OEI" 안의 "EI" 와 구분한다 — 앞 글자가 O 가 아닌 EI 만 EI 지표를 가리킨다.
    const mentionsEi = (t) => /(^|[^O])EI(\s|의|가|는|를)/.test(t)
    if (!text.includes("DO")) return "DO 를 적지 않는다(이 목록이 거르는 것이 DO 계측값이다)"
    if (mentionsEi(text)) return `suspect/oei 문구가 EI 를 적고 있다: ${text}`
    const bad = flags.qualityFlagRiskText("bad", "oei")
    if (mentionsEi(bad)) return `bad/oei 문구가 EI 를 적고 있다: ${bad}`
    // 반대로 ei 블록 문구는 EI 를 주어로 적어야 한다(검사가 아무것도 안 보는 일 방지).
    if (!mentionsEi(flags.qualityFlagRiskText("suspect", "ei"))) {
      return "ei 블록 문구가 EI 를 적지 않는다 — 이 검사가 헛돌고 있다"
    }
    return null
  })

  check("④-i 같은 플래그라도 블록마다 다른 문장", () => {
    const blocks = ["ei", "fcr", "oei", "recommend"]
    const texts = blocks.map((b) => flags.qualityFlagRiskText("suspect", b))
    return new Set(texts).size === blocks.length
      ? null
      : "두 블록이 같은 문장을 쓴다(틀린 수치 이름이 섞일 자리다)"
  })

  check("④-j 위험 기록에 블록이 함께 실린다", () => {
    const risks = flags.collectQualityFlagRisks({
      oei: { included_quality_flags: ["ok", "suspect"] },
    })
    if (risks.length !== 1) return `건수가 다르다: ${risks.length}`
    return risks[0].block === "oei" ? null : `블록이 없다/다르다: ${risks[0].block}`
  })

  check("④-k isDefaultQualityFlagList 는 집합으로 본다", () => {
    const cases = [
      [["ok"], true],
      [["ok", "ok"], true],
      [["ok", "suspect"], false],
      [[], false],
      [undefined, false],
      ["ok", false],
    ]
    for (const [input, want] of cases) {
      const got = flags.isDefaultQualityFlagList(input)
      if (got !== want) return `${JSON.stringify(input)} → ${got} (기대 ${want})`
    }
    return null
  })

  // ── ⑤ 활성 설정 선택 규칙 ───────────────────────────────────────────────
  check("⑤ org 행이 있으면 org 행, 없으면 플랫폼 기본값", () => {
    const orgRow = { id: "a", org_id: "org-a", version: "2026.2.0" }
    const defRow = { id: "b", org_id: null, version: "2026.1.0" }
    if (source.pickActiveKpiConfig(orgRow, defRow)?.id !== "a") return "org 행이 이기지 않는다"
    if (source.pickActiveKpiConfig(null, defRow)?.id !== "b") return "기본값으로 떨어지지 않는다"
    if (source.pickActiveKpiConfig(null, null) !== null) return "둘 다 없을 때 null 이 아니다"
    // 기본값이 더 늦은 effective_from 을 갖고 있어도 org 행이 이긴다 — 그 반대가 되면
    // 기본값을 올리는 것이 조직이 정한 파라미터를 뒤집는다(이번에 막은 바로 그 사고다).
    const laterDefault = { id: "c", org_id: null, version: "2027.1.0" }
    return source.pickActiveKpiConfig(orgRow, laterDefault)?.id === "a"
      ? null
      : "날짜가 늦은 기본값이 org 행을 이긴다"
  })

  // ── ⑤ 질의까지 포함한 선택 규칙 ─────────────────────────────────────────
  /**
   * 가짜 Supabase 질의 빌더. `latestCandidate` 가 실제로 쓰는 연산만 구현한다
   * (select/lte/eq/is/order/limit/maybeSingle).
   *
   * ★ `.order()` 를 여러 번 부른 것은 **복합 정렬 키 하나**다(PostgREST 가 `order=
   *   a.desc,b.desc` 로 보낸다). 부를 때마다 다시 정렬하면 **마지막 키가 가장 세게**
   *   작용해 실제와 반대가 되므로, 키를 모아 두고 한 번에 정렬한다. 동률 깨기를 보는
   *   검증에서 이 차이가 그대로 오판으로 나온다. `nullsFirst: false` 도 지킨다.
   */
  function makeFakeDb(rows) {
    return {
      from() {
        let current = [...rows]
        const orders = []
        const materialize = () => {
          current = current
            .map((r, i) => [r, i])
            .sort(([a, ai], [b, bi]) => {
              for (const { col, asc, nullsFirst } of orders) {
                const av = a[col] ?? null
                const bv = b[col] ?? null
                if (av === null && bv === null) continue
                if (av === null) return nullsFirst ? -1 : 1
                if (bv === null) return nullsFirst ? 1 : -1
                if (av === bv) continue
                return (av < bv ? -1 : 1) * (asc ? 1 : -1)
              }
              return ai - bi
            })
            .map(([r]) => r)
        }
        const builder = {
          select: () => builder,
          lte(col, value) {
            current = current.filter((r) => String(r[col]) <= String(value))
            return builder
          },
          eq(col, value) {
            current = current.filter((r) => r[col] === value)
            return builder
          },
          is(col, value) {
            current =
              value === null
                ? current.filter((r) => r[col] === null || r[col] === undefined)
                : current.filter((r) => r[col] === value)
            return builder
          },
          order(col, opts = {}) {
            orders.push({
              col,
              asc: opts.ascending !== false,
              nullsFirst: opts.nullsFirst === true,
            })
            return builder
          },
          limit(n) {
            materialize()
            current = current.slice(0, n)
            return builder
          },
          maybeSingle() {
            materialize()
            return Promise.resolve({ data: current[0] ?? null, error: null })
          },
        }
        return builder
      },
    }
  }

  const row = (over) => ({
    id: "r",
    org_id: null,
    version: "2026.1.0",
    params_json: {},
    effective_from: "2026-01-01T00:00:00Z",
    created_at: null,
    created_by: null,
    note: null,
    ...over,
  })
  const ASOF = new Date("2026-06-01T00:00:00Z")

  await (async () => {
    const futureOnly = makeFakeDb([
      row({ id: "now", org_id: "org-a", effective_from: "2026-03-01T00:00:00Z", version: "a" }),
      row({ id: "future", org_id: "org-a", effective_from: "2030-01-01T00:00:00Z", version: "b" }),
    ])
    checked += 1
    const picked = await source.loadActiveKpiConfigRow(futureOnly, "org-a", ASOF)
    if (picked?.id !== "now") {
      failures.push(
        `⑤ 미래 날짜 행이 활성이 됐다(effective_from <= asOf 조건이 빠졌다): ${picked?.id}`,
      )
    }

    checked += 1
    const crossOrg = makeFakeDb([
      row({ id: "mine", org_id: "org-a", effective_from: "2026-02-01T00:00:00Z", version: "mine" }),
      row({ id: "default", org_id: null, effective_from: "2026-05-01T00:00:00Z", version: "def" }),
      row({ id: "theirs", org_id: "org-b", effective_from: "2026-05-30T00:00:00Z", version: "th" }),
    ])
    const mine = await source.loadActiveKpiConfigRow(crossOrg, "org-a", ASOF)
    if (mine?.id !== "mine") {
      failures.push(`⑤ 남의 org 행이나 기본값이 내 org 행을 이겼다: ${mine?.id}`)
    }

    checked += 1
    const noOrgRow = await source.loadActiveKpiConfigRow(crossOrg, "org-c", ASOF)
    if (noOrgRow?.id !== "default") {
      failures.push(`⑤ 전용 행이 없는 org 가 기본값으로 떨어지지 않았다: ${noOrgRow?.id}`)
    }

    checked += 1
    const tie = makeFakeDb([
      row({
        id: "old-entry",
        org_id: "org-a",
        effective_from: "2026-03-01T00:00:00Z",
        version: "z",
        created_at: null,
      }),
      row({
        id: "new-entry",
        org_id: "org-a",
        effective_from: "2026-03-01T00:00:00Z",
        version: "a",
        created_at: "2026-04-01T00:00:00Z",
      }),
    ])
    const tieWinner = await source.loadActiveKpiConfigRow(tie, "org-a", ASOF)
    if (tieWinner?.id !== "new-entry") {
      failures.push(
        `⑤ effective_from 동률을 created_at 으로 깨지 않았다(결정론 위반): ${tieWinner?.id}`,
      )
    }

    checked += 1
    const futureForWrite = await source.latestOrgKpiConfigRow(futureOnly, "org-a")
    if (futureForWrite?.id !== "future") {
      failures.push(
        "⑤ 쓰기 경계용 조회가 미래 행을 보지 못한다 — 그 행에 가려 영원히 안 쓰이는 " +
          `행을 201 로 받게 된다: ${futureForWrite?.id}`,
      )
    }
  })()

  // ── ⑥ 라우트의 검증 **순서** ────────────────────────────────────────────
  /** 거부의 종류와 문구를 함께 본다. 422 가 아니라 500 이 되는 것이 이 항목의 사고다. */
  function rejection(doc) {
    const err = thrown(() => validate.validateKpiParamsJson(doc))
    if (err === null) return { kind: "accepted" }
    if (err instanceof TypeError) return { kind: "TypeError(=500)", message: err.message }
    return { kind: err.name, status: err.status, message: err.message }
  }

  check("⑥-a 목록 자리의 문자열은 422 다(500 이 아니다)", () => {
    for (const { block, key } of shape.STRING_LIST_PARAM_PATHS) {
      const r = rejection({ [block]: { [key]: "ok" } })
      if (r.kind !== "HttpError" || r.status !== 422) {
        return `${block}.${key}: ${JSON.stringify(r)}`
      }
    }
    return null
  })

  check("⑥-b 모양 오류가 엔진 거부보다 먼저 보고된다", () => {
    // 모양 오류(목록 자리에 문자열)와 엔진 거부(잎 키 오탈자)를 한 문서에 함께 담는다.
    // 엔진을 먼저 돌리면 이 문서는 TypeError → 500 이다.
    const r = rejection({
      ei: { included_quality_flags: "ok" },
      mortality: { movin_avg_window_days: 7 },
    })
    if (r.kind !== "HttpError" || r.status !== 422) return JSON.stringify(r)
    return r.message.includes("included_quality_flags")
      ? null
      : `모양 오류가 아니라 다른 것을 먼저 보고한다: ${r.message}`
  })

  check("⑥-c 블록 이름 오탈자는 422 로 거부된다(201 이 아니다)", () => {
    const r = rejection({
      ei: { included_quality_flags: ["ok"] },
      recomend: { target_feed_rate_pct_of_biomass: 3 },
    })
    if (r.kind !== "HttpError" || r.status !== 422) return JSON.stringify(r)
    return r.message.includes("recomend") ? null : `어느 키인지 적지 않는다: ${r.message}`
  })

  check("⑥-d 모르는 지표명은 422 로 거부된다", () => {
    const r = rejection({ alerting: { kpi_red_metrics: ["ei_totla"] } })
    if (r.kind !== "HttpError" || r.status !== 422) return JSON.stringify(r)
    return r.message.includes("ei_totla") ? null : `이름을 적지 않는다: ${r.message}`
  })

  check("⑥-e 잎 키 오탈자는 엔진이 KpiValueError 로 거부한다", () => {
    const r = rejection({ mortality: { movin_avg_window_days: 7 } })
    return r.kind === "KpiValueError" ? null : JSON.stringify(r)
  })

  check("⑥-f suspect 산입은 거부하지 않고 기록으로 남는다", () => {
    const risks = validate.validateKpiParamsJson({
      ei: { included_quality_flags: ["ok", "suspect"] },
      alerting: { kpi_red_metrics: [] },
    })
    if (risks.length !== 1) return `기록 건수가 다르다: ${JSON.stringify(risks)}`
    if (risks[0].block !== "ei") return `블록이 없다/다르다: ${risks[0].block}`
    return risks[0].effect.length > 0 ? null : "effect 문장이 비어 있다"
  })

  check("⑥-g effective_from: 미래 거부 · 동률/과거 거부 · 더 늦은 시각 허용", () => {
    const now = new Date("2026-06-01T00:00:00Z")
    const latest = { version: "2026.1.0", effective_from: "2026-03-01T00:00:00Z" }
    const call = (iso, latestRow) =>
      thrown(() => validate.assertEffectiveFrom(new Date(iso), now, latestRow))

    if (call("2030-01-01T00:00:00Z", null) === null) return "미래 시각을 받아 줬다"
    if (call("2026-03-01T00:00:00Z", latest) === null) return "동률 시각을 받아 줬다"
    if (call("2026-02-01T00:00:00Z", latest) === null) return "과거 시각을 받아 줬다"
    if (call("2026-05-01T00:00:00Z", latest) !== null) return "정상 시각을 거부했다"
    // 전용 행이 없는 조직의 첫 등록은 과거 시각이어도 받는다(그 행이 곧 활성이 된다).
    if (call("2020-01-01T00:00:00Z", null) !== null) return "첫 등록을 거부했다"
    // 시계 오차 허용 폭 안쪽은 받는다.
    const skew = new Date(now.getTime() + 30_000).toISOString()
    return call(skew, null) === null ? null : "시계 오차 허용 폭 안쪽을 거부했다"
  })

  check("⑤ 범위 표기", () => {
    if (source.kpiConfigScope({ org_id: null }) !== "platform_default") return "null 이 org 로 읽힌다"
    if (source.kpiConfigScope({ org_id: "org-a" }) !== "org") return "org 가 기본값으로 읽힌다"
    return null
  })

  if (failures.length > 0) {
    console.error(`✗ KPI 설정 쓰기 경계 검증 실패 — ${failures.length}건`)
    for (const f of failures) console.error("  " + f)
    process.exit(1)
  }
  console.log(
    `✓ KPI 설정 쓰기 경계 검증 통과 — ${checked}개 항목 (원본에 쓰기 창구가 없어 차분 검증이 아니라 사양 기반 단위 검증이다)`,
  )
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
