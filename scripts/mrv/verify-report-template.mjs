/**
 * 맞춤 리포트 서식 규칙 검증 — 사양 기반 단위 검증.
 *
 * 서식이 **지키지 않으면 증빙을 우회하게 되는 규칙**을 고정한다: 요약·산식 전문은 뺄 수
 * 없고, 리포트가 들고 있지 않은 지표는 약속할 수 없고, 서식이 없으면 전부 그린다.
 *
 * 실행: node scripts/mrv/verify-report-template.mjs
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-tpl-"))

copyFileSync(join(ROOT, "lib/mrv/report-template.ts"), join(outDir, "report-template.ts"))
// 타입만 import 하는 api-types 는 스텁으로 둔다 — 검증 대상이 아니다.
writeFileSync(join(outDir, "api-types.ts"), 'export type ReportSectionKey = string\n')
execFileSync("npx", ["tsc", join(outDir, "report-template.ts"), "--outDir", join(outDir, "out"),
  "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--strict",
  "--skipLibCheck"], { stdio: "inherit" })
const mod = createRequire(import.meta.url)(join(outDir, "out", "report-template.js"))
const { checkTemplate, templateShowsSection, templateShowsMetric, REPORT_METRICS, DEFAULT_TEMPLATE, LOCKED_SECTIONS } = mod

const results = []
const check = (name, fn) => {
  let detail = null
  try { detail = fn() } catch (e) { detail = `예외: ${e.message}` }
  results.push({ name, ok: detail === null })
  console.log(`  ${detail === null ? "OK  " : "FAIL"} ${name}${detail === null ? "" : "\n       → " + detail}`)
}
const base = { name: "서식", sections: [...DEFAULT_TEMPLATE.sections], metrics: [...DEFAULT_TEMPLATE.metrics] }

check("기본 서식은 그대로 통과한다", () => {
  const r = checkTemplate(base)
  return r.ok ? null : r.detail
})
check("요약(summary)을 빼면 거절한다", () => {
  const r = checkTemplate({ ...base, sections: base.sections.filter((s) => s !== "summary") })
  return !r.ok && r.detail.includes("뺄 수 없습니다") ? null : JSON.stringify(r)
})
check("산식 전문(formula)을 빼면 거절한다", () => {
  const r = checkTemplate({ ...base, sections: base.sections.filter((s) => s !== "formula") })
  return !r.ok && r.detail.includes("뺄 수 없습니다") ? null : JSON.stringify(r)
})
check("잠긴 절이 정확히 summary·formula 둘이다", () =>
  JSON.stringify([...LOCKED_SECTIONS].sort()) === JSON.stringify(["formula", "summary"]) ? null : JSON.stringify(LOCKED_SECTIONS))
check("리포트에 없는 지표(fcr·oei·mortality_rate)는 약속할 수 없다", () => {
  for (const k of ["fcr", "oei", "mortality_rate"]) {
    if (REPORT_METRICS.some((m) => m.key === k)) return `${k} 가 선택지에 있다`
    const r = checkTemplate({ ...base, metrics: [k] })
    if (r.ok) return `${k} 가 통과했다`
  }
  return null
})
check("모르는 절 이름은 거절한다", () => {
  const r = checkTemplate({ ...base, sections: [...base.sections, "recomend"] })
  return !r.ok && r.detail.includes("모르는 절") ? null : JSON.stringify(r)
})
check("KPI 표를 넣으면서 지표를 하나도 안 고르면 거절한다", () => {
  const r = checkTemplate({ ...base, metrics: [] })
  return !r.ok && r.detail.includes("하나 이상") ? null : JSON.stringify(r)
})
check("KPI 표를 뺐으면 지표가 비어도 된다", () => {
  const r = checkTemplate({ ...base, sections: base.sections.filter((s) => s !== "kpi_table"), metrics: [] })
  return r.ok ? null : r.detail
})
check("이름이 비면 거절한다", () => {
  const r = checkTemplate({ ...base, name: "   " })
  return !r.ok ? null : "통과했다"
})
check("표지 제목이 120자를 넘으면 거절한다", () => {
  const r = checkTemplate({ ...base, cover_title: "가".repeat(121) })
  return !r.ok && r.detail.includes("120자") ? null : JSON.stringify(r)
})
check("중복 절·지표는 하나로 합친다", () => {
  const r = checkTemplate({ ...base, sections: [...base.sections, "boundary", "boundary"], metrics: [...base.metrics, "ei_total"] })
  if (!r.ok) return r.detail
  const dupS = r.value.sections.filter((s) => s === "boundary").length
  const dupM = r.value.metrics.filter((m) => m === "ei_total").length
  return dupS === 1 && dupM === 1 ? null : `boundary ${dupS} · ei_total ${dupM}`
})
check("서식이 없으면(null) 모든 절·지표를 그린다", () => {
  for (const key of ["kpi_table", "boundary", "provenance", "unavailability", "market_based"]) {
    if (!templateShowsSection(null, key)) return `${key} 를 감춘다`
  }
  for (const m of REPORT_METRICS) if (!templateShowsMetric(null, m.key)) return `${m.key} 를 감춘다`
  return null
})
check("서식이 있으면 고른 것만 그린다", () => {
  const t = { sections: ["summary", "formula"], metrics: ["ei_total"] }
  if (templateShowsSection(t, "boundary")) return "boundary 를 그린다"
  if (!templateShowsSection(t, "formula")) return "formula 를 감춘다"
  if (templateShowsMetric(t, "scope2_tco2e")) return "scope2 를 그린다"
  if (!templateShowsMetric(t, "ei_total")) return "ei_total 을 감춘다"
  return null
})

rmSync(outDir, { recursive: true, force: true })
const bad = results.filter((r) => !r.ok)
console.log(bad.length
  ? `✗ 리포트 서식 규칙 검증 실패 — ${bad.length}건`
  : `✓ 리포트 서식 규칙 검증 통과 — ${results.length}개 항목 (원본에 없던 기능이라 차분 검증이 아니라 사양 기반 단위 검증이다)`)
process.exit(bad.length ? 1 : 0)
