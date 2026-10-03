"use client"

// 엔진 1·2·3 을 **한 곳에서** 돌린다.
//
// 왜 훅인가 — 열 개가 넘는 컴포넌트가 같은 엔진 결과를 읽는다. 각자 호출하면
// 같은 사이클의 생존율이 화면 두 곳에서 다르게 나오고(입력 조립이 조금씩
// 달라서), 그 불일치는 눈에 안 띈다. 조립은 여기만 있다.
//
// ── 이 훅의 규칙 ──────────────────────────────────────────────────────────
//  1. **모르는 값을 0 으로 채우지 않는다.** 엔진 넷이 전부 이 규칙으로 쓰였고
//     (미입력과 0 원은 다른 사건이다), 화면 입구에서 0 을 채우면 그 설계가
//     통째로 무의미해진다. 비용 항목이 한 건도 없으면 그 칸을 **보내지 않고**,
//     엔진이 missingItems 로 알린다.
//  2. **DB 를 더 부르지 않는다.** 단 하나 예외가 일별 수온(getDailyWaterTemps)
//     이고, 그것도 부모가 불러서 인자로 넘긴다 — 훅은 순수 계산이다.
//  3. **엔진이 failure 를 주면 그 자리를 null 로 두고 코드를 그대로 올린다.**
//     화면이 코드로 분기한다. 훅이 문장을 만들지 않는다.
//  4. **엔진 산식을 다시 쓰지 않는다.** 「아는 폭」도 computeActuals 를 두 번
//     부르는 것으로 만든다(설계서 2-4).
//
// ── 「아는 폭」이 설계서 2-2 와 한 군데 다르다 ────────────────────────────
// 설계서는 A 그룹 두 건(냉동 재고 1,221 kg · 원장 누락 209 kg)이 모두
// 「kg × 사용자가 고른 단가」로 계산된다고 적었다. **원장 누락 출하는 계산되지
// 않는다.** 엔진 2 가 거부한다 — `outOfLedgerHarvestKg` 는 중량만 받고 매출로
// 환산하지 않는다(performance.ts 58~64행: "엔진이 매출로 환산하지 않는다 —
// 단가를 모른다"). 출하 시점·채널·크기를 모르는 중량에 단가를 곱하면 그것은
// 관측이 아니라 가정이고, 그 가정이 손익에 그대로 들어간다.
//
// 그래서 띠의 상한은 **재고 평가분만**이고, 원장 누락분은 중량만 보이는 행으로
// 남는다. 설계서보다 좁은 폭을 그리는 쪽이 맞다 — 폭을 넓게 그려 놓고 그 끝이
// 가정이면, 폭을 그린 목적(모르는 것을 모른다고 보이기)이 뒤집힌다.

import { useMemo } from "react"

import {
  DEFAULT_WINF_G,
  MIN_FIT_SAMPLES,
  STANZA_BREAK_G,
  cumulativeDegreeDays,
  dateKey,
  fitGompertz,
} from "@/lib/growth"
import type { DailyWaterTemp, DegreeDayAxis, GompertzFit, GrowthPoint } from "@/lib/growth"

import {
  COST_ITEMS,
  computeActuals,
  computeCost,
  mergeExclusions,
  resolvePrice,
  survivalSensitivity,
} from "@/lib/profitability"
import type {
  ActualPerformance,
  CostBreakdown,
  CostInput,
  CostItem,
  PriceBasis,
  SalesChannel,
  SurvivalSensitivity,
} from "@/lib/profitability"

import {
  FARM_PRICE_ANCHOR,
  SIZE_ELASTICITY_DEFAULT,
  abwFromCountPerKg,
  sizePriceTable,
} from "@/lib/pricing"
import type { PriceAnchor, ProductForm, SizePriceEstimate } from "@/lib/pricing"

import { DEFAULT_HORIZON_DAYS, DEFAULT_STEP_DAYS, harvestWindow, mergeHarvestExclusions } from "@/lib/harvest"
import type { HarvestCandidate, HarvestCostInput, HarvestExclusion, HarvestWindow } from "@/lib/harvest"

import type { CycleCost, CycleHarvest, GrowthSample, ProductionCycle } from "@/types"

// ── 계산을 막는 것 ─────────────────────────────────────────────────────────
// 「없다」가 아니라 「무엇이 없다」를 돌려준다. 체크리스트가 그대로 이것이다.
export type EngineBlocker =
  | { kind: "no_samples" }
  | { kind: "samples_below_min"; have: number; need: number }
  | { kind: "samples_below_stanza"; eligible: number; total: number; thresholdG: number }
  | { kind: "fit_failure"; failure: NonNullable<GompertzFit["failure"]> }
  | { kind: "no_price_basis" }
  | { kind: "no_cost"; missing: CostItem[] }
  | { kind: "no_temp_series" }
  | { kind: "window_failure"; failure: NonNullable<HarvestWindow["failure"]> }

export type CycleEngineInput = {
  cycle: ProductionCycle
  samples: readonly GrowthSample[]
  costs: readonly CycleCost[]
  harvests: readonly CycleHarvest[]
  /** 일별 평균 수온. **null 은 「아직 안 불렀다」, [] 는 「불렀고 없다」다.** */
  dailyTemps: readonly DailyWaterTemp[] | null
  /** 사용자가 고른 단가 근거. **미선택이 유효한 초기 상태다.** */
  priceBasis: PriceBasis | null
  /** 미판매 재고 중량(kg). 사용자 입력. */
  inventoryKg: number | null
  /** 이벤트 원장에 없는 출하(kg). 사용자 입력. */
  outOfLedgerKg: number | null
  /** 하루치 추가 비용. 비면 엔진이 「잔여기간 비용 미산정」을 올린다. */
  dailyCost?: HarvestCostInput
  /** 앞으로 며칠을 볼까. 기본 28. */
  horizonDays?: number
  /** 후보 간격(일). 기본 7. */
  stepDays?: number
}

export type CycleEngineResult = {
  // 엔진 1
  cddAxis: DegreeDayAxis | null
  growthPoints: GrowthPoint[]
  /**
   * growthPoints[i] 의 날짜(YYYY-MM-DD). **같은 순서로 평행하게 들고 있다** —
   * fit.excluded 의 index 가 growthPoints 의 인덱스이고, 그 점을 날짜축에
   * 되돌려 찍으려면 날짜가 필요하다. GrowthPoint 에 날짜를 넣지 않는 이유는
   * 엔진 1 의 시간축이 적산수온이고 날짜가 아니기 때문이다.
   */
  growthPointDates: string[]
  fit: GompertzFit | null
  /** 지금까지의 적산수온(℃·일). 축이 없으면 null. */
  cddNow: number | null
  /** 전망에 쓴 수온(℃). 관측 마지막 구간의 평균이다 — 예보가 아니다. */
  outlookWaterTempC: number | null
  // 엔진 2
  cost: CostBreakdown
  actualsRecorded: ActualPerformance
  /** 「아는 폭」을 반영한 두 번째 호출. 단가 미선택이면 null. */
  actualsWithKnownGap: ActualPerformance | null
  sensitivity: SurvivalSensitivity | null
  // 크기별 단가
  anchor: PriceAnchor | null
  sizePriceEstimates: readonly SizePriceEstimate[]
  // 엔진 3
  window: HarvestWindow | null
  // 공통
  blockers: EngineBlocker[]
  /** 세 엔진의 「포함되지 않은 것」 전부. 변환 없이 합쳐진다. */
  exclusions: HarvestExclusion[]
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 수온 전망에 쓸 평균을 낼 관측 구간(일). 예보가 아니라 **최근 평균**이다. */
const OUTLOOK_TEMP_WINDOW_DAYS = 14

/** 민감도 표의 생존율 눈금. 실측·손익분기는 호출부가 따로 끼워 넣는다. */
const SENSITIVITY_RATES: readonly number[] = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

/** 크기별 단가 표의 목표 개체중(g). 사다리 관측 범위 23.5~33.3 을 품는다. */
const SIZE_TABLE_TARGETS_G: readonly number[] = [20, 22.5, 25, 27.5, 30, 32.5, 35]

/**
 * 출하 실적이 없을 때 앵커 크기로 쓸 규격(미/kg). 35미 = 28.57 g 이고, 이것은
 * **천황수산의 유일한 (크기, 단가) 관측**이다(SIZE_PRICE_ANCHOR). 금액은 이
 * 값을 쓰지 않는다 — 금액은 사용자가 고른 근거에서 온다. 크기만 빌린다.
 */
const DEFAULT_ANCHOR_COUNT_PER_KG = 35

/** 채널 → 상품 상태. **냉동을 활로 두지 않는다** — 기울기가 1/3 로 다르다. */
function formOfChannel(channel: SalesChannel | null | undefined): ProductForm {
  return channel === "retail_frozen" ? "frozen" : "live"
}

function sumBy<T>(rows: readonly T[], pick: (r: T) => number | null | undefined): number | null {
  let total = 0
  let seen = false
  for (const r of rows) {
    const v = pick(r)
    if (isNum(v)) {
      total += v
      seen = true
    }
  }
  return seen ? total : null
}

/**
 * cycle_costs 행 → 엔진 2 의 CostInput.
 *
 * **그 항목의 행이 하나도 없으면 칸을 비운다.** 0 을 넣으면 엔진이 「0원 입력」
 * 으로 받아 missingItems 에서 빠지고, 화면에서 「인건비 0원」과 「인건비
 * 모름」이 같아진다.
 */
function buildCostInput(cycle: ProductionCycle, costs: readonly CycleCost[]): CostInput {
  const input: CostInput = {}
  const byItem = new Map<CostItem, number>()
  for (const c of costs) {
    byItem.set(c.category, (byItem.get(c.category) ?? 0) + c.amount)
  }

  const pl = byItem.get("pl")
  if (pl !== undefined) input.plKrw = pl
  else if (isNum(cycle.stocking_count)) input.stockedCount = cycle.stocking_count

  const feed = byItem.get("feed")
  if (feed !== undefined) input.feedKrw = feed
  else if (isNum(cycle.total_feed_kg)) input.feedKg = cycle.total_feed_kg

  const electricity = byItem.get("electricity")
  if (electricity !== undefined) input.electricityKrw = electricity

  const labor = byItem.get("labor")
  if (labor !== undefined) input.laborKrw = labor

  const chemicals = byItem.get("chemicals")
  if (chemicals !== undefined) input.chemicalsKrw = chemicals

  const other = byItem.get("other")
  if (other !== undefined) input.otherKrw = other

  return input
}

/** 출하 실적에서 평균 개체중(g). 둘 중 하나라도 없으면 null 이다. */
function meanHarvestWeightG(harvests: readonly CycleHarvest[]): number | null {
  const kg = sumBy(harvests, h => h.weight_kg)
  const count = sumBy(harvests, h => h.count)
  if (kg === null || count === null || count <= 0) return null
  return (kg * 1000) / count
}

/**
 * 지금 살아 있는 마리수.
 *
 * 순서가 뜻이다 — 최신 샘플의 추정 개체수가 **관측에 가장 가깝고**, 그것이
 * 없으면 생존율 × 입식수로 역산한다. 둘 다 없으면 **입식수를 그대로 쓰지
 * 않는다.** 그것은 「한 마리도 안 죽었다」는 주장이고, 그 주장이 들어가면
 * 엔진 3 의 바이오매스가 2배 넘게 과대가 된다.
 */
function survivingCountNow(cycle: ProductionCycle, latest: GrowthSample | null): number | null {
  if (latest !== null && isNum(latest.estimated_population)) return latest.estimated_population
  if (latest !== null && isNum(latest.survival_rate) && isNum(cycle.stocking_count)) {
    return (cycle.stocking_count * latest.survival_rate) / 100
  }
  return null
}

export function useCycleEngines(input: CycleEngineInput): CycleEngineResult {
  const {
    cycle,
    samples,
    costs,
    harvests,
    dailyTemps,
    priceBasis,
    inventoryKg,
    outOfLedgerKg,
    dailyCost,
    horizonDays = DEFAULT_HORIZON_DAYS,
    stepDays = DEFAULT_STEP_DAYS,
  } = input

  return useMemo<CycleEngineResult>(() => {
    const blockers: EngineBlocker[] = []

    // ── 엔진 1 — 적산수온축과 성장곡선 ──────────────────────────────────
    const temps = dailyTemps ?? []
    const cddAxis = temps.length > 0 ? cumulativeDegreeDays(temps) : null
    if (cddAxis === null) blockers.push({ kind: "no_temp_series" })

    // 샘플을 축에 올린다. 축에 없는 날짜의 샘플은 cdd 를 모르므로 **빼고**,
    // 0 으로 채우지 않는다 — 0 을 넣으면 곡선이 원점으로 끌려간다.
    const sorted = [...samples].sort((a, b) =>
      dateKey(a.sampled_at) < dateKey(b.sampled_at) ? -1 : dateKey(a.sampled_at) > dateKey(b.sampled_at) ? 1 : 0,
    )
    const growthPoints: GrowthPoint[] = []
    const growthPointDates: string[] = []
    if (cddAxis !== null) {
      for (const s of sorted) {
        const key = dateKey(s.sampled_at)
        const cdd = cddAxis.byDate.get(key)
        if (cdd === undefined || !isNum(s.abw_g)) continue
        growthPoints.push({ cdd, abwG: s.abw_g })
        growthPointDates.push(key)
      }
    }

    const fit = growthPoints.length > 0 ? fitGompertz(growthPoints) : null

    if (samples.length === 0) {
      blockers.push({ kind: "no_samples" })
    } else {
      const eligible = sorted.filter(s => isNum(s.abw_g) && s.abw_g >= STANZA_BREAK_G).length
      if (eligible < MIN_FIT_SAMPLES) {
        // 7.5 g 미만만 있는 입식 초기는 **흔하게** 걸린다. 「샘플 없음」과 같은
        // 문구로 처리하면 농가는 자기가 넣은 샘플이 무시됐다고 읽는다.
        blockers.push({
          kind: "samples_below_stanza",
          eligible,
          total: samples.length,
          thresholdG: STANZA_BREAK_G,
        })
      } else if (growthPoints.length < MIN_FIT_SAMPLES) {
        blockers.push({ kind: "samples_below_min", have: growthPoints.length, need: MIN_FIT_SAMPLES })
      } else if (fit !== null && fit.failure !== null) {
        blockers.push({ kind: "fit_failure", failure: fit.failure })
      }
    }

    const points = cddAxis?.points ?? []
    const cddNow = points.length > 0 ? points[points.length - 1].cdd : null

    // 전망 수온 — **예보가 아니다.** 관측 마지막 구간의 평균이고, 그 사실이
    // harvest_water_temp_outlook_assumed 로 나간다.
    const recent = temps.slice(-OUTLOOK_TEMP_WINDOW_DAYS).map(d => d.waterTempC).filter(isNum)
    const outlookWaterTempC =
      recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : null

    // ── 엔진 2 — 비용 ───────────────────────────────────────────────────
    const cost = computeCost(buildCostInput(cycle, costs))
    if (cost.missingItems.length === COST_ITEMS.length) {
      blockers.push({ kind: "no_cost", missing: cost.missingItems })
    }

    // ── 엔진 2 — 실적 두 번 ─────────────────────────────────────────────
    const harvestedKg = sumBy(harvests, h => h.weight_kg)
    const harvestedCount = sumBy(harvests, h => h.count)
    const confirmedKrw = sumBy(harvests, h => h.revenue)
    const stockedBiomassKg =
      isNum(cycle.stocking_count) && isNum(cycle.initial_weight_g)
        ? (cycle.stocking_count * cycle.initial_weight_g) / 1000
        : null

    const actualsBase = {
      stockedCount: cycle.stocking_count ?? null,
      stockedBiomassKg,
      harvestedKg,
      harvestedCount,
      feedKg: cycle.total_feed_kg ?? null,
      // 우리 DB 는 회차 경계를 **행으로** 들고 있다(production_cycles). 메모에서
      // 복원한 파생 라벨이 아니므로 source_data 다. 천황수산 반입 데이터와 다른
      // 점이고, 그래서 이 화면에는 cycle_boundary_derived_label 이 뜨지 않는다.
      cycleBoundary: "source_data" as const,
    }

    // 호출 ① 기록대로. 재고 평가도 원장 누락도 넣지 않는다.
    const actualsRecorded = computeActuals(
      {
        ...actualsBase,
        revenue: {
          confirmedKrw,
          recordCount: harvests.length > 0 ? harvests.length : null,
          ...(isNum(inventoryKg) ? { unsoldInventory: { weightKg: inventoryKg } } : {}),
          ...(isNum(outOfLedgerKg) ? { outOfLedgerHarvestKg: outOfLedgerKg } : {}),
        },
      },
      cost,
    )

    // 호출 ② 아는 폭 반영. **같은 함수를 다른 입력으로 부른다** — 화면이 산식을
    // 새로 쓰지 않는다. 단가를 안 골랐으면 null 이고, 0 폭으로 그리지 않는다.
    const actualsWithKnownGap =
      priceBasis !== null && isNum(inventoryKg)
        ? computeActuals(
            {
              ...actualsBase,
              revenue: {
                confirmedKrw,
                recordCount: harvests.length > 0 ? harvests.length : null,
                soldWeightKg: harvestedKg,
                unsoldInventory: { weightKg: inventoryKg, valuation: priceBasis },
                ...(isNum(outOfLedgerKg) ? { outOfLedgerHarvestKg: outOfLedgerKg } : {}),
              },
            },
            cost,
          )
        : null

    if (priceBasis === null) blockers.push({ kind: "no_price_basis" })

    // ── 엔진 2 — 생존율 민감도 ──────────────────────────────────────────
    // 단가는 **실현 단가**를 쓴다. 채널 중앙값을 끼우면 생존율이 아니라 단가를
    // 바꾼 결과가 섞여 나온다(sensitivity.ts 64~68행).
    const meanWeightG = meanHarvestWeightG(harvests)
    const sensitivityInput = {
      stockedCount: cycle.stocking_count ?? null,
      stockedBiomassKg,
      feedKg: cycle.total_feed_kg ?? null,
      meanHarvestWeightG: meanWeightG,
      referenceHarvestedKg: harvestedKg,
      referenceHarvestedCount: harvestedCount,
      cost,
      price: { kind: "realized" } as PriceBasis,
      priceRealizedContext: { revenueKrw: confirmedKrw, weightKg: harvestedKg },
    }
    const referenceRate = actualsRecorded.survivalRate
    // 실측 행이 표에 **반드시** 있어야 한다 — 없으면 전부 가정 행이 되고 표가
    // 통째로 예측으로 읽힌다. 눈금에 끼워 넣고 정렬은 하지 않는다(엔진이
    // 호출자의 순서를 지킨다).
    const rates = isNum(referenceRate) && !SENSITIVITY_RATES.includes(referenceRate)
      ? [...SENSITIVITY_RATES, referenceRate].sort((a, b) => a - b)
      : SENSITIVITY_RATES
    const sensitivity =
      isNum(cycle.stocking_count) && meanWeightG !== null ? survivalSensitivity(sensitivityInput, rates) : null

    // ── 크기별 단가 — 앵커 ─────────────────────────────────────────────
    // 수준은 사용자가 고른 근거에서, 크기는 **농가의 실제 출하 평균**에서.
    // 둘 중 하나라도 없으면 앵커를 만들지 않는다 — 기본 앵커(천황수산
    // 17,000 원 @28.57 g)로 조용히 떨어지면 남의 농가 단가가 내 금액이 된다.
    // 단가는 **엔진 2 의 resolvePrice 가 정한다.** 화면이 채널 → 금액 표를
    // 다시 들고 있으면 엔진의 표와 어긋나는 날이 온다.
    const resolvedPrice = resolvePrice(priceBasis, {
      revenueKrw: confirmedKrw,
      weightKg: harvestedKg,
    })
    const basisPrice = resolvedPrice.krwPerKg
    const anchorAbwG = meanWeightG ?? abwFromCountPerKg(DEFAULT_ANCHOR_COUNT_PER_KG)
    const anchor: PriceAnchor | null =
      isNum(basisPrice) && basisPrice > 0 && isNum(anchorAbwG) && anchorAbwG > 0
        ? {
            krwPerKg: basisPrice,
            abwG: anchorAbwG,
            // 세 채널 모두 **농가가 실제로 받은 금액**이다(천황수산
            // SalesInventory 실거래 40건). 소매 채널이라도 농가 수취 단계다 —
            // 남의 상품 페이지 호가가 아니다.
            stage: "wholesale",
            form: formOfChannel(priceBasis?.kind === "realized" ? null : priceBasis?.channel),
            premium: false,
            observedAt: cycle.actual_harvest_date ?? cycle.stocking_date,
            grade: "A",
            source: { kind: "farm_record", farm: cycle.farm_name ?? cycle.tank_name ?? "farm" },
          }
        : null

    const sizePriceEstimates = anchor === null ? [] : sizePriceTable(anchor, SIZE_TABLE_TARGETS_G)

    // ── 엔진 3 — 출하 윈도우 ───────────────────────────────────────────
    const countNow = survivingCountNow(cycle, sorted.length > 0 ? sorted[sorted.length - 1] : null)
    const fitParams = fit?.params ?? null

    let window: HarvestWindow | null = null
    if (anchor !== null && fitParams !== null && cddNow !== null && outlookWaterTempC !== null) {
      window = harvestWindow({
        // 기준일은 축의 마지막 관측일이다. **엔진이 오늘을 지어내지 않도록**
        // 인자로 넘긴다(엔진 3 설계 규칙 7).
        asOfDate: points.length > 0 ? points[points.length - 1].date : null,
        survivingCountNow: countNow,
        stockedCount: cycle.stocking_count ?? null,
        abw: {
          kind: "gompertz",
          params: fitParams,
          cddNow,
          waterTemp: { kind: "constant", waterTempC: outlookWaterTempC },
        },
        // 사이클 생존율에서 일별로 환산한다. 실측이 있으면 기본값으로
        // 떨어지지 않는다(source 가 derived_from_cycle 로 나간다).
        ...(isNum(referenceRate) && isNum(cycle.doc) && cycle.doc > 0
          ? { survival: { cycleSurvivalRate: referenceRate, cycleDays: cycle.doc } }
          : {}),
        price: { anchor },
        incurredCost: cost,
        confirmedRevenueKrw: confirmedKrw,
        ...(dailyCost === undefined ? {} : { dailyCost }),
        candidates: { stepDays, horizonDays },
        // 개체중 폭은 **엔진 1 의 홀드아웃 MAE 를 엔진 3 이 제 값으로 박지
        // 않는다**(설계 규칙). 적합의 학습 MAE 가 있으면 그것을 넘긴다.
        ...(isNum(fit?.trainMaeG) ? { abwUncertaintyG: fit.trainMaeG } : {}),
      })
    }

    if (window !== null && window.failure !== null) {
      blockers.push({ kind: "window_failure", failure: window.failure })
    }

    // ── 경고 합치기 ─────────────────────────────────────────────────────
    // 세 엔진의 Exclusion 은 필드가 같아 **변환 없이** 합쳐진다
    // (lib/harvest/exclusions.ts 머리주석). 먼저 들어온 쪽의 quantity 가
    // 남으므로 대표값(= 사용자가 고른 단가로 다시 계산한 쪽)을 앞에 둔다.
    const exclusions = mergeHarvestExclusions(
      window?.exclusions,
      (actualsWithKnownGap ?? actualsRecorded).exclusions,
      actualsRecorded.exclusions,
      sensitivity === null ? undefined : mergeExclusions(sensitivity.exclusions),
      sizePriceEstimates[0]?.exclusions,
    )

    return {
      cddAxis,
      growthPoints,
      growthPointDates,
      fit,
      cddNow,
      outlookWaterTempC,
      cost,
      actualsRecorded,
      actualsWithKnownGap,
      sensitivity,
      anchor,
      sizePriceEstimates,
      window,
      blockers,
      exclusions,
    }
  }, [
    cycle,
    samples,
    costs,
    harvests,
    dailyTemps,
    priceBasis,
    inventoryKg,
    outOfLedgerKg,
    dailyCost,
    horizonDays,
    stepDays,
  ])
}

/**
 * 요인 분해를 **어느 후보로** 보여줄 것인가.
 *
 * `best` 를 그대로 쓰면 안 되는 경우가 있다 — 엔진이 「지금 출하」를 최대로
 * 고르면 `best.dayOffset` 이 0 이고, 0일 후보의 분해는 자기 자신과의 비교라
 * **전 항목이 0** 이다. 그 막대를 그리면 화면이 「증체도 0, 폐사도 0, 사료비도
 * 0」이라고 말하는 꼴이 되고, 농가는 아무것도 배우지 못한다.
 *
 * 그래서 「지금이 최대」일 때는 **기다렸다면 어떻게 됐을까**를 보여준다 —
 * 분해가 있는 마지막 후보다. 판정이 「지금 출하」인 이유가 거기 적혀 있다
 * (보통 폐사와 사료비가 증체·크기 프리미엄을 넘어선다).
 */
export function breakdownCandidate(win: HarvestWindow | null): HarvestCandidate | null {
  if (win === null) return null
  const best = win.best === null ? null : win.candidates[win.best.index] ?? null
  if (best !== null && best.dayOffset > 0 && best.attribution !== null) return best
  for (let i = win.candidates.length - 1; i >= 0; i--) {
    const c = win.candidates[i]
    if (c.dayOffset > 0 && c.attribution !== null) return c
  }
  return best
}

/** 적합 성능의 상한중량. 화면이 「상한중량 25 g」을 쓸 때 import 를 늘리지 않도록. */
export { DEFAULT_WINF_G, MIN_FIT_SAMPLES, STANZA_BREAK_G, SIZE_ELASTICITY_DEFAULT }
export { FARM_PRICE_ANCHOR }
