// 엔진 1(생육 성장곡선) 자체검증 — 구현이 설계대로이고 참조 구현과 같은 수를
// 내는지 확인한다. raspberry-pi/verify.py 와 같은 역할이다.
//
//   node scripts/growth/verify.mjs
//   node scripts/growth/verify.mjs --daily <daily_tank_dataset.csv> \
//                                  --growth <GrowthSamples.csv>
//
// 테스트 프레임워크를 들이지 않는다(이 저장소에 없다). Node 22 의 기본 타입
// 스트리핑으로 lib/growth 의 .ts 를 그대로 불러 쓰므로 새 의존성도 없다.
//
// 검증은 두 층이다.
//
//   (가) 자체 검사 — 데이터가 필요 없다. 누구나 돌릴 수 있어야 한다.
//        알려진 {Winf,b,k} 로 만든 곡선에서 b·k 를 되찾는지, 예측과 역산이
//        서로 뒤집히는지, 결측·빈 입력·표본 1건·ABW>=Winf 에서 죽지 않고
//        이유를 돌려주는지.
//
//   (나) 실데이터 대조 — 참조 구현
//        scripts/analysis/growth_curve_feasibility.py 와 같은 수를 내는지.
//        데이터 파일은 저장소에 없다(단일 농가 운영 기록). 경로를 주지 않으면
//        (나)는 건너뛰고 (가)만 돈다.
//
// 기대값(참조 구현이 낸 값, 7.5 g 이상 · Winf 25 g · 홀드아웃 앞 70%→뒤 30%)
//        수조 5개 평균 MAE 0.90 g · 수조 {1,2,3} 평균 0.99 g
// 허용 오차 ±0.1 g.

import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"

// lib/growth 안쪽의 import 는 확장자가 없다 — tsconfig 의 moduleResolution
// "bundler" 가 그 형태를 쓰고, 거기에 .ts 를 붙이면 allowImportingTsExtensions
// 없이는 tsc 가 거부한다. Node 는 반대로 확장자를 요구하므로, 그 한 칸의 차이를
// 여기서 메운다. **제품 코드를 검증 도구에 맞춰 바꾸지 않는다.**
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        // 확장자를 붙여서 못 찾으면 원래 지정자로 되돌린다.
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  cumulativeDegreeDays,
  fitGompertz,
  predictAbw,
  cddForAbw,
  meanAbsoluteErrorG,
  DEFAULT_WINF_G,
  STANZA_BREAK_G,
} = await import("../../lib/growth/index.ts")

// 참조 구현과 같은 분할·하한. growth_curve_feasibility.py 의 상수와 맞춘다.
const TRAIN_FRACTION = 0.7
const MIN_TRAIN_FIXED = 3
const MIN_TEST_POINTS = 2
const MAE_TOLERANCE_G = 0.1
const EXPECTED_MAE_ALL = 0.9
const EXPECTED_MAE_123 = 0.99

const fails = []
let checks = 0

function check(label, ok, detail = "") {
  checks++
  if (!ok) fails.push(label)
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `\n        ${detail}`}`)
}

function checkEqual(label, got, want) {
  check(label, got === want, `받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`)
}

function checkClose(label, got, want, tol) {
  const ok = typeof got === "number" && Number.isFinite(got) && Math.abs(got - want) <= tol
  check(label, ok, `받음 ${got} / 기대 ${want} ±${tol}`)
}

// ── (가) 자체 검사 ────────────────────────────────────────────────────────

function curve(winfG, b, k, xs) {
  return xs.map((cdd) => ({ cdd, abwG: winfG * Math.exp(-b * Math.exp(-k * cdd)) }))
}

function selfChecks() {
  console.log("\n[가] 자체 검사 — 데이터 없이 돈다\n")

  // 1. 알려진 곡선에서 b·k 를 되찾는다. 우리 데이터와 같은 축 범위·중량대를 쓴다.
  //    (적산수온 1800~5400, ABW 7.5~23 g)
  {
    const winfG = 25
    const b = 4.2
    const k = 0.0007
    const xs = [1800, 2300, 2800, 3300, 3800, 4300, 4800, 5300]
    const fit = fitGompertz(curve(winfG, b, k, xs), { winfG })
    checkEqual("1-1 알려진 곡선 적합 성공", fit.failure, null)
    checkEqual("1-2 적합에 쓴 표본 수", fit.n, xs.length)
    checkClose("1-3 b 복원", fit.params?.b, b, 1e-6)
    checkClose("1-4 k 복원", fit.params?.k, k, 1e-9)
    checkClose("1-5 학습 MAE 는 0 에 가깝다", fit.trainMaeG, 0, 1e-6)
    checkEqual("1-6 제외된 표본 없음", fit.excluded.length, 0)
  }

  // 2. 구간 필터를 끄면 7.5 g 아래도 쓴다. 켜면 그 표본이 이유와 함께 빠진다.
  {
    const winfG = 25
    const b = 5.5
    const k = 0.0009
    const pts = curve(winfG, b, k, [500, 900, 1400, 2000, 2600, 3300, 4000, 4800])
    const below = pts.filter((p) => p.abwG < STANZA_BREAK_G).length
    check("2-0 시험 곡선에 7.5 g 아래 표본이 있다", below > 0, `아래 표본 ${below}건`)

    const open = fitGompertz(pts, { winfG, stanzaBreakG: null })
    checkEqual("2-1 구간 필터 끄면 전 표본 사용", open.n, pts.length)
    checkClose("2-2 구간 필터 끄고 k 복원", open.params?.k, k, 1e-9)

    const gated = fitGompertz(pts, { winfG })
    checkEqual("2-3 구간 필터 켜면 7.5 g 아래 제외", gated.n, pts.length - below)
    checkEqual(
      "2-4 제외 이유가 below_stanza_break",
      gated.excluded.every((e) => e.reason === "below_stanza_break"),
      true,
    )
    checkEqual("2-5 제외된 표본의 입력 위치를 알려준다", gated.excluded[0]?.index, 0)
    // 같은 곡선이므로 구간을 끊어도 같은 파라미터가 나와야 한다.
    checkClose("2-6 구간을 끊어도 같은 k", gated.params?.k, k, 1e-9)
  }

  // 3. 예측 ↔ 역산이 서로 뒤집힌다.
  {
    const params = { winfG: 25, b: 4.2, k: 0.0007 }
    for (const target of [8, 12, 17.5, 22, 24.9]) {
      const inv = cddForAbw(params, target)
      checkEqual(`3-1 역산 성공 (${target} g)`, inv.failure, null)
      checkClose(`3-2 역산→예측 왕복 (${target} g)`, predictAbw(params, inv.cdd), target, 1e-9)
    }
    for (const cdd of [1500, 3000, 5000]) {
      const w = predictAbw(params, cdd)
      checkClose(`3-3 예측→역산 왕복 (${cdd} ℃·일)`, cddForAbw(params, w).cdd, cdd, 1e-6)
    }
    // 예측은 적산수온에 대해 단조증가한다. 역산이 성립하는 전제다.
    const seq = [1000, 2000, 3000, 4000, 5000].map((x) => predictAbw(params, x))
    checkEqual(
      "3-4 예측은 단조증가",
      seq.every((v, i) => i === 0 || v > seq[i - 1]),
      true,
    )
  }

  // 4. 역산이 못 하는 경우를 이유로 돌려준다.
  {
    const params = { winfG: 25, b: 4.2, k: 0.0007 }
    checkEqual("4-1 목표가 Winf 이상", cddForAbw(params, 25).failure, "target_at_or_above_winf")
    checkEqual("4-2 목표가 Winf 초과", cddForAbw(params, 40).failure, "target_at_or_above_winf")
    checkEqual("4-3 목표가 0", cddForAbw(params, 0).failure, "target_not_positive")
    checkEqual("4-4 목표가 음수", cddForAbw(params, -5).failure, "target_not_positive")
    checkEqual("4-5 목표가 NaN", cddForAbw(params, NaN).failure, "target_not_positive")
    checkEqual("4-6 k 가 0", cddForAbw({ winfG: 25, b: 4, k: 0 }, 20).failure, "invalid_params")
    checkEqual("4-7 b 가 음수", cddForAbw({ winfG: 25, b: -4, k: 0.001 }, 20).failure, "invalid_params")
    // 축 원점보다 앞서 도달하는 목표는 음수로 돌려준다 — 0 으로 자르지 않는다.
    const early = cddForAbw({ winfG: 25, b: 0.2, k: 0.0007 }, 8)
    checkEqual("4-8 원점 이전 도달은 음수로 돌려준다", early.failure === null && early.cdd < 0, true)
  }

  // 5. 적합이 못 하는 경우에 죽지 않고 이유를 돌려준다.
  {
    const winfG = 25
    checkEqual("5-1 빈 입력", fitGompertz([], { winfG }).failure, "no_samples")
    checkEqual(
      "5-2 표본 1건",
      fitGompertz([{ cdd: 3000, abwG: 12 }], { winfG }).failure,
      "insufficient_samples",
    )
    checkEqual(
      "5-3 표본 2건 (하한 3 미만)",
      fitGompertz([{ cdd: 3000, abwG: 12 }, { cdd: 3500, abwG: 14 }], { winfG }).failure,
      "insufficient_samples",
    )
    const flat = fitGompertz(
      [{ cdd: 3000, abwG: 12 }, { cdd: 3000, abwG: 13 }, { cdd: 3000, abwG: 14 }],
      { winfG },
    )
    checkEqual("5-4 적산수온이 전부 같으면 degenerate_axis", flat.failure, "degenerate_axis")
    checkEqual("5-5 Winf 가 0", fitGompertz(curve(25, 4, 7e-4, [1800, 2800, 3800]), { winfG: 0 }).failure, "invalid_winf")
    checkEqual(
      "5-6 7.5 g 아래만 들어오면 no_samples",
      fitGompertz([{ cdd: 1000, abwG: 1 }, { cdd: 1500, abwG: 2 }, { cdd: 2000, abwG: 3 }], { winfG }).failure,
      "no_samples",
    )
  }

  // 6. 결측·비정상 표본을 조용히 떨어뜨리지 않는다.
  {
    const winfG = 25
    const good = curve(winfG, 4.2, 0.0007, [1800, 2600, 3400, 4200, 5000])
    const dirty = [
      ...good,
      { cdd: NaN, abwG: 15 },
      { cdd: 3000, abwG: null },
      { cdd: 3200, abwG: 0 },
      { cdd: 3400, abwG: -2 },
    ]
    const fit = fitGompertz(dirty, { winfG })
    checkEqual("6-1 결측이 섞여도 적합 성공", fit.failure, null)
    checkEqual("6-2 성한 표본만 썼다", fit.n, good.length)
    checkEqual("6-3 제외된 표본 수", fit.excluded.length, 4)
    checkEqual(
      "6-4 제외 이유 목록",
      fit.excluded.map((e) => e.reason).join(","),
      "not_finite,not_finite,abw_not_positive,abw_not_positive",
    )
    checkClose("6-5 결측이 있어도 k 복원", fit.params?.k, 0.0007, 1e-9)
  }

  // 7. ABW >= Winf 표본 — 버리지도, 조용히 넘기지도 않는다.
  //    보정(기본)을 쓰면 원 공간에서 적합에 쓰고, 끄면 excluded 로 돌려준다.
  //    어느 쪽이든 atOrAboveWinfCount 로 "Winf 를 올려라" 신호를 보낸다.
  {
    const winfG = 20
    const pts = [
      // Winf 20 g 아래에 머무는 네 점(생성 곡선의 Winf 는 25 g 이다).
      ...curve(25, 4.2, 0.0007, [1800, 2500, 3200, 3900]),
      { cdd: 5200, abwG: 21.5 },
      { cdd: 5600, abwG: 22.4 },
    ]
    const refined = fitGompertz(pts, { winfG })
    checkEqual("7-1 보정 켜면 적합 성공", refined.failure, null)
    checkEqual("7-2 Winf 이상 표본 수를 알린다", refined.atOrAboveWinfCount, 2)
    checkEqual("7-3 보정 켜면 그 표본도 적합에 쓴다", refined.n, pts.length)
    checkEqual("7-4 보정 켜면 excluded 에 없다", refined.excluded.length, 0)

    const plain = fitGompertz(pts, { winfG, refine: false })
    checkEqual("7-5 보정 끄면 Winf 이상 표본 제외", plain.n, pts.length - 2)
    checkEqual("7-6 보정 끄면 이유를 남긴다", plain.excluded.map((e) => e.reason).join(","), "abw_at_or_above_winf,abw_at_or_above_winf")
    checkEqual("7-7 보정 꺼도 신호는 같다", plain.atOrAboveWinfCount, 2)

    // 전 표본이 Winf 이상이면 적합할 것이 없다 — 이유를 돌려준다.
    const allAbove = fitGompertz(
      [{ cdd: 4000, abwG: 26 }, { cdd: 4500, abwG: 27 }, { cdd: 5000, abwG: 28 }],
      { winfG: 25, refine: false },
    )
    checkEqual("7-8 전 표본이 Winf 이상 (보정 끔)", allAbove.failure, "no_samples")
    checkEqual("7-9 그때도 신호는 센다", allAbove.atOrAboveWinfCount, 3)
  }

  // 8. 적산수온 축 — 수온이 없는 날은 그 수조의 평균 증분으로 메운다.
  {
    // 20, 결측, 30 → 평균 증분 25 로 메워 누적 20, 45, 75.
    const axis = cumulativeDegreeDays([
      { date: "2024-03-12", waterTempC: 20 },
      { date: "2024-03-13", waterTempC: null },
      { date: "2024-03-14", waterTempC: 30 },
    ])
    checkEqual("8-1 메운 날 수", axis.filledDays, 1)
    checkEqual("8-2 관측된 날 수", axis.observedDays, 2)
    checkClose("8-3 메울 때 쓴 증분", axis.fillIncrementC, 25, 1e-12)
    checkEqual("8-4 누적값", axis.points.map((p) => p.cdd).join(","), "20,45,75")
    checkClose("8-5 날짜로 조회", axis.byDate.get("2024-03-14"), 75, 1e-12)

    // 0 으로 두면 45 가 아니라 20 이 되고, 행을 버리면 2일치 축이 된다.
    check("8-6 결측을 0 으로 두지 않았다", axis.points[1].cdd !== 20, `받음 ${axis.points[1].cdd}`)
    checkEqual("8-7 결측 행을 버리지 않았다", axis.points.length, 3)

    // 입력 순서를 믿지 않는다.
    const shuffled = cumulativeDegreeDays([
      { date: "2024-03-14", waterTempC: 30 },
      { date: "2024-03-12", waterTempC: 20 },
      { date: "2024-03-13", waterTempC: null },
    ])
    checkEqual("8-8 입력 순서가 섞여도 같은 축", shuffled.points.map((p) => p.cdd).join(","), "20,45,75")

    checkEqual("8-9 빈 입력", cumulativeDegreeDays([]).points.length, 0)
    const allNull = cumulativeDegreeDays([
      { date: "2024-03-12", waterTempC: null },
      { date: "2024-03-13", waterTempC: undefined },
    ])
    checkEqual("8-10 수온이 전부 결측이면 축을 만들지 않는다", allNull.fillIncrementC, null)
    checkEqual("8-11 그때 points 는 빈 배열", allNull.points.length, 0)

    // 음수 증분은 0 으로 자른다 — 적산이 거꾸로 흐르면 역산이 성립하지 않는다.
    const negative = cumulativeDegreeDays([
      { date: "2024-03-12", waterTempC: 20 },
      { date: "2024-03-13", waterTempC: -5 },
    ])
    checkEqual("8-12 음수 증분은 0 으로 자른다", negative.points.map((p) => p.cdd).join(","), "20,20")

    // ISO 타임스탬프와 날짜 문자열이 같은 키로 모인다.
    const iso = cumulativeDegreeDays([{ date: "2024-03-12T09:30:00Z", waterTempC: 20 }])
    checkEqual("8-13 ISO 타임스탬프도 날짜 키로 모은다", iso.byDate.get("2024-03-12"), 20)

    // 기준온도를 넘기면 차감한다 — 기본은 0(차감 없음)이다.
    const based = cumulativeDegreeDays([{ date: "2024-03-12", waterTempC: 20 }], { baseTempC: 15 })
    checkEqual("8-14 기준온도 차감은 인자로만 (기본 0)", based.points[0].cdd, 5)
  }

  // 9. MAE 는 돌려주지만 R² 는 내보내지 않는다(설계 규칙 5).
  {
    const params = { winfG: 25, b: 4.2, k: 0.0007 }
    const pts = curve(25, 4.2, 0.0007, [2000, 3000, 4000]).map((p) => ({ ...p, abwG: p.abwG + 1 }))
    checkClose("9-1 MAE 계산", meanAbsoluteErrorG(params, pts).maeG, 1, 1e-9)
    checkEqual("9-2 빈 입력이면 null", meanAbsoluteErrorG(params, []).maeG, null)
    checkEqual("9-3 결측은 n 에서 뺀다", meanAbsoluteErrorG(params, [{ cdd: NaN, abwG: 12 }]).n, 0)
  }

  // 10. 기본값이 설계 규칙 1·2 를 둘 다 적용한 상태다.
  checkEqual("10-1 기본 Winf 는 25 g", DEFAULT_WINF_G, 25)
  checkEqual("10-2 기본 구간 경계는 7.5 g", STANZA_BREAK_G, 7.5)
  {
    const pts = curve(25, 4.2, 0.0007, [1800, 2600, 3400, 4200, 5000])
    const withDefaults = fitGompertz(pts)
    checkEqual("10-3 인자 없이 호출해도 적합된다", withDefaults.failure, null)
    checkClose("10-4 그때 Winf 는 25 g 로 고정", withDefaults.params?.winfG, 25, 0)
  }
}

// ── (나) 실데이터 대조 ────────────────────────────────────────────────────

/** 따옴표를 처리하는 최소 CSV 파서. GrowthSamples 의 notes 에 쉼표가 들어온다. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = [] }
    else if (c !== "\r") field += c
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row) }
  if (rows.length === 0) return []
  const header = rows[0]
  return rows.slice(1)
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

const num = (v) => (v === undefined || v === null || v.trim() === "" ? null : Number(v))

function realDataChecks(dailyPath, growthPath) {
  console.log("\n[나] 실데이터 대조 — 참조 구현과 같은 수를 내는지\n")

  const daily = parseCsv(readFileSync(dailyPath, "utf8"))
  const growth = parseCsv(readFileSync(growthPath, "utf8"))
  const tanks = [...new Set(daily.map((r) => r.tank_id))]
    .filter((t) => growth.some((g) => g.tank_id === t))
    .sort((a, b) => Number(a) - Number(b))

  console.log(`  수조 ${tanks.length}개 · 일별 ${daily.length}행 · 성장 실측 ${growth.length}건`)
  const trainPct = Math.round(TRAIN_FRACTION * 100)
  console.log(`  처방: ${STANZA_BREAK_G} g 이상 · Winf ${DEFAULT_WINF_G} g 고정 · 앞 ${trainPct}% → 뒤 ${100 - trainPct}%\n`)
  console.log(`  ${"수조".padStart(4)} ${"n".padStart(3)} ${"MAE(g)".padStart(8)} ${"마지막 실측".padStart(12)} ${"예측".padStart(8)}   메움 · 방법`)

  const maeByTank = new Map()
  for (const tank of tanks) {
    // 축은 그 수조의 일별 수온 전체로 만든다 — 성장 실측이 있는 날만 쓰면
    // 적산이 끊긴다.
    const axis = cumulativeDegreeDays(
      daily.filter((r) => r.tank_id === tank)
        .map((r) => ({ date: r.date, waterTempC: num(r.water_temperature_c_mean) })),
    )

    const points = growth.filter((g) => g.tank_id === tank)
      .map((g) => ({ cdd: axis.byDate.get(g.date.slice(0, 10)), abwG: num(g.body_weight_g) }))
      .filter((p) => p.cdd !== undefined && p.abwG !== null)
      // 참조 구현은 7.5 g 필터를 분할 **전에** 걸고 적산수온으로 정렬한다.
      .filter((p) => p.abwG >= STANZA_BREAK_G)
      .sort((a, b) => a.cdd - b.cdd)

    const cut = Math.floor(points.length * TRAIN_FRACTION)
    const train = points.slice(0, cut)
    const test = points.slice(cut)
    if (cut < MIN_TRAIN_FIXED) {
      console.log(`  ${String(tank).padStart(4)} ${String(points.length).padStart(3)}   제외 — 학습 ${cut}건<${MIN_TRAIN_FIXED}`)
      continue
    }
    if (test.length < MIN_TEST_POINTS) {
      console.log(`  ${String(tank).padStart(4)} ${String(points.length).padStart(3)}   제외 — 예측 ${test.length}건<${MIN_TEST_POINTS}`)
      continue
    }

    const fit = fitGompertz(train, { winfG: DEFAULT_WINF_G })
    if (fit.params === null) {
      console.log(`  ${String(tank).padStart(4)} ${String(points.length).padStart(3)}   제외 — ${fit.failure}`)
      continue
    }

    const { maeG } = meanAbsoluteErrorG(fit.params, test)
    maeByTank.set(tank, maeG)
    const last = test[test.length - 1]
    console.log(
      `  ${String(tank).padStart(4)} ${String(points.length).padStart(3)} ${maeG.toFixed(2).padStart(8)}` +
      ` ${last.abwG.toFixed(1).padStart(12)} ${predictAbw(fit.params, last.cdd).toFixed(1).padStart(8)}` +
      `   ${axis.filledDays}일 · ${fit.method}(${fit.iterations})`,
    )
  }

  const mean = (keys) => {
    const vals = keys.filter((t) => maeByTank.has(t)).map((t) => maeByTank.get(t))
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }

  const all = [...maeByTank.keys()]
  const t123 = tanks.filter((t) => ["1", "2", "3"].includes(String(t)))

  console.log("")
  checkEqual("나-1 전 수조에서 적합이 수렴한다", all.length, tanks.length)
  checkClose(`나-2 수조 ${tanks.length}개 평균 MAE`, mean(all), EXPECTED_MAE_ALL, MAE_TOLERANCE_G)
  checkClose(`나-3 수조 {1,2,3} 평균 MAE`, mean(t123), EXPECTED_MAE_123, MAE_TOLERANCE_G)
  console.log(`\n  전 수조 평균 ${mean(all)?.toFixed(3)} g (기대 ${EXPECTED_MAE_ALL}) · {1,2,3} 평균 ${mean(t123)?.toFixed(3)} g (기대 ${EXPECTED_MAE_123})`)
}

// ── 실행 ─────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

console.log("=".repeat(76))
console.log("엔진 1 생육 성장곡선 자체검증 — lib/growth")
console.log("=".repeat(76))

selfChecks()

const dailyPath = arg("daily")
const growthPath = arg("growth")
if (dailyPath && growthPath) {
  realDataChecks(dailyPath, growthPath)
} else {
  console.log("\n[나] 건너뜀 — --daily 와 --growth 를 주면 참조 구현과 대조한다.")
  console.log("     데이터는 저장소에 없다(단일 농가 운영 기록). 경로는 작업 지시서에 있다.")
}

console.log("\n" + "=".repeat(76))
if (fails.length === 0) {
  console.log(`전부 통과 — ${checks}항목`)
} else {
  console.log(`실패 ${fails.length}/${checks}항목`)
  for (const f of fails) console.log(`  · ${f}`)
}
console.log("=".repeat(76))
process.exit(fails.length === 0 ? 0 : 1)
