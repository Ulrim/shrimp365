// 출하 윈도우 엔진 자체검증 — 구현이 설계대로이고, **폐사를 빼먹지 않았고**,
// 농가 수취 단계가 아닌 단가로 수익을 계산하지 않는지 확인한다.
// scripts/growth/verify.mjs · scripts/profitability/verify.mjs ·
// scripts/pricing/verify.mjs 와 같은 방식·같은 역할이다.
//
//   node scripts/harvest/verify.mjs
//
// 테스트 프레임워크를 들이지 않는다(이 저장소에 없다). Node 22 의 타입
// 스트리핑으로 lib 의 .ts 를 그대로 불러 쓰므로 새 의존성도 없다.
// **데이터 파일이 필요 없다** — 천황수산 수치가 엔진 2·단가의 상수로 들어 있다.
//
// 검증은 여섯 층이다.
//
//   (가) **기본 동작** — 후보 생성, 날짜, 구간, 밴드, 한계 분석, 근거 분해
//   (나) **천황수산 조건** — 2주 더 키우면 이익이 얼마나 달라지나. **수를 박는다**
//   (다) **폐사** — 0 이면 항상 "더 키우라"가 나오고 경고가 붙는가.
//        높으면 "지금 출하"로 뒤집히는가. **뒤집히는 경계 폐사율은 몇 %인가**
//   (라) **단가 앵커 검문** — 소매 앵커가 막히거나 변환되는가. 그냥 통과하는 길
//        이 정말 없는가
//   (마) **경고 전파** — 관측 범위 밖 경고가 결과까지 올라오는가.
//        엔진 1·2·단가의 경고가 전부 합쳐져 나오는가
//   (바) **설계 규칙** — 점이 아니라 구간인가, 구분 불가가 나오는가, 계절 보정을
//        만들지 않았는가, 문장을 만들지 않는가, 0 으로 채우지 않는가
//
// (다)·(라)·(마)가 이 스크립트의 절반이다. 수가 맞는지는 (가)·(나)로 끝나는데,
// **수가 맞는 채로 조용히 틀리는 쪽**이 이 엔진의 실제 위험이다 — 폐사를 빼먹어
// 항상 "더 키우라" 고 말하거나, 소매 단가로 농가 수익을 1.9배 부풀리거나,
// 점으로 답해 사용자가 신뢰도를 모르게 하는 쪽.

import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

// lib 안쪽의 import 는 확장자가 없고(tsconfig 의 moduleResolution "bundler"),
// 디렉토리 간에는 "@/lib/..." 별칭을 쓴다(저장소 규약). Node 는 둘 다 모르므로
// 그 차이를 여기서 메운다. **제품 코드를 검증 도구에 맞춰 바꾸지 않는다.**
const ROOT = fileURLToPath(new URL("../../", import.meta.url))

registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = []
    if (specifier.startsWith("@/")) {
      const base = pathToFileURL(ROOT + specifier.slice(2)).href
      candidates.push(`${base}.ts`, `${base}/index.ts`, base)
    } else if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      candidates.push(`${specifier}.ts`, `${specifier}/index.ts`)
    }
    for (const candidate of candidates) {
      try {
        return nextResolve(candidate, context)
      } catch {
        // 다음 후보로.
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  CHEONHWANG_CYCLE_DAYS,
  CHEONHWANG_CYCLE_SURVIVAL_RATE,
  DEFAULT_DAILY_SURVIVAL_RATE,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_STEP_DAYS,
  abwAtDay,
  addDays,
  cddAtDay,
  dailySurvivalFlipPoint,
  dailySurvivalFromCycle,
  harvestWindow,
  harvestWindowBySurvival,
  hasExclusion,
  resolveDailySurvival,
  resolveHarvestAnchor,
  survivalOverDays,
} = await import("../../lib/harvest/index.ts")

const {
  DEFAULT_SIZE_ELASTICITY,
  FARM_PRICE_ANCHOR,
  FROZEN_SIZE_ELASTICITY,
  SIZE_ELASTICITY_BAND,
  anchorFromCountPerKg,
  estimateSizePrice,
} = await import("../../lib/pricing/index.ts")

const {
  DEFAULT_ELECTRICITY_KRW_PER_KWH,
  DEFAULT_FEED_KRW_PER_KG,
  ELECTRICITY_BILLED_KWH,
  ELECTRICITY_BILLED_KRW,
  computeCost,
} = await import("../../lib/profitability/index.ts")

const { fitGompertz, predictAbw } = await import("../../lib/growth/index.ts")

// ── 기대값 ────────────────────────────────────────────────────────────────
//
// **천황수산 2주 사례.** 아래 수는 모두 농가 기록에서 끌어온 입력으로 이
// 구현이 낸 결과이고, 한 번 박아 두면 다음 사람이 구현을 고쳤을 때 금액이
// 움직였는지 바로 안다.
//
//   입력 — 앵커 17,000 원/kg @ 28.571 g(35미/kg, 천황수산 2024-11 도매) ·
//          일별 생존율 0.448^(1/268) = 0.9970084(하루 0.2992% 폐사) ·
//          사료 2,300 원/kg · 전기 실청구 88.64 원/kWh ·
//          일급이 61.11 kg(16,378.5 ÷ 268) · 일전기 1,123.24 kWh(275,193 ÷ 245) ·
//          지금 마리수 537,562 · 2주 뒤 개체중 31.6 g
//
//   결과 — **2주 더 키우는 쪽이 +30,598,881 원 이익**(밴드 +30.60 ~ +33.59백만).
//          매출이 +13.00% 늘고(개체중 +10.60% · 단가 +6.55% · 마리수 −4.11%)
//          추가 사료·전기 3,361,707 원이 그보다 훨씬 작다.
//
// **이 후보 묶음은 가정 사례다.** 천황수산 코호트의 실제 출하는 평균 9.5 g 이고
// 28.6 g 은 11월 출하분의 크기다. 537,562마리를 전부 28.6 g 로 두는 것은 실제로
// 일어난 일이 아니다 — 단가·비용 조건만 그 농가의 것이다. 절대 금액보다
// **비율과 경계 폐사율**을 읽을 것.
const EXPECT = {
  dailySurvival: 0.9970083568699499,
  dailyMortalityPct: 0.2992,
  anchorAbwG: 1000 / 35,
  twoWeekAbwG: 31.6,
  // lib/pricing 머리주석이 적어 둔 수와 같아야 한다 — 17,000 × (31.6/28.57)^0.63.
  twoWeekPriceKrwPerKg: 18114,
  twoWeekPriceHighKrwPerKg: 18297,
  nowProfitKrw: 187038743,
  twoWeekProfitKrw: 217637624,
  twoWeekProfitDeltaKrw: 30598881,
  twoWeekProfitDeltaBandKrw: { low: 30598881, high: 33586655 },
  twoWeekAdditionalCostKrw: 3361707,
  twoWeekRevenueGrowthRate: 0.13006,
  // 근거 분해.
  growthKrw: 27676764,
  sizePremiumKrw: 17110015,
  mortalityKrw: -10725588,
  feedCostKrw: -1967865,
  electricityCostKrw: -1393843,
  // 뒤집히는 경계 — **하루 1.0758% 폐사.** 천황수산 실적(0.2992%)의 3.6배다.
  flipDailySurvival: 0.98924190,
  flipDailyMortalityPct: 1.0758,
}
const KRW_TOL = 2
const RATIO_TOL = 5e-5

// ── 검사 틀 ───────────────────────────────────────────────────────────────

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

const hasCode = (exclusions, code) => (exclusions ?? []).some((e) => e.code === code)
const findCode = (exclusions, code) => (exclusions ?? []).find((e) => e.code === code)
const krw = (v) => (typeof v === "number" ? Math.round(v).toLocaleString("ko-KR") : String(v))
const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(4)}%` : String(v))

// ── 사례 ──────────────────────────────────────────────────────────────────

/** 지금 ~ N일의 개체중을 선형으로 잇는다. */
function abwSeries(fromG, toG, days) {
  return Array.from({ length: days + 1 }, (_, d) => fromG + ((toG - fromG) * d) / days)
}

// 천황수산 누적 비용 — 엔진 2 가 재현하는 그 묶음이다(74,062,800 원).
const INCURRED_COST = computeCost({
  stockedCount: 1200000,
  feedKg: 16378.5,
  electricityKrw: ELECTRICITY_BILLED_KRW,
  electricityUnbilledMonths: 2,
})

const FEED_KG_PER_DAY = 16378.5 / CHEONHWANG_CYCLE_DAYS
// 고지서가 덮은 2024-03~10 은 245일이다(31+30+31+30+31+31+30+31).
const BILLED_DAYS = 245
const ELEC_KWH_PER_DAY = ELECTRICITY_BILLED_KWH / BILLED_DAYS

/** 천황수산 2주 사례. 후보는 지금 · 1주 · 2주. */
function cheonhwangInput(overrides = {}) {
  return {
    asOfDate: "2024-11-21",
    survivingCountNow: 537562,
    stockedCount: 1200000,
    abw: { kind: "daily_abw_g", abwG: abwSeries(EXPECT.anchorAbwG, EXPECT.twoWeekAbwG, 14) },
    survival: { dailySurvivalRate: DEFAULT_DAILY_SURVIVAL_RATE },
    price: { anchor: FARM_PRICE_ANCHOR },
    incurredCost: INCURRED_COST,
    dailyCost: { feedKgPerDay: FEED_KG_PER_DAY, electricityKwhPerDay: ELEC_KWH_PER_DAY },
    candidates: { stepDays: 7, horizonDays: 14 },
    ...overrides,
  }
}

// 포화 곡선 사례 — 한계이익이 **0 을 지나는** 모양을 보려면 성장이 꺾여야 한다.
// 선형 성장에서는 사료비가 일정하고 성장분이 줄지 않아 영원히 "더 키우라" 다.
const SATURATING_PARAMS = { winfG: 40, b: 3, k: 0.0008 }
function saturatingInput(overrides = {}) {
  return cheonhwangInput({
    abw: {
      kind: "gompertz",
      params: SATURATING_PARAMS,
      cddNow: 2000,
      waterTemp: { kind: "constant", waterTempC: 25 },
    },
    candidates: { stepDays: 14, horizonDays: 112 },
    ...overrides,
  })
}

// ── (가) 기본 동작 ────────────────────────────────────────────────────────

function basicChecks() {
  console.log("\n(가) 기본 동작 — 후보·날짜·구간·밴드·한계·근거")

  const w = harvestWindow(cheonhwangInput())
  checkEqual("가-1 실패 없이 돌아간다", w.failure, null)
  checkEqual("가-2 후보는 지금·1주·2주 세 개다", w.candidates.map((c) => c.dayOffset).join(","), "0,7,14")
  checkEqual("가-3 평가 못 한 후보가 없다", w.unevaluableCandidateCount, 0)

  // 기준일을 주면 날짜가 붙는다. 2024-11-21 + 14일 = 2024-12-05(실제 출하 종료일).
  checkEqual("가-4 기준일이 날짜 키로 들어온다", w.asOfDate, "2024-11-21")
  checkEqual("가-5 추천 구간에 날짜가 붙는다", w.recommended.endDate, "2024-12-05")
  checkEqual("가-6 최대 후보에도 날짜가 붙는다", w.best.date, "2024-12-05")
  // 기준일을 안 주면 **지어내지 않는다.**
  const noDate = harvestWindow(cheonhwangInput({ asOfDate: undefined }))
  checkEqual("가-7 기준일이 없으면 asOfDate 는 null", noDate.asOfDate, null)
  checkEqual("가-8 그때 추천 구간 날짜도 null", noDate.recommended.startDate, null)
  checkEqual("가-9 일수는 그대로 나온다", noDate.recommended.endDayOffset, 14)

  // 추천은 **점이 아니라 구간**이다 — 모양부터 구간이어야 한다.
  check(
    "가-10 추천이 구간 모양이다(start/end)",
    typeof w.recommended.startDayOffset === "number" && typeof w.recommended.endDayOffset === "number",
    JSON.stringify(w.recommended),
  )
  checkEqual("가-11 구간 안 구분 불가 여부가 반환값에 있다", typeof w.recommended.indistinguishableWithinWindow, "boolean")
  checkEqual("가-12 구간이 지금을 품는지도 반환값에 있다", typeof w.recommended.includesNow, "boolean")

  // 후보마다 이익이 **밴드**로 나온다.
  const d14 = w.candidates[2]
  check("가-13 이익이 밴드로 나온다", d14.profitBandKrw !== null, JSON.stringify(d14.profitBandKrw))
  check("가-14 밴드 하한 ≤ 상한", d14.profitBandKrw.low <= d14.profitBandKrw.high, "")
  checkEqual("가-15 밴드 폭의 출처가 반환값에 있다", w.band.sources.join(","), "price_elasticity")
  checkClose("가-16 그 출처가 탄력성 0.63 하한", w.band.priceElasticity.low, SIZE_ELASTICITY_BAND.low, 0)
  checkClose("가-17 그 출처가 탄력성 0.73 상한", w.band.priceElasticity.high, SIZE_ELASTICITY_BAND.high, 0)
  checkEqual("가-18 개체중 폭은 기본 0", w.band.abwUncertaintyG, 0)
  checkEqual("가-19 그 사실을 경고로 알린다", hasCode(w.exclusions, "harvest_abw_uncertainty_not_in_band"), true)
  checkEqual("가-20 폭 0 을 수량으로 담는다", findCode(w.exclusions, "harvest_abw_uncertainty_not_in_band").quantity, 0)

  // 단가 밴드가 lib/pricing 의 bandKrwPerKg 와 같은 수인가 — 세 번 평가해 만든
  // 양끝이 단가 모델 자신의 밴드와 일치해야 한다.
  const direct = estimateSizePrice(FARM_PRICE_ANCHOR, EXPECT.twoWeekAbwG)
  checkClose("가-21 단가 밴드 하한이 단가 모델과 같다", d14.priceBandKrwPerKg.low, direct.bandKrwPerKg.low, 1e-9)
  checkClose("가-22 단가 밴드 상한이 단가 모델과 같다", d14.priceBandKrwPerKg.high, direct.bandKrwPerKg.high, 1e-9)

  // 한계 분석.
  checkEqual("가-23 한계 분석이 후보 사이마다 한 줄", w.marginal.rows.length, 2)
  checkClose(
    "가-24 하루당 이익 = 구간 차액 ÷ 일수",
    w.marginal.rows[1].perDayKrw,
    (w.candidates[2].operatingProfitKrw - w.candidates[1].operatingProfitKrw) / 7,
    1e-6,
  )

  // 근거 분해 — **합이 차액과 정확히 같아야 한다.**
  const sum = d14.attribution.components.reduce((s, c) => s + c.krw, 0)
  checkClose("가-25 근거 분해의 합이 이익 차액과 같다", sum, d14.attribution.profitDeltaKrw, 1e-6)
  checkClose("가-26 차액 = 매출차액 − 비용차액", d14.attribution.profitDeltaKrw, d14.attribution.revenueDeltaKrw - d14.attribution.costDeltaKrw, 1e-6)
  checkEqual("가-27 분해가 코드로 나온다(문장 아님)", d14.attribution.components.every((c) => typeof c.code === "string" && typeof c.krw === "number"), true)

  // "지금" 후보도 같은 모양이다 — 자기와의 차액은 0 이고, 그 0 은 「모른다」가 아니다.
  checkEqual("가-28 지금 후보의 차액은 0", w.candidates[0].profitDeltaFromNowKrw, 0)
  checkEqual("가-29 지금 후보의 추가 비용은 0", w.candidates[0].additionalCostKrw, 0)
  checkEqual("가-30 지금 후보의 분해 항목도 전부 0", w.candidates[0].attribution.components.every((c) => c.krw === 0), true)

  // 후보를 직접 지정할 수 있고, 0 일이 없으면 넣고 알린다.
  const explicit = harvestWindow(cheonhwangInput({ candidates: { dayOffsets: [7, 14] } }))
  checkEqual("가-31 0일 후보가 없으면 넣는다", explicit.candidates.map((c) => c.dayOffset).join(","), "0,7,14")
  checkEqual("가-32 넣었다는 사실을 알린다", hasCode(explicit.exclusions, "harvest_candidate_now_added"), true)
  checkEqual("가-33 명시 후보면 stepDays 는 null", explicit.stepDays, null)

  // 기본 간격·지평.
  const defaults = harvestWindow(cheonhwangInput({ candidates: undefined, abw: { kind: "daily_abw_g", abwG: abwSeries(EXPECT.anchorAbwG, 34, DEFAULT_HORIZON_DAYS) } }))
  checkEqual("가-34 기본 간격 7일", DEFAULT_STEP_DAYS, 7)
  checkEqual("가-35 기본 지평 28일", DEFAULT_HORIZON_DAYS, 28)
  checkEqual("가-36 기본 후보는 0·7·14·21·28", defaults.candidates.map((c) => c.dayOffset).join(","), "0,7,14,21,28")

  // 날짜 셈은 UTC 자정 기준이고, 없는 날짜는 null 이다.
  checkEqual("가-37 날짜에 일수를 더한다", addDays("2024-11-21", 14), "2024-12-05")
  checkEqual("가-38 달·해를 넘어도 맞다", addDays("2024-12-25", 10), "2025-01-04")
  checkEqual("가-39 윤일을 센다", addDays("2024-02-28", 2), "2024-03-01")
  checkEqual("가-40 없는 날짜는 null", addDays("2026-02-30", 1), null)
  checkEqual("가-41 기준일이 없으면 null", addDays(null, 1), null)

  // 후보마다 날짜를 들고 다닌다 — 화면의 x축이 날짜다.
  checkEqual("가-42 후보에 날짜가 붙는다", w.candidates.map((c) => c.date).join(","), "2024-11-21,2024-11-28,2024-12-05")
  checkEqual("가-43 기준일이 없으면 후보 날짜도 null", noDate.candidates.every((c) => c.date === null), true)
  // 크기 프리미엄의 보조 수치 — 금액과 별개로 배수를 돌려준다.
  checkClose("가-44 앵커 대비 단가 비 1.0655(= +6.55%)", d14.priceRatioFromAnchor, 1.065534, 1e-5)
  checkClose("가-45 그 비가 단가 ÷ 앵커와 같다", d14.priceRatioFromAnchor, d14.priceKrwPerKg / w.price.anchorKrwPerKg, 1e-12)

  console.log("")
  console.log(
    `  후보: ${w.candidates
      .map((c) => `d${c.dayOffset} ${c.abwG.toFixed(2)}g ${krw(c.priceKrwPerKg)}원/kg 이익 ${krw(c.operatingProfitKrw)}원`)
      .join(" | ")}`,
  )
  console.log(`  추천: ${w.recommended.startDate} ~ ${w.recommended.endDate} (d${w.recommended.startDayOffset}~d${w.recommended.endDayOffset}) · 판정 ${w.decision}`)
}

// ── (나) 천황수산 조건 ────────────────────────────────────────────────────

function cheonhwangChecks() {
  console.log("\n(나) 천황수산 조건 — 2주 더 키우면 이익이 얼마나 달라지나")

  checkClose("나-1 일별 생존율 = 0.448^(1/268)", DEFAULT_DAILY_SURVIVAL_RATE, EXPECT.dailySurvival, 1e-12)
  checkClose("나-2 하루 폐사율 약 0.30%", (1 - DEFAULT_DAILY_SURVIVAL_RATE) * 100, EXPECT.dailyMortalityPct, 0.0001)
  checkClose("나-3 사이클 환산이 역으로도 맞는다", Math.pow(DEFAULT_DAILY_SURVIVAL_RATE, CHEONHWANG_CYCLE_DAYS), CHEONHWANG_CYCLE_SURVIVAL_RATE, 1e-12)
  checkClose("나-4 268일 환산 함수가 같은 수를 낸다", dailySurvivalFromCycle(0.448, 268), EXPECT.dailySurvival, 1e-12)
  checkClose("나-5 2주 누적 생존율 0.9589", survivalOverDays(DEFAULT_DAILY_SURVIVAL_RATE, 14), Math.pow(EXPECT.dailySurvival, 14), 1e-15)

  // 누적 비용은 엔진 2 가 재현하는 그 수여야 한다.
  checkClose("나-6 누적 비용 74,062,800원(엔진 2 재현)", INCURRED_COST.knownTotalKrw, 74062800, 1)
  checkClose("나-7 사료 단가 2,300원/kg", DEFAULT_FEED_KRW_PER_KG, 2300, 0)
  checkClose("나-8 전기 실청구 88.64원/kWh", DEFAULT_ELECTRICITY_KRW_PER_KWH, ELECTRICITY_BILLED_KRW / ELECTRICITY_BILLED_KWH, 0)

  const w = harvestWindow(cheonhwangInput())
  const [d0, d7, d14] = w.candidates

  checkClose("나-9 지금 개체중 28.571g(앵커와 같다)", d0.abwG, EXPECT.anchorAbwG, 1e-9)
  checkClose("나-10 그래서 지금 단가가 앵커 그대로 17,000원", d0.priceKrwPerKg, 17000, 1e-6)
  checkClose("나-11 2주 뒤 개체중 31.6g", d14.abwG, EXPECT.twoWeekAbwG, 1e-9)
  // lib/pricing 머리주석의 18,114원과 같은 수인가.
  checkClose("나-12 2주 뒤 단가 18,114원/kg(단가 모델과 같다)", d14.priceKrwPerKg, EXPECT.twoWeekPriceKrwPerKg, 1)
  checkClose("나-13 탄력성 0.73 이면 18,297원", d14.priceBandKrwPerKg.high, EXPECT.twoWeekPriceHighKrwPerKg, 1)

  checkClose("나-14 2주 뒤 마리수 = 537,562 × 0.9589", d14.survivingCount, 537562 * Math.pow(EXPECT.dailySurvival, 14), 1e-6)
  checkClose("나-15 추가 비용 3,361,707원(사료+전기)", d14.additionalCostKrw, EXPECT.twoWeekAdditionalCostKrw, KRW_TOL)

  // **이 사례의 결론 — 수를 박는다.**
  checkClose("나-16 지금 출하 영업이익 187,038,743원", d0.operatingProfitKrw, EXPECT.nowProfitKrw, KRW_TOL)
  checkClose("나-17 2주 뒤 영업이익 217,637,624원", d14.operatingProfitKrw, EXPECT.twoWeekProfitKrw, KRW_TOL)
  checkClose("나-18 **2주 더 키우면 +30,598,881원 — 양수다**", d14.profitDeltaFromNowKrw, EXPECT.twoWeekProfitDeltaKrw, KRW_TOL)
  check("나-19 밴드 양끝이 둘 다 양수다 — 부호가 확실하다", d14.profitDeltaBandKrw.low > 0 && d14.profitDeltaBandKrw.high > 0, JSON.stringify(d14.profitDeltaBandKrw))
  checkClose("나-20 차액 밴드 하한 +30,598,881원", d14.profitDeltaBandKrw.low, EXPECT.twoWeekProfitDeltaBandKrw.low, KRW_TOL)
  checkClose("나-21 차액 밴드 상한 +33,586,655원", d14.profitDeltaBandKrw.high, EXPECT.twoWeekProfitDeltaBandKrw.high, KRW_TOL)
  checkClose("나-22 매출이 +13.00% 늘어난다", d14.revenueKrw / d0.revenueKrw - 1, EXPECT.twoWeekRevenueGrowthRate, RATIO_TOL)
  checkEqual("나-23 그래서 판정은 '지금 출하'가 아니다", w.decision === "harvest_now", false)

  // 근거 분해 — **왜 그런지.**
  const comp = (code) => d14.attribution.components.find((c) => c.code === code).krw
  checkClose("나-24 성장 +27,676,764원", comp("growth"), EXPECT.growthKrw, KRW_TOL)
  checkClose("나-25 크기 프리미엄 +17,110,015원", comp("size_premium"), EXPECT.sizePremiumKrw, KRW_TOL)
  checkClose("나-26 폐사 −10,725,588원", comp("mortality"), EXPECT.mortalityKrw, KRW_TOL)
  checkClose("나-27 사료비 −1,967,865원", comp("cost_feed"), EXPECT.feedCostKrw, KRW_TOL)
  checkClose("나-28 전기비 −1,393,843원", comp("cost_electricity"), EXPECT.electricityCostKrw, KRW_TOL)
  checkEqual("나-29 가장 큰 플러스는 성장", d14.attribution.dominantGainCode, "growth")
  checkEqual("나-30 가장 큰 마이너스는 폐사", d14.attribution.dominantLossCode, "mortality")
  check("나-31 크기 프리미엄이 폐사보다 크다 — 그래서 더 키우는 쪽이 이긴다", comp("size_premium") > -comp("mortality"), `${krw(comp("size_premium"))} vs ${krw(-comp("mortality"))}`)

  // 1주만 키우는 쪽도 같은 방향이어야 한다 — 중간 후보가 뒤집히면 뭔가 틀렸다.
  check("나-32 1주 뒤도 양수다", d7.profitDeltaFromNowKrw > 0, krw(d7.profitDeltaFromNowKrw))
  check("나-33 2주가 1주보다 더 이익이다", d14.profitDeltaFromNowKrw > d7.profitDeltaFromNowKrw, "")

  console.log("")
  console.log(`  지금 출하  ${d0.abwG.toFixed(2)}g · ${krw(d0.biomassKg)}kg · ${krw(d0.priceKrwPerKg)}원/kg → 이익 ${krw(d0.operatingProfitKrw)}원`)
  console.log(`  2주 뒤     ${d14.abwG.toFixed(2)}g · ${krw(d14.biomassKg)}kg · ${krw(d14.priceKrwPerKg)}원/kg → 이익 ${krw(d14.operatingProfitKrw)}원`)
  console.log(`  **차액 ${d14.profitDeltaFromNowKrw > 0 ? "+" : ""}${krw(d14.profitDeltaFromNowKrw)}원** (밴드 ${krw(d14.profitDeltaBandKrw.low)} ~ ${krw(d14.profitDeltaBandKrw.high)})`)
  console.log(
    `  근거: ${d14.attribution.components.map((c) => `${c.code} ${c.krw > 0 ? "+" : ""}${krw(c.krw)}`).join(" · ")}`,
  )
}

// ── (다) 폐사 ─────────────────────────────────────────────────────────────

function mortalityChecks() {
  console.log("\n(다) 폐사 — 빼먹으면 엔진이 항상 '더 키우라'고 말한다")

  // 폐사 0 → 바이오매스가 단조 증가하므로 언제나 "더 키우라" 다.
  const zero = harvestWindow(cheonhwangInput({ survival: { dailySurvivalRate: 1 } }))
  checkEqual("다-1 폐사 0 이면 한계이익이 끝까지 양수다", zero.marginal.sign, "always_positive")
  checkEqual("다-2 그래서 최대가 마지막 후보다", zero.best.dayOffset, 14)
  checkEqual("다-3 판정이 '지금 출하'가 아니다", zero.decision, "hold_beyond_horizon")
  // **그리고 경고가 붙는다.**
  checkEqual("다-4 폐사 없음 가정을 경고로 알린다", hasCode(zero.exclusions, "harvest_zero_mortality_assumed"), true)
  checkEqual("다-5 그 수량은 0(= 일별 폐사율 0)", findCode(zero.exclusions, "harvest_zero_mortality_assumed").quantity, 0)
  checkEqual("다-6 0 을 지나지 않는다는 사실도 알린다", hasCode(zero.exclusions, "harvest_marginal_never_crosses_zero"), true)
  checkEqual("다-7 지평 끝에 걸렸다는 사실도 알린다", hasCode(zero.exclusions, "harvest_horizon_truncated"), true)
  checkEqual("다-8 폐사 분해 항목이 0 이다", zero.candidates[2].attribution.components.find((c) => c.code === "mortality").krw, 0)

  // 폐사를 **안 넘기면 0 으로 가정하지 않는다** — 이것이 이 엔진에서 가장
  // 위험한 기본값이고, 그래서 실측 환산값으로 떨어지고 경고가 올라간다.
  const omitted = harvestWindow(cheonhwangInput({ survival: undefined }))
  checkClose("다-9 생존율을 안 주면 0% 폐사가 아니다", omitted.survival.dailySurvivalRate, EXPECT.dailySurvival, 1e-12)
  checkEqual("다-10 기본값으로 떨어졌다고 알린다", hasCode(omitted.exclusions, "harvest_daily_survival_default"), true)
  checkEqual("다-11 폐사 없음 경고는 뜨지 않는다", hasCode(omitted.exclusions, "harvest_zero_mortality_assumed"), false)
  checkEqual("다-12 엔진 2 어휘로도 가정임을 알린다", hasCode(omitted.exclusions, "survival_rate_assumed"), true)
  checkClose("다-13 그 수량이 일별 생존율이다", findCode(omitted.exclusions, "survival_rate_assumed").quantity, EXPECT.dailySurvival, 1e-12)
  checkEqual("다-14 생존율 출처가 반환값에 있다", omitted.survival.source, "default")
  checkEqual("다-15 넘기면 출처가 provided 다", harvestWindow(cheonhwangInput()).survival.source, "provided")
  checkEqual("다-16 사이클에서 환산했으면 derived_from_cycle", harvestWindow(cheonhwangInput({ survival: { cycleSurvivalRate: 0.448, cycleDays: 268 } })).survival.source, "derived_from_cycle")
  checkEqual("다-17 0~1 밖은 거부한다", resolveDailySurvival({ dailySurvivalRate: 1.2 }).failure, "invalid_survival_rate")
  checkEqual("다-18 거부되면 엔진 전체가 수를 안 낸다", harvestWindow(cheonhwangInput({ survival: { dailySurvivalRate: -0.1 } })).failure, "survival_rate_invalid")

  // 폐사가 높으면 **뒤집힌다.**
  const high = harvestWindow(cheonhwangInput({ survival: { dailySurvivalRate: 0.95 } }))
  checkEqual("다-19 하루 5% 폐사면 '지금 출하'로 뒤집힌다", high.decision, "harvest_now")
  checkEqual("다-20 그때 최대가 0일이다", high.best.dayOffset, 0)
  checkEqual("다-21 한계이익이 끝까지 음수다", high.marginal.sign, "always_negative")
  check("다-22 2주 뒤 차액이 음수다", high.candidates[2].profitDeltaFromNowKrw < 0, krw(high.candidates[2].profitDeltaFromNowKrw))
  const two = harvestWindow(cheonhwangInput({ survival: { dailySurvivalRate: 0.98 } }))
  checkEqual("다-23 하루 2% 폐사도 '지금 출하'다", two.decision, "harvest_now")

  // **뒤집히는 경계 폐사율을 수로 확인한다.**
  const flip = dailySurvivalFlipPoint(cheonhwangInput(), { atDayOffset: 14 })
  checkEqual("다-24 경계를 찾았다", flip.failure, null)
  checkClose("다-25 **경계 일별 생존율 0.989242**", flip.dailySurvivalRate, EXPECT.flipDailySurvival, 1e-6)
  checkClose("다-26 **= 하루 1.0758% 폐사에서 뒤집힌다**", flip.dailyMortalityRate * 100, EXPECT.flipDailyMortalityPct, 0.001)
  check("다-27 천황수산 실적(0.2992%)은 그 경계의 아래다", (1 - EXPECT.dailySurvival) < flip.dailyMortalityRate, "")
  checkClose("다-28 경계보다 3.5배 이상 여유가 있다", flip.dailyMortalityRate / (1 - EXPECT.dailySurvival), 3.595, 0.01)
  // 경계 바로 양쪽에서 실제로 판정이 갈리는가.
  const justAbove = harvestWindow(cheonhwangInput({ survival: { dailySurvivalRate: flip.dailySurvivalRate + 1e-4 } }))
  const justBelow = harvestWindow(cheonhwangInput({ survival: { dailySurvivalRate: flip.dailySurvivalRate - 1e-4 } }))
  check("다-29 경계 위에서는 2주 차액이 양수", justAbove.candidates[2].profitDeltaFromNowKrw > 0, krw(justAbove.candidates[2].profitDeltaFromNowKrw))
  check("다-30 경계 아래에서는 음수", justBelow.candidates[2].profitDeltaFromNowKrw < 0, krw(justBelow.candidates[2].profitDeltaFromNowKrw))
  // 끌어당기지 않는다 — 구간 안에 뒤집힘이 없으면 수를 돌려주지 않는다.
  const noFlip = dailySurvivalFlipPoint(cheonhwangInput(), { atDayOffset: 14, range: { min: 0.999, max: 1 } })
  checkEqual("다-31 구간 안에 뒤집힘이 없으면 수를 안 낸다", noFlip.failure, "no_flip_in_range")
  checkEqual("다-32 그때 값은 null 이다", noFlip.dailySurvivalRate, null)
  check("다-33 대신 구간 양끝의 차액을 보여 준다", noFlip.bracket.deltaAtMinKrw > 0 && noFlip.bracket.deltaAtMaxKrw > 0, JSON.stringify(noFlip.bracket))

  // 민감도 스윕 — 엔진 2 의 survivalSensitivity 와 같은 역할, 축만 일별이다.
  const sweep = harvestWindowBySurvival(
    cheonhwangInput(),
    [1, EXPECT.dailySurvival, 0.995, 0.99, 0.985, 0.98],
    { atDayOffset: 14 },
  )
  checkEqual("다-34 스윕이 입력 순서를 지킨다", sweep.rows.map((r) => r.dailySurvivalRate)[0], 1)
  checkEqual("다-35 스윕 어딘가에서 판정이 뒤집힌다", new Set(sweep.rows.map((r) => r.decision)).size > 1, true)
  checkEqual("다-36 가장 높은 폐사 행은 '지금 출하'", sweep.rows[sweep.rows.length - 1].decision, "harvest_now")

  console.log("")
  for (const r of sweep.rows) {
    console.log(
      `  하루 폐사 ${(r.dailyMortalityRate * 100).toFixed(3)}% → ${r.decision} · 최대 d${r.bestDayOffset} · 2주 차액 ${r.profitDeltaKrw > 0 ? "+" : ""}${krw(r.profitDeltaKrw)}원`,
    )
  }
  console.log(`  **뒤집히는 경계 — 하루 ${(flip.dailyMortalityRate * 100).toFixed(4)}% 폐사**(일별 생존율 ${flip.dailySurvivalRate.toFixed(6)})`)
}

// ── (라) 단가 앵커 검문 ───────────────────────────────────────────────────

function anchorChecks() {
  console.log("\n(라) 단가 앵커 — 소매로 농가 수익을 계산하면 1.9배 과대가 된다")

  const retail = anchorFromCountPerKg({
    krwPerKg: 28000,
    countPerKg: 42.5,
    stage: "online_retail",
    form: "live",
    premium: false,
    observedAt: "2026-10",
    grade: "A",
    source: { kind: "vendor_listing", vendor: "이순신수산", marketplace: "11번가" },
  })

  // 기본은 **거부**다.
  const rejected = harvestWindow(cheonhwangInput({ price: { anchor: retail } }))
  checkEqual("라-1 소매 앵커는 기본적으로 거부된다", rejected.failure, "price_anchor_not_farmgate")
  checkEqual("라-2 거부되면 후보를 하나도 내지 않는다", rejected.candidates.length, 0)
  checkEqual("라-3 추천도 없다", rejected.recommended, null)
  checkEqual("라-4 판정도 없다", rejected.decision, null)
  checkEqual("라-5 거부 이유를 경고로 알린다", hasCode(rejected.exclusions, "price_anchor_not_farmgate"), true)
  checkClose("라-6 그 수량이 농가로 내릴 배수(2.2)다", findCode(rejected.exclusions, "price_anchor_not_farmgate").quantity, 2.2, 1e-9)

  // 켜면 **변환**한다 — 그냥 통과하지 않는다.
  const converted = harvestWindow(cheonhwangInput({ price: { anchor: retail, nonFarmgateAnchor: "convert" } }))
  checkEqual("라-7 변환을 켜면 돌아간다", converted.failure, null)
  checkClose("라-8 28,000원 ÷ 2.2 = 12,727.27원으로 내려간다", converted.price.anchorKrwPerKg, 28000 / 2.2, 1e-9)
  checkEqual("라-9 변환된 단계가 농가 수취다", converted.price.stage, "farmgate")
  checkEqual("라-10 원래 단계를 반환값에 남긴다", converted.price.convertedFrom, "online_retail")
  checkClose("라-11 곱한 배수도 남긴다", converted.price.conversionMultiplier, 1 / 2.2, 1e-9)
  checkEqual("라-12 변환했다는 사실을 경고로 알린다", hasCode(converted.exclusions, "harvest_anchor_converted_to_farmgate"), true)
  // **변환 뒤에는 소매 경고가 남아 있지 않다** — 결과가 농가 단계이기 때문이다.
  checkEqual("라-13 변환 뒤에는 소매 경고가 붙지 않는다", hasCode(converted.exclusions, "price_anchor_not_farmgate"), false)

  // 변환하지 않았다면 얼마나 과대였나 — 1.9배 쪽을 수로 확인한다.
  const rawRetailPrice = estimateSizePrice(retail, EXPECT.twoWeekAbwG)
  const farmgatePrice = estimateSizePrice(FARM_PRICE_ANCHOR, EXPECT.twoWeekAbwG)
  checkEqual("라-14 소매 앵커로 그냥 추정하면 경고가 붙는다(단가 모델)", hasCode(rawRetailPrice.exclusions, "price_anchor_not_farmgate"), true)
  checkClose("라-15 그 단가는 농가 수취의 1.86배다", rawRetailPrice.krwPerKg / farmgatePrice.krwPerKg, 1.863, 0.01)

  // 범위 밖 변환 계수는 **끌어당기지 않고 거부한다.**
  const badDivisor = harvestWindow(cheonhwangInput({ price: { anchor: retail, nonFarmgateAnchor: "convert", retailToFarmgateDivisor: 9 } }))
  checkEqual("라-16 허용 범위 밖 계수는 거부된다", badDivisor.failure, "price_anchor_unconvertible")
  checkEqual("라-17 거부되면 단가를 안 낸다", badDivisor.price.anchorKrwPerKg, null)
  const okDivisor = harvestWindow(cheonhwangInput({ price: { anchor: retail, nonFarmgateAnchor: "convert", retailToFarmgateDivisor: 2.4 } }))
  checkClose("라-18 범위 안 계수(2.4)는 받는다", okDivisor.price.anchorKrwPerKg, 28000 / 2.4, 1e-9)

  // 프리미엄 인증 상품은 유통단계 배수로 환산되지 않는다.
  const premium = { ...retail, stage: "online_premium", premium: true, krwPerKg: 49900 }
  checkEqual("라-19 프리미엄 앵커는 변환해도 거부된다", harvestWindow(cheonhwangInput({ price: { anchor: premium, nonFarmgateAnchor: "convert" } })).failure, "price_anchor_unconvertible")
  checkEqual("라-20 프리미엄 플래그만 서도 거부된다", resolveHarvestAnchor({ anchor: { ...retail, premium: true }, nonFarmgateAnchor: "convert" }).failure, "price_anchor_unconvertible")

  // 농가 수취 단계는 변환 없이 그대로 쓴다.
  checkEqual("라-21 도매 앵커는 변환 없이 쓴다", resolveHarvestAnchor({ anchor: FARM_PRICE_ANCHOR }).convertedFrom, null)
  checkEqual("라-22 그때 경고도 없다", resolveHarvestAnchor({ anchor: FARM_PRICE_ANCHOR }).exclusions.length, 0)
  checkEqual("라-23 산지 앵커도 그대로 쓴다", resolveHarvestAnchor({ anchor: { ...FARM_PRICE_ANCHOR, stage: "farmgate" } }).failure, null)
  // 마트·직송 같은 중간 단계도 변환을 거친다.
  const mart = resolveHarvestAnchor({ anchor: { ...FARM_PRICE_ANCHOR, stage: "mart_promo", krwPerKg: 19857 }, nonFarmgateAnchor: "convert" })
  checkEqual("라-24 마트 단계도 변환된다", mart.convertedFrom, "mart_promo")
  checkClose("라-25 1.39 배수를 되돌린다", mart.anchor.krwPerKg, 19857 / 1.39, 1e-6)

  // 냉동 계수로 활 단가를 계산하는 길은 단가 모델이 막고, 엔진 3 은 그 거부를
  // 삼키지 않고 후보 실패로 올린다.
  const frozen = harvestWindow(cheonhwangInput({ price: { anchor: FARM_PRICE_ANCHOR, elasticity: FROZEN_SIZE_ELASTICITY } }))
  checkEqual("라-26 냉동 계수로 활 단가를 계산하면 막힌다", frozen.failure, "now_not_evaluable")
  checkEqual("라-27 그 이유가 후보에 남는다", frozen.candidates[0].failure, "price_unavailable")
  // **실패 경로에서도 이유가 반환값에 남아야 한다.** failure 코드만으로는
  // 화면이 「냉동이라 기울기 근거가 없다」를 말할 수 없고, 농가는 자기
  // 데이터가 모자란 줄 안다. now_not_evaluable 조기 반환이 후보 경고를
  // 버리고 있었다(2026-10-03 수정).
  check(
    "라-28 그 이유가 window.exclusions 에도 올라온다",
    hasExclusion(frozen.exclusions, "price_ladder_form_not_slope_eligible"),
    `exclusions=[${frozen.exclusions.map((e) => e.code).join(", ")}]`,
  )

  console.log("")
  console.log(`  소매 28,000원/kg @23.5g → 농가 ${krw(converted.price.anchorKrwPerKg)}원/kg (÷2.2)`)
  console.log(`  변환 안 하면 31.6g 단가가 ${krw(rawRetailPrice.krwPerKg)}원/kg — 농가 ${krw(farmgatePrice.krwPerKg)}원/kg 의 ${(rawRetailPrice.krwPerKg / farmgatePrice.krwPerKg).toFixed(2)}배`)
}

// ── (마) 경고 전파 ────────────────────────────────────────────────────────

function exclusionChecks() {
  console.log("\n(마) 경고 전파 — 엔진 1·2·단가의 경고가 전부 올라오는가")

  const w = harvestWindow(cheonhwangInput())
  const codes = w.exclusions.map((e) => e.code)

  // 엔진 2 의 어휘.
  checkEqual("마-1 미입력 비용 항목(엔진 2)", hasCode(w.exclusions, "cost_not_recorded"), true)
  checkEqual("마-2 감가 미반영(엔진 2)", hasCode(w.exclusions, "cost_depreciation_not_modeled"), true)
  checkEqual("마-3 전기 고지서 미비(엔진 2)", hasCode(w.exclusions, "electricity_billing_incomplete"), true)
  checkEqual("마-4 개체중이 예측값(엔진 2가 엔진 1 위에서 올린다)", hasCode(w.exclusions, "abw_from_growth_projection"), true)
  checkEqual("마-5 생존율이 가정(엔진 2)", hasCode(w.exclusions, "survival_rate_assumed"), true)
  // 단가 모델의 어휘.
  checkEqual("마-6 앵커에서 외삽(단가)", hasCode(w.exclusions, "price_extrapolated_from_anchor"), true)
  checkEqual("마-7 탄력성 잠정값(단가)", hasCode(w.exclusions, "price_elasticity_provisional"), true)
  checkEqual("마-8 판매처 한 곳(단가)", hasCode(w.exclusions, "price_elasticity_single_vendor"), true)
  checkEqual("마-9 0.63 이 하한(단가)", hasCode(w.exclusions, "price_elasticity_lower_bound"), true)
  checkEqual("마-10 구간 탄력성이 크기의존(단가)", hasCode(w.exclusions, "price_elasticity_size_dependent"), true)
  checkEqual("마-11 상태별 계수(단가)", hasCode(w.exclusions, "price_elasticity_form_specific"), true)
  checkEqual("마-12 공시 통계 없음(단가)", hasCode(w.exclusions, "price_official_statistics_unavailable"), true)
  // 엔진 3 자신의 어휘.
  checkEqual("마-13 밴드에 개체중 폭 없음(엔진 3)", hasCode(w.exclusions, "harvest_abw_uncertainty_not_in_band"), true)
  checkEqual("마-14 지평 끝에 걸림(엔진 3)", hasCode(w.exclusions, "harvest_horizon_truncated"), true)
  check("마-15 세 어휘가 한 목록에 섞여 나온다", codes.some((c) => c.startsWith("cost_")) && codes.some((c) => c.startsWith("price_")) && codes.some((c) => c.startsWith("harvest_")), codes.join(","))

  // **관측 범위 밖 경고가 결과까지 따라온다.**
  const outside = harvestWindow(cheonhwangInput({ abw: { kind: "daily_abw_g", abwG: abwSeries(32, 36, 14) } }))
  checkEqual("마-16 사다리 범위 밖 후보에 깃발이 선다", outside.candidates[2].priceOutsideObservedSize, true)
  checkEqual("마-17 범위 안 후보에는 서지 않는다", outside.candidates[0].priceOutsideObservedSize, false)
  checkEqual("마-18 **그 경고가 결과의 목록까지 올라온다**", hasCode(outside.exclusions, "price_target_outside_observed_size"), true)
  checkEqual("마-19 후보 목록에도 남아 있다", hasCode(outside.candidates[2].exclusions, "price_target_outside_observed_size"), true)
  // 범위 안이면 올라오지 않는다 — 언제나 붙는 경고면 뜻이 없다.
  checkEqual("마-20 범위 안이면 그 경고가 없다", hasCode(w.exclusions, "price_target_outside_observed_size"), false)

  // 추가 비용을 안 주면 엔진 2 가 알린다 — **0 으로 채우지 않는다.**
  const noCost = harvestWindow(cheonhwangInput({ dailyCost: undefined }))
  checkEqual("마-21 잔여기간 비용 미입력(엔진 2)", hasCode(noCost.exclusions, "remaining_period_cost_not_estimated"), true)
  checkEqual("마-22 그때 추가 비용은 0 이 아니라 null", noCost.candidates[2].additionalCostKrw, null)
  check("마-23 비용을 안 세면 이익이 과대로 나온다", noCost.candidates[2].operatingProfitKrw > harvestWindow(cheonhwangInput()).candidates[2].operatingProfitKrw, "")

  // 수온 전망은 관측이 아니다.
  const gompertz = harvestWindow(saturatingInput())
  checkEqual("마-24 수온 전망임을 알린다", hasCode(gompertz.exclusions, "harvest_water_temp_outlook_assumed"), true)
  checkEqual("마-25 그 수량은 전망으로 덮은 일수", findCode(gompertz.exclusions, "harvest_water_temp_outlook_assumed").quantity, 112)
  checkEqual("마-26 개체중을 직접 받으면 그 경고가 없다", hasCode(w.exclusions, "harvest_water_temp_outlook_assumed"), false)

  // 고정 상한에 닿으면 알린다 — 그 구간의 성장분은 가정이 만든 수다.
  const ceiling = harvestWindow(cheonhwangInput({ abw: { kind: "gompertz", params: { winfG: 25, b: 3, k: 0.002 }, cddNow: 4000, waterTemp: { kind: "constant", waterTempC: 25 } } }))
  checkEqual("마-27 Winf 천장에 닿으면 깃발이 선다", ceiling.candidates[0].abwAtWinfCeiling, true)
  checkEqual("마-28 경고로도 알린다", hasCode(ceiling.exclusions, "harvest_abw_at_winf_ceiling"), true)
  checkEqual("마-29 그 수량이 상한(25g)", findCode(ceiling.exclusions, "harvest_abw_at_winf_ceiling").quantity, 25)
  checkEqual("마-30 천장 아래면 깃발이 안 선다", harvestWindow(saturatingInput()).candidates[0].abwAtWinfCeiling, false)

  // 급이율로 받으면 호출자 입력임을 알린다 — 엔진 5 의 추정이 아니다.
  const rate = harvestWindow(cheonhwangInput({ dailyCost: { feedRateOfBiomassPerDay: 0.02, electricityKwhPerDay: ELEC_KWH_PER_DAY } }))
  checkEqual("마-31 급이율이 호출자 입력임을 알린다", hasCode(rate.exclusions, "harvest_feed_rate_caller_supplied"), true)
  checkClose("마-32 그 수량이 쓰인 비율", findCode(rate.exclusions, "harvest_feed_rate_caller_supplied").quantity, 0.02, 0)
  check("마-33 바이오매스 2% 급이면 사료비가 훨씬 크다", rate.candidates[2].additionalCostKrw > w.candidates[2].additionalCostKrw * 2, `${krw(rate.candidates[2].additionalCostKrw)} vs ${krw(w.candidates[2].additionalCostKrw)}`)
  // 그래도 결론은 뒤집히지 않는다 — 이 사례의 강건성이다.
  check("마-34 그래도 2주 더 키우는 쪽이 이익이다", rate.candidates[2].profitDeltaFromNowKrw > 0, krw(rate.candidates[2].profitDeltaFromNowKrw))

  // 경고의 모양과 단위 — **새 체계를 만들지 않았다.**
  const engine2Units = new Set(["krw", "krw_per_kg", "kg", "count", "month", "day", "gram", "ratio", null])
  checkEqual("마-35 새 단위를 만들지 않았다", w.exclusions.every((e) => engine2Units.has(e.unit)), true)
  checkEqual("마-36 경고는 {code, quantity, unit} 모양이다", w.exclusions.every((e) => "code" in e && "quantity" in e && "unit" in e), true)
  checkEqual("마-37 문장을 만들지 않는다", w.exclusions.every((e) => !("message" in e) && !("text" in e)), true)
  checkEqual("마-38 같은 코드가 중복되지 않는다", new Set(w.exclusions.map((e) => `${e.code}|${e.item ?? ""}`)).size, w.exclusions.length)

  console.log("")
  console.log(`  경고 ${w.exclusions.length}건 — ${codes.join(", ")}`)
  console.log(`  범위 밖 사례(32→36g): ${outside.candidates.map((c) => `d${c.dayOffset}:${c.priceOutsideObservedSize ? "밖" : "안"}`).join(" ")}`)
  console.log(`  바이오매스 2% 급이: 추가비용 ${krw(rate.candidates[2].additionalCostKrw)}원 · 2주 차액 ${rate.candidates[2].profitDeltaFromNowKrw > 0 ? "+" : ""}${krw(rate.candidates[2].profitDeltaFromNowKrw)}원`)
}

// ── (바) 설계 규칙 ────────────────────────────────────────────────────────

function designRuleChecks() {
  console.log("\n(바) 설계 규칙 — 점으로 답하지 않는가, 문장을 만들지 않는가")

  // ① 점이 아니라 구간 — 밴드가 겹치면 **구분 불가**다.
  // 개체중 폭을 엔진 1 의 홀드아웃 MAE(0.895 g)만큼 넣으면 1주·2주의 밴드가
  // 겹친다. **그때 하루를 억지로 고르지 않는다.**
  const narrow = harvestWindow(cheonhwangInput())
  const wide = harvestWindow(cheonhwangInput({ abwUncertaintyG: 0.895 }))
  checkEqual("바-1 개체중 폭을 넣으면 밴드 출처가 둘이 된다", wide.band.sources.join(","), "price_elasticity,abw_uncertainty")
  checkClose("바-2 그 폭이 반환값에 담긴다", wide.band.abwUncertaintyG, 0.895, 0)
  checkEqual("바-3 그러면 개체중 폭 0 경고가 사라진다", hasCode(wide.exclusions, "harvest_abw_uncertainty_not_in_band"), false)
  check(
    "바-4 밴드가 넓어진다",
    wide.candidates[2].profitBandKrw.high - wide.candidates[2].profitBandKrw.low >
      narrow.candidates[2].profitBandKrw.high - narrow.candidates[2].profitBandKrw.low,
    "",
  )
  checkEqual("바-5 **밴드가 겹치면 구분 불가가 나온다**", wide.recommended.indistinguishableWithinWindow, true)
  checkEqual("바-6 구간이 1주~2주를 덮는다", `${wide.recommended.startDayOffset}-${wide.recommended.endDayOffset}`, "7-14")
  checkEqual("바-7 구간에 든 후보는 둘이다", wide.recommended.candidateCount, 2)
  // 지금(d0)은 **겹치지 않아서 구간에 들지 않는다** — 겹침 판정이 실제로
  // 작동한다는 뜻이다. 전부 넣어 주면 "구분 불가" 가 아무 뜻이 없다.
  check(
    "바-8 지금 밴드는 2주 밴드와 안 겹쳐 구간에서 빠진다",
    wide.candidates[0].profitBandKrw.high < wide.candidates[2].profitBandKrw.low,
    `${krw(wide.candidates[0].profitBandKrw.high)} < ${krw(wide.candidates[2].profitBandKrw.low)}`,
  )
  checkEqual("바-9 그래서 구간이 지금을 품지 않는다", wide.recommended.includesNow, false)
  checkEqual("바-10 구분 불가를 경고로도 알린다", hasCode(wide.exclusions, "harvest_window_indistinguishable"), true)
  checkEqual("바-11 그 수량이 구간에 든 후보 수", findCode(wide.exclusions, "harvest_window_indistinguishable").quantity, 2)

  // 폭을 더 넓히면 구간이 "지금" 까지 내려온다 — 그때는 **지금 출하해도 구분되지
  // 않는다**는 뜻이고, 판정 코드가 그 사실을 말한다.
  const widest = harvestWindow(cheonhwangInput({ abwUncertaintyG: 2 }))
  checkEqual("바-12 폭이 더 넓으면 구간이 지금까지 내려온다", widest.recommended.includesNow, true)
  checkEqual("바-13 구간이 세 후보를 전부 덮는다", `${widest.recommended.startDayOffset}-${widest.recommended.endDayOffset}`, "0-14")
  checkEqual("바-14 **그때 판정이 'window_includes_now'**", widest.decision, "window_includes_now")
  checkEqual("바-15 최대는 그래도 2주다", widest.best.dayOffset, 14)

  // 밴드가 안 겹치면 구분된다 — 언제나 "구분 불가" 면 뜻이 없다.
  checkEqual("바-16 밴드가 안 겹치면 구분된다", narrow.recommended.indistinguishableWithinWindow, false)
  checkEqual("바-17 그때 구간은 한 점이다", narrow.recommended.candidateCount, 1)
  checkEqual("바-18 그때 구분 불가 경고도 없다", hasCode(narrow.exclusions, "harvest_window_indistinguishable"), false)

  // ③ 한계 분석이 0 을 지나는 지점 — 성장이 꺾이면 반드시 지난다.
  const sat = harvestWindow(saturatingInput())
  checkEqual("바-19 포화 곡선에서는 한계이익이 0 을 지난다", sat.marginal.sign, "crosses")
  check("바-20 0 통과 지점을 수로 돌려준다", typeof sat.marginal.zeroCrossingDayOffset === "number", String(sat.marginal.zeroCrossingDayOffset))
  checkClose("바-21 그 지점이 82.7일 근처다", sat.marginal.zeroCrossingDayOffset, 82.71, 0.5)
  checkEqual("바-22 어느 두 구간 사이인지도 알려 준다", `${sat.marginal.crossing.fromDayOffset}-${sat.marginal.crossing.toDayOffset}`, "70-98")
  checkEqual("바-23 이익 최대가 그 근처다", sat.best.dayOffset, 84)
  checkEqual("바-24 추천은 그 주변 구간이다", `${sat.recommended.startDayOffset}-${sat.recommended.endDayOffset}`, "70-98")
  checkEqual("바-25 구간 안은 구분 불가다", sat.recommended.indistinguishableWithinWindow, true)
  checkEqual("바-26 0 을 지났으므로 지평 경고가 없다", hasCode(sat.exclusions, "harvest_horizon_truncated"), false)
  checkEqual("바-27 '지금 출하'도 아니고 지평 밖도 아니다", sat.decision, "hold")

  // ⑤ 계절항은 0 이고, 엔진 3 이 계절 보정을 만들지 않는다.
  checkEqual("바-28 계절 미반영을 알린다", hasCode(narrow.exclusions, "price_seasonality_not_modeled"), true)
  checkEqual("바-29 보정량 0 을 수량으로 담는다", findCode(narrow.exclusions, "price_seasonality_not_modeled").quantity, 0)
  // 기준일만 바꿔 9월·12월로 돌려도 **같은 수가 나온다** — 달을 받는 경로가 없다.
  const sep = harvestWindow(cheonhwangInput({ asOfDate: "2024-09-01" }))
  const dec = harvestWindow(cheonhwangInput({ asOfDate: "2024-12-01" }))
  checkClose("바-30 9월이든 12월이든 이익이 같다", sep.candidates[2].operatingProfitKrw, dec.candidates[2].operatingProfitKrw, 0)
  checkEqual("바-31 달을 받는 인자가 없다(기준일은 표시용이다)", sep.candidates[2].priceKrwPerKg === dec.candidates[2].priceKrwPerKg, true)

  // ⑥ 문장을 만들지 않는다.
  checkEqual("바-32 판정이 코드다", narrow.decision, "hold_beyond_horizon")
  check("바-33 판정 코드에 공백이 없다(문장이 아니다)", !/\s/.test(narrow.decision), narrow.decision)
  const json = JSON.stringify(narrow)
  checkEqual("바-34 반환값 어디에도 한글 문장이 없다", /[가-힣]/.test(json.replace(/"(sourceNote|note|direction|observedAt|asOfDate|startDate|endDate|date|farm|vendor|marketplace|label)":"[^"]*"/g, "")), false)
  checkEqual("바-35 message·text 필드를 만들지 않았다", /"(message|text|advice|recommendationText)":/.test(json), false)

  // ⑦ 반올림하지 않는다 / 모르는 값을 0 으로 채우지 않는다.
  check("바-36 금액을 반올림하지 않는다", narrow.candidates[2].operatingProfitKrw !== Math.round(narrow.candidates[2].operatingProfitKrw), String(narrow.candidates[2].operatingProfitKrw))
  check("바-37 단가도 반올림하지 않는다", narrow.candidates[2].priceKrwPerKg !== Math.round(narrow.candidates[2].priceKrwPerKg), String(narrow.candidates[2].priceKrwPerKg))
  checkEqual("바-38 마리수를 안 주면 수를 안 낸다", harvestWindow(cheonhwangInput({ survivingCountNow: null })).failure, "count_unavailable")
  checkEqual("바-39 그때 후보도 비어 있다", harvestWindow(cheonhwangInput({ survivingCountNow: null })).candidates.length, 0)

  // 전망이 닿지 않는 후보는 **메우지 않고** 실패로 남고, 그 뒤쪽을 못 봤다는
  // 사실이 판정에 반영된다.
  const short = harvestWindow(cheonhwangInput({ abw: { kind: "gompertz", params: SATURATING_PARAMS, cddNow: 2000, waterTemp: { kind: "daily", waterTempC: Array(10).fill(25) } } }))
  checkEqual("바-40 전망이 모자란 후보는 null 이다", short.candidates[2].abwG, null)
  checkEqual("바-41 평균으로 메우지 않는다", short.candidates[2].failure, "abw_unavailable")
  checkEqual("바-42 평가 못 한 후보 수를 돌려준다", short.unevaluableCandidateCount, 1)
  checkEqual("바-43 뒤쪽을 못 봤다는 사실이 판정에 들어간다", short.decision, "hold_beyond_horizon")
  checkEqual("바-44 지평 경고도 붙는다", hasCode(short.exclusions, "harvest_horizon_truncated"), true)
  // 최대가 "지금" 인데 그 뒤를 못 봤으면 **'지금 출하' 라고 하지 않는다.**
  const blind = harvestWindow(cheonhwangInput({ abw: { kind: "daily_abw_g", abwG: [EXPECT.anchorAbwG, EXPECT.anchorAbwG + 0.2] } }))
  checkEqual("바-45 1주·2주를 못 봤다", blind.unevaluableCandidateCount, 2)
  checkEqual("바-46 그때 최대는 지금이다", blind.best.dayOffset, 0)
  checkEqual("바-47 **그래도 '지금 출하'로 단정하지 않는다**", blind.decision, "indeterminate")

  // 엔진 1·단가 함수를 다시 쓰지 않았다는 확인 — 같은 입력에 같은 수가 나온다.
  const params = SATURATING_PARAMS
  const cdd = cddAtDay(2000, { kind: "constant", waterTempC: 25 }, 14)
  checkEqual("바-48 적산수온은 기준온도를 차감하지 않는다(base 0)", cdd, 2000 + 25 * 14)
  checkClose("바-49 개체중이 엔진 1 의 predictAbw 와 같다", abwAtDay({ kind: "gompertz", params, cddNow: 2000, waterTemp: { kind: "constant", waterTempC: 25 } }, 14).abwG, predictAbw(params, cdd), 0)
  const fit = fitGompertz([1200, 1400, 1600, 1800, 2000].map((c) => ({ cdd: c, abwG: predictAbw(params, c) })), { winfG: 40 })
  checkEqual("바-50 엔진 1 적합 결과를 그대로 받는다", fit.failure, null)
  checkClose("바-51 그 적합이 원 파라미터를 되찾는다", fit.params.k, params.k, 1e-9)
  checkEqual("바-52 그 적합으로 엔진 3 이 돌아간다", harvestWindow(saturatingInput({ abw: { kind: "gompertz", params: fit.params, cddNow: 2000, waterTemp: { kind: "constant", waterTempC: 25 } } })).failure, null)
  checkClose("바-53 기본 탄력성이 단가 모델의 것이다", narrow.price.elasticity.value, DEFAULT_SIZE_ELASTICITY.value, 0)

  console.log("")
  console.log(`  구분 불가 사례(개체중 ±0.895g): 추천 d${wide.recommended.startDayOffset}~d${wide.recommended.endDayOffset} · ${wide.decision} · 구분 불가 ${wide.recommended.indistinguishableWithinWindow}`)
  for (const c of wide.candidates) {
    console.log(`    d${c.dayOffset} 이익 밴드 ${krw(c.profitBandKrw.low)} ~ ${krw(c.profitBandKrw.high)}원`)
  }
  console.log(`  포화 곡선 사례: 한계이익 0 통과 ${sat.marginal.zeroCrossingDayOffset.toFixed(2)}일 · 최대 d${sat.best.dayOffset} · 추천 d${sat.recommended.startDayOffset}~d${sat.recommended.endDayOffset}`)
  console.log(`    한계이익: ${sat.marginal.rows.map((r) => `${r.fromDayOffset}-${r.toDayOffset}일 ${r.perDayKrw > 0 ? "+" : ""}${krw(r.perDayKrw)}원/일`).join(" · ")}`)
  console.log(`  밴드 폭의 출처: ${narrow.band.sources.join("+")} (탄력성 ${narrow.band.priceElasticity.low}~${narrow.band.priceElasticity.high} · 개체중 ±${narrow.band.abwUncertaintyG}g) — **신뢰구간이 아니다**`)
  console.log(`  2주 뒤 누적 생존율 ${pct(narrow.candidates[2].survivalFromNow)}`)
}

// ── 실행 ─────────────────────────────────────────────────────────────────

console.log("=".repeat(84))
console.log("출하 윈도우 엔진 자체검증 — lib/harvest")
console.log("=".repeat(84))

basicChecks()
cheonhwangChecks()
mortalityChecks()
anchorChecks()
exclusionChecks()
designRuleChecks()

console.log("\n" + "=".repeat(84))
if (fails.length === 0) {
  console.log(`전부 통과 — ${checks}항목`)
} else {
  console.log(`실패 ${fails.length}/${checks}항목`)
  for (const f of fails) console.log(`  · ${f}`)
}
console.log("=".repeat(84))
process.exit(fails.length === 0 ? 0 : 1)
