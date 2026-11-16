// STA 시험 도구의 시험 — node --test scripts/sta/test/
//
//   ① 작은 사례 묶음의 판정 결과가 고정값과 같다(플랫폼 판정 함수 호출 경로 확인)
//   ② 재계산 = 최종값 (종료 코드 0), 결과를 고치면 불일치(종료 코드 1)
//   ③ 시험 대상·사례 파일이 바뀌면 중단(종료 코드 3), 기준값이 없으면 보류(종료 코드 2)
//
// 여기 쓰는 시계열은 시험용으로 지어낸 것이다. STA 제출 사례가 아니다.

import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { toCsv, parseCsv } from "../lib/csv.mjs"
import { summarize, verdict, ratio } from "../lib/metrics.mjs"
import { parseTime, formatTime } from "../lib/cases.mjs"
import { injectionOffset } from "../build-cases.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STA = path.resolve(HERE, "..")
const BASE_CONFIG = JSON.parse(readFileSync(path.join(STA, "sta.config.json"), "utf8"))

const run = (script, args) => spawnSync(process.execPath, [path.join(STA, script), ...args], { encoding: "utf8" })

/** 하루 주기로 오르내리는 6일치 1시간 간격 자료(수조 T1). 난수 없음. */
function syntheticSource() {
  const start = parseTime("2024-07-01T00:00")
  const rows = []
  for (let h = 0; h < 144; h++) {
    const s = Math.sin(((h % 24) - 9) / 24 * 2 * Math.PI)   // 15시에 최고, 03시에 최저
    rows.push({
      "수조": "T1", "시각": formatTime(start + h * 3600_000), "장치": "",
      "수온(℃)": (28 + 1.5 * s).toFixed(2), "pH": (8.0 + 0.15 * s).toFixed(2),
      "DO(mg/L)": (6.5 + 1.0 * s).toFixed(2), "염도(ppt)": "30",
    })
  }
  return toCsv(["수조", "시각", "장치", "수온(℃)", "pH", "DO(mg/L)", "염도(ppt)"], rows)
}

const base = { "원본": "시험용", "수조": "T1", "시작": "2024-07-01T00:00", "끝": "2024-07-05T23:00" }
const PLAN = {
  "사례": [
    { ...base, "사례ID": "T-N1", "출처": "실측", "정답": "정상" },
    { ...base, "사례ID": "T-N2", "출처": "모사", "정답": "정상",
      "주입": [{ "항목": "염도", "종류": "계단", "시각": "2024-07-05T22:00", "크기": 3.5 }] },
    { ...base, "사례ID": "T-A1", "출처": "모사", "정답": "이상", "이상 유형": "급변", "대상 항목": "DO",
      "주입": [{ "항목": "DO", "종류": "계단", "시각": "2024-07-05T22:00", "크기": -1.8 }] },
    { ...base, "사례ID": "T-A2", "출처": "모사", "정답": "이상", "이상 유형": "임계값 초과", "대상 항목": "pH",
      "주입": [{ "항목": "pH", "종류": "구간", "시작": "2024-07-05T23:00", "끝": "2024-07-05T23:30", "크기": 0.9 }] },
    { ...base, "사례ID": "T-A3", "출처": "모사", "정답": "이상", "이상 유형": "연속 악화", "대상 항목": "DO",
      "주입": [{ "항목": "DO", "종류": "경사", "시작": "2024-07-02T00:00", "끝": "2024-07-05T23:00", "크기": -2.0 }] },
    { ...base, "사례ID": "T-A4", "출처": "실측", "정답": "이상", "이상 유형": "연속 악화", "대상 항목": "수온" },
  ],
}
// T-A4 는 "사람은 이상이라 했지만 플랫폼은 못 잡는" 사례 자리다(놓침이 셈에 들어가는지 확인).

/** 임시 폴더에 원본·계획·설정을 만들고 사례 묶음을 생성한다. */
function setup(configPatch = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sta-test-"))
  const cases = path.join(dir, "cases"), out = path.join(dir, "out")
  const source = path.join(dir, "source.csv"), plan = path.join(dir, "plan.json"), config = path.join(dir, "config.json")
  writeFileSync(source, syntheticSource())
  writeFileSync(plan, JSON.stringify(PLAN))
  writeFileSync(config, JSON.stringify({
    ...BASE_CONFIG, "기준_재현율": 0.75, "최소_사례수": { "이상": 0, "정상": 0 }, ...configPatch,
  }))
  const built = run("build-cases.mjs", ["--source", `시험용=${source}`, "--plan", plan, "--cases", cases])
  assert.equal(built.status, 0, built.stderr)
  return { dir, cases, out, config, evalArgs: ["--cases", cases, "--out", out, "--config", config] }
}

test("셈법: 혼동행렬·지표·기준 판정", () => {
  const rows = [
    ...Array(27).fill({ "정답": "이상", "판정": "이상" }), ...Array(3).fill({ "정답": "이상", "판정": "정상" }),
    ...Array(2).fill({ "정답": "정상", "판정": "이상" }), ...Array(28).fill({ "정답": "정상", "판정": "정상" }),
  ]
  const s = summarize(rows)
  assert.deepEqual(s["혼동행렬"], { TP: 27, FN: 3, FP: 2, TN: 28 })
  assert.equal(s["재현율"], 0.9)
  assert.equal(s["정밀도"], 0.931)
  assert.equal(s["F1"], 0.9153)
  assert.equal(s["정확도"], 0.9167)
  assert.equal(s["오경보율"], 0.0667)
  assert.equal(verdict(s["혼동행렬"], 0.9), "적합")
  assert.equal(verdict(s["혼동행렬"], 0.91), "부적합")
  assert.equal(verdict(s["혼동행렬"], null), "보류(기준값 미설정)")
  assert.equal(ratio(1, 0), null)
  // 반올림으로 기준을 넘기지 않는다: 0.89996 → 표기는 0.9 지만 기준 0.9 에는 못 미친다.
  assert.equal(verdict({ TP: 22499, FN: 2501, FP: 0, TN: 0 }, 0.9), "부적합")
})

test("주입: 계단·경사·구간", () => {
  const t = (s) => parseTime(s)
  const step = { "종류": "계단", "시각": "2024-07-01T10:00", "크기": -2 }
  assert.equal(injectionOffset(step, t("2024-07-01T09:59")), 0)
  assert.equal(injectionOffset(step, t("2024-07-01T10:00")), -2)
  const ramp = { "종류": "경사", "시작": "2024-07-01T00:00", "끝": "2024-07-01T10:00", "크기": 5 }
  assert.equal(injectionOffset(ramp, t("2024-07-01T05:00")), 2.5)
  assert.equal(injectionOffset(ramp, t("2024-07-02T00:00")), 5)
  const span = { "종류": "구간", "시작": "2024-07-01T00:00", "끝": "2024-07-01T10:00", "크기": 1 }
  assert.equal(injectionOffset(span, t("2024-07-01T11:00")), 0)
})

test("① 판정 결과가 고정값과 같고 ② 재계산이 최종값과 일치한다", (t) => {
  const s = setup()
  t.after(() => rmSync(s.dir, { recursive: true, force: true }))

  const ev = run("eval-anomaly.mjs", s.evalArgs)
  assert.equal(ev.status, 0, ev.stdout + ev.stderr)
  assert.equal(ev.stderr, "", "경고 없이 조용히 끝나야 한다")

  const { rows } = parseCsv(readFileSync(path.join(s.out, "02_사례별_결과.csv"), "utf8"))
  const got = Object.fromEntries(rows.map(r => [r["사례ID"], [r["판정"], r["구분"], r["판정 항목·종류"]]]))
  assert.deepEqual(got, {
    "T-A1": ["이상", "TP", "DO:임계(warning); DO:surge(warning)"],
    "T-A2": ["이상", "TP", "pH:임계(warning); pH:surge(danger)"],
    "T-A3": ["이상", "TP", "DO:임계(warning); DO:drift(warning)"],
    "T-A4": ["정상", "FN", ""],
    "T-N1": ["정상", "TN", ""],
    "T-N2": ["이상", "FP", "염도:surge(warning)"],
  })

  const json = JSON.parse(readFileSync(path.join(s.out, "03_최종결과.json"), "utf8"))
  assert.deepEqual(json["최종값"]["전체"]["혼동행렬"], { TP: 3, FN: 1, FP: 1, TN: 1 })
  assert.equal(json["최종값"]["전체"]["재현율"], 0.75)
  assert.deepEqual(json["최종값"]["출처별"]["실측"]["혼동행렬"], { TP: 0, FN: 1, FP: 0, TN: 1 })
  assert.deepEqual(json["최종값"]["출처별"]["모사"]["혼동행렬"], { TP: 3, FN: 0, FP: 1, TN: 0 })
  assert.equal(json["판정"], "적합")
  assert.deepEqual(json["참고"]["대상항목_탐지율"], { "분자": 3, "분모": 4, "값": 0.75 })
  if (json["참고"]["웹_장비_추세판정_일치율"] !== "미실행") {
    assert.equal(json["참고"]["웹_장비_추세판정_일치율"]["값"], 1, "같은 사례에서 장비와 웹의 추세 판정이 같다")
  }

  const re = run("recompute.mjs", ["--out", s.out])
  assert.equal(re.status, 0, re.stdout + re.stderr)
  assert.match(readFileSync(path.join(s.out, "04_재계산_결과.txt"), "utf8"), /결과: 일치/)

  // 같은 입력이면 같은 결과(사례별 CSV 가 바이트 단위로 같다).
  const first = readFileSync(path.join(s.out, "02_사례별_결과.csv"))
  assert.equal(run("eval-anomaly.mjs", s.evalArgs).status, 0)
  assert.deepEqual(readFileSync(path.join(s.out, "02_사례별_결과.csv")), first)

  // 사례별 결과 한 줄을 고치면 재계산이 불일치로 끝난다.
  const csvFile = path.join(s.out, "02_사례별_결과.csv")
  writeFileSync(csvFile, readFileSync(csvFile, "utf8").replace("T-A4,실측,이상,연속 악화,수온,정상", "T-A4,실측,이상,연속 악화,수온,이상"))
  const bad = run("recompute.mjs", ["--out", s.out])
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /결과: 불일치/)
})

test("순차 판정: 구간 중간에 잡히면 그 시각에서 멈춘다", (t) => {
  const s = setup({ "판정_방식": "순차" })
  t.after(() => rmSync(s.dir, { recursive: true, force: true }))
  const ev = run("eval-anomaly.mjs", s.evalArgs)
  assert.ok([0, 1].includes(ev.status), ev.stdout + ev.stderr)
  const { rows } = parseCsv(readFileSync(path.join(s.out, "02_사례별_결과.csv"), "utf8"))
  const a1 = rows.find(r => r["사례ID"] === "T-A1")
  assert.equal(a1["판정"], "이상")
  assert.equal(a1["판정 시각"], "2024-07-05T22:00:00+09:00")
  assert.equal(rows.find(r => r["사례ID"] === "T-N1")["판정"], "정상")
  assert.equal(run("recompute.mjs", ["--out", s.out]).status, 0)
})

test("③ 기준값이 없으면 보류(2), 사례·시험 대상이 바뀌면 중단(3)", (t) => {
  const s = setup({ "기준_재현율": null })
  t.after(() => rmSync(s.dir, { recursive: true, force: true }))
  const hold = run("eval-anomaly.mjs", s.evalArgs)
  assert.equal(hold.status, 2)
  assert.match(hold.stdout, /보류\(기준값 미설정\)/)
  assert.equal(run("recompute.mjs", ["--out", s.out]).status, 0)

  // 사례 시계열을 한 글자 고치면 sha256 대조에서 멈춘다.
  const f = path.join(s.cases, "series", "T-N1.csv")
  writeFileSync(f, readFileSync(f, "utf8").replace("28.00", "28.01"))
  const tampered = run("eval-anomaly.mjs", s.evalArgs)
  assert.equal(tampered.status, 3)
  assert.match(tampered.stderr, /sha256 불일치/)

  // 시험 대상 해시가 설정과 다르면 멈춘다.
  const cfg = JSON.parse(readFileSync(s.config, "utf8"))
  cfg["시험대상_sha256"]["lib/thresholds.ts"] = "0".repeat(64)
  writeFileSync(s.config, JSON.stringify(cfg))
  const moved = run("eval-anomaly.mjs", s.evalArgs)
  assert.equal(moved.status, 3)
  assert.match(moved.stdout, /시험 대상 파일이 고정한 해시와 다릅니다/)
})
