// 시험 사례 읽기 — cases.csv(목록) + 사례별 시계열 CSV.
//
// 열 이름은 한글이고 단위는 괄호로 붙인다. 플랫폼 항목 키와의 짝은 여기 한 곳에 둔다.

import { readFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { parseCsv } from "./csv.mjs"

/** 시계열 CSV 의 측정 열 → 플랫폼 항목 키(water_quality_readings 컬럼). 순서가 곧 열 순서다. */
export const FIELD_COLUMNS = [
  ["수온(℃)", "temperature"],
  ["pH", "ph"],
  ["DO(mg/L)", "do_level"],
  ["염도(ppt)", "salinity"],
  ["암모니아(mg/L)", "ammonia"],
  ["아질산염(mg/L)", "nitrite"],
  ["질산염(mg/L)", "nitrate"],
  ["알칼리도(mg/L)", "alkalinity"],
  ["탁도(NTU)", "turbidity"],
]
export const SERIES_HEADER = ["시각", "장치", ...FIELD_COLUMNS.map(([c]) => c)]

export const CASES_HEADER = [
  "사례ID", "출처", "수조", "시작 시각", "끝 시각", "정답", "이상 유형", "대상 항목",
  "표본수(건)", "시계열 파일", "원본 자료", "주입 내용", "라벨 근거",
]

export const SOURCES = ["실측", "모사"]
export const LABELS = ["이상", "정상"]

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

/** 시각 문자열 → ms. 시간대 표기가 없으면 한국 표준시(+09:00)로 읽는다. */
export function parseTime(text) {
  let s = String(text).trim().replace(" ", "T")
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += "+09:00"
  const t = new Date(s).getTime()
  if (!Number.isFinite(t)) throw new Error(`시각을 읽을 수 없습니다: ${JSON.stringify(text)}`)
  return t
}

/** ms → "2024-07-01T13:00:00+09:00" (항상 한국 표준시로 적는다). */
export function formatTime(ms) {
  return new Date(ms + 9 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "+09:00")
}

/** 시계열 CSV 한 개 → 시각순 행. 빈 칸은 "안 쟀다" 이고 values 에 넣지 않는다. */
export function readSeries(file) {
  const { header, rows } = parseCsv(readFileSync(file, "utf8"))
  if (!header.includes("시각")) throw new Error(`${file}: 「시각」 열이 없습니다`)
  const out = rows.map((r, i) => {
    const values = {}
    for (const [col, key] of FIELD_COLUMNS) {
      const raw = (r[col] ?? "").trim()
      if (raw === "") continue
      const v = Number(raw)
      if (!Number.isFinite(v)) throw new Error(`${file} ${i + 2}행 ${col}: 숫자가 아닙니다 (${raw})`)
      values[key] = v
    }
    return { t: parseTime(r["시각"]), device: (r["장치"] ?? "").trim() || null, values, order: i }
  })
  // 시각순, 같은 시각이면 파일에 적힌 순서(정렬 순서 고정).
  out.sort((a, b) => a.t - b.t || a.order - b.order)
  return out
}

/** sha256sums.txt("<해시>  <상대경로>") → Map(상대경로 → 해시). */
export function readSha256Sums(file) {
  const map = new Map()
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/)
    if (m) map.set(m[2].trim(), m[1])
  }
  return map
}

/**
 * 사례 묶음을 읽고 검사한다.
 *   - cases.csv 의 필수 열, 출처·정답 값, 사례ID 중복
 *   - sha256sums.txt 가 있으면 cases.csv·시계열 파일의 해시 대조(시험 절차 1)
 * 문제가 있으면 모아서 한 번에 던진다.
 */
export function loadCases(dir, { verifyHashes = true } = {}) {
  const listFile = path.join(dir, "cases.csv")
  if (!existsSync(listFile)) throw new Error(`사례 목록이 없습니다: ${listFile}`)
  const { header, rows } = parseCsv(readFileSync(listFile, "utf8"))
  const problems = []
  for (const h of ["사례ID", "출처", "정답", "시계열 파일"]) {
    if (!header.includes(h)) problems.push(`cases.csv 에 「${h}」 열이 없습니다`)
  }
  if (problems.length) throw new Error(problems.join("\n"))

  const sumsFile = path.join(dir, "sha256sums.txt")
  const sums = verifyHashes && existsSync(sumsFile) ? readSha256Sums(sumsFile) : null
  const hashChecks = []
  const check = (rel) => {
    if (!sums) return
    const want = sums.get(rel)
    const got = sha256File(path.join(dir, rel))
    hashChecks.push({ 파일: rel, sha256: got, 일치: want === got })
    if (!want) problems.push(`sha256sums.txt 에 ${rel} 이(가) 없습니다`)
    else if (want !== got) problems.push(`sha256 불일치: ${rel}`)
  }
  check("cases.csv")

  const seen = new Set()
  const cases = []
  for (const r of rows) {
    const id = r["사례ID"]
    if (!id) { problems.push("사례ID 가 빈 행이 있습니다"); continue }
    if (seen.has(id)) problems.push(`사례ID 중복: ${id}`)
    seen.add(id)
    if (!SOURCES.includes(r["출처"])) problems.push(`${id}: 출처는 실측/모사 여야 합니다 (${r["출처"]})`)
    if (!LABELS.includes(r["정답"])) problems.push(`${id}: 정답은 이상/정상 이어야 합니다 (${r["정답"]})`)
    const rel = r["시계열 파일"]
    const file = path.join(dir, rel)
    if (!existsSync(file)) { problems.push(`${id}: 시계열 파일이 없습니다 (${rel})`); continue }
    check(rel)
    let series
    try { series = readSeries(file) } catch (e) { problems.push(e.message); continue }
    if (!series.length) problems.push(`${id}: 시계열이 비어 있습니다`)
    cases.push({ id, meta: r, series })
  }
  if (problems.length) throw new Error("사례 묶음 검사 실패\n  - " + problems.join("\n  - "))
  // 사례ID 순으로 고정(결과 CSV 의 줄 순서).
  cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { cases, hashChecks, hasSums: !!sums }
}
