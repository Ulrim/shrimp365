/**
 * 리포트 자동 생성 규칙 검증 — 사양 기반 단위 검증.
 *
 * 배치 본체는 DB 를 돌리므로 여기서는 **순수 부분**을 고정한다:
 *   · duePeriod — 같은 기간을 두 번 만들지 않고, 밀린 것은 한 번에 하나씩, 때가 아니면 null
 *   · mailTransportFromEnv — 설정이 모자라면 조용히 보내지 않고(log) 그 사실을 적는다
 *   · checkRecipients — 주소 검사
 *
 * 실행: node scripts/mrv/verify-report-jobs.mjs
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-rjob-"))

copyFileSync(join(ROOT, "lib/mrv/mailer.ts"), join(outDir, "mailer.ts"))
// report-jobs.ts 는 DB·리포트 서비스를 import 한다. duePeriod 만 검증하므로 그 셋을 스텁으로 둔다 —
// 검증 대상(duePeriod 본문)은 한 글자도 바꾸지 않는다.
const jobs = readFileSync(join(ROOT, "lib/mrv/report-jobs.ts"), "utf8")
writeFileSync(join(outDir, "report-jobs.ts"), jobs)
// 스텁은 **실물과 같은 서명**이어야 한다. 얇게 두면 호출부가 컴파일되지 않아(never · 인자 수)
// 검증 대상인 duePeriod 까지 못 간다 — 실제로 그랬다.
writeFileSync(join(outDir, "db.ts"), [
  "export const T = {} as any",
  "export async function fetchAll<T>(_build: (from: number, to: number) => unknown): Promise<T[]> { return [] }",
  "export const newId = (p: string) => p",
  "export type MrvDb = any",
  "",
].join("\n"))
writeFileSync(join(outDir, "mrv-report-service.ts"), [
  "export async function generateMrvReport(_p: unknown): Promise<{ report: { id: string; reduction_tco2e: number | null } }> { throw new Error('stub') }",
  "",
].join("\n"))
writeFileSync(join(outDir, "audit.ts"), "export async function recordAudit(_db: unknown, _p: unknown): Promise<void> {}\n")
writeFileSync(join(outDir, "tenancy.ts"), "export type SiteRow = any\n")
execFileSync("npx", ["tsc", join(outDir, "report-jobs.ts"), join(outDir, "mailer.ts"), "--outDir", join(outDir, "out"),
  "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--strict", "--skipLibCheck",
  "--types", "node"], { stdio: "inherit" })
const req = createRequire(import.meta.url)
const { duePeriod } = req(join(outDir, "out", "report-jobs.js"))
const { mailTransportFromEnv, checkRecipients, logTransport } = req(join(outDir, "out", "mailer.js"))

const results = []
const check = (name, fn) => {
  let d = null
  try { d = fn() } catch (e) { d = `예외: ${e.message}` }
  results.push({ name, ok: d === null })
  console.log(`  ${d === null ? "OK  " : "FAIL"} ${name}${d === null ? "" : "\n       → " + d}`)
}
const iso = (d) => (d === null ? null : { from: d.from.toISOString(), to: d.to.toISOString() })
const D = (s) => new Date(s)

// ── weekly ──────────────────────────────────────────────────────────────────
check("weekly · 첫 실행(수요일)은 직전 월~월 한 주를 만든다", () => {
  const r = iso(duePeriod("weekly", D("2026-11-04T00:30:00Z"), null)) // 수요일
  const want = { from: "2026-10-26T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" }
  return JSON.stringify(r) === JSON.stringify(want) ? null : JSON.stringify(r)
})
check("weekly · 같은 주 안에서 다시 돌면 null (중복 발행 없음)", () => {
  const r = duePeriod("weekly", D("2026-11-05T00:30:00Z"), D("2026-11-02T00:00:00Z"))
  return r === null ? null : JSON.stringify(iso(r))
})
check("weekly · 다음 월요일이 되면 이어지는 한 주를 만든다", () => {
  const r = iso(duePeriod("weekly", D("2026-11-09T00:30:00Z"), D("2026-11-02T00:00:00Z")))
  const want = { from: "2026-11-02T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z" }
  return JSON.stringify(r) === JSON.stringify(want) ? null : JSON.stringify(r)
})
check("weekly · 3주 밀렸으면 가장 오래된 한 주만 돌려준다 (실행당 하나)", () => {
  const r = iso(duePeriod("weekly", D("2026-11-23T00:30:00Z"), D("2026-11-02T00:00:00Z")))
  const want = { from: "2026-11-02T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z" }
  return JSON.stringify(r) === JSON.stringify(want) ? null : JSON.stringify(r)
})
check("weekly · 월요일 00:00 정각은 '그 주가 끝났다' 로 본다", () => {
  const r = iso(duePeriod("weekly", D("2026-11-09T00:00:00Z"), D("2026-11-02T00:00:00Z")))
  return r && r.to === "2026-11-09T00:00:00.000Z" ? null : JSON.stringify(r)
})

// ── monthly ─────────────────────────────────────────────────────────────────
check("monthly · 첫 실행(11/4)은 10월 한 달을 만든다", () => {
  const r = iso(duePeriod("monthly", D("2026-11-04T00:30:00Z"), null))
  const want = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" }
  return JSON.stringify(r) === JSON.stringify(want) ? null : JSON.stringify(r)
})
check("monthly · 같은 달 안에서 다시 돌면 null", () => {
  const r = duePeriod("monthly", D("2026-11-20T00:30:00Z"), D("2026-11-01T00:00:00Z"))
  return r === null ? null : JSON.stringify(iso(r))
})
check("monthly · 해가 바뀌는 경계(12월 → 1월)도 맞다", () => {
  const r = iso(duePeriod("monthly", D("2027-01-03T00:30:00Z"), D("2026-12-01T00:00:00Z")))
  const want = { from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }
  return JSON.stringify(r) === JSON.stringify(want) ? null : JSON.stringify(r)
})
check("monthly · 두 달 밀렸으면 오래된 달 하나만", () => {
  const r = iso(duePeriod("monthly", D("2027-02-05T00:30:00Z"), D("2026-12-01T00:00:00Z")))
  const want = { from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }
  return JSON.stringify(r) === JSON.stringify(want) ? null : JSON.stringify(r)
})
check("순수 함수 — 같은 입력에 같은 출력", () => {
  const a = JSON.stringify(iso(duePeriod("weekly", D("2026-11-04T00:30:00Z"), null)))
  const b = JSON.stringify(iso(duePeriod("weekly", D("2026-11-04T00:30:00Z"), null)))
  return a === b ? null : "다르다"
})

// ── mailer ──────────────────────────────────────────────────────────────────
const silence = (fn) => { const e = console.error; console.error = () => {}; try { return fn() } finally { console.error = e } }
check("MRV_MAIL_PROVIDER 미설정 → log (보내지 않음)", () =>
  mailTransportFromEnv({}).name === "log" ? null : mailTransportFromEnv({}).name)
check("resend 인데 키가 없으면 log 로 내려간다", () =>
  silence(() => mailTransportFromEnv({ MRV_MAIL_PROVIDER: "resend" })).name === "log" ? null : "resend 로 갔다")
check("resend + 키 + 발신자 → resend", () =>
  mailTransportFromEnv({ MRV_MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", MRV_MAIL_FROM: "a@b.co" }).name === "resend" ? null : "log 로 갔다")
check("모르는 공급자 → log", () =>
  silence(() => mailTransportFromEnv({ MRV_MAIL_PROVIDER: "sendgrid" })).name === "log" ? null : "다른 값")
{
  // check() 는 동기다 — async 를 넘기면 Promise 가 실패 사유로 들어간다. 이 한 건만 직접 기다린다.
  const r = await (async () => { const e = console.info; console.info = () => {}; try { return await logTransport.send({ to: "a@b.co", subject: "s", text: "t" }) } finally { console.info = e } })()
  check("log 발송기는 'skipped' 를 돌려주고 이유를 적는다", () =>
    r.status === "skipped" && /MRV_MAIL_PROVIDER/.test(r.reason) ? null : JSON.stringify(r))
}

// ── recipients ──────────────────────────────────────────────────────────────
check("수신자 — 소문자·중복 제거·빈 칸 무시", () => {
  const r = checkRecipients(["A@B.co", "a@b.co", " ", "c@d.io"])
  return r.ok && JSON.stringify(r.recipients) === JSON.stringify(["a@b.co", "c@d.io"]) ? null : JSON.stringify(r)
})
check("수신자 — 잘못된 주소는 거절", () => { const r = checkRecipients(["not-an-email"]); return !r.ok ? null : "통과했다" })
check("수신자 — 비우면 허용(생성만)", () => { const r = checkRecipients(undefined); return r.ok && r.recipients.length === 0 ? null : JSON.stringify(r) })
check("수신자 — 21명은 거절", () => { const r = checkRecipients(Array.from({ length: 21 }, (_, i) => `u${i}@x.io`)); return !r.ok ? null : "통과했다" })

rmSync(outDir, { recursive: true, force: true })
const bad = results.filter((r) => !r.ok)
console.log(bad.length
  ? `✗ 리포트 자동 생성 규칙 검증 실패 — ${bad.length}건`
  : `✓ 리포트 자동 생성 규칙 검증 통과 — ${results.length}개 항목 (원본에 없던 기능이라 차분 검증이 아니라 사양 기반 단위 검증이다)`)
process.exit(bad.length ? 1 : 0)
