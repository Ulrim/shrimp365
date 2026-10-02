// 엔진 2(수익성 예측) 자체검증 — 구현이 설계대로이고 농가 실적표의 수를
// 재현하는지 확인한다. scripts/growth/verify.mjs 와 같은 방식·같은 역할이다.
//
//   node scripts/profitability/verify.mjs
//
// 테스트 프레임워크를 들이지 않는다(이 저장소에 없다). Node 22 의 타입
// 스트리핑으로 lib/profitability 의 .ts 를 그대로 불러 쓰므로 새 의존성도 없다.
//
// 검증은 세 층이다.
//
//   (가) **실적표 재현** — 2026-10-02 농가 제공 비용 자료 + 천황수산 2024
//        코호트. 생존율 44.8% · FCR 3.21 · 손익 −29,209,700원 · kg당 원가
//        14,489원. **데이터 파일이 필요 없다** — 집계값이 전부 아래 상수에
//        들어 있어서 누구나 돌릴 수 있다.
//   (나) **생존율 민감도표 재현** — 4행 + 손익분기 생존율.
//   (다) **설계 규칙 검사** — 채널을 안 고르면 어떻게 되는가, 미포함 항목
//        목록이 실제로 채워지는가, 미입력 비용이 0 으로 채워지지 않는가.
//
// (다)가 이 스크립트의 절반이다. 금액이 맞는지는 (가)·(나)로 끝나는데,
// **금액이 맞는 채로 조용히 틀리는 쪽**이 엔진 2 의 실제 위험이다 —
// 도매가로 계산해 소매 수익을 보여 주거나, 인건비 미입력을 0 으로 더해
// 영업이익을 좋게 만드는 쪽.

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
  computeCost,
  addCosts,
  costOf,
  computeActuals,
  computeRevenue,
  projectHarvestScenarios,
  survivalSensitivity,
  breakEvenSurvivalRate,
  resolvePrice,
  CHANNEL_MEDIAN_KRW_PER_KG,
  ELECTRICITY_BILLS_2024,
  summarizeElectricityBills,
  DEFAULT_FEED_KRW_PER_KG,
  DEFAULT_SEED_KRW_PER_PL,
  DEFAULT_ELECTRICITY_KRW_PER_KWH,
  AGRICULTURAL_ENERGY_CHARGE_KRW_PER_KWH,
  ELECTRICITY_BILLED_KWH,
  ELECTRICITY_BILLED_KRW,
} = await import("../../lib/profitability/index.ts")

const { fitGompertz, predictAbw } = await import("../../lib/growth/index.ts")

// ── 천황수산 2024 코호트 집계값 ───────────────────────────────────────────
// 단일 코호트 2024-03-12 입식 ~ 2024-12-05, 수조 5개.
// 근거: docs/plans/tips-2026-dataset-assessment.md + 2026-10-02 농가 제공 비용.
const COHORT = {
  stockedCount: 1_200_000,
  stockedBiomassKg: 9.0,
  feedKg: 16_378.5,
  harvestedKg: 5_111.6,
  harvestedCount: 537_562,
  confirmedRevenueKrw: 44_853_100,
  revenueRecordCount: 41,
  // 매출에 안 잡힌 냉동 재고. transfer_to_freezer 7건으로 나갔고 freezer 채널
  // 기록 9건은 중량·금액이 비어 있다.
  frozenInventoryKg: 1_221,
  // 이벤트 원장에 없는 12월 출하(T1 출하 116 + 냉동 93). 메모에만 있다.
  outOfLedgerHarvestKg: 209,
  // 고지서가 2024-10 까지다. 11·12월이 없다.
  electricityUnbilledMonths: 2,
}

// 기대값 — 작업 지시서의 실적표.
const EXPECT = {
  plKrw: 12_000_000,
  feedKrw: 37_670_550,
  electricityKrw: 24_392_250,
  totalCostKrw: 74_062_800,
  survivalRate: 0.448,
  fcr: 3.21,
  costPerKgKrw: 14_489,
  operatingProfitKrw: -29_209_700,
}

// 생존율 민감도표 — 손익은 만원 단위 반올림, FCR 은 소수 둘째 자리.
const SENSITIVITY_TABLE = [
  { survivalRate: null, profitManwon: -2921, fcr: 3.21 }, // null = 실측 생존율
  { survivalRate: 0.6, profitManwon: -1399, fcr: 2.4 },
  { survivalRate: 0.7, profitManwon: -397, fcr: 2.05 },
  { survivalRate: 0.85, profitManwon: 1104, fcr: 1.69 },
]

// 손익분기 생존율. **작업 지시서는 "약 72%" 라고 적었는데 계산하면 74.0% 다.**
// 지시서의 민감도표 4행(나머지 전부 고정)과 그 표가 나온 모델에서는 72% 가
// 나오지 않는다 — 70% 에서 −397만, 85% 에서 +1,104만이면 영점은 선형보간으로도
// 73.97% 다. 표의 수는 전부 재현되므로 모델이 아니라 **72 라는 수가 어긋난
// 것으로 본다.** 여기에 74.0% 를 기대값으로 박고, 사람이 다시 볼 수 있게
// 아래에서 두 수를 같이 출력한다.
const EXPECT_BREAK_EVEN = 0.7397
const PLAN_BREAK_EVEN_CLAIM = 0.72

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

const krw = (v) => (typeof v === "number" ? Math.round(v).toLocaleString("ko-KR") : String(v))
const hasCode = (list, code, item) =>
  (list ?? []).some((e) => e.code === code && (item === undefined || e.item === item))
const findCode = (list, code) => (list ?? []).find((e) => e.code === code)

/** 실적 코호트의 비용. 인건·약품·기타는 **일부러 넣지 않는다** — 자료가 없다. */
function cohortCost() {
  return computeCost({
    stockedCount: COHORT.stockedCount,
    feedKg: COHORT.feedKg,
    electricityKrw: EXPECT.electricityKrw,
    electricityUnbilledMonths: COHORT.electricityUnbilledMonths,
  })
}

function cohortActuals(revenueOverrides = {}) {
  return computeActuals(
    {
      stockedCount: COHORT.stockedCount,
      stockedBiomassKg: COHORT.stockedBiomassKg,
      harvestedKg: COHORT.harvestedKg,
      harvestedCount: COHORT.harvestedCount,
      feedKg: COHORT.feedKg,
      // 회차는 사람이 메모를 읽어 복원한 파생 라벨이다(dataset-assessment 4-7).
      cycleBoundary: "human_derived",
      revenue: {
        confirmedKrw: COHORT.confirmedRevenueKrw,
        recordCount: COHORT.revenueRecordCount,
        unsoldInventory: { weightKg: COHORT.frozenInventoryKg },
        outOfLedgerHarvestKg: COHORT.outOfLedgerHarvestKg,
        ...revenueOverrides,
      },
    },
    cohortCost(),
  )
}

// ── (가) 실적표 재현 ──────────────────────────────────────────────────────

function actualsChecks() {
  console.log("\n[가] 실적표 재현 — 천황수산 2024 코호트 + 2026-10-02 농가 비용 자료\n")

  // 0. 단가 기본값이 농가 제공값인가.
  checkEqual("가-0-1 사료 기본 단가 2,300 원/kg", DEFAULT_FEED_KRW_PER_KG, 2300)
  checkEqual("가-0-2 종묘 기본 단가 10 원/마리", DEFAULT_SEED_KRW_PER_PL, 10)
  checkEqual("가-0-3 고지서 합 사용량 275,193 kWh", ELECTRICITY_BILLED_KWH, 275_193)
  checkEqual("가-0-4 고지서 합 청구액 24,392,250 원", ELECTRICITY_BILLED_KRW, 24_392_250)
  checkClose("가-0-5 기본 전기 단가는 실청구 기준 88.6 원/kWh", DEFAULT_ELECTRICITY_KRW_PER_KWH, 88.6, 0.05)
  // 고지서 묶음 요약 — 월별 원본을 그대로 두고 합을 구한다.
  const bills = summarizeElectricityBills(ELECTRICITY_BILLS_2024)
  checkEqual("가-0-5a 고지서는 3~10월 8개월", bills.months, 8)
  checkEqual("가-0-5b 요약이 상수와 일치한다", `${bills.kwh}/${bills.krw}`, `${ELECTRICITY_BILLED_KWH}/${ELECTRICITY_BILLED_KRW}`)
  checkEqual("가-0-5c 3월이 최고 사용량 69,797 kWh", Math.max(...ELECTRICITY_BILLS_2024.map((b) => b.kwh)), 69_797)
  checkEqual("가-0-5d 빈 묶음이면 단가가 null — 0 이 아니다", summarizeElectricityBills([]).krwPerKwh, null)
  // 요금표 전력량요금과 기본값이 다르다는 것을 상수로 확인한다 — 누가 65.9 로
  // 바꾸면 이 항목이 깨진다.
  checkEqual("가-0-6 농사용(을) 전력량요금 상수는 65.9", AGRICULTURAL_ENERGY_CHARGE_KRW_PER_KWH, 65.9)
  check(
    "가-0-7 기본 단가가 65.9 로 바뀌지 않았다",
    Math.abs(DEFAULT_ELECTRICITY_KRW_PER_KWH - AGRICULTURAL_ENERGY_CHARGE_KRW_PER_KWH) > 20,
    `실청구 ${DEFAULT_ELECTRICITY_KRW_PER_KWH.toFixed(3)} / 요금표 ${AGRICULTURAL_ENERGY_CHARGE_KRW_PER_KWH}`,
  )

  // 1. 항목별 비용과 합계.
  const cost = cohortCost()
  checkEqual("가-1-1 종묘비 = 1,200,000마리 × 10원", costOf(cost, "pl"), EXPECT.plKrw)
  checkEqual("가-1-2 사료비 = 16,378.5kg × 2,300원", costOf(cost, "feed"), EXPECT.feedKrw)
  checkEqual("가-1-3 전기비 = 고지서 실청구액", costOf(cost, "electricity"), EXPECT.electricityKrw)
  checkEqual("가-1-4 비용 합계 74,062,800원", cost.knownTotalKrw, EXPECT.totalCostKrw)
  checkEqual("가-1-5 인건·약품·기타는 미입력으로 남는다", cost.missingItems.join(","), "labor,chemicals,other")
  checkEqual("가-1-6 비용이 완전하지 않다고 알린다", cost.complete, false)

  // 2. 실적 지표.
  const a = cohortActuals()
  checkClose("가-2-1 생존율 44.8%", a.survivalRate, EXPECT.survivalRate, 0.0005)
  checkClose("가-2-2 FCR 3.21", a.fcr, EXPECT.fcr, 0.005)
  checkClose("가-2-3 kg당 원가 14,489원", a.costPerKgKrw, EXPECT.costPerKgKrw, 0.5)
  checkEqual("가-2-4 확정 매출 44,853,100원 (41건)", a.revenue.confirmedKrw, COHORT.confirmedRevenueKrw)
  checkEqual("가-2-5 매출 건수를 돌려준다", a.revenue.recordCount, 41)
  checkEqual("가-2-6 영업이익 −29,209,700원", a.operatingProfitKrw, EXPECT.operatingProfitKrw)
  checkClose("가-2-7 출하 개체 평균중량", a.meanHarvestWeightG, (COHORT.harvestedKg * 1000) / COHORT.harvestedCount, 1e-9)
  checkClose("가-2-8 순증체 = 출하 − 입식", a.biomassGainKg, COHORT.harvestedKg - COHORT.stockedBiomassKg, 1e-9)

  // 3. FCR 은 순증체로 나눈다 — 출하 총중량으로 나누면 3.20 이다.
  const grossFcr = COHORT.feedKg / COHORT.harvestedKg
  checkEqual("가-3-1 총중량 기준 FCR 은 3.20 (기존 화면 산식)", Number(grossFcr.toFixed(2)), 3.2)
  checkEqual("가-3-2 엔진은 순증체 기준 3.21 을 쓴다", Number(a.fcr.toFixed(2)), 3.21)

  // 4. 실현 단가 — 확정매출 ÷ 출하중량. 채널 단가보다 한참 낮다.
  checkClose("가-4-1 실현 단가 8,775 원/kg", a.realizedPriceKrwPerKg, 8774.76, 1)
  check(
    "가-4-2 실현 단가가 도매 중앙값의 절반 수준이다 (재고가 분모에만 있다)",
    a.realizedPriceKrwPerKg < CHANNEL_MEDIAN_KRW_PER_KG.wholesale * 0.6,
    `실현 ${krw(a.realizedPriceKrwPerKg)} / 도매 ${krw(CHANNEL_MEDIAN_KRW_PER_KG.wholesale)}`,
  )

  console.log("")
  console.log(`  비용 ${krw(cost.knownTotalKrw)}원 = 종묘 ${krw(costOf(cost, "pl"))} + 사료 ${krw(costOf(cost, "feed"))} + 전기 ${krw(costOf(cost, "electricity"))}`)
  console.log(`  매출 ${krw(a.revenue.knownTotalKrw)}원 · 손익 ${krw(a.operatingProfitKrw)}원 · kg당 원가 ${krw(a.costPerKgKrw)}원`)
  console.log(`  생존율 ${(a.survivalRate * 100).toFixed(1)}% · FCR ${a.fcr.toFixed(2)} · 영업이익률 ${(a.operatingMarginRate * 100).toFixed(1)}%`)
}

// ── (나) 생존율 민감도표 재현 ─────────────────────────────────────────────

function sensitivityChecks() {
  console.log("\n[나] 생존율 민감도표 재현 — 나머지 전부 고정\n")

  const cost = cohortCost()
  const referenceRate = COHORT.harvestedCount / COHORT.stockedCount
  const input = {
    stockedCount: COHORT.stockedCount,
    stockedBiomassKg: COHORT.stockedBiomassKg,
    feedKg: COHORT.feedKg,
    referenceHarvestedKg: COHORT.harvestedKg,
    referenceHarvestedCount: COHORT.harvestedCount,
    cost,
    // 실측 행과 이어지려면 실현 단가여야 한다. 여기서 채널 중앙값을 끼우면
    // 생존율이 아니라 단가를 바꾼 결과가 섞인다.
    price: { kind: "realized" },
    priceRealizedContext: { revenueKrw: COHORT.confirmedRevenueKrw, weightKg: COHORT.harvestedKg },
  }

  const rates = SENSITIVITY_TABLE.map((r) => r.survivalRate ?? referenceRate)
  const out = survivalSensitivity(input, rates)

  console.log(`  ${"생존율".padStart(8)} ${"바이오매스".padStart(12)} ${"매출".padStart(14)} ${"손익".padStart(14)} ${"FCR".padStart(6)}  실측`)
  for (const row of out.rows) {
    console.log(
      `  ${(row.survivalRate * 100).toFixed(1).padStart(7)}% ${row.biomassKg.toFixed(1).padStart(12)} ${krw(row.revenueKrw).padStart(14)} ${krw(row.operatingProfitKrw).padStart(14)} ${row.fcr.toFixed(2).padStart(6)}  ${row.isReference ? "●" : ""}`,
    )
  }
  console.log("")

  for (let i = 0; i < SENSITIVITY_TABLE.length; i++) {
    const want = SENSITIVITY_TABLE[i]
    const row = out.rows[i]
    const label = `${((want.survivalRate ?? referenceRate) * 100).toFixed(1)}%`
    checkEqual(`나-1-${i + 1} 손익 ${label} → ${want.profitManwon}만원`, Math.round(row.operatingProfitKrw / 10_000), want.profitManwon)
    checkEqual(`나-2-${i + 1} FCR  ${label} → ${want.fcr}`, Number(row.fcr.toFixed(2)), want.fcr)
  }

  // 실측 행만 가정이 아니다.
  checkEqual("나-3-1 실측 생존율 행이 표시된다", out.rows.filter((r) => r.isReference).length, 1)
  checkEqual("나-3-2 실측 행은 첫 행이다", out.rows[0].isReference, true)
  checkEqual(
    "나-3-3 나머지 행은 생존율이 가정이라고 알린다",
    out.rows.slice(1).every((r) => hasCode(r.exclusions, "survival_rate_assumed")),
    true,
  )
  checkClose("나-3-4 실측 행 손익은 실적과 같다", out.rows[0].operatingProfitKrw, EXPECT.operatingProfitKrw, 1)
  checkClose("나-3-5 실측 행 kg당 원가도 같다", out.rows[0].costPerKgKrw, EXPECT.costPerKgKrw, 0.5)

  // 고정한 것을 반환값에 적는다 — "생존율만 고치면 된다" 로 읽히지 않도록.
  checkEqual("나-4-1 고정한 급이량을 알린다", out.assumptions.feedKgHeldFixed, COHORT.feedKg)
  checkEqual("나-4-2 고정한 비용을 알린다", out.assumptions.costHeldFixedKrw, EXPECT.totalCostKrw)
  checkClose("나-4-3 쓴 단가를 알린다", out.assumptions.priceKrwPerKg, 8774.76, 1)
  checkClose("나-4-4 쓴 개체중을 알린다", out.assumptions.meanHarvestWeightG, 9.5088, 0.001)

  // 손익분기.
  const be = out.breakEven
  checkEqual("나-5-1 손익분기 계산 성공", be.failure, null)
  checkClose("나-5-2 손익분기 생존율 74.0%", be.survivalRate, EXPECT_BREAK_EVEN, 0.001)
  // 그 지점의 손익이 실제로 0 인가 — 닫힌 해가 표와 어긋나지 않는지 본다.
  const atBe = survivalSensitivity(input, [be.survivalRate])
  checkClose("나-5-3 그 생존율에서 손익이 0 이다", atBe.rows[0].operatingProfitKrw, 0, 1)
  console.log(
    `\n  손익분기 생존율 ${(be.survivalRate * 100).toFixed(2)}% — 작업 지시서는 "약 ${(PLAN_BREAK_EVEN_CLAIM * 100).toFixed(0)}%" 로 적었다.`,
  )
  console.log(`  지시서 표 4행은 전부 재현되므로 모델이 아니라 그 "${(PLAN_BREAK_EVEN_CLAIM * 100).toFixed(0)}%" 가 어긋난 것으로 본다(70%→−397만, 85%→+1,104만 사이 영점은 73.97%).`)

  // 손익분기가 1 을 넘는 경우 — 1 로 자르지 않는다.
  const hopeless = breakEvenSurvivalRate({
    ...input,
    cost: { ...cost, knownTotalKrw: cost.knownTotalKrw * 3 },
  })
  check(
    "나-6-1 전부 살아도 적자면 1 을 넘는 값을 그대로 돌려준다",
    hopeless.failure === null && hopeless.survivalRate > 1,
    `받음 ${hopeless.survivalRate}`,
  )
}

// ── (다) 설계 규칙 검사 ───────────────────────────────────────────────────

function channelChecks() {
  console.log("\n[다-1] 채널 — 조용히 도매가로 계산하지 않는가\n")

  // 1. 안 고르면 기본값으로 떨어지지 않는다.
  const none = resolvePrice(undefined)
  checkEqual("다-1-1 채널을 안 고르면 단가가 null", none.krwPerKg, null)
  checkEqual("다-1-2 그때 이유를 돌려준다", none.failure, "price_basis_not_selected")
  checkEqual("다-1-3 도매로 떨어지지 않았다", none.channel, null)
  checkEqual("다-1-4 미포함 목록에도 올린다", hasCode(none.exclusions, "price_basis_not_selected"), true)
  checkEqual("다-1-5 null 도 같다", resolvePrice(null).failure, "price_basis_not_selected")

  // 2. 고르면 어느 채널인지 반환값에 담긴다.
  for (const [channel, price] of Object.entries(CHANNEL_MEDIAN_KRW_PER_KG)) {
    const r = resolvePrice({ kind: "channel_median", channel })
    checkEqual(`다-2 ${channel} 중앙값 ${krw(price)}원 + 채널을 돌려준다`, `${r.krwPerKg}/${r.channel}`, `${price}/${channel}`)
  }
  const wholesale = resolvePrice({ kind: "channel_median", channel: "wholesale" })
  checkEqual("다-2-4 중앙값은 가정이라고 알린다", hasCode(wholesale.exclusions, "price_from_channel_median"), true)
  checkEqual("다-2-5 관측 폭과 표본 수를 함께 돌려준다", wholesale.observed.n, 9)
  const live = resolvePrice({ kind: "channel_median", channel: "retail_live" })
  checkEqual("다-2-6 소매 활새우는 관측 폭이 16,000~28,000", `${live.observed.minKrwPerKg}~${live.observed.maxKrwPerKg}`, "16000~28000")
  checkEqual(
    "다-2-7 도매↔소매활 차이 56%",
    Math.round(((CHANNEL_MEDIAN_KRW_PER_KG.retail_live - CHANNEL_MEDIAN_KRW_PER_KG.wholesale) / CHANNEL_MEDIAN_KRW_PER_KG.wholesale) * 100),
    56,
  )

  // 3. 명시 단가·실현 단가.
  const explicit = resolvePrice({ kind: "explicit", krwPerKg: 21000, channel: "retail_frozen" })
  checkEqual("다-3-1 명시 단가를 그대로 쓴다", explicit.krwPerKg, 21000)
  checkEqual("다-3-2 명시 단가는 가정 경고가 없다", explicit.exclusions.length, 0)
  const realized = resolvePrice({ kind: "realized" }, { revenueKrw: 44_853_100, weightKg: 5_111.6 })
  checkClose("다-3-3 실현 단가 역산", realized.krwPerKg, 8774.76, 1)
  checkEqual("다-3-4 실현 단가는 채널이 섞여 있어 null", realized.channel, null)
  checkEqual("다-3-5 역산 근거가 없으면 실패를 돌려준다", resolvePrice({ kind: "realized" }).failure, "no_realized_basis")

  // 4. 채널이 손익을 얼마나 바꾸나 — 같은 바이오매스로 세 채널을 돌린다.
  const cost = cohortCost()
  const base = { stockedCount: COHORT.stockedCount, incurredCost: cost, price: undefined }
  const scenario = [{ dayOffset: 0, abw: { kind: "abw_g", abwG: 9.5088 }, survivingCount: COHORT.harvestedCount }]

  const noPrice = projectHarvestScenarios(base, scenario)
  checkEqual("다-4-1 단가 근거 없이 예측하면 매출이 null", noPrice.scenarios[0].revenueKrw, null)
  checkEqual("다-4-2 그때 영업이익도 null — 0 이 아니다", noPrice.scenarios[0].operatingProfitKrw, null)
  checkEqual("다-4-3 그 이유가 반환값에 있다", noPrice.price.failure, "price_basis_not_selected")

  const byChannel = {}
  for (const channel of ["wholesale", "retail_live", "retail_frozen"]) {
    const p = projectHarvestScenarios({ ...base, price: { kind: "channel_median", channel } }, scenario)
    byChannel[channel] = p.scenarios[0]
    checkEqual(`다-4-4 ${channel} 로 계산했음이 시나리오에 담긴다`, p.scenarios[0].channel, channel)
  }
  const spread = byChannel.retail_live.operatingProfitKrw - byChannel.wholesale.operatingProfitKrw
  check(
    "다-4-5 채널만 바꿔도 영업이익이 4,800만원 넘게 달라진다",
    spread > 48_000_000,
    `차이 ${krw(spread)}원`,
  )
  console.log("")
  for (const [channel, s] of Object.entries(byChannel)) {
    console.log(`  ${channel.padEnd(14)} 단가 ${krw(s.priceKrwPerKg).padStart(7)}원/kg · 매출 ${krw(s.revenueKrw).padStart(12)}원 · 손익 ${krw(s.operatingProfitKrw).padStart(13)}원`)
  }
}

function exclusionChecks() {
  console.log("\n[다-2] 미포함 항목 — 금액만 돌려주지 않는가\n")

  const a = cohortActuals()
  const want = [
    ["cost_not_recorded", "labor", "인건비 미입력"],
    ["cost_not_recorded", "chemicals", "약품비 미입력"],
    ["cost_not_recorded", "other", "기타비용 미입력"],
    ["cost_depreciation_not_modeled", undefined, "감가가 모델에 없다"],
    ["electricity_billing_incomplete", undefined, "11·12월 전기요금 없음"],
    ["revenue_unsold_inventory", undefined, "냉동 재고 1,221 kg 매출 미계상"],
    ["harvest_not_in_event_ledger", undefined, "12월 출하 209 kg 원장 누락"],
    ["cycle_boundary_derived_label", undefined, "회차 경계가 사람 검수 파생 라벨"],
  ]
  for (const [code, item, label] of want) {
    checkEqual(`다-2-1 ${label}`, hasCode(a.exclusions, code, item), true)
  }
  checkEqual("다-2-2 미포함 항목이 8건", a.exclusions.length, want.length)
  checkEqual("다-2-3 확정 손익이 아니라고 알린다", a.complete, false)

  // 회차 경계의 출처 — 엔진이 추측하지 않는다.
  const unresolved = computeActuals({ cycleBoundary: "unresolved" }, cohortCost())
  checkEqual("다-2-3a 복원 실패는 다른 코드로 알린다", hasCode(unresolved.exclusions, "cycle_boundary_not_resolved"), true)
  const fromSource = computeActuals({ cycleBoundary: "source_data" }, cohortCost())
  checkEqual("다-2-3b 원본에 회차 ID 가 있으면 경고하지 않는다", hasCode(fromSource.exclusions, "cycle_boundary_derived_label"), false)
  const unsaid = computeActuals({}, cohortCost())
  checkEqual("다-2-3c 안 알려주면 추측해 경고하지 않는다", hasCode(unsaid.exclusions, "cycle_boundary_derived_label"), false)

  // 수량이 실제로 담겨 있는가 — 코드만 돌려주면 화면이 금액을 못 보여 준다.
  checkEqual("다-2-4 재고 중량 1,221 kg", findCode(a.exclusions, "revenue_unsold_inventory").quantity, 1_221)
  checkEqual("다-2-5 원장 누락 209 kg", findCode(a.exclusions, "harvest_not_in_event_ledger").quantity, 209)
  checkEqual("다-2-6 미청구 2개월", findCode(a.exclusions, "electricity_billing_incomplete").quantity, 2)
  checkEqual("다-2-7 미입력 비용의 수량은 null — 0 이 아니다", findCode(a.exclusions, "cost_not_recorded").quantity, null)

  // 재고를 평가해 넣으면 매출에 들어가고 경고가 사라진다. **평가는 사람이 한다.**
  const valued = cohortActuals({
    unsoldInventory: {
      weightKg: COHORT.frozenInventoryKg,
      valuation: { kind: "channel_median", channel: "wholesale" },
    },
  })
  checkEqual("다-2-8 재고를 도매가로 평가하면 20,757,000원", valued.revenue.inventoryValuationKrw, 1_221 * 17_000)
  checkEqual("다-2-9 그때 손익이 −8,452,700원", valued.operatingProfitKrw, -8_452_700)
  checkEqual("다-2-10 재고 경고가 사라진다", hasCode(valued.exclusions, "revenue_unsold_inventory"), false)
  checkEqual("다-2-11 대신 단가가 가정이라고 알린다", hasCode(valued.exclusions, "price_from_channel_median"), true)
  checkEqual("다-2-12 확정 매출은 따로 남는다", valued.revenue.confirmedKrw, COHORT.confirmedRevenueKrw)
  check(
    "다-2-13 재고 평가가 손익의 70% 를 움직인다",
    Math.abs(valued.operatingProfitKrw - EXPECT.operatingProfitKrw) > 20_000_000,
    `${krw(EXPECT.operatingProfitKrw)} → ${krw(valued.operatingProfitKrw)}`,
  )

  // 평가 기준을 못 정하면 0 으로 치지 않는다.
  const badValuation = computeRevenue({
    confirmedKrw: 1_000_000,
    unsoldInventory: { weightKg: 500, valuation: { kind: "realized" } },
  })
  checkEqual("다-2-14 평가 기준을 못 정하면 평가액이 null", badValuation.inventoryValuationKrw, null)
  checkEqual("다-2-15 그때 재고는 매출에서 빠지고 목록에 남는다", hasCode(badValuation.exclusions, "revenue_unsold_inventory"), true)
  checkEqual("다-2-16 재고가 0 으로 더해지지 않았다", badValuation.knownTotalKrw, 1_000_000)
}

function zeroFillChecks() {
  console.log("\n[다-3] 0 으로 채우지 않는가 — 미입력과 0 원은 다르다\n")

  const partial = computeCost({ stockedCount: COHORT.stockedCount, feedKg: COHORT.feedKg })
  checkEqual("다-3-1 미입력 항목은 lines 에 없다", partial.lines.map((l) => l.item).join(","), "pl,feed")
  checkEqual("다-3-2 미입력 항목의 금액은 null", costOf(partial, "labor"), null)
  checkEqual("다-3-3 합계는 입력된 것만 더한다", partial.knownTotalKrw, EXPECT.plKrw + EXPECT.feedKrw)
  checkEqual("다-3-4 부분합임을 알린다", partial.complete, false)

  // 0 원 입력은 기록이다 — 미입력과 구분된다.
  const zeroLabor = computeCost({ stockedCount: COHORT.stockedCount, feedKg: COHORT.feedKg, laborKrw: 0 })
  checkEqual("다-3-5 인건비 0원은 기록으로 인정한다", costOf(zeroLabor, "labor"), 0)
  checkEqual("다-3-6 0원은 미입력 목록에 없다", zeroLabor.missingItems.includes("labor"), false)
  checkEqual("다-3-7 0원은 미포함 경고도 없다", hasCode(zeroLabor.exclusions, "cost_not_recorded", "labor"), false)
  checkEqual("다-3-8 미입력은 목록에 있다", partial.missingItems.includes("labor"), true)

  // 합계가 조용히 작아지지 않는가 — 인건비를 넣으면 그만큼 커지고 손익이 나빠진다.
  const withLabor = computeCost({
    stockedCount: COHORT.stockedCount,
    feedKg: COHORT.feedKg,
    electricityKrw: EXPECT.electricityKrw,
    electricityUnbilledMonths: COHORT.electricityUnbilledMonths,
    laborKrw: 30_000_000,
    chemicalsKrw: 2_000_000,
    otherKrw: 1_000_000,
  })
  checkEqual("다-3-9 인건·약품·기타를 넣으면 합계가 그만큼 커진다", withLabor.knownTotalKrw - EXPECT.totalCostKrw, 33_000_000)
  checkEqual("다-3-10 그래도 전기 고지서 미비는 남는다", withLabor.complete, false)
  checkEqual("다-3-11 미입력 항목은 사라졌다", withLabor.missingItems.length, 0)

  // 사이클이 안 닫혔을 때 — 손익이 null 로 나오는 쪽이 0 보다 낫다.
  const noRevenue = computeActuals(
    { stockedCount: COHORT.stockedCount, harvestedKg: 100, harvestedCount: 10_000 },
    partial,
  )
  checkEqual("다-3-12 매출이 없으면 손익은 null — 비용만큼 적자로 단정하지 않는다", noRevenue.operatingProfitKrw, null)
  checkEqual("다-3-13 매출 합계도 null", noRevenue.revenue.knownTotalKrw, null)
  checkEqual("다-3-14 입식 바이오매스를 모르면 FCR 은 null", noRevenue.fcr, null)

  // 생존율·개체중을 모르면 민감도도 null 로 나온다.
  const blind = survivalSensitivity({ cost: partial, price: { kind: "channel_median", channel: "wholesale" } }, [0.5])
  checkEqual("다-3-15 개체중·입식수를 모르면 바이오매스 null", blind.rows[0].biomassKg, null)
  checkEqual("다-3-16 그때 손익도 null", blind.rows[0].operatingProfitKrw, null)
  checkEqual("다-3-17 손익분기도 이유와 함께 null", blind.breakEven.failure, "no_mean_weight")
}

function projectionChecks() {
  console.log("\n[다-4] 예상 지표 — 엔진 1 위에 올라가는가\n")

  // 엔진 1 의 적합 결과를 그대로 받는다.
  const winfG = 25
  const truth = { b: 4.2, k: 0.0007 }
  const xs = [1800, 2400, 3000, 3600, 4200, 4800]
  const points = xs.map((cdd) => ({ cdd, abwG: winfG * Math.exp(-truth.b * Math.exp(-truth.k * cdd)) }))
  const fit = fitGompertz(points, { winfG })
  checkEqual("다-4-1 엔진 1 적합이 성공한다", fit.failure, null)

  const cost = cohortCost()
  const base = {
    stockedCount: 1_000_000,
    incurredCost: cost,
    price: { kind: "channel_median", channel: "wholesale" },
  }
  const now = { dayOffset: 0, abw: { kind: "gompertz", params: fit.params, cdd: 4800 }, survivalRate: 0.6 }
  const later = {
    dayOffset: 30,
    abw: { kind: "gompertz", params: fit.params, cdd: 4800 + 30 * 28 },
    survivalRate: 0.57,
  }

  const p = projectHarvestScenarios(base, [now, later])
  checkClose("다-4-2 지금 출하 ABW 는 엔진 1 의 예측과 같다", p.scenarios[0].abwG, predictAbw(fit.params, 4800), 1e-9)
  checkEqual("다-4-3 생존율로 마리수를 구한다", p.scenarios[0].survivingCount, 600_000)
  checkClose("다-4-4 바이오매스 = 마리수 × 개체중 ÷ 1000", p.scenarios[0].biomassKg, (600_000 * p.scenarios[0].abwG) / 1000, 1e-9)
  checkClose("다-4-5 매출 = 바이오매스 × 단가", p.scenarios[0].revenueKrw, p.scenarios[0].biomassKg * 17_000, 1e-6)
  checkClose(
    "다-4-6 영업이익 = 매출 − 비용",
    p.scenarios[0].operatingProfitKrw,
    p.scenarios[0].revenueKrw - cost.knownTotalKrw,
    1e-6,
  )
  checkEqual("다-4-7 지금 출하의 지금 대비 차액은 0", p.scenarios[0].profitDeltaFromFirstKrw, 0)
  check("다-4-8 30일 뒤 ABW 가 더 크다", p.scenarios[1].abwG > p.scenarios[0].abwG, `${p.scenarios[0].abwG} → ${p.scenarios[1].abwG}`)

  // 잔여기간 비용을 안 주면 0 으로 채우지 않고 경고한다.
  checkEqual("다-4-9 지금 출하에는 잔여비용 경고가 없다", hasCode(p.scenarios[0].exclusions, "remaining_period_cost_not_estimated"), false)
  checkEqual("다-4-10 30일 뒤에는 잔여비용 미추정을 알린다", hasCode(p.scenarios[1].exclusions, "remaining_period_cost_not_estimated"), true)
  checkEqual("다-4-11 남은 일수를 수량으로 담는다", findCode(p.scenarios[1].exclusions, "remaining_period_cost_not_estimated").quantity, 30)
  checkEqual("다-4-12 그때 비용은 누적 그대로다", p.scenarios[1].cost.knownTotalKrw, cost.knownTotalKrw)

  // 잔여 사료를 주면 비용에 더해지고 경고가 사라진다.
  const withFeed = projectHarvestScenarios(base, [now, { ...later, additionalCost: { feedKg: 3_000 } }])
  checkEqual("다-4-13 잔여 사료 3,000kg → 비용 +690만원", withFeed.scenarios[1].cost.knownTotalKrw - cost.knownTotalKrw, 3_000 * 2_300)
  checkEqual("다-4-14 그때 잔여비용 경고가 사라진다", hasCode(withFeed.scenarios[1].exclusions, "remaining_period_cost_not_estimated"), false)
  checkEqual("다-4-15 전기 고지서 미비 경고는 살아남는다", hasCode(withFeed.scenarios[1].exclusions, "electricity_billing_incomplete"), true)
  check(
    "다-4-16 잔여비용을 넣으면 30일 뒤 이익이 낮아진다",
    withFeed.scenarios[1].operatingProfitKrw < p.scenarios[1].operatingProfitKrw,
    `${krw(p.scenarios[1].operatingProfitKrw)} → ${krw(withFeed.scenarios[1].operatingProfitKrw)}`,
  )

  // 예측은 예측이라고 적는다.
  checkEqual("다-4-17 개체중이 예측값임을 알린다", hasCode(p.scenarios[0].exclusions, "abw_from_growth_projection"), true)
  checkEqual("다-4-18 생존율이 가정임을 알린다", hasCode(p.scenarios[0].exclusions, "survival_rate_assumed"), true)
  checkClose("다-4-19 가정한 생존율을 수량으로 담는다", findCode(p.scenarios[0].exclusions, "survival_rate_assumed").quantity, 0.6, 1e-12)

  // 적합이 실패했을 때 — 죽지 않고 null 로 나온다.
  const broken = projectHarvestScenarios(base, [
    { dayOffset: 0, abw: { kind: "gompertz", params: { winfG: 25, b: NaN, k: 0.0007 }, cdd: 4000 }, survivalRate: 0.6 },
  ])
  checkEqual("다-4-20 적합 파라미터가 깨지면 ABW null", broken.scenarios[0].abwG, null)
  checkEqual("다-4-21 그때 바이오매스·손익도 null", broken.scenarios[0].operatingProfitKrw, null)

  console.log("")
  for (const s of p.scenarios) {
    console.log(
      `  +${String(s.dayOffset).padStart(2)}일  ABW ${s.abwG.toFixed(2).padStart(6)}g · ${krw(s.biomassKg).padStart(6)}kg · 매출 ${krw(s.revenueKrw).padStart(12)}원 · 손익 ${krw(s.operatingProfitKrw).padStart(12)}원 · 지금 대비 ${krw(s.profitDeltaFromFirstKrw).padStart(11)}원`,
    )
  }

  // 비용 합산이 항목을 잃지 않는가.
  const merged = addCosts(cost, computeCost({ feedKg: 1_000, laborKrw: 5_000_000 }))
  checkEqual("다-4-22 합산하면 같은 항목이 더해진다", costOf(merged, "feed"), EXPECT.feedKrw + 1_000 * 2_300)
  checkEqual("다-4-23 한쪽에만 있는 항목도 들어온다", costOf(merged, "labor"), 5_000_000)
  checkEqual("다-4-24 합산 합계", merged.knownTotalKrw, EXPECT.totalCostKrw + 2_300_000 + 5_000_000)
  checkEqual("다-4-25 합산해도 남은 미입력을 알린다", merged.missingItems.join(","), "chemicals,other")
}

// ── 실행 ─────────────────────────────────────────────────────────────────

console.log("=".repeat(84))
console.log("엔진 2 수익성 예측 자체검증 — lib/profitability")
console.log("=".repeat(84))

actualsChecks()
sensitivityChecks()
channelChecks()
exclusionChecks()
zeroFillChecks()
projectionChecks()

console.log("\n" + "=".repeat(84))
if (fails.length === 0) {
  console.log(`전부 통과 — ${checks}항목`)
} else {
  console.log(`실패 ${fails.length}/${checks}항목`)
  for (const f of fails) console.log(`  · ${f}`)
}
console.log("=".repeat(84))
process.exit(fails.length === 0 ? 0 : 1)
