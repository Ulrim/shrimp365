/**
 * 비교실험(A/B) 입력 규칙 검증 — 사양 기반 단위 검증.
 * 실행: node scripts/mrv/verify-experiments.mjs
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-exp-"))
copyFileSync(join(ROOT, "lib/mrv/experiments.ts"), join(outDir, "experiments.ts"))
execFileSync("npx", ["tsc", join(outDir, "experiments.ts"), "--outDir", join(outDir, "out"),
  "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--strict", "--skipLibCheck"], { stdio: "inherit" })
const { checkExperiment, checkConclusion } = createRequire(import.meta.url)(join(outDir, "out", "experiments.js"))

const results = []
const check = (name, fn) => {
  let d = null
  try { d = fn() } catch (e) { d = `예외: ${e.message}` }
  results.push({ name, ok: d === null })
  console.log(`  ${d === null ? "OK  " : "FAIL"} ${name}${d === null ? "" : "\n       → " + d}`)
}
const base = {
  name: "폭기기 인버터 교체", hypothesis: "폭기 EI 10% 감소 기대",
  control_from: "2026-09-01T00:00:00Z", control_to: "2026-09-15T00:00:00Z",
  treatment_from: "2026-09-15T00:00:00Z", treatment_to: "2026-09-29T00:00:00Z",
}
check("정상 입력은 통과하고 Date 로 바뀐다", () => {
  const r = checkExperiment(base)
  return r.ok && r.value.control_from instanceof Date ? null : JSON.stringify(r)
})
check("이름이 비면 거절", () => { const r = checkExperiment({ ...base, name: " " }); return !r.ok ? null : "통과" })
check("대조군 시작 ≥ 끝이면 거절", () => {
  const r = checkExperiment({ ...base, control_from: base.control_to })
  return !r.ok && r.detail.includes("앞서야") ? null : JSON.stringify(r)
})
check("구간이 하루보다 짧으면 거절", () => {
  const r = checkExperiment({ ...base, treatment_to: "2026-09-15T12:00:00Z" })
  return !r.ok && r.detail.includes("하루") ? null : JSON.stringify(r)
})
check("두 구간이 겹치면 거절 — 같은 기록을 양쪽에 센다", () => {
  const r = checkExperiment({ ...base, treatment_from: "2026-09-10T00:00:00Z" })
  return !r.ok && r.detail.includes("겹칩니다") ? null : JSON.stringify(r)
})
check("맞닿은 구간(끝 = 시작)은 겹침이 아니다", () => {
  const r = checkExperiment(base) // control_to == treatment_from
  return r.ok ? null : r.detail
})
check("처리군이 대조군보다 앞서도 된다(되돌린 실험)", () => {
  const r = checkExperiment({ ...base, control_from: "2026-10-01T00:00:00Z", control_to: "2026-10-15T00:00:00Z" })
  return r.ok ? null : r.detail
})
check("시각이 깨지면 거절", () => { const r = checkExperiment({ ...base, control_from: "어제" }); return !r.ok ? null : "통과" })
check("가설 2000자 초과는 거절", () => { const r = checkExperiment({ ...base, hypothesis: "가".repeat(2001) }); return !r.ok ? null : "통과" })
check("concluded 는 결론이 필수다", () => {
  const r = checkConclusion({ status: "concluded", conclusion: " " })
  return !r.ok && r.detail.includes("결론을 적어야") ? null : JSON.stringify(r)
})
check("abandoned 는 결론 없이 된다", () => { const r = checkConclusion({ status: "abandoned" }); return r.ok && r.conclusion === null ? null : JSON.stringify(r) })
check("running 으로 되돌리는 요청은 거절", () => { const r = checkConclusion({ status: "running" }); return !r.ok ? null : "통과" })

rmSync(outDir, { recursive: true, force: true })
const bad = results.filter((r) => !r.ok)
console.log(bad.length
  ? `✗ 비교실험 규칙 검증 실패 — ${bad.length}건`
  : `✓ 비교실험 규칙 검증 통과 — ${results.length}개 항목 (원본에 없던 기능이라 차분 검증이 아니라 사양 기반 단위 검증이다)`)
process.exit(bad.length ? 1 : 0)
