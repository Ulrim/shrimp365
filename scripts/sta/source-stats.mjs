#!/usr/bin/env node
// STA 시험 — 받은 원본 자료(정규화 CSV)의 수조 수·기간·측정 간격·결측률을 정리한다.
//
//   node scripts/sta/source-stats.mjs <정규화 CSV> [--out <통계 파일>]
//
// 어느 자료로 사례를 만들지 고르기 전에 본다. 추세 판정은 시간 단위 이상 촘촘한 자료가 필요하다.

import { readFileSync, writeFileSync } from "node:fs"
import { parseCsv } from "./lib/csv.mjs"
import { FIELD_COLUMNS, parseTime, formatTime, sha256File } from "./lib/cases.mjs"

const [file, flag, outFile] = process.argv.slice(2)
if (!file || (flag && flag !== "--out")) {
  console.error("사용법: node scripts/sta/source-stats.mjs <정규화 CSV> [--out <통계 파일>]")
  process.exit(3)
}
const { header, rows } = parseCsv(readFileSync(file, "utf8"))
const tanks = new Map()
for (const r of rows) {
  const list = tanks.get(r["수조"])
  const row = { t: parseTime(r["시각"]), r }
  if (list) list.push(row); else tanks.set(r["수조"], [row])
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }
const out = [
  `원본 자료 통계 — ${file}`,
  `sha256 ${sha256File(file)}`,
  `전체 ${rows.length}행 · 수조 ${tanks.size}개 · 측정 열: ${FIELD_COLUMNS.map(([c]) => c).filter(c => header.includes(c)).join(", ")}`,
  "",
]
for (const name of [...tanks.keys()].sort()) {
  const list = tanks.get(name).sort((a, b) => a.t - b.t)
  const gaps = list.slice(1).map((x, i) => (x.t - list[i].t) / 60000).filter(g => g > 0)
  const med = median(gaps)
  out.push(`[수조 ${name}] ${list.length}행 · ${formatTime(list[0].t)} ~ ${formatTime(list[list.length - 1].t)}`)
  out.push(`  측정 간격(분): 중앙값 ${med} · 최소 ${gaps.length ? Math.min(...gaps) : "-"} · 최대 ${gaps.length ? Math.max(...gaps) : "-"}`)
  out.push(`  간격 2시간 초과 끊김: ${gaps.filter(g => g > 120).length}곳`)
  for (const [col] of FIELD_COLUMNS) {
    if (!header.includes(col)) continue
    const vals = list.map(x => (x.r[col] ?? "").trim()).filter(v => v !== "" && Number(v) !== 0).map(Number)
    const miss = list.length - vals.length
    out.push(`  ${col}: 결측(빈 칸·0) ${miss}건(${(miss / list.length * 100).toFixed(1)}%)` +
      (vals.length ? ` · 최소 ${Math.min(...vals)} · 중앙값 ${median(vals)} · 최대 ${Math.max(...vals)}` : ""))
  }
  out.push("")
}
const text = out.join("\n")
console.log(text)
if (outFile) writeFileSync(outFile, text + "\n", "utf8")
