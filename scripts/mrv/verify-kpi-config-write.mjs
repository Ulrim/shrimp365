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
 *   ⑦ 「잠정 지표」 정본(`lib/mrv/metric-provenance.ts`)이 사실을 말한다.
 *      OEI 는 사업계획서에 산식이 없는 제안값인데 플랫폼은 그 값을 산출하고 신호등을 켜고
 *      기본 설정으로 알림까지 보낸다 — 그 사실이 화면·인쇄 리포트·알림에 적히는가를
 *      고정한다. 문구를 비우거나 OEI 를 조용히 '확정' 으로 돌리거나 감시 목록 읽기가
 *      엔진 폴백 규약과 갈라지면 FAIL 한다.
 *
 * 실행:
 *   node scripts/mrv/verify-kpi-config-write.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
    // ⑦ 가 보는 모듈. api-types 는 metric-provenance 가 타입만 가져오지만, tsc 가
    // 컴파일하려면 파일이 있어야 한다.
    "metric-provenance.ts",
    // ⑧ 이 보는 모듈. 실물을 컴파일해 쓴다 — 엔진을 오라클로 삼아 "엔진이 null 을 낸
    // 조건과 이 모듈이 적는 사유가 같은가" 를 대조하기 때문에 스텁으로 바꾸면 정작
    // 검증하려는 연결이 사라진다.
    "metric-unavailability.ts",
    // ⑧-q 가 **인쇄 리포트를 실제로 렌더해** 사유가 인쇄되는지 본다. 원문에서 이름만
    // 찾는 검사는 함수 정의 자체에 걸려 통과해 버린다(역검증에서 실제로 그랬다) —
    // 그래서 출력물을 본다. 이 파일은 순수 렌더러라 그대로 돌릴 수 있다.
    "report-html.ts",
    "measurement-basis.ts",
    "api-types.ts",
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
  // report-html 은 리포트 행 타입만 가져온다(import type) — 실행 코드가 없으므로
  // 타입 전용 스텁으로 둔다. 실제 타입이 어긋나는지는 tsc --noEmit 가 본다.
  writeFileSync(
    join(outDir, "mrv-report-service.ts"),
    [
      "// 검증용 타입 스텁(실제 타입 검사는 tsc --noEmit 가 한다).",
      "/* eslint-disable @typescript-eslint/no-explicit-any */",
      "export type MrvReportRow = any",
      "export type EmissionFactorRow = any",
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
      join(outDir, "metric-provenance.ts"),
      join(outDir, "metric-unavailability.ts"),
      // ⑧ 은 엔진 **실물**을 오라클로 쓴다(computeEi/computeFcr/computeOei/
      // computeMortality/computeScope2Reduction/compareMetric). 배럴을 함께 컴파일해
      // 두어야 그 함수들이 나온다.
      join(outDir, "kpi", "index.ts"),
      join(outDir, "report-html.ts"),
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
  const prov = require(join(outDir, "out", "metric-provenance.js"))
  const engineStatus = require(join(outDir, "out", "kpi", "status.js"))
  const engineTypes = require(join(outDir, "out", "kpi", "types.js"))
  const na = require(join(outDir, "out", "metric-unavailability.js"))
  const kpi = require(join(outDir, "out", "kpi", "index.js"))
  const reportHtml = require(join(outDir, "out", "report-html.js"))

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

  // ── ⑦ 「잠정 지표」 정본이 사실을 말하는가 ───────────────────────────────
  //
  // 고정하는 것: OEI 는 사업계획서에 산식이 없는 제안값이고, 플랫폼은 그 값을 산출하고
  // 신호등을 켜고 기본 설정으로 알림까지 보낸다. 그 사실을 `lib/mrv/metric-provenance.ts`
  // 가 담고, 화면 · 인쇄 리포트 · 알림이 거기서 가져다 적는다.
  //
  // ★ import 만 해 두고 단정이 없으면 "검사가 약속만 하고 비어 있어 판정을 망가뜨려도
  //   통과" 한다. 아래 항목은 전부 실제로 값을 들여다본다 — 문장을 비우거나, OEI 를
  //   조용히 '확정' 으로 돌리거나, 엔진 폴백 규약과 갈라지면 FAIL 한다.

  check("⑦-a 지표 목록이 엔진의 METRIC_DIRECTIONS 와 같다", () => {
    const want = Object.keys(engineStatus.METRIC_DIRECTIONS).slice().sort()
    const got = [...prov.PROVENANCE_METRIC_KEYS].slice().sort()
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      return (
        `엔진 ${JSON.stringify(want)} ≠ 정본 ${JSON.stringify(got)} — 신호등 판정 대상이 ` +
        "늘었으면 METRIC_PROVENANCE 에 그 지표의 정의 출처를 적을 것(적지 않으면 그 " +
        "지표는 화면에 아무 출처 표시 없이 나간다)"
      )
    }
    const missing = want.filter((k) => prov.METRIC_PROVENANCE[k] === undefined)
    return missing.length === 0 ? null : `METRIC_PROVENANCE 에 ${JSON.stringify(missing)} 가 없다`
  })

  check("⑦-b OEI 는 제안 산식 · 잠정이고 미확정 셋을 적는다", () => {
    const oei = prov.METRIC_PROVENANCE.oei
    if (oei === undefined) return "METRIC_PROVENANCE.oei 가 없다"
    if (oei.origin !== "proposed") return `origin 이 'proposed' 가 아니다: ${oei.origin}`
    if (oei.status !== "provisional") return `status 가 'provisional' 이 아니다: ${oei.status}`
    if (!prov.isProvisionalMetric("oei")) return "isProvisionalMetric('oei') 가 false 다"
    // 「지표정의」 시트가 미확정으로 둔 것은 셋이다 — 산식 · 단위 · 승인 DO 임계치.
    if (oei.unresolved.length !== 3) {
      return `미확정 항목이 3건이 아니다: ${JSON.stringify(oei.unresolved)}`
    }
    for (const needle of ["산식", "단위", "임계치"]) {
      if (!oei.unresolved.some((u) => u.includes(needle))) {
        return `미확정 목록에 '${needle}' 가 없다: ${JSON.stringify(oei.unresolved)}`
      }
    }
    if (!oei.sourceText.includes("사업계획서")) return "sourceText 가 정의 출처를 적지 않는다"
    return null
  })

  check("⑦-c 확정 지표는 잠정으로 표시되지 않는다", () => {
    for (const key of prov.PROVENANCE_METRIC_KEYS) {
      const meta = prov.METRIC_PROVENANCE[key]
      const isProv = meta.status === "provisional"
      if (prov.isProvisionalMetric(key) !== isProv) return `${key}: isProvisionalMetric 불일치`
      if (prov.PROVISIONAL_METRIC_KEYS.includes(key) !== isProv) {
        return `${key}: PROVISIONAL_METRIC_KEYS 불일치`
      }
      if (!isProv && meta.unresolved.length !== 0) {
        return `${key}: 확정인데 미확정 항목이 있다 ${JSON.stringify(meta.unresolved)}`
      }
      // 표시 문구는 잠정일 때만, 그리고 **빈 문자열이 아니게** 나와야 한다.
      // 두 가지를 다 본다 — 배지가 없는 자리가 쓰는 쪽(표시가 앞에 붙은 것)과 배지 바로
      // 옆이 쓰는 쪽(표시를 뗀 것). 한쪽만 보면 다른 쪽을 비워도 통과한다.
      for (const fn of ["provisionalMetricShortNote", "provisionalMetricReason"]) {
        const note = prov[fn](key)
        if (isProv && (typeof note !== "string" || note.trim().length < 20)) {
          return `${key}: 잠정인데 ${fn} 가 비었다/너무 짧다 ${JSON.stringify(note)}`
        }
        if (!isProv && note !== null) return `${key}: 확정인데 ${fn} 가 문구를 낸다`
      }
      // 표시가 중복되지 않아야 한다 — 배지 옆에 쓰는 쪽은 그 네 글자를 담지 않는다.
      if (isProv && prov.provisionalMetricReason(key).includes(prov.PROVISIONAL_METRIC_MARK)) {
        return `${key}: provisionalMetricReason 이 표시 문구를 다시 담는다`
      }
    }
    return null
  })

  check("⑦-d 리포트 절이 비어 있지 않고 필요한 사실을 전부 적는다", () => {
    const lines = prov.REPORT_PROVISIONAL_METRIC_LINES
    if (!Array.isArray(lines) || lines.length === 0) return "리포트 절이 비어 있다"
    const blank = lines.findIndex((l) => typeof l !== "string" || l.trim().length < 20)
    if (blank !== -1) return `${blank}번째 줄이 비었다/너무 짧다`
    if (prov.REPORT_PROVISIONAL_METRIC_HEADING.trim().length < 10) return "절 제목이 비었다"
    const body = `${prov.REPORT_PROVISIONAL_METRIC_HEADING}\n${lines.join("\n")}`
    /*
     * 심사위원이 읽는 문서이므로 이 네 가지 사실이 **문장째로** 들어 있어야 한다.
     *
     * ★ 낱말(`"임계값"` 같은 것)로만 보면 안 된다. 실제로 그렇게 짰다가, 임계값 사실
     *   한 줄을 배열에서 빼도 다른 줄에 그 낱말이 남아 있어 **통과했다.** 약속만 하고
     *   비어 있는 검사가 되는 자리다 — 그래서 상수 자체를 찾는다.
     */
    const required = [
      [prov.METRIC_PROVENANCE.oei.sourceText, "산식이 사업계획서에 없고 제안값이라는 사실"],
      [prov.OEI_SCALE_FACTOR_NOTE, "스케일 계수가 보정 예정이라는 사실"],
      [prov.OEI_HOW_TO_READ, "그래서 이 숫자를 어떻게 읽어야 하는가"],
      [prov.KPI_THRESHOLD_ASSUMPTION_NOTE, "신호등 임계값이 실증 전 가정이라는 사실"],
    ]
    for (const [needle, why] of required) {
      if (typeof needle !== "string" || needle.trim().length < 20) {
        return `${why}: 가져다 쓸 문장 자체가 비어 있다`
      }
      if (!body.includes(needle)) return `리포트 절에 ${why}이 없다`
    }
    if (!body.includes("OEI")) return "어느 지표에 대한 말인지 적지 않는다"
    for (const item of prov.METRIC_PROVENANCE.oei.unresolved) {
      if (!body.includes(item)) return `미확정 항목 '${item}' 이 리포트 절에 없다`
    }
    return null
  })

  check("⑦-e 감시 목록 읽기가 엔진 폴백 규약과 같다", () => {
    // 엔진(`alertingConfigFromParams`)이 오라클이다. 화면이 "감시 중" 이라고 적는 목록과
    // 알림 작업이 실제로 쓰는 목록이 갈리면, 화면이 틀린 사실을 말한다.
    const docs = [
      {},
      { alerting: {} },
      { alerting: { kpi_red_metrics: [] } },
      { alerting: { kpi_red_metrics: ["ei_total"] } },
      { alerting: { kpi_red_metrics: ["ei_total", "oei"] } },
      { ei: { included_quality_flags: ["ok"] } },
    ]
    for (const doc of docs) {
      const want = engine.alertingConfigFromParams(doc).kpiRedMetrics
      const got = prov.readKpiRedWatchlist(doc).metrics
      if (JSON.stringify([...want]) !== JSON.stringify([...got])) {
        return `${JSON.stringify(doc)}: 엔진 ${JSON.stringify(want)} ≠ 정본 ${JSON.stringify(got)}`
      }
    }
    // 키가 없을 때만 fromDefault 다 — 빈 배열은 "쓰지 않겠다는 선택" 이고 기본값이 아니다.
    if (!prov.readKpiRedWatchlist({}).fromDefault) return "키가 없는데 fromDefault 가 false 다"
    if (prov.readKpiRedWatchlist({ alerting: { kpi_red_metrics: [] } }).fromDefault) {
      return "빈 배열이 fromDefault 로 읽힌다"
    }
    // 배열이 아닌 값은 추측하지 않고 unreadable 로 돌려준다(엔진은 TypeError 를 던진다).
    const bad = prov.readKpiRedWatchlist({ alerting: { kpi_red_metrics: "oei" } })
    if (!bad.unreadable) return "배열이 아닌 값을 unreadable 로 표시하지 않는다"
    return null
  })

  check("⑦-f 기본 감시 목록에 든 잠정 지표를 사실대로 적는다", () => {
    const def = prov.DEFAULT_KPI_RED_METRICS
    const engineDefault = engineTypes.DEFAULT_ALERTING_CONFIG.kpiRedMetrics
    if (JSON.stringify([...def]) !== JSON.stringify([...engineDefault])) {
      return `엔진 기본값 ${JSON.stringify(engineDefault)} ≠ 정본 ${JSON.stringify(def)}`
    }
    const provisionalByDefault = prov.PROVISIONAL_METRIC_KEYS.filter((k) => def.includes(k))
    // 알림 센터의 안내는 "기본 목록에 잠정 지표가 있다" 와 **정확히 같은 조건**에서만 뜬다.
    const pointer = prov.alertCenterKpiRedWatchlistPointer()
    if (provisionalByDefault.length > 0) {
      if (pointer === null) return "기본 목록에 잠정 지표가 있는데 알림 센터 안내가 없다"
      if (!pointer.includes("kpi_red_metrics")) return "안내가 감시 목록의 자리를 적지 않는다"
      for (const key of provisionalByDefault) {
        if (!pointer.includes(key.toUpperCase())) return `안내가 ${key} 를 적지 않는다`
      }
    } else if (pointer !== null) {
      return "기본 목록에 잠정 지표가 없는데 안내가 뜬다"
    }

    // 설정 화면 문구: 감시 중일 때는 빠져나갈 경로를, 아닐 때는 "없다" 를 적는다.
    const watched = prov.provisionalMetricWatchlistNote("oei", {
      metrics: ["ei_total", "oei"],
      fromDefault: true,
      unreadable: false,
    })
    if (watched === null) return "감시 중인데 설정 화면 문구가 없다"
    if (!watched.includes("kpi_red_metrics")) return "빠져나갈 경로를 적지 않는다"
    if (!watched.includes("/api/mrv/kpi-config")) return "쓰기 창구를 적지 않는다"

    const unwatched = prov.provisionalMetricWatchlistNote("oei", {
      metrics: ["ei_total"],
      fromDefault: false,
      unreadable: false,
    })
    if (unwatched === null) return "감시 중이 아닐 때도 문구가 필요하다"
    if (unwatched.includes("kpi_red_metrics")) {
      return "감시 중이 아닌데 빠져나갈 경로를 적는다(끄려고 들어온 사람이 끌 것을 못 찾는다)"
    }
    // 확정 지표에는 붙지 않는다.
    return prov.provisionalMetricWatchlistNote("ei_total", {
      metrics: ["ei_total"],
      fromDefault: true,
      unreadable: false,
    }) === null
      ? null
      : "확정 지표에 잠정 문구가 붙는다"
  })

  check("⑦-g 알림 한 건의 문구는 잠정 지표에만, 모르는 이름에는 붙지 않는다", () => {
    const note = prov.provisionalAlertNote("oei")
    if (note === null || note.trim().length < 20) return "OEI 알림에 문구가 없다/너무 짧다"
    if (!note.includes("OEI")) return "어느 지표인지 적지 않는다"
    if (prov.provisionalAlertNote("ei_total") !== null) return "확정 지표에 문구가 붙는다"
    // payload.metric 은 자유 문자열이다 — 모르는 값/문자열 아닌 값에서 죽지 않아야 한다.
    for (const raw of ["ei_totla", "", undefined, null, 7, {}, []]) {
      if (prov.provisionalAlertNote(raw) !== null) {
        return `모르는 값에 문구가 붙는다: ${JSON.stringify(raw) ?? String(raw)}`
      }
      if (prov.asMetricKey(raw) !== null) return `asMetricKey 가 ${String(raw)} 를 통과시킨다`
    }
    return null
  })

  check("⑦-h OEI 를 내보내는 자리가 전부 정본을 읽는다", () => {
    /*
     * 직접 grep 해서 찾은 자리 전부다(명령은 이 작업 보고에 그대로 적었다):
     *   grep -rniE "oei|산소효율|oxygen" --include=*.ts --include=*.tsx app/ lib/ components/
     * 중 **사람 앞에 값·신호등·순위·알림·파라미터를 내보내는** 파일만 남긴 것이다.
     * API 라우트와 서비스 계층(값을 만들어 넘기는 자리)은 화면이 아니므로 제외했다.
     *
     * 새 자리가 생기는 것은 이 검사가 잡지 못한다. 잡는 것은 **있던 자리에서 표시가
     * 사라지는 것**이고, 그것이 이 작업에서 실제로 되돌아갈 수 있는 쪽이다.
     */
    const surfaces = [
      ["components/mrv/kpi-card.tsx", "KPI 카드(개요 · 기준선 두 화면이 함께 쓴다)"],
      ["app/mrv/multisite/page.tsx", "사이트 벤치마크 표(지표 방향 보정 · 최고/최저 배지)"],
      ["app/mrv/comparison/page.tsx", "전후 비교표(개선율까지 적는다)"],
      ["lib/mrv/report-html.ts", "인쇄 리포트"],
      ["app/mrv/mrv-reports/[reportId]/page.tsx", "리포트 화면"],
      ["app/mrv/settings/page.tsx", "KPI 파라미터 표"],
      ["app/mrv/alerts/page.tsx", "알림 센터"],
    ]
    /*
     * ★ 파일 안에 "metric-provenance" 라는 글자가 있는지로 보면 안 된다. 실제로 그렇게
     *   짰다가, 화면의 import 를 다른 모듈로 바꿔도 **파일 머리 주석에 그 이름이 남아
     *   있어 통과했다.** 보는 것은 import 문이다.
     */
    const IMPORT_RE = /from\s+"(?:@\/lib\/mrv|\.)\/metric-provenance"/
    for (const [rel, what] of surfaces) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      if (!IMPORT_RE.test(src)) {
        return `${rel}(${what}) 가 lib/mrv/metric-provenance 를 import 하지 않는다`
      }
    }
    // 인쇄과 화면이 **같은 배열**을 돌리는가. 한쪽만 자기 문장을 지으면 화면으로 본 사람과
    // 인쇄물로 본 사람이 다른 사실을 알게 된다.
    for (const rel of ["lib/mrv/report-html.ts", "app/mrv/mrv-reports/[reportId]/page.tsx"]) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      for (const name of [
        "REPORT_PROVISIONAL_METRIC_HEADING",
        "REPORT_PROVISIONAL_METRIC_LINES",
      ]) {
        // 2회 이상 — import 와 실제 사용. 1회면 주석에만 이름이 남은 상태일 수 있다
        // (⑦-h 위의 주석에 적은 함정이 그것이다).
        if (src.split(name).length - 1 < 2) {
          return `${rel} 가 리포트 공용 문구 ${name} 를 가져다 쓰지 않는다`
        }
      }
    }
    return null
  })


  // ── ⑧ 「산출 불가」의 사유가 엔진의 결론과 같은 것을 가리키는가 ──────────
  //
  // 고정하는 것: KPI 카드는 값이 없는 지표 넷에 같은 추측 한 줄을 적고 있었다
  // ("해당 기간에 산출 조건을 만족하지 못했습니다(예: 생산량 변화 부족)"). 지금은
  // `lib/mrv/metric-unavailability.ts` 가 **엔진이 돌려준 근거**에서 사유를 확정한다.
  //
  // ★ 여기서 **엔진 실물이 오라클**이다. 시나리오마다 computeEi/computeFcr/computeOei/
  //   computeMortality 를 실제로 돌려 "엔진이 null 을 냈는가" 를 먼저 확인하고, 그
  //   다음에 모듈이 적는 사유 id 를 대조한다. 엔진의 null 조건이 바뀌면(또는 모듈이
  //   엉뚱한 조건을 적으면) 두 쪽이 어긋나 FAIL 한다.
  //
  // ★ import 만 해 두고 단정이 없으면 "약속만 하고 비어 있는 검사" 가 된다. 아래는
  //   전부 실제 값을 들여다보고, 마지막 두 항목은 **화면·인쇄 리포트 원문**을 읽어
  //   공용 상수를 정말 가져다 쓰는지(그리고 옛 추측 문구가 되살아나지 않았는지)까지 본다.

  const P_FROM = new Date("2026-08-01T00:00:00Z")
  const P_TO = new Date("2026-08-31T00:00:00Z")
  const VER = "2026.1.0"

  /** 생산량 기록 n건을 개시/마감 시점으로 고른다 — kpi-service.pickBiomassBounds 와 같은 규약. */
  function bounds(records, startKg, endKg) {
    if (records === 0) {
      const empty = { ts: new Date(0), biomassKg: 0.0, sourceRef: "none" }
      return [empty, empty]
    }
    if (records === 1) {
      const only = { ts: new Date("2026-08-02T00:00:00Z"), biomassKg: startKg, sourceRef: "h1" }
      return [only, only]
    }
    return [
      { ts: new Date("2026-08-02T00:00:00Z"), biomassKg: startKg, sourceRef: "h1" },
      { ts: new Date("2026-08-20T00:00:00Z"), biomassKg: endKg, sourceRef: "h2" },
    ]
  }

  function powerReading(kwh, isAeration) {
    return {
      meterId: isAeration ? "m-aer" : "m-main",
      ts: new Date("2026-08-05T00:00:00Z"),
      kwh,
      isAeration,
      qualityFlag: "ok",
    }
  }

  /**
   * 시나리오 하나를 **실물 엔진**으로 돌리고, kpi-service 와 같은 모양의 근거를 만든다.
   * (조립 자체가 kpi-service 와 일치하는지는 verify-pipeline 이 실물로 본다 — 여기서
   * 보는 것은 "그 근거로 모듈이 무엇을 적는가" 다.)
   */
  function scenario(opts) {
    const params = opts.params ?? {}
    const eiCfg = engine.eiConfigFromParams(params)
    const fcrCfg = engine.fcrConfigFromParams(params)
    const oeiCfg = engine.oeiConfigFromParams(params)
    const mortCfg = engine.mortalityConfigFromParams(params)

    const records = opts.records ?? 2
    const [bStart, bEnd] = bounds(records, opts.startKg ?? 100, opts.endKg ?? 600)
    const power = opts.power ?? [powerReading(900, false), powerReading(400, true)]
    const feed = opts.feed ?? [
      { sourceRef: "f1", batchId: "b1", ts: new Date("2026-08-06T00:00:00Z"), feedKg: 120, qualityFlag: "ok" },
    ]
    const doReadings = opts.doReadings ?? [
      { meterId: "m-do", ts: new Date("2026-08-07T00:00:00Z"), doMgL: 6.5, qualityFlag: "ok" },
    ]
    const band = opts.band === undefined ? { doMin: 5.0, doMax: 8.0 } : opts.band
    const mortRows = opts.mortality ?? [
      { sourceRef: "d1", batchId: "b1", ts: new Date("2026-08-08T00:00:00Z"), deadCount: 10 },
    ]
    const stocked = opts.stocked === undefined ? 100000 : opts.stocked

    const ei = kpi.computeEi(power, bStart, bEnd, P_FROM, P_TO, eiCfg, VER)
    const fcr = kpi.computeFcr(feed, bStart, bEnd, P_FROM, P_TO, fcrCfg, VER)
    const mort = kpi.computeMortality(mortRows, stocked, P_FROM, P_TO, mortCfg, VER)
    const oei =
      band === null
        ? null
        : kpi.computeOei(doReadings, power, bStart, bEnd, band, P_FROM, P_TO, oeiCfg, VER)

    const evidence = {
      biomass_delta_kg: ei.biomassDeltaKg,
      biomass_record_count: records,
      ei_min_biomass_delta_kg: eiCfg.minBiomassDeltaKg,
      fcr_min_biomass_delta_kg: fcrCfg.minBiomassDeltaKg,
      oei_min_biomass_kg: oeiCfg.minBiomassKg,
      total_power_kwh: ei.totalPowerKwh,
      aeration_power_kwh: ei.aerationPowerKwh,
      oei_aeration_power_kwh: oei === null ? null : oei.aerationPowerKwh,
      included_reading_count: ei.includedReadingCount,
      excluded_reading_count: ei.excludedReadingCount,
      included_feed_count: fcr.includedFeedCount,
      excluded_feed_count: fcr.excludedFeedCount,
      stocked_count: mort.stockedCount,
      oei_applicable: oei !== null,
      do_total_samples: oei === null ? null : oei.doTotalSamples,
      do_excluded_samples: oei === null ? null : oei.doExcludedSamples,
    }
    const values = {
      ei_total: ei.eiTotal,
      ei_aeration: ei.eiAeration,
      fcr: fcr.fcr,
      oei: oei === null ? null : oei.oei,
      mortality_rate: mort.cumulativeRatePct,
    }
    return { values, evidence }
  }

  function reasonIds(metricKey, evidence) {
    return na.metricUnavailabilityReasons(metricKey, evidence).map((r) => r.id).sort()
  }
  function causeIds(metricKey, evidence) {
    return na
      .metricUnavailabilityReasons(metricKey, evidence)
      .filter((r) => r.kind === "cause")
      .map((r) => r.id)
      .sort()
  }

  const ALL_METRIC_KEYS = ["ei_total", "ei_aeration", "fcr", "oei", "mortality_rate"]

  check("⑧-a 산출된 지표에는 확정 사유가 하나도 없다", () => {
    // 역방향 검사. 모듈이 아무 때나 "분모 부족" 을 적으면 여기서 걸린다.
    const { values, evidence } = scenario({})
    for (const key of ALL_METRIC_KEYS) {
      if (values[key] === null) return `기준 시나리오에서 ${key} 가 산출되지 않았다`
      const causes = causeIds(key, evidence)
      if (causes.length > 0) return `${key}: 값이 있는데 확정 사유를 적는다 ${JSON.stringify(causes)}`
    }
    return null
  })

  check("⑧-b 생산량 기록 0건 · 1건 · 2건이 서로 다른 사유다", () => {
    const cases = [
      [{ records: 0 }, "biomass_no_record"],
      [{ records: 1, startKg: 300 }, "biomass_single_record"],
      [{ records: 2, startKg: 300, endKg: 300 }, "biomass_delta_below_threshold"],
      [{ records: 2, startKg: 600, endKg: 400 }, "biomass_delta_negative"],
    ]
    for (const [opts, wantId] of cases) {
      const { values, evidence } = scenario(opts)
      // 엔진이 오라클이다 — 먼저 null 인지 확인한다.
      for (const key of ["ei_total", "ei_aeration", "fcr"]) {
        if (values[key] !== null) return `${JSON.stringify(opts)}: 엔진이 ${key} 를 산출했다`
        if (!causeIds(key, evidence).includes(wantId)) {
          return `${JSON.stringify(opts)} · ${key}: ${wantId} 가 사유에 없다 ${JSON.stringify(reasonIds(key, evidence))}`
        }
      }
    }
    return null
  })

  check("⑧-c 사유가 겹치면 전부 적는다", () => {
    // 전력도 없고 생산량도 없는 기간. 하나만 적으면 운영자가 두 번 헛걸음한다.
    const { values, evidence } = scenario({ records: 0, power: [], feed: [] })
    if (values.ei_total !== null) return "엔진이 EI 를 산출했다"
    const ids = reasonIds("ei_total", evidence)
    for (const want of ["biomass_no_record", "power_readings_none"]) {
      if (!ids.includes(want)) return `EI 사유에 ${want} 가 없다 ${JSON.stringify(ids)}`
    }
    const fcrIds = reasonIds("fcr", evidence)
    for (const want of ["biomass_no_record", "feed_logs_none"]) {
      if (!fcrIds.includes(want)) return `FCR 사유에 ${want} 가 없다 ${JSON.stringify(fcrIds)}`
    }
    // 폭기 EI: 전력이 한 건도 없으면 폭기 전력 0 은 그 결과다 — 같은 할 일을 두 번
    // 적지 않고 한 문장이 둘을 말한다. 그 대신 폭기 전력이 0 이라는 **사실**은 빠지면
    // 안 된다.
    const aerIds = reasonIds("ei_aeration", evidence)
    if (!aerIds.includes("power_readings_none")) {
      return `폭기 EI 사유에 power_readings_none 가 없다 ${JSON.stringify(aerIds)}`
    }
    if (aerIds.includes("aeration_power_zero")) {
      return `전력이 0건인데 폭기 전력 0 을 따로 또 적는다 ${JSON.stringify(aerIds)}`
    }
    const aerText = na
      .metricUnavailabilityReasons("ei_aeration", evidence)
      .map((r) => r.text)
      .join(" ")
    if (!aerText.includes("폭기 전력도 0 kWh")) {
      return `폭기 전력이 0 이라는 사실이 빠졌다: ${aerText}`
    }

    // 전력은 있는데 폭기 계측기만 없는 기간은 **폭기 전력 0** 을 따로 적는다.
    const noAerMeter = scenario({
      records: 0,
      power: [powerReading(900, false)],
      feed: [],
    })
    const noAerIds = reasonIds("ei_aeration", noAerMeter.evidence)
    if (!noAerIds.includes("aeration_power_zero")) {
      return `폭기 계측기가 없는 기간에 그 사실을 적지 않는다 ${JSON.stringify(noAerIds)}`
    }
    return null
  })

  check("⑧-d 분모만 비어 있고 값이 0 인 경우를 사유로 적지 않는다", () => {
    // 전력 0건 + 생산량 증가 → 엔진은 EI 를 **0 으로 산출한다**(null 이 아니다).
    // 그 사실을 '함께 비어 있음' 으로만 적어야 한다 — 확정 사유로 적으면 거짓이다.
    const { values, evidence } = scenario({ power: [], feed: [] })
    if (values.ei_total !== 0) return `엔진 EI 가 0 이 아니다: ${values.ei_total}`
    if (values.fcr !== 0) return `엔진 FCR 이 0 이 아니다: ${values.fcr}`
    const reasons = na.metricUnavailabilityReasons("ei_total", evidence)
    const power = reasons.find((r) => r.id === "power_readings_none")
    if (power === undefined) return "전력 0건을 아예 적지 않는다"
    if (power.kind !== "also_missing") return `전력 0건의 무게가 ${power.kind} 다`
    if (causeIds("ei_total", evidence).length > 0) {
      return `값이 0 으로 산출됐는데 확정 사유를 적는다 ${JSON.stringify(causeIds("ei_total", evidence))}`
    }
    return null
  })

  check("⑧-e 임계값을 문장에 박지 않고 적용 설정에서 읽는다", () => {
    // 조직 설정이 임계값을 덮으면 사유 문장의 숫자도 따라가야 한다. 코드에 0 을 박아
    // 두면 이 항목이 FAIL 한다.
    const params = {
      ei: { included_quality_flags: ["ok"], min_biomass_delta_kg: 250.0 },
      fcr: { included_quality_flags: ["ok"], min_biomass_delta_kg: 250.0 },
      oei: { included_quality_flags: ["ok"], min_biomass_kg: 250.0 },
      mortality: { moving_avg_window_days: 7 },
    }
    // Δbiomass = 100 kg — 기본 임계값(0)이면 산출되고, 250 이면 산출되지 않는다.
    const { values, evidence } = scenario({ params, startKg: 100, endKg: 200 })
    if (values.ei_total !== null) return "엔진이 임계값을 보지 않았다(EI 가 산출됐다)"
    const text = na
      .metricUnavailabilityReasons("ei_total", evidence)
      .map((r) => r.text)
      .join(" ")
    if (!text.includes("250.00 kg")) return `사유가 적용 임계값을 적지 않는다: ${text}`
    if (!text.includes("100.00 kg")) return `사유가 실제 생산량 변화를 적지 않는다: ${text}`
    // 기본값으로 돌리면 같은 기간이 산출된다 — 임계값이 실제로 판정을 가른다는 확인.
    const base = scenario({ startKg: 100, endKg: 200 })
    if (base.values.ei_total === null) return "기본 임계값에서도 산출되지 않는다(시나리오가 무의미)"
    return null
  })

  check("⑧-f 임계값을 모르면 단정하지 않는다", () => {
    const { evidence } = scenario({ startKg: 300, endKg: 300 })
    const partial = { biomass_delta_kg: evidence.biomass_delta_kg, biomass_record_count: 2 }
    const reasons = na.metricUnavailabilityReasons("ei_total", partial)
    if (reasons.length !== 1) return `사유가 1건이 아니다 ${JSON.stringify(reasons.map((r) => r.id))}`
    if (reasons[0].kind !== "unknown") return `임계값을 모르는데 ${reasons[0].kind} 로 단정한다`
    if (!reasons[0].text.includes("0.00 kg")) return "아는 숫자(생산량 변화)를 적지 않는다"
    // 근거가 아예 없으면 '모른다' 한 건.
    for (const empty of [undefined, null]) {
      const r = na.metricUnavailabilityReasons("ei_total", empty)
      if (r.length !== 1 || r[0].id !== "evidence_missing" || r[0].kind !== "unknown") {
        return `근거 없음에서 ${JSON.stringify(r)} 를 돌려준다`
      }
    }
    return null
  })

  check("⑧-g OEI 의 세 경계 조건을 각각 · 겹쳐서 적는다", () => {
    // 산식이 null 을 내는 자리는 셋이다(lib/mrv/kpi/oxygen.ts): 유효 DO 0 / 폭기 전력 0 /
    // 생산량 정규화 불가. 화면은 넷을 같은 한 줄로 적고 있었다.
    const noDo = scenario({ doReadings: [] })
    if (noDo.values.oei !== null) return "엔진이 DO 0건에서 OEI 를 산출했다"
    if (!causeIds("oei", noDo.evidence).includes("do_samples_none")) {
      return `DO 0건 사유가 없다 ${JSON.stringify(reasonIds("oei", noDo.evidence))}`
    }
    const noAer = scenario({ power: [powerReading(900, false)] })
    if (noAer.values.oei !== null) return "엔진이 폭기 전력 0 에서 OEI 를 산출했다"
    if (!causeIds("oei", noAer.evidence).includes("aeration_power_zero")) {
      return `폭기 전력 0 사유가 없다 ${JSON.stringify(reasonIds("oei", noAer.evidence))}`
    }
    const noDelta = scenario({ records: 2, startKg: 300, endKg: 300 })
    if (noDelta.values.oei !== null) return "엔진이 Δbiomass 0 에서 OEI 를 산출했다"
    if (causeIds("oei", noDelta.evidence).length === 0) return "Δbiomass 사유가 없다"
    // 셋이 겹친 기간은 셋을 전부 적는다.
    const all = scenario({ records: 0, doReadings: [], power: [] })
    const ids = causeIds("oei", all.evidence)
    for (const want of ["do_samples_none", "aeration_power_zero", "biomass_no_record"]) {
      if (!ids.includes(want)) return `겹친 사유에 ${want} 가 없다 ${JSON.stringify(ids)}`
    }
    return null
  })

  check("⑧-h DO 목표대역이 없으면 그 사실만 적는다", () => {
    // '산출 대상이 아니다' 와 '조건을 못 채웠다' 는 다른 사실이다. 입력 사유를 함께
    // 적으면 운영자가 엉뚱한 곳(전력·생산량)을 먼저 손댄다.
    const { values, evidence } = scenario({ band: null, records: 0, power: [], doReadings: [] })
    if (values.oei !== null) return "대역이 없는데 OEI 가 산출됐다"
    const ids = reasonIds("oei", evidence)
    if (JSON.stringify(ids) !== JSON.stringify(["oei_not_applicable"])) {
      return `사유가 oei_not_applicable 하나가 아니다 ${JSON.stringify(ids)}`
    }
    const only = na.metricUnavailabilityReasons("oei", evidence)[0]
    if (only.action === null || !only.action.includes("target_do_min")) {
      return "무엇을 하면 채워지는지(대역 등록)를 적지 않는다"
    }
    return null
  })

  check("⑧-i 폐사율은 입식 수를 분모로 적고, 기간과 무관함을 밝힌다", () => {
    const { values, evidence } = scenario({ stocked: 0 })
    if (values.mortality_rate !== null) return "입식 수 0 에서 폐사율이 산출됐다"
    const reasons = na.metricUnavailabilityReasons("mortality_rate", evidence)
    if (!reasons.some((r) => r.id === "stocked_count_zero" && r.kind === "cause")) {
      return `사유가 없다 ${JSON.stringify(reasons.map((r) => r.id))}`
    }
    // 이 수는 사이트의 전 기간 배치 합이다 — 기간을 바꿔도 달라지지 않는다는 사실을
    // 적지 않으면 운영자가 기간만 바꿔 보며 시간을 버린다.
    if (!reasons[0].text.includes("기간")) return "기간과 무관하다는 사실을 적지 않는다"
    return null
  })

  check("⑧-j 모든 사유가 추측이 아니고 · 할 일을 적는다", () => {
    const seen = new Map()
    const scenarios = [
      scenario({}),
      scenario({ records: 0, power: [], feed: [], doReadings: [], stocked: 0 }),
      scenario({ records: 1 }),
      scenario({ startKg: 600, endKg: 400 }),
      scenario({ band: null }),
      scenario({ power: [powerReading(900, false)] }),
    ]
    for (const sc of scenarios) {
      for (const key of ALL_METRIC_KEYS) {
        for (const r of na.metricUnavailabilityReasons(key, sc.evidence)) {
          seen.set(r.id, r)
        }
      }
    }
    for (const empty of [undefined]) {
      for (const r of na.metricUnavailabilityReasons("ei_total", empty)) seen.set(r.id, r)
    }
    if (seen.size < 8) return `둘러본 사유가 ${seen.size}종뿐이다(시나리오가 모자라다)`
    for (const [id, r] of seen) {
      if (typeof r.text !== "string" || r.text.trim().length < 20) return `${id}: 문장이 비었다/짧다`
      // ★ 추측 금지. 종전 문구가 "(예: 생산량 변화 부족)" 이었다.
      if (/예\s*:/.test(r.text)) return `${id}: 사유에 추측("예:")이 들어 있다 — ${r.text}`
      // 사용자 문장에 마크다운을 쓰지 않는다(이 저장소는 그대로 렌더한다).
      if (r.text.includes("**") || (r.action ?? "").includes("**")) return `${id}: 문장에 마크다운 ** 가 있다`
      if (!["cause", "also_missing", "unknown"].includes(r.kind)) return `${id}: 모르는 kind ${r.kind}`
      // 확정 사유에는 **무엇을 하면 채워지는지**가 반드시 붙는다.
      if (r.kind === "cause" && (r.action === null || r.action.trim().length < 20)) {
        return `${id}: 확정 사유인데 할 일을 적지 않는다`
      }
    }
    // 무게를 색이 아니라 낱말로 구분한다.
    for (const kind of ["cause", "also_missing", "unknown"]) {
      const prefix = na.UNAVAILABILITY_REASON_KIND_PREFIX[kind]
      if (typeof prefix !== "string" || prefix.trim().length === 0) {
        return `${kind}: 무게를 적는 낱말이 비었다`
      }
    }
    return null
  })

  check("⑧-k 숫자가 사유 문장에 들어간다", () => {
    const { evidence } = scenario({ records: 0, power: [], feed: [] })
    const text = na.metricUnavailabilityReasons("fcr", evidence).map((r) => r.text).join(" ")
    // "급이 기록이 부족합니다" 가 아니라 건수를 적는다.
    if (!/0 ?건/.test(text)) return `산입 건수를 적지 않는다: ${text}`
    const excluded = scenario({
      records: 0,
      feed: [{ sourceRef: "f1", batchId: "b1", ts: new Date("2026-07-01T00:00:00Z"), feedKg: 12, qualityFlag: "ok" }],
    })
    const exText = na
      .metricUnavailabilityReasons("fcr", excluded.evidence)
      .map((r) => r.text)
      .join(" ")
    if (!exText.includes("제외 1건")) return `제외 건수를 적지 않는다: ${exText}`
    return null
  })

  check("⑧-l 「산출 불가」와 「잠정 지표」가 다른 층임을 적는다", () => {
    // 두 문장이 한 카드에 함께 뜬다. 연결이 없으면 "입력을 채우면 산식도 확정된다" 로
    // 읽힌다. 판정은 metric-provenance 하나에서 와야 한다(사본 금지).
    for (const key of prov.PROVENANCE_METRIC_KEYS) {
      const note = na.unavailabilityVsProvisionalNote(key)
      if (prov.isProvisionalMetric(key)) {
        if (typeof note !== "string" || note.trim().length < 40) return `${key}: 연결 문장이 비었다`
        if (!note.includes(prov.PROVISIONAL_METRIC_MARK)) {
          return `${key}: 어느 칸을 보라는 말이 없다(「${prov.PROVISIONAL_METRIC_MARK}」)`
        }
        // 잠정 문구를 다시 베껴 쓰면 같은 자리에서 중복된다.
        if (note.includes(prov.provisionalMetricReason(key))) {
          return `${key}: 잠정 사유 문구를 그대로 다시 담는다(중복)`
        }
      } else if (note !== null) {
        return `${key}: 확정 지표인데 연결 문장이 나온다`
      }
    }
    return null
  })

  check("⑧-m 리포트 절이 산출되지 않은 값 전부를 고른다", () => {
    // Scope2 엔진이 오라클이다 — 감축량 null 조건은 두 EI 중 하나라도 null 인 것이다.
    const s2 = kpi.computeScope2Reduction({
      baselineEiTotal: null,
      afterEiTotal: 3.0,
      afterBiomassDeltaKg: 500,
      baselinePowerMwh: null,
      afterPowerMwh: 1.5,
      emissionFactorTco2ePerMwh: 0.4594,
      emissionFactorSource: "src",
      emissionFactorYear: 2023,
      emissionFactorVersion: "v1",
    })
    if (s2.reductionTco2e !== null) return "엔진이 기준선 EI 없이 감축량을 냈다"
    const { evidence } = scenario({})
    const entries = na.reportUnavailabilityEntries({
      reductionTco2e: s2.reductionTco2e,
      before: { eiTotal: null, eiAeration: null, scope2Tco2e: s2.scope2TCo2eBaseline, kpiSnapshotId: null },
      after: { eiTotal: 3.0, eiAeration: 1.2 },
      afterEvidence: evidence,
    })
    const ids = entries.map((e) => e.id)
    for (const want of ["reduction_tco2e", "before_ei", "before_scope2"]) {
      if (!ids.includes(want)) return `${want} 항목이 없다 ${JSON.stringify(ids)}`
    }
    for (const e of entries) {
      if (e.label.trim().length === 0) return `${e.id}: 어느 값인지 적지 않는다`
      if (e.reasons.length === 0 && (e.note === null || e.note.trim().length < 20)) {
        return `${e.id}: 사유도 안내도 없다`
      }
    }
    // 기준선 쪽은 근거가 없으므로 되짚을 길(스냅샷)을 적는다.
    const beforeEi = entries.find((e) => e.id === "before_ei")
    if (!beforeEi.note.includes("kpi-snapshots")) return "기준선 사유를 되짚을 길을 적지 않는다"

    // After 의 근거가 없는 옛 리포트는 '모른다' 로 적고, 그 사실도 밝힌다.
    const old = na.reportUnavailabilityEntries({
      reductionTco2e: null,
      before: { eiTotal: 3.4, eiAeration: 1.1, scope2Tco2e: 2.0, kpiSnapshotId: "snap-1" },
      after: { eiTotal: null, eiAeration: null },
      afterEvidence: undefined,
    })
    const afterEntry = old.find((e) => e.id === "after_ei_total")
    if (afterEntry === undefined) return "After EI 항목이 없다"
    if (afterEntry.reasons[0].id !== "evidence_missing") return "옛 리포트에서 사유를 지어낸다"
    if (afterEntry.note === null || afterEntry.note.trim().length < 20) {
      return "옛 리포트라는 사실을 적지 않는다"
    }
    // 전부 산출됐으면 절을 만들지 않는다 — 없는 문제를 띄우지 않는다.
    const none = na.reportUnavailabilityEntries({
      reductionTco2e: 1.23,
      before: { eiTotal: 3.4, eiAeration: 1.1, scope2Tco2e: 2.0, kpiSnapshotId: "snap-1" },
      after: { eiTotal: 3.0, eiAeration: 1.0 },
      afterEvidence: evidence,
    })
    return none.length === 0 ? null : `산출 불가가 없는데 항목이 ${none.length}건 생겼다`
  })

  check("⑧-n 개선율의 사유가 지표값의 사유와 구별된다", () => {
    // compareMetric 이 오라클이다 — 기준선이 0 이하면 **변화량은 나오고 개선율만** 빈다.
    const cases = [
      [3.4, null],
      [null, 3.0],
      [0, 3.0],
      [-1, 3.0],
      [3.4, 3.0],
    ]
    for (const [baseline, current] of cases) {
      const cmpResult = kpi.compareMetric(baseline, current, "lower_is_better")
      const text = na.comparisonImprovementUnavailabilityText({
        baselineValue: baseline,
        currentValue: current,
        improvementPct: cmpResult.improvementPct,
      })
      if (cmpResult.improvementPct === null) {
        if (text === null) return `${baseline}/${current}: 개선율이 비었는데 사유가 없다`
        if (text.trim().length < 20) return `${baseline}/${current}: 사유가 너무 짧다`
        if (baseline !== null && current !== null && !text.includes("변화량")) {
          return `${baseline}/${current}: 변화량은 산출됐다는 사실을 적지 않는다`
        }
      } else if (text !== null) {
        return `${baseline}/${current}: 개선율이 있는데 사유를 적는다`
      }
    }
    return null
  })

  check("⑧-o 사유가 나오는 자리 전부가 공용 모듈을 쓴다", () => {
    /*
     * 「화면으로 본 사람과 인쇄물로 본 사람이 다른 사실을 알게 되면 안 된다」를
     * **원문으로** 확인한다. 이름이 2회 이상 나와야 한다 — 1회면 import 만 해 두고
     * 쓰지 않은 상태일 수 있다(⑦-h 와 같은 함정).
     */
    const surfaces = [
      ["components/mrv/kpi-card.tsx", ["metricUnavailabilityReasons", "UNAVAILABILITY_REASON_KIND_PREFIX"]],
      ["app/mrv/overview/page.tsx", ["unavailability"]],
      ["app/mrv/baseline/page.tsx", ["UNAVAILABILITY_LOOKUP_LOCKED_BASELINE", "unavailability"]],
      ["app/mrv/comparison/page.tsx", ["UNAVAILABILITY_REASON_KIND_PREFIX", "comparisonImprovementUnavailabilityText"]],
      ["app/mrv/multisite/page.tsx", ["UNAVAILABILITY_REASON_KIND_PREFIX", "unavailability"]],
      ["app/mrv/mrv-reports/[reportId]/page.tsx", ["reportUnavailabilityEntries", "REPORT_UNAVAILABILITY_HEADING", "UNAVAILABILITY_REASON_KIND_PREFIX"]],
      ["lib/mrv/report-html.ts", ["reportUnavailabilityEntries", "REPORT_UNAVAILABILITY_HEADING", "UNAVAILABILITY_REASON_KIND_PREFIX"]],
      ["lib/mrv/kpi-service.ts", ["metricUnavailabilityReasons", "unavailabilityEvidence"]],
      ["app/api/mrv/sites/[siteId]/comparison/route.ts", ["buildKpiUnavailability"]],
      ["app/api/mrv/sites/kpi-benchmark/route.ts", ["buildKpiUnavailability"]],
    ]
    for (const [rel, names] of surfaces) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      for (const name of names) {
        if (src.split(name).length - 1 < 2) {
          return `${rel} 가 ${name} 를 가져다 쓰지 않는다(이름이 2회 미만)`
        }
      }
    }
    // 리포트가 After 기간의 근거를 **생성 시점에 얼려** 담는지. 담지 않으면 발행된
    // 리포트는 영원히 "근거가 없다" 로만 적힌다(사유를 지어내지 않는 것은 맞지만,
    // 담을 수 있었던 사실을 버린 것이다).
    const reportSrc = readFileSync(join(ROOT, "lib/mrv/mrv-report-service.ts"), "utf8")
    if (!/after_metric_evidence:\s*comp\.unavailabilityEvidence/.test(reportSrc)) {
      return "lib/mrv/mrv-report-service.ts 가 After 근거를 boundary_json 에 얼려 담지 않는다"
    }
    // 인쇄와 화면이 같은 **항목 선택 함수**를 호출하는지(이름만이 아니라 호출인지).
    for (const rel of ["lib/mrv/report-html.ts", "app/mrv/mrv-reports/[reportId]/page.tsx"]) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      if (!/reportUnavailabilityEntries\s*\(\s*\{/.test(src)) {
        return `${rel} 가 reportUnavailabilityEntries 를 호출하지 않는다`
      }
    }
    return null
  })

  check("⑧-p 옛 추측 문구가 되살아나지 않았다", () => {
    /*
     * 종전 문구가 사람 앞에 다시 나가는 일을 막는다.
     *
     * ★ **주석은 떼고 본다.** 이 작업의 주석들이 "전에는 이렇게 적었다" 며 그 문장을
     *   인용하고 있어서, 원문을 그대로 훑으면 자기 설명에 걸려 영구히 FAIL 한다.
     *   화면에 렌더되는 것은 주석이 아니라 문자열·JSX 본문이므로 그쪽만 본다.
     */
    const stripComments = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ")
    const roots = ["components/mrv", "app/mrv", "lib/mrv"]
    const banned = "산출 조건을 만족하지 못했습니다"
    const hits = []
    const walk = (dir) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          walk(rel)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (stripComments(readFileSync(join(ROOT, rel), "utf8")).includes(banned)) {
          hits.push(rel)
        }
      }
    }
    for (const r of roots) walk(r)
    return hits.length === 0
      ? null
      : `추측 문구("${banned}")가 남아 있다: ${JSON.stringify(hits)}`
  })


  check("⑧-q 인쇄 리포트가 사유를 실제로 인쇄한다", () => {
    /*
     * ★ 원문에서 이름만 찾는 검사로는 모자란다. 역검증으로 인쇄 템플릿에서 절을 빼
     *   보았더니 **그 검사가 통과했다** — 함수 정의 안에 이름이 그대로 남아 있었기
     *   때문이다. 그래서 여기서는 렌더러를 실제로 돌려 **출력물**을 본다.
     */
    const { evidence } = scenario({ records: 0, power: [], feed: [] })
    const makeReport = (over) => ({
      id: "mrv-1",
      site_id: "site-p",
      org_id: "org-p",
      baseline_id: "bsl-1",
      period_start: "2026-08-01T00:00:00Z",
      period_end: "2026-08-31T00:00:00Z",
      emission_factor_id: "ef-1",
      after_kpi_snapshot_id: "snap-2",
      before_json: {
        period: { from: "2026-07-01T00:00:00Z", to: "2026-07-31T00:00:00Z" },
        config_version: VER,
        ei_total: null,
        ei_aeration: null,
        total_power_kwh: 0,
        aeration_power_kwh: 0,
        biomass_delta_kg: 0,
        scope2_tco2e: null,
        kpi_snapshot_id: null,
      },
      after_json: {
        period: { from: "2026-08-01T00:00:00Z", to: "2026-08-31T00:00:00Z" },
        config_version: VER,
        ei_total: null,
        ei_aeration: null,
        total_power_kwh: 0,
        aeration_power_kwh: 0,
        biomass_delta_kg: 0,
        scope2_tco2e: 1.0,
        kpi_snapshot_id: "snap-2",
      },
      reduction_tco2e: null,
      formula_text: "감축량 = 산출 불가",
      boundary_json: {
        site_id: "site-p",
        site_name: "검증 사이트",
        included_meter_ids: ["m-main"],
        included_quality_flags: ["ok"],
        after_power_measurement_basis: { metered: 0, calculated: 0, estimated: 0, unrecorded: 0 },
        after_metric_evidence: evidence,
        biomass_source_refs: { before: [], after: [] },
        config_version: { before: VER, after: VER },
        assumptions: ["가정 하나"],
        ...over,
      },
      pdf_path: null,
      generated_by: "u-1",
      generated_at: "2026-09-01T00:00:00Z",
    })
    const ef = {
      id: "ef-1",
      factor_tco2e_per_mwh: 0.4594,
      source: "검증 출처",
      year: 2023,
      version: "v1",
      effective_from: "2023-01-01T00:00:00Z",
    }

    const html = reportHtml.renderMrvReportHtml(makeReport({}), ef)
    if (!html.includes(na.REPORT_UNAVAILABILITY_HEADING)) {
      return "인쇄 리포트에 「산출 불가 사유」 절이 없다"
    }
    if (!html.includes(na.REPORT_UNAVAILABILITY_INTRO)) return "절의 머리말이 인쇄되지 않는다"
    // 감축량 · 기준선 EI · After EI 세 가지가 전부 인쇄돼야 한다.
    if (!html.includes("감축량")) return "감축량 사유가 인쇄되지 않는다"
    if (!html.includes("kpi-snapshots")) return "기준선 사유를 되짚을 길이 인쇄되지 않는다"
    // After 의 확정 사유(생산량 기록 0건)가 숫자·할 일과 함께 인쇄돼야 한다.
    const afterReasons = na.metricUnavailabilityReasons("ei_total", evidence)
    for (const r of afterReasons) {
      if (!html.includes(r.text)) return `After 사유가 인쇄되지 않는다: ${r.text}`
      if (r.action !== null && !html.includes(r.action)) return `할 일이 인쇄되지 않는다: ${r.id}`
    }
    if (!html.includes(na.UNAVAILABILITY_REASON_KIND_PREFIX.cause)) {
      return "사유의 무게를 적는 낱말이 인쇄되지 않는다"
    }

    // 근거를 담기 전에 발행된 리포트는 **지어내지 않고** 그 사실을 인쇄한다.
    const oldHtml = reportHtml.renderMrvReportHtml(
      makeReport({ after_metric_evidence: undefined }),
      ef,
    )
    if (!oldHtml.includes(na.UNAVAILABILITY_LOOKUP_OLD_REPORT)) {
      return "옛 리포트에서 '근거가 없다'는 사실을 인쇄하지 않는다"
    }
    if (oldHtml.includes("생산량 기록이 한 건도 없습니다")) {
      return "근거가 없는데 사유를 지어내 인쇄한다"
    }

    // 전부 산출된 리포트에는 절을 넣지 않는다 — 없는 문제를 인쇄하지 않는다.
    const good = makeReport({})
    good.before_json = { ...good.before_json, ei_total: 3.4, ei_aeration: 1.1, scope2_tco2e: 2.0, kpi_snapshot_id: "snap-1" }
    good.after_json = { ...good.after_json, ei_total: 3.0, ei_aeration: 1.0 }
    good.reduction_tco2e = 0.12
    const goodHtml = reportHtml.renderMrvReportHtml(good, ef)
    return goodHtml.includes(na.REPORT_UNAVAILABILITY_HEADING)
      ? "산출 불가가 없는 리포트에도 절을 인쇄한다"
      : null
  })

  check("⑧-r 리포트 화면이 같은 절을 **글자로** 렌더한다", () => {
    /*
     * 화면은 React 라 여기서 렌더할 수 없다. 그래서 JSX 를 본다 — 다만 이름이 **있는지**
     * 가 아니라 **자식으로 보간되는지**를 본다.
     *
     * ★ 역검증에서 `<h2>{REPORT_UNAVAILABILITY_HEADING}</h2>` 를 한국어 리터럴로
     *   바꿔 보았더니, 같은 상수가 `aria-label={...}` 에 남아 있어서 "이름이 있는가"
     *   검사가 **통과했다.** 화면에 글자로 나가는 것은 속성이 아니라 자식이므로,
     *   앞에 `>` 가 오는 꼴(`>{CONST}`)만 렌더로 인정한다.
     */
    const rel = "app/mrv/mrv-reports/[reportId]/page.tsx"
    const src = readFileSync(join(ROOT, rel), "utf8")
    const rendersAsChild = (name) =>
      new RegExp(`>\\s*\\{${name}\\}`).test(src)
    for (const name of ["REPORT_UNAVAILABILITY_HEADING", "REPORT_UNAVAILABILITY_INTRO"]) {
      if (!rendersAsChild(name)) {
        return `${rel} 가 ${name} 를 글자로 렌더하지 않는다(속성에만 쓰였거나 리터럴로 바뀌었다)`
      }
    }
    if (!/reportUnavailabilityEntries\s*\(\s*\{/.test(src)) {
      return `${rel} 가 공용 항목 선택 함수를 호출하지 않는다`
    }
    // 항목의 내용을 실제로 꺼내 쓰는지. 절을 지우면 이 접근들이 함께 사라진다.
    for (const access of ["entry.label", "entry.note", "reason.text", "reason.action"]) {
      if (!src.includes(`{${access}}`) && !src.includes(`${access} !== null`)) {
        return `${rel} 가 ${access} 를 렌더하지 않는다`
      }
    }
    if (!/UNAVAILABILITY_REASON_KIND_PREFIX\[/.test(src)) {
      return `${rel} 가 사유의 무게를 적는 낱말을 쓰지 않는다`
    }
    return null
  })

  check("⑧-s 사유를 적는 화면들이 사유 문장과 할 일을 모두 렌더한다", () => {
    /*
     * 사유만 적고 **무엇을 하면 채워지는지**를 빼면 운영자는 여전히 무엇을 넣어야
     * 하는지 모른다. 네 자리가 전부 `reason.text` 와 `reason.action` 을 꺼내 쓰는지
     * 본다(이름이 아니라 접근 꼴을 본다 — import 만으로는 생기지 않는다).
     */
    const screens = [
      "components/mrv/kpi-card.tsx",
      "app/mrv/comparison/page.tsx",
      "app/mrv/multisite/page.tsx",
      "app/mrv/mrv-reports/[reportId]/page.tsx",
    ]
    for (const rel of screens) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      if (!src.includes("{reason.text}")) return `${rel} 가 사유 문장을 렌더하지 않는다`
      if (!src.includes("{reason.action}")) return `${rel} 가 할 일을 렌더하지 않는다`
      if (!/UNAVAILABILITY_REASON_KIND_PREFIX\[reason\.kind\]/.test(src)) {
        return `${rel} 가 사유의 무게를 적지 않는다`
      }
    }
    // 인쇄 리포트는 문자열을 조립하므로 꼴이 다르다 — 출력물은 ⑧-q 가 본다.
    const printSrc = readFileSync(join(ROOT, "lib/mrv/report-html.ts"), "utf8")
    for (const access of ["reason.text", "reason.action", "entry.label", "entry.note"]) {
      if (!printSrc.includes(access)) return `인쇄 리포트가 ${access} 를 쓰지 않는다`
    }
    return null
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
