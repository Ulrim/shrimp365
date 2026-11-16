// 사례 한 건을 플랫폼 판정 함수에 넣는다.
//
// **판정 로직은 여기에 없다.** lib/thresholds.ts 의 checkThresholds ·
// detectTrendAnomalies 를 그대로 불러 돌려준 것을 받아 적을 뿐이다.
// 입력 한 줄의 모양은 플랫폼의 측정 기록과 같다(lib/db.ts 의 toWaterQuality):
//   { recorded_at, device_id, temperature, ph, ... } — 안 잰 항목은 0.
//
// ⚠ 사례의 측정 기록을 **그대로** 넘긴다. 플랫폼 수질 화면은 추세 판정에 원시 기록이
// 아니라 wq_series 의 구간 평균(168시간 조회면 약 42분 칸)을 넘기므로, 그보다 촘촘한
// 사례에서는 화면과 결과가 다를 수 있다. 시험 대상은 "판정 함수" 이고 화면 경로의
// 묶음은 범위 밖이다 — 이 정의는 김정석 확인 사항이다(작업 보고 참고).

import path from "node:path"
import { pathToFileURL } from "node:url"
import { FIELD_COLUMNS } from "./cases.mjs"

const KEYS = FIELD_COLUMNS.map(([, key]) => key)
const H = 3600_000

/** lib/thresholds.ts 를 그대로 import 한다(Node 22.18+ 의 타입 제거 실행). */
export async function loadPlatform(repoRoot) {
  if (!process.features?.typescript) {
    throw new Error(`이 Node(${process.version})는 .ts 파일을 바로 실행하지 못합니다. Node 22.18 이상이 필요합니다.`)
  }
  // 저장소 package.json 에 "type" 이 없어 뜨는 안내 경고 한 가지만 가린다(판정과 무관).
  const emit = process.emitWarning
  process.emitWarning = (w, ...rest) => {
    const code = typeof rest[0] === "object" ? rest[0]?.code : rest[1]
    if (code === "MODULE_TYPELESS_PACKAGE_JSON" || String(w).includes("MODULE_TYPELESS_PACKAGE_JSON")) return
    return emit.call(process, w, ...rest)
  }
  try {
    return await import(pathToFileURL(path.join(repoRoot, "lib", "thresholds.ts")).href)
  } finally {
    process.emitWarning = emit
  }
}

/** 사례 행 → 플랫폼 입력 한 줄. */
function toReading(row) {
  const r = { recorded_at: new Date(row.t).toISOString(), device_id: row.device }
  for (const k of KEYS) r[k] = row.values[k] ?? 0
  return r
}

/**
 * 한 시각(구간의 마지막 행 시각)에서 판정한다.
 *   임계값: 마지막 시각의 측정값마다 checkThresholds
 *   추세  : 구간 전체를 detectTrendAnomalies
 * 돌려주는 것: [{ 항목, 종류(임계|surge|drift|deviation), 등급(danger|warning) }]
 */
export function judgeWindow(platform, rows, profile) {
  const found = []
  const lastT = rows[rows.length - 1].t
  const seen = new Set()
  for (const row of rows) {
    if (row.t !== lastT) continue
    const values = Object.fromEntries(KEYS.map(k => [k, row.values[k] ?? 0]))
    for (const a of platform.checkThresholds(values, profile)) {
      const key = `${a.parameter}|${a.type}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ 항목: a.parameter, 종류: "임계", 등급: a.type })
    }
  }
  for (const a of platform.detectTrendAnomalies(rows.map(toReading))) {
    found.push({ 항목: a.parameter, 종류: a.kind, 등급: a.type })
  }
  return found
}

/**
 * 사례 한 건 판정.
 *   "구간끝" — 구간의 마지막 시각에서 한 번.
 *   "순차"   — 측정 시각마다 그때까지의 기록으로 판정, 처음 잡힌 시각에서 멈춘다.
 * 어느 쪽이든 판정에 넘기는 것은 판정 시각 기준 최근 windowHours 시간이다.
 *
 * 돌려주는 것: { 판정, 판정시각(ms), 근거[], 전체[], rows(판정에 쓴 행) }
 *   근거 = 설정한 등급에 드는 것만, 전체 = 플랫폼이 돌려준 것 전부.
 */
export function judgeCase(platform, series, { mode, grades, windowHours, profile }) {
  const at = (endIdx) => {
    const endT = series[endIdx].t
    let end = endIdx
    while (end + 1 < series.length && series[end + 1].t === endT) end++
    const rows = series.slice(0, end + 1).filter(r => r.t > endT - windowHours * H)
    const all = judgeWindow(platform, rows, profile)
    const hits = all.filter(a => grades.includes(a.등급))
    return { endT, rows, all, hits, next: end + 1 }
  }

  if (mode === "구간끝") {
    const r = at(series.length - 1)
    return { 판정: r.hits.length ? "이상" : "정상", 판정시각: r.endT, 근거: r.hits, 전체: r.all, rows: r.rows }
  }
  if (mode === "순차") {
    let i = 0, last = null
    while (i < series.length) {
      last = at(i)
      if (last.hits.length) {
        return { 판정: "이상", 판정시각: last.endT, 근거: last.hits, 전체: last.all, rows: last.rows }
      }
      i = last.next
    }
    return { 판정: "정상", 판정시각: last.endT, 근거: [], 전체: last.all, rows: last.rows }
  }
  throw new Error(`판정_방식 은 "구간끝" 또는 "순차" 여야 합니다: ${JSON.stringify(mode)}`)
}

/** 근거 목록을 CSV 한 칸 문자열로. 예: "DO:임계(danger); 수온:surge(warning)" */
export function describe(found) {
  return found.map(a => `${a.항목}:${a.종류}(${a.등급})`).join("; ")
}
