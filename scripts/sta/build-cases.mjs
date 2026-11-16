#!/usr/bin/env node
// STA 시험 — 시험 사례 묶음 만들기(시험 전날까지 끝내는 준비 작업).
//
//   node scripts/sta/build-cases.mjs --source <이름>=<정규화 CSV> [--source ...]
//                                    [--plan <사례계획.json>] [--cases <사례 폴더>]
//
// 정규화 CSV(원본 자료를 한 모양으로 옮긴 것, 저장소에 커밋하지 않는다)
//   열: 수조, 시각, 장치(없어도 됨), 수온(℃), pH, DO(mg/L), 염도(ppt), 암모니아(mg/L),
//       아질산염(mg/L), 질산염(mg/L), 알칼리도(mg/L), 탁도(NTU) — 없는 항목 열은 빼도 된다.
//
// 사례계획.json — 어느 수조의 어느 구간을 어떤 정답으로 쓸지, 무엇을 주입할지 사람이 적는다.
//   { "사례": [
//     { "사례ID": "R-N01", "출처": "실측", "원본": "컬리버2024", "수조": "1",
//       "시작": "2024-07-01T00:00", "끝": "2024-07-04T23:00",
//       "정답": "정상", "이상 유형": "", "대상 항목": "", "라벨 근거": "기준표 3-1" },
//     { "사례ID": "S-A01", "출처": "모사", ..., "정답": "이상", "이상 유형": "급변", "대상 항목": "DO",
//       "주입": [ { "항목": "DO", "종류": "계단", "시각": "2024-07-04T22:00", "크기": -1.8 } ] } ] }
//
// 주입 종류 — 값이 있는 자리에만 더한다(빈 칸과 0 은 미측정이라 그대로 둔다).
//   계단  「시각」부터 끝까지 「크기」를 더한다.
//   경사  「시작」~「끝」 사이에 0 → 「크기」로 곧게 늘리고, 그 뒤는 「크기」를 유지한다.
//   구간  「시작」~「끝」 사이에만 「크기」를 더한다.
//
// 이 스크립트는 정답을 정하지 않는다. 정답·주입 크기는 라벨기준.md 에 따라 계획 파일에 적힌 대로다.
// 같은 원본·같은 계획이면 같은 파일이 나온다(난수 없음, 사례ID 순).

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "./lib/args.mjs"
import { parseCsv, toCsv } from "./lib/csv.mjs"
import { injectionOffset } from "./lib/inject.mjs"
import {
  FIELD_COLUMNS, SERIES_HEADER, CASES_HEADER, SOURCES, LABELS,
  parseTime, formatTime, sha256File,
} from "./lib/cases.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 주입 항목 이름("DO"·"DO(mg/L)"·"do_level") → 시계열 열 이름. */
function columnOf(name) {
  for (const [col, key] of FIELD_COLUMNS) {
    if (name === col || name === key || name === col.replace(/\(.*\)$/, "")) return col
  }
  throw new Error(`알 수 없는 항목: ${name}`)
}

const round3 = (v) => Math.round(v * 1000) / 1000

function describeInjection(inj) {
  const where = inj["종류"] === "계단" ? inj["시각"] : `${inj["시작"]}~${inj["끝"]}`
  const size = Number(inj["크기"])
  return `${inj["항목"]} ${inj["종류"]} ${where} ${size > 0 ? "+" : ""}${size}`
}

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

function main() {
  const argv = process.argv.slice(2)
  // --source 는 여러 번 올 수 있어 따로 모은다.
  const sources = new Map()
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") {
      const [name, ...file] = String(argv[++i] ?? "").split("=")
      if (!name || !file.length) throw new Error("--source 는 <이름>=<파일> 꼴이어야 합니다")
      sources.set(name, path.resolve(file.join("=")))
    } else rest.push(argv[i])
  }
  const args = parseArgs(rest, { plan: "value", cases: "value" })
  const casesDir = path.resolve(args.cases ?? path.join(HERE, "cases"))
  const planFile = path.resolve(args.plan ?? path.join(casesDir, "사례계획.json"))
  const plan = JSON.parse(readFileSync(planFile, "utf8"))

  // 원본 읽기 — 수조별 시각순.
  const data = new Map()
  const sourceHashes = []
  for (const [name, file] of sources) {
    const { header, rows } = parseCsv(readFileSync(file, "utf8"))
    for (const h of ["수조", "시각"]) if (!header.includes(h)) throw new Error(`${file}: 「${h}」 열이 없습니다`)
    const byTank = new Map()
    rows.forEach((r, i) => {
      const row = { t: parseTime(r["시각"]), order: i, r }
      const list = byTank.get(r["수조"])
      if (list) list.push(row); else byTank.set(r["수조"], [row])
    })
    for (const list of byTank.values()) list.sort((a, b) => a.t - b.t || a.order - b.order)
    data.set(name, byTank)
    sourceHashes.push(`${sha256File(file)}  ${name} (${path.basename(file)}, ${rows.length}행)`)
  }

  const problems = []
  const seen = new Set()
  const built = []
  for (const c of plan["사례"]) {
    const id = c["사례ID"]
    if (!id || seen.has(id)) { problems.push(`사례ID 가 없거나 중복: ${id}`); continue }
    seen.add(id)
    if (!SOURCES.includes(c["출처"])) problems.push(`${id}: 출처는 실측/모사`)
    if (!LABELS.includes(c["정답"])) problems.push(`${id}: 정답은 이상/정상`)
    const inj = c["주입"] ?? []
    if (c["출처"] === "실측" && inj.length) problems.push(`${id}: 실측 사례에는 주입을 쓸 수 없습니다(모사로 표기)`)
    if (c["출처"] === "모사" && c["정답"] === "이상" && !inj.length) problems.push(`${id}: 모사 이상 사례인데 주입이 없습니다`)
    const tank = data.get(c["원본"])?.get(String(c["수조"]))
    if (!tank) { problems.push(`${id}: 원본 「${c["원본"]}」 에 수조 「${c["수조"]}」 가 없습니다`); continue }
    const a = parseTime(c["시작"]), b = parseTime(c["끝"])
    const window = tank.filter(x => x.t >= a && x.t <= b)
    if (window.length < 4) { problems.push(`${id}: 구간 안의 기록이 ${window.length}건뿐입니다(최소 4건)`); continue }
    const cols = inj.map(j => columnOf(j["항목"]))
    const rows = window.map(x => {
      const out = { "시각": formatTime(x.t), "장치": x.r["장치"] ?? "" }
      for (const [col] of FIELD_COLUMNS) {
        const raw = (x.r[col] ?? "").trim()
        if (raw === "") { out[col] = ""; continue }
        let v = Number(raw)
        if (!Number.isFinite(v)) throw new Error(`${id}: ${col} 값이 숫자가 아닙니다 (${raw})`)
        // 주입이 닿지 않은 열은 원본 표기를 그대로 둔다(28.00 을 28 로 바꾸지 않는다).
        // 0 은 플랫폼 규약상 "안 쟀다" 다 — 결측과 같이 주입하지 않고 그대로 둔다.
        if (!cols.includes(col) || v === 0) { out[col] = raw; continue }
        inj.forEach((j, k) => { if (cols[k] === col) v += injectionOffset(j, x.t) })
        out[col] = round3(v)
        // 주입 결과가 0 이 되면 그 점이 "안 쟀다" 로 사라진다 — 계획을 고치게 멈춘다.
        if (out[col] === 0) throw new Error(`${id}: ${col} 주입 결과가 0 입니다(${out["시각"]}). 0 은 미측정으로 읽히므로 주입 크기를 바꾸십시오`)
      }
      return out
    })
    built.push({ c, rows, first: window[0].t, last: window[window.length - 1].t,
      gaps: window.slice(1).map((x, i) => (x.t - window[i].t) / 60000) })
  }
  if (problems.length) throw new Error("사례 계획 검사 실패\n  - " + problems.join("\n  - "))
  built.sort((x, y) => (x.c["사례ID"] < y.c["사례ID"] ? -1 : 1))

  // 쓰기 — 시계열 폴더는 비우고 다시 만든다(계획에서 뺀 사례가 남지 않게).
  const seriesDir = path.join(casesDir, "series")
  rmSync(seriesDir, { recursive: true, force: true })
  mkdirSync(seriesDir, { recursive: true })
  const list = []
  for (const { c, rows, first, last } of built) {
    const rel = `series/${c["사례ID"]}.csv`
    writeFileSync(path.join(casesDir, rel), toCsv(SERIES_HEADER, rows), "utf8")
    list.push({
      "사례ID": c["사례ID"], "출처": c["출처"], "수조": c["수조"],
      "시작 시각": formatTime(first), "끝 시각": formatTime(last),
      "정답": c["정답"], "이상 유형": c["이상 유형"] ?? "", "대상 항목": c["대상 항목"] ?? "",
      "표본수(건)": rows.length, "시계열 파일": rel, "원본 자료": c["원본"],
      "주입 내용": (c["주입"] ?? []).map(describeInjection).join("; "),
      "라벨 근거": c["라벨 근거"] ?? "",
    })
  }
  writeFileSync(path.join(casesDir, "cases.csv"), toCsv(CASES_HEADER, list), "utf8")

  // 통계
  const n = (f) => list.filter(f).length
  const types = [...new Set(list.filter(r => r["정답"] === "이상").map(r => r["이상 유형"] || "(미기재)"))].sort()
  const sizes = built.map(b => b.rows.length)
  const spans = built.map(b => (b.last - b.first) / 3600_000)
  const gapMed = built.map(b => median(b.gaps))
  const stats = [
    "시험 사례 통계 (build-cases.mjs 가 만든다)",
    "",
    `사례 수: ${list.length}건`,
    `  이상 ${n(r => r["정답"] === "이상")}건 (실측 ${n(r => r["정답"] === "이상" && r["출처"] === "실측")} · 모사 ${n(r => r["정답"] === "이상" && r["출처"] === "모사")})`,
    `  정상 ${n(r => r["정답"] === "정상")}건 (실측 ${n(r => r["정답"] === "정상" && r["출처"] === "실측")} · 모사 ${n(r => r["정답"] === "정상" && r["출처"] === "모사")})`,
    "",
    "이상 유형별 건수:",
    ...types.map(t => `  ${t}: ${n(r => r["정답"] === "이상" && (r["이상 유형"] || "(미기재)") === t)}건`),
    "",
    `사례당 표본수(건): 최소 ${Math.min(...sizes)} · 중앙값 ${median(sizes)} · 최대 ${Math.max(...sizes)}`,
    `사례 구간 길이(시간): 최소 ${Math.min(...spans).toFixed(1)} · 중앙값 ${median(spans).toFixed(1)} · 최대 ${Math.max(...spans).toFixed(1)}`,
    `사례 안 측정 간격 중앙값(분): 최소 ${Math.min(...gapMed)} · 최대 ${Math.max(...gapMed)}`,
    "",
    "원본 자료(정규화 CSV) sha256 — 원본은 저장소에 두지 않는다:",
    ...sourceHashes.map(s => "  " + s),
    "",
  ].join("\n")
  writeFileSync(path.join(casesDir, "통계.txt"), stats, "utf8")

  // sha256 목록 — 사례 목록·시계열·기준표·계획(있는 것만). 경로순.
  const hashed = ["cases.csv", ...list.map(r => r["시계열 파일"])]
  for (const extra of ["라벨기준.md", "사례계획.json", "통계.txt"]) {
    if (existsSync(path.join(casesDir, extra))) hashed.push(extra)
  }
  hashed.sort()
  writeFileSync(path.join(casesDir, "sha256sums.txt"),
    hashed.map(f => `${sha256File(path.join(casesDir, f))}  ${f}`).join("\n") + "\n", "utf8")

  console.log(stats)
  console.log(`사례 폴더: ${casesDir}`)
  console.log(`  cases.csv · series/ ${list.length}개 · 통계.txt · sha256sums.txt`)
}

try { main() } catch (err) {
  console.error(`\n실행 오류: ${err.message}`)
  process.exitCode = 3
}
