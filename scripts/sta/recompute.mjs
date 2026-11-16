#!/usr/bin/env node
// STA 시험 — 사례별 결과(CSV)만으로 최종값을 다시 계산한다.
//
//   node scripts/sta/recompute.mjs [--out <결과 폴더>]
//
// 읽는 것은 02_사례별_결과.csv 와, 비교 대상인 03_최종결과.json 둘뿐이다.
// 판정 함수·사례 시계열은 읽지 않는다.
// 다시 계산한 값이 03_최종결과.json 과 하나라도 다르면 종료 코드 1 로 끝난다.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "./lib/args.mjs"
import { parseCsv } from "./lib/csv.mjs"
import { summarizeAll, verdict, ratio } from "./lib/metrics.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")

const lines = []
function log(text = "") {
  for (const l of String(text).split("\n")) { lines.push(l); console.log(l) }
}

function main() {
  const args = parseArgs(process.argv.slice(2), { out: "value" })
  const outDir = path.resolve(args.out ?? path.join(ROOT, "sta_AI데이터"))
  const csvFile = path.join(outDir, "02_사례별_결과.csv")
  const jsonFile = path.join(outDir, "03_최종결과.json")

  log("══════════════════════════════════════════════════════════════")
  log(" STA 시험 — 사례별 결과로 최종값 재계산")
  log("══════════════════════════════════════════════════════════════")
  log(`읽는 파일: ${csvFile}`)
  const { rows } = parseCsv(readFileSync(csvFile, "utf8"))
  const reported = JSON.parse(readFileSync(jsonFile, "utf8"))
  log(`사례별 결과 ${rows.length}줄`)
  log("")

  // 「구분」「일치」 열이 정답·판정과 맞는지부터 본다(줄 단위 자기 일관성).
  const rowProblems = []
  for (const r of rows) {
    const kind = r["정답"] === "이상" ? (r["판정"] === "이상" ? "TP" : "FN") : (r["판정"] === "이상" ? "FP" : "TN")
    if (r["구분"] !== kind) rowProblems.push(`${r["사례ID"]}: 구분 ${r["구분"]} ≠ ${kind}`)
    if (String(r["일치(0/1)"]) !== (r["정답"] === r["판정"] ? "1" : "0")) rowProblems.push(`${r["사례ID"]}: 일치(0/1) 값이 정답·판정과 다름`)
  }

  const again = summarizeAll(rows)
  const diffs = []
  const cmp = (name, a, b) => {
    const same = JSON.stringify(a) === JSON.stringify(b)
    if (!same) diffs.push(name)
    log(`  ${same ? "일치  " : "불일치"} ${name}: 재계산 ${JSON.stringify(a)} / 최종결과 ${JSON.stringify(b)}`)
  }

  const section = (title, mine, theirs) => {
    log(`[${title}]`)
    const m = mine["혼동행렬"]
    log(`  셈: 이상 사례 ${mine["사례수"]["이상"]}건 중 판정 이상 ${m.TP}건(TP)·판정 정상 ${m.FN}건(FN), 정상 사례 ${mine["사례수"]["정상"]}건 중 판정 이상 ${m.FP}건(FP)·판정 정상 ${m.TN}건(TN)`)
    cmp("사례수", mine["사례수"], theirs?.["사례수"])
    cmp("혼동행렬", m, theirs?.["혼동행렬"])
    log(`  재현율 = TP/(TP+FN) = ${m.TP}/${m.TP + m.FN}`)
    cmp("재현율", mine["재현율"], theirs?.["재현율"])
    log(`  정밀도 = TP/(TP+FP) = ${m.TP}/${m.TP + m.FP}`)
    cmp("정밀도", mine["정밀도"], theirs?.["정밀도"])
    log(`  F1 = 2TP/(2TP+FP+FN) = ${2 * m.TP}/${2 * m.TP + m.FP + m.FN}`)
    cmp("F1", mine["F1"], theirs?.["F1"])
    log(`  정확도 = (TP+TN)/전체 = ${m.TP + m.TN}/${mine["사례수"]["전체"]}`)
    cmp("정확도", mine["정확도"], theirs?.["정확도"])
    log(`  오경보율 = FP/(FP+TN) = ${m.FP}/${m.FP + m.TN}`)
    cmp("오경보율", mine["오경보율"], theirs?.["오경보율"])
    log("")
  }
  section("전체", again["전체"], reported["최종값"]?.["전체"])
  section("실측 사례", again["출처별"]["실측"], reported["최종값"]?.["출처별"]?.["실측"])
  section("모사 사례", again["출처별"]["모사"], reported["최종값"]?.["출처별"]?.["모사"])

  log("[판정]")
  const threshold = reported["판정기준"]?.["기준값"] ?? null
  log(`  기준: 재현율 ${threshold === null ? "【미설정】" : threshold + " 이상"}`)
  let result = verdict(again["전체"]["혼동행렬"], threshold)
  // 사례 수 부족 보류는 측정 단계의 설정(최소 사례수)에 따른 것이라 그대로 따른다.
  if (reported["판정"] === "보류(사례 수 부족)") result = reported["판정"]
  cmp("판정", result, reported["판정"])
  log("")

  log("[참고값]")
  const targeted = rows.filter(r => r["대상 항목 탐지(0/1)"] !== "")
  const hit = targeted.filter(r => r["대상 항목 탐지(0/1)"] === "1").length
  cmp("대상항목_탐지율", { "분자": hit, "분모": targeted.length, "값": ratio(hit, targeted.length) },
    reported["참고"]?.["대상항목_탐지율"])
  const compared = rows.filter(r => r["참고: 웹-장비 추세 일치(0/1)"] !== "")
  const same = compared.filter(r => r["참고: 웹-장비 추세 일치(0/1)"] === "1").length
  cmp("웹_장비_추세판정_일치율",
    compared.length ? { "분자": same, "분모": compared.length, "값": ratio(same, compared.length) } : "미실행",
    reported["참고"]?.["웹_장비_추세판정_일치율"])
  log("")

  if (rowProblems.length) {
    log("[사례별 결과의 줄 단위 불일치]")
    for (const p of rowProblems) log(`  ${p}`)
    log("")
  }

  const ok = diffs.length === 0 && rowProblems.length === 0
  log(ok
    ? "결과: 일치 — 사례별 결과만으로 다시 계산한 값이 최종결과와 모두 같습니다."
    : `결과: 불일치 — ${[...diffs, ...(rowProblems.length ? ["줄 단위 검사"] : [])].join(", ")}`)

  writeFileSync(path.join(outDir, "04_재계산_결과.txt"), lines.join("\n") + "\n", "utf8")
  const runLog = path.join(outDir, "05_실행로그.txt")
  if (existsSync(runLog)) appendFileSync(runLog, "\n" + lines.join("\n") + "\n", "utf8")
  return ok ? 0 : 1
}

try { process.exitCode = main() } catch (err) {
  console.error(`\n실행 오류: ${err.message}`)
  process.exitCode = 3
}
