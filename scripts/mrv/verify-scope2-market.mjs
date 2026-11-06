/**
 * Scope 2 market-based 배분 규칙 검증 — 사양 기반 단위 검증.
 *
 * 원본 Python 에 market-based 가 없으므로 차분 검증이 아니다. 대신 **규칙이 지켜야 하는
 * 성질**을 고정한다. 이름이 소스에 있는지가 아니라 숫자가 맞는지를 본다.
 *
 * 실행: node scripts/mrv/verify-scope2-market.mjs
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-s2m-"))

let mod
try {
  copyFileSync(join(ROOT, "lib/mrv/scope2-market.ts"), join(outDir, "scope2-market.ts"))
  execFileSync("npx", ["tsc", join(outDir, "scope2-market.ts"), "--outDir", join(outDir, "out"),
    "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--strict",
    "--skipLibCheck"], { stdio: "inherit" })
  mod = createRequire(import.meta.url)(join(outDir, "out", "scope2-market.js"))
} finally {
  // 컴파일 산출물은 require 가 이미 읽었다.
}

const { computeScope2MarketBased } = mod
const results = []
const check = (name, fn) => {
  let detail = null
  try { detail = fn() } catch (e) { detail = `예외: ${e.message}` }
  results.push({ name, ok: detail === null })
  console.log(`  ${detail === null ? "OK  " : "FAIL"} ${name}${detail === null ? "" : "\n       → " + detail}`)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

const P = { periodFrom: new Date("2026-10-01T00:00:00Z"), periodTo: new Date("2026-11-01T00:00:00Z") }
const inst = (over) => ({
  id: "ci-1", kind: "rec", mwh: 10, factor_tco2e_per_mwh: 0,
  period_start: "2026-10-01T00:00:00Z", period_end: "2026-11-01T00:00:00Z",
  document_name: null, certificate_id: "K-REC-001", ...over,
})

check("증서가 없으면 market-based = location-based", () => {
  const r = computeScope2MarketBased({ totalMwh: 50, locationFactor: 0.4173, ...P, instruments: [] })
  if (!near(r.marketBasedTco2e, r.locationBasedTco2e)) return `${r.marketBasedTco2e} ≠ ${r.locationBasedTco2e}`
  if (!r.caveats.some((c) => c.includes("적용된 계약 증서가 없습니다"))) return "증서 없음을 적지 않는다"
  return null
})

check("REC 10 MWh(계수 0)가 50 MWh 중 10 을 덮으면 잔여 40 만 계통 계수", () => {
  const r = computeScope2MarketBased({ totalMwh: 50, locationFactor: 0.4173, ...P, instruments: [inst()] })
  if (!near(r.contractualMwh, 10)) return `계약 ${r.contractualMwh}`
  if (!near(r.residualMwh, 40)) return `잔여 ${r.residualMwh}`
  if (!near(r.marketBasedTco2e, 40 * 0.4173, 1e-3)) return `market ${r.marketBasedTco2e}`
  if (!near(r.locationBasedTco2e, 50 * 0.4173, 1e-3)) return `location ${r.locationBasedTco2e}`
  return null
})

check("증서가 소비량보다 많으면 소비량까지만 적용하고 초과분을 적는다", () => {
  const r = computeScope2MarketBased({ totalMwh: 5, locationFactor: 0.4173, ...P, instruments: [inst()] })
  if (!near(r.contractualMwh, 5)) return `계약 ${r.contractualMwh}`
  if (!near(r.residualMwh, 0)) return `잔여 ${r.residualMwh}`
  if (!near(r.oversuppliedMwh, 5)) return `초과 ${r.oversuppliedMwh}`
  if (!r.caveats.some((c) => c.includes("소비량을 넘어"))) return "초과를 적지 않는다"
  return null
})

check("연 단위 증서는 월 리포트에 시간 비례로 배분된다", () => {
  const yearly = inst({ mwh: 120, period_start: "2026-01-01T00:00:00Z", period_end: "2027-01-01T00:00:00Z" })
  const r = computeScope2MarketBased({ totalMwh: 50, locationFactor: 0.4173, ...P, instruments: [yearly] })
  // 10월 = 31일 / 365일 → 120 × 31/365 ≈ 10.19 MWh
  const expect = 120 * (31 / 365)
  if (!near(r.contractualMwh, expect, 1e-2)) return `계약 ${r.contractualMwh} (기대 ${expect.toFixed(3)})`
  if (!r.caveats.some((c) => c.includes("시간 비례"))) return "비례 배분을 적지 않는다"
  return null
})

check("기간이 안 겹치는 증서는 쓰이지 않는다", () => {
  const past = inst({ period_start: "2025-01-01T00:00:00Z", period_end: "2025-12-31T00:00:00Z" })
  const r = computeScope2MarketBased({ totalMwh: 50, locationFactor: 0.4173, ...P, instruments: [past] })
  if (r.applied.length !== 0) return `적용 ${r.applied.length}건`
  if (!near(r.marketBasedTco2e, r.locationBasedTco2e)) return "location 과 달라졌다"
  return null
})

check("계수가 낮은 증서부터 적용한다 — 입력 순서와 무관(결정론)", () => {
  const a = inst({ id: "ci-a", mwh: 30, factor_tco2e_per_mwh: 0.1 })
  const b = inst({ id: "ci-b", mwh: 30, factor_tco2e_per_mwh: 0 })
  const r1 = computeScope2MarketBased({ totalMwh: 40, locationFactor: 0.4173, ...P, instruments: [a, b] })
  const r2 = computeScope2MarketBased({ totalMwh: 40, locationFactor: 0.4173, ...P, instruments: [b, a] })
  if (r1.marketBasedTco2e !== r2.marketBasedTco2e) return `순서에 따라 다르다 ${r1.marketBasedTco2e} / ${r2.marketBasedTco2e}`
  // b(0) 30 전부 + a(0.1) 10 = 1.0 tCO2e, 잔여 0
  if (!near(r1.contractualTco2e, 1.0, 1e-3)) return `계약 배출 ${r1.contractualTco2e}`
  if (r1.applied[0].id !== "ci-b") return `먼저 적용된 것이 ${r1.applied[0].id}`
  return null
})

check("residual mix 대체를 **항상** 적는다", () => {
  for (const instruments of [[], [inst()]]) {
    const r = computeScope2MarketBased({ totalMwh: 50, locationFactor: 0.4173, ...P, instruments })
    if (!r.caveats.some((c) => c.includes("residual mix"))) return "residual mix 한계를 적지 않는다"
    if (!r.formulaText.includes("residual mix 미공표")) return "산식 전문에 대체를 적지 않는다"
  }
  return null
})

check("산식 전문에 대입값과 증서번호가 들어간다", () => {
  const r = computeScope2MarketBased({ totalMwh: 50, locationFactor: 0.4173, ...P, instruments: [inst()] })
  for (const want of ["50 MWh", "10 MWh", "0.4173", "K-REC-001", "market-based 합계"]) {
    if (!r.formulaText.includes(want)) return `'${want}' 가 없다:\n${r.formulaText}`
  }
  return null
})

check("순수 함수 — 같은 입력에 같은 출력", () => {
  const args = { totalMwh: 50, locationFactor: 0.4173, ...P, instruments: [inst()] }
  const a = JSON.stringify(computeScope2MarketBased(args))
  const b = JSON.stringify(computeScope2MarketBased(args))
  return a === b ? null : "두 번 호출 결과가 다르다"
})

rmSync(outDir, { recursive: true, force: true })
const bad = results.filter((r) => !r.ok)
console.log(bad.length
  ? `✗ Scope 2 market-based 검증 실패 — ${bad.length}건`
  : `✓ Scope 2 market-based 검증 통과 — ${results.length}개 항목 (원본에 없던 규칙이라 차분 검증이 아니라 사양 기반 단위 검증이다)`)
process.exit(bad.length ? 1 : 0)
