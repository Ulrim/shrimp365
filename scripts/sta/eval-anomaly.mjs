#!/usr/bin/env node
// STA 시험 — 수질 이상징후 탐지 정확도 측정.
//
//   node scripts/sta/eval-anomaly.mjs [--cases <사례 폴더>] [--out <결과 폴더>]
//                                     [--config <설정 파일>] [--no-device]
//
// 하는 일
//   1. 시험 대상(lib/thresholds.ts)·사례 파일의 sha256 을 확인한다.
//   2. 사례마다 플랫폼 판정 함수(checkThresholds + detectTrendAnomalies)를 그대로 부른다.
//   3. 사례별 결과 CSV 와 최종 결과 JSON 을 쓴다.
// 판정 로직은 이 파일에 없다. 기준값·셈법은 sta.config.json 에서 받는다.
//
// 종료 코드: 0 적합 · 1 부적합 · 2 보류(기준값 미설정·사례 수 부족) · 3 실행 오류

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "./lib/args.mjs"
import { toCsv } from "./lib/csv.mjs"
import { loadCases, sha256File, formatTime, FIELD_COLUMNS } from "./lib/cases.mjs"
import { loadPlatform, judgeCase, describe } from "./lib/judge.mjs"
import { summarizeAll, verdict, ratio } from "./lib/metrics.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")

export const RESULT_HEADER = [
  "사례ID", "출처", "정답", "이상 유형", "대상 항목",
  "판정", "판정 항목·종류", "구분", "일치(0/1)", "판정 시각", "표본수(건)",
  "대상 항목 탐지(0/1)", "참고: 플랫폼 판정 전체",
  "참고: 장비 추세 판정", "참고: 웹-장비 추세 일치(0/1)",
]

const lines = []
function log(text = "") {
  for (const l of String(text).split("\n")) { lines.push(l); console.log(l) }
}

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : null
}

/** 장비 판정(raspberry-pi/sta_eval.py → anomaly.detect)을 한 번에 돌린다. 못 돌리면 null. */
function runDevice(requests, tz) {
  const script = path.join(ROOT, "raspberry-pi", "sta_eval.py")
  const input = JSON.stringify({ "시간대": tz, "사례": requests })
  for (const exe of ["python3", "python"]) {
    const r = spawnSync(exe, [script], {
      input, encoding: "utf8", maxBuffer: 1 << 28,
      env: { ...process.env, TZ: tz, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    })
    if (r.error || r.status !== 0) continue
    try { return { exe, ...JSON.parse(r.stdout) } } catch { /* 다음 후보 */ }
  }
  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    cases: "value", out: "value", config: "value", "no-device": "flag",
  })
  const configFile = path.resolve(args.config ?? path.join(HERE, "sta.config.json"))
  const config = JSON.parse(readFileSync(configFile, "utf8"))
  const casesDir = path.resolve(args.cases ?? path.join(HERE, "cases"))
  const outDir = path.resolve(args.out ?? path.join(ROOT, "sta_AI데이터"))

  // 날짜 경계(일별 극값)가 시험 PC 의 시간대에 따라 달라지지 않게 고정한다.
  // Date 를 처음 쓰기 전에 정해야 한다.
  process.env.TZ = config["시간대"]

  const started = Date.now()
  log("══════════════════════════════════════════════════════════════")
  log(` STA 시험 — ${config["시험항목"]}`)
  log(` 시험 대상: ${config["시험대상_SW"]}`)
  log("══════════════════════════════════════════════════════════════")
  log(`실행 시각: ${formatTime(started)}`)
  log("")

  // ── 1. 시험 대상 고정 ────────────────────────────────────────────────
  log("[1/4] 시험 대상 확인")
  const commit = git(["rev-parse", "HEAD"])
  const targetHashes = {}
  let targetOk = true
  for (const [rel, want] of Object.entries(config["시험대상_sha256"])) {
    const got = sha256File(path.join(ROOT, rel))
    targetHashes[rel] = got
    const ok = got === want
    targetOk &&= ok
    log(`  ${ok ? "일치" : "불일치"}  ${rel}`)
    log(`        sha256 ${got}`)
    if (!ok) log(`        기대값 ${want}`)
  }
  const dirty = git(["status", "--porcelain", "--", ...Object.keys(config["시험대상_sha256"])])
  log(`  git 커밋: ${commit ?? "확인 불가(git 없음)"}`)
  log(`  시험 대상 파일의 미커밋 변경: ${dirty === null ? "확인 불가" : dirty === "" ? "없음" : "있음"}`)
  if (!targetOk) {
    log("\n시험 대상 파일이 고정한 해시와 다릅니다. 중단합니다.")
    return 3
  }
  const toolHashes = {}
  for (const rel of [
    "scripts/sta/eval-anomaly.mjs", "scripts/sta/recompute.mjs",
    "scripts/sta/lib/args.mjs", "scripts/sta/lib/cases.mjs", "scripts/sta/lib/csv.mjs",
    "scripts/sta/lib/judge.mjs", "scripts/sta/lib/metrics.mjs", "raspberry-pi/sta_eval.py",
  ]) toolHashes[rel] = sha256File(path.join(ROOT, rel))
  const configHash = sha256File(configFile)
  log("")

  // ── 2. 시험 사례 ─────────────────────────────────────────────────────
  log("[2/4] 시험 사례 확인")
  log(`  사례 폴더: ${casesDir}`)
  const { cases, hashChecks, hasSums } = loadCases(casesDir)
  if (!hasSums) {
    log("  sha256sums.txt 가 없습니다. 사례 파일을 고정할 수 없어 중단합니다.")
    return 3
  }
  log(`  sha256 대조: ${hashChecks.length}개 파일 모두 일치`)
  const count = { 이상: 0, 정상: 0, 실측: 0, 모사: 0 }
  for (const c of cases) { count[c.meta["정답"]]++; count[c.meta["출처"]]++ }
  log(`  사례 ${cases.length}건 — 이상 ${count.이상} · 정상 ${count.정상} (실측 ${count.실측} · 모사 ${count.모사})`)
  const min = config["최소_사례수"] ?? { 이상: 0, 정상: 0 }
  const enough = count.이상 >= (min.이상 ?? 0) && count.정상 >= (min.정상 ?? 0)
  if (!enough) log(`  ⚠ 사례 수 부족 — 이상 ${min.이상}건·정상 ${min.정상}건 이상이어야 합니다`)
  log("")

  // ── 3. 사례별 판정 ───────────────────────────────────────────────────
  log("[3/4] 사례별 판정 (플랫폼 함수 checkThresholds + detectTrendAnomalies 호출)")
  const platform = await loadPlatform(ROOT)
  const mode = config["판정_방식"]
  const grades = config["이상으로_세는_등급"]
  log(`  판정 방식: ${mode} · 이상으로 세는 등급: ${grades.join(", ")} · 조회 구간: ${config["조회구간_시간"]}시간 · 시간대: ${config["시간대"]}`)
  const labelToKey = Object.fromEntries(
    FIELD_COLUMNS.map(([, key]) => [platform.PARAM_LABELS[key] ?? key, key]))

  const judged = cases.map(c => ({
    c,
    j: judgeCase(platform, c.series, {
      mode, grades, windowHours: config["조회구간_시간"], profile: config["프로필"],
    }),
  }))

  // 참고: 같은 입력을 장비 판정(anomaly.py)에 넣는다.
  let device = null
  if (!args["no-device"]) {
    device = runDevice(judged.map(({ c, j }) => ({
      id: c.id,
      rows: j.rows.map(r => ({ t: r.t / 1000, ...r.values })),
    })), config["시간대"])
    if (!device) log("  (참고) 파이썬을 실행하지 못해 장비 판정 비교는 건너뜁니다")
    else if (device["시간대_오프셋_시"] !== 9) {
      log(`  (참고) 파이썬 시간대가 한국 표준시가 아닙니다(UTC${device["시간대_오프셋_시"] >= 0 ? "+" : ""}${device["시간대_오프셋_시"]}) — 장비 비교는 건너뜁니다`)
      device = null
    }
  }

  const rows = judged.map(({ c, j }) => {
    const truth = c.meta["정답"]
    const kind = truth === "이상" ? (j.판정 === "이상" ? "TP" : "FN") : (j.판정 === "이상" ? "FP" : "TN")
    // 대상 항목까지 맞췄는가(이상 사례만). 대상 항목은 라벨("DO") 또는 키("do_level"), ; 로 여럿.
    let targetHit = ""
    const targets = (c.meta["대상 항목"] ?? "").split(/[;,]/).map(s => s.trim()).filter(Boolean)
    if (truth === "이상" && targets.length) {
      const targetKeys = new Set(targets.map(t => labelToKey[t] ?? t))
      targetHit = j.근거.some(a => targetKeys.has(labelToKey[a.항목] ?? a.항목)) ? 1 : 0
    }
    let deviceText = "미실행", deviceSame = ""
    if (device) {
      const fields = new Set(device["판정_항목"])
      const dev = (device["결과"][c.id] ?? []).map(a => `${a.parameter}:${a.kind}:${a.type}`).sort()
      const web = j.전체.filter(a => a.종류 !== "임계")
        .map(a => ({ key: labelToKey[a.항목] ?? a.항목, a }))
        .filter(x => fields.has(x.key))
        .map(x => `${x.key}:${x.a.종류}:${x.a.등급}`).sort()
      deviceText = dev.length ? dev.join("; ") : "없음"
      deviceSame = JSON.stringify(dev) === JSON.stringify(web) ? 1 : 0
    }
    return {
      "사례ID": c.id, "출처": c.meta["출처"], "정답": truth,
      "이상 유형": c.meta["이상 유형"] ?? "", "대상 항목": c.meta["대상 항목"] ?? "",
      "판정": j.판정, "판정 항목·종류": describe(j.근거), "구분": kind,
      "일치(0/1)": truth === j.판정 ? 1 : 0,
      "판정 시각": formatTime(j.판정시각), "표본수(건)": j.rows.length,
      "대상 항목 탐지(0/1)": targetHit, "참고: 플랫폼 판정 전체": describe(j.전체),
      "참고: 장비 추세 판정": deviceText, "참고: 웹-장비 추세 일치(0/1)": deviceSame,
    }
  })

  for (const r of rows) {
    log(`  ${r["사례ID"].padEnd(8)} ${r["출처"]} 정답 ${r["정답"]} → 판정 ${r["판정"]}  ${r["구분"]}  ${r["판정 항목·종류"]}`)
  }
  log("")

  // ── 4. 최종값 ────────────────────────────────────────────────────────
  log("[4/4] 최종값")
  const final = summarizeAll(rows)
  const threshold = config["기준_재현율"]
  let result = verdict(final["전체"]["혼동행렬"], threshold)
  if (!enough && threshold !== null) result = "보류(사례 수 부족)"

  const show = (name, s) => {
    const m = s["혼동행렬"]
    log(`  ${name}: 사례 ${s["사례수"]["전체"]}건 (이상 ${s["사례수"]["이상"]} · 정상 ${s["사례수"]["정상"]})`)
    log(`      혼동행렬  TP ${m.TP} · FN ${m.FN} · FP ${m.FP} · TN ${m.TN}`)
    const v = (x) => x ?? "계산 불가(분모 0)"
    log(`      재현율 ${v(s["재현율"])} · 정밀도 ${v(s["정밀도"])} · F1 ${v(s["F1"])} · 정확도 ${v(s["정확도"])} · 오경보율 ${v(s["오경보율"])}`)
  }
  show("전체", final["전체"])
  show("실측", final["출처별"]["실측"])
  show("모사", final["출처별"]["모사"])

  const targeted = rows.filter(r => r["대상 항목 탐지(0/1)"] !== "")
  const compared = rows.filter(r => r["참고: 웹-장비 추세 일치(0/1)"] !== "")
  const byType = {}
  for (const r of rows.filter(r => r["정답"] === "이상")) {
    const t = r["이상 유형"] || "(미기재)"
    byType[t] ??= { "사례수": 0, "탐지수": 0 }
    byType[t]["사례수"]++
    if (r["판정"] === "이상") byType[t]["탐지수"]++
  }
  const reference = {
    "대상항목_탐지율": {
      "분자": targeted.filter(r => r["대상 항목 탐지(0/1)"] === 1).length,
      "분모": targeted.length,
      "값": ratio(targeted.filter(r => r["대상 항목 탐지(0/1)"] === 1).length, targeted.length),
    },
    "웹_장비_추세판정_일치율": device ? {
      "분자": compared.filter(r => r["참고: 웹-장비 추세 일치(0/1)"] === 1).length,
      "분모": compared.length,
      "값": ratio(compared.filter(r => r["참고: 웹-장비 추세 일치(0/1)"] === 1).length, compared.length),
    } : "미실행",
    "이상유형별_탐지": Object.fromEntries(Object.keys(byType).sort().map(k => [k, byType[k]])),
  }
  log(`  (참고) 대상 항목까지 맞춘 탐지: ${reference["대상항목_탐지율"]["분자"]}/${reference["대상항목_탐지율"]["분모"]}`)
  if (device) log(`  (참고) 웹-장비 추세 판정 일치: ${reference["웹_장비_추세판정_일치율"]["분자"]}/${reference["웹_장비_추세판정_일치율"]["분모"]}`)
  log("")
  log(`  판정 기준: 재현율 ${threshold === null ? "【미설정】" : threshold + " 이상"}`)
  log(`  측정값   : 재현율 ${final["전체"]["재현율"]} (TP ${final["전체"]["혼동행렬"].TP} / 이상 사례 ${final["전체"]["사례수"]["이상"]})`)
  log(`  판정     : ${result}`)
  log("")

  // ── 결과 묶음 쓰기 ───────────────────────────────────────────────────
  mkdirSync(outDir, { recursive: true })
  const dataDir = path.join(outDir, "01_시험데이터")
  rmSync(dataDir, { recursive: true, force: true })
  cpSync(casesDir, dataDir, { recursive: true })

  const hashText = [
    `시험 항목: ${config["시험항목"]}`,
    `시험 대상: ${config["시험대상_SW"]}`,
    `git 커밋: ${commit ?? "확인 불가"}`,
    `시험 대상 파일의 미커밋 변경: ${dirty === null ? "확인 불가" : dirty === "" ? "없음" : "있음"}`,
    "",
    "[시험 대상 코드 sha256]",
    ...Object.entries(targetHashes).map(([f, h]) => `${h}  ${f}`),
    "",
    "[시험 도구 sha256]",
    ...Object.entries(toolHashes).map(([f, h]) => `${h}  ${f}`),
    `${configHash}  ${path.relative(ROOT, configFile).split(path.sep).join("/")}`,
    "",
    "[시험 데이터 sha256]",
    `${sha256File(path.join(casesDir, "sha256sums.txt"))}  sha256sums.txt (사례 파일별 해시 목록 — 01_시험데이터/ 에 있음)`,
    ...hashChecks.filter(h => h.파일 === "cases.csv").map(h => `${h.sha256}  cases.csv`),
    "",
  ].join("\n")
  writeFileSync(path.join(outDir, "00_시험대상_해시.txt"), hashText, "utf8")
  writeFileSync(path.join(outDir, "02_사례별_결과.csv"), toCsv(RESULT_HEADER, rows), "utf8")

  const summary = {
    "시험항목": config["시험항목"],
    "시험대상_SW": config["시험대상_SW"],
    "판정기준": { "지표": "재현율", "기준값": threshold, "비교": "기준값 이상이면 적합" },
    "판정": result,
    "최종값": final,
    "참고": reference,
    "셈법": {
      "양성": "이상",
      "재현율": "TP / (TP + FN)", "정밀도": "TP / (TP + FP)",
      "F1": "2TP / (2TP + FP + FN)", "정확도": "(TP + TN) / 전체", "오경보율": "FP / (FP + TN)",
      "반올림": "소수 넷째 자리. 분모가 0 이면 null",
      "판정_방식": mode, "이상으로_세는_등급": grades,
      "조회구간_시간": config["조회구간_시간"], "프로필": config["프로필"],
      "판정_함수": "lib/thresholds.ts — checkThresholds(마지막 시각의 측정값) + detectTrendAnomalies(구간 시계열)",
    },
    "시험대상": {
      "git_커밋": commit, "미커밋_변경": dirty === null ? "확인 불가" : dirty === "" ? "없음" : "있음",
      "sha256": targetHashes,
    },
    "시험도구_sha256": { ...toolHashes, [path.relative(ROOT, configFile).split(path.sep).join("/")]: configHash },
    "시험데이터": {
      "사례수": count,
      "sha256sums.txt": sha256File(path.join(casesDir, "sha256sums.txt")),
      "cases.csv": sha256File(path.join(casesDir, "cases.csv")),
    },
    "실행환경": {
      "실행시각": formatTime(started),
      "소요시간(ms)": Date.now() - started,
      "OS": `${os.type()} ${os.release()} (${os.arch()})`,
      "CPU": `${os.cpus()[0]?.model ?? "?"} × ${os.cpus().length}`,
      "RAM(GB)": Math.round(os.totalmem() / 2 ** 30 * 10) / 10,
      "Node": process.version,
      "시간대": config["시간대"],
      "장비비교_파이썬": device ? device.exe : "미실행",
    },
  }
  writeFileSync(path.join(outDir, "03_최종결과.json"), JSON.stringify(summary, null, 2) + "\n", "utf8")

  log(`결과 폴더: ${outDir}`)
  log("  00_시험대상_해시.txt · 01_시험데이터/ · 02_사례별_결과.csv · 03_최종결과.json · 05_실행로그.txt")
  log(`소요 시간: ${((Date.now() - started) / 1000).toFixed(1)}초`)
  log("다음: node scripts/sta/recompute.mjs  (사례별 결과만으로 최종값 재계산)")
  writeFileSync(path.join(outDir, "05_실행로그.txt"), lines.join("\n") + "\n", "utf8")

  if (result === "적합") return 0
  if (result === "부적합") return 1
  return 2
}

main().then(code => { process.exitCode = code }).catch(err => {
  console.error(`\n실행 오류: ${err.message}`)
  process.exitCode = 3
})
