// 출하 윈도우 판정 — **엔진 3 의 결론이 나오는 자리다.**
//
// 네 가지를 돌려준다. 계획서 4절 엔진 3 이 요구한 「추천 구간 + 근거 수치 전량
// 노출(블랙박스 금지)」이 이 네 가지다.
//
//   1. 후보 시점별 시나리오 — 개체중·마리수·바이오매스·단가·매출·추가비용·이익
//   2. 최적 **구간** — 이익 최대 시점과, 그 최대와 구분되지 않는 구간
//   3. 한계 분석 — "하루 더 키우면 얼마가 더/덜 남는가". 0 을 지나는 지점
//   4. 왜 그런지 — 크기 프리미엄이 이겼나, 폐사가 이겼나, 사료비가 이겼나
//
// ── 점으로 답하지 않는다 ─────────────────────────────────────────────────
// 엔진 1 의 홀드아웃 MAE 가 0.895 g 이고 출하 크기 20~28 g 에서 3~5% 오차다.
// 단가 탄력성도 0.63~0.73 밴드다. **"11월 20일에 출하하십시오" 라고 점으로
// 답하면 그 답의 신뢰도를 사용자가 알 수 없다**(dataset-assessment 2-6 규칙 5).
//
// 그래서 추천은 **구간**이고, 후보마다 이익이 **밴드**로 나간다. 밴드가 겹치는
// 후보들은 **구분 불가**이고, 그 사실 자체를 `indistinguishableWithinWindow`
// 로 돌려준다 — 화면이 "이 구간 안에서는 차이가 구분되지 않습니다" 를 지어내지
// 않도록. 엔진은 문장을 만들지 않지만, 화면이 번역할 **사실**은 엔진이 준다.
//
// ── 이 밴드는 「신뢰구간」이 아니다 ──────────────────────────────────────
// 분포 가정도 표본 추출도 없다. **「입력 양끝을 넣었을 때 나오는 양끝」** 이다.
// 엔진 1 은 예측구간을 돌려주지 않고 홀드아웃 MAE 하나뿐이며 R² 는 설계로
// 막아 두었다 — 「95% 신뢰구간」은 우리가 갖지 않은 정밀도의 주장이다.
// 그래서 폭이 **어디서 왔는지**를 `band.sources` 로 구분해 돌려준다.
//
//   "price_elasticity"  단가 탄력성 0.63~0.73 (언제나 들어간다)
//   "abw_uncertainty"   개체중 ±abwUncertaintyG (호출자가 넣을 때만)
//
// 기본은 단가 탄력성만이고, 그때 `harvest_abw_uncertainty_not_in_band` 가
// 함께 나간다.
//
// ── 계절 보정을 만들지 않는다 ────────────────────────────────────────────
// 단가 모델에 **달을 받는 인자가 아예 없다.** 추계 집중 출하기 하락 방향은
// 보이지만 정량화 불가(C)다. **엔진 3 이 계절 보정을 자체적으로 만들어 넣지
// 않는다** — 그 사실은 후보마다 `price_seasonality_not_modeled` 로 나간다.
//
// ── 문장을 만들지 않는다 ─────────────────────────────────────────────────
// "지금 출하하세요" 같은 문구는 여기 없다. 판정은 **코드**(HarvestDecisionCode)
// 이고 번역은 화면(엔진 6)이 맡는다. raspberry-pi/advice.py 와 같은 원칙이다.

import { DEFAULT_SIZE_ELASTICITY } from "@/lib/pricing"
import type { DistributionStage, ProductForm, SizeElasticity } from "@/lib/pricing"
import type { CostBreakdown, CostUnitPrices } from "@/lib/profitability"

import {
  DEFAULT_FLIP_SEARCH_RANGE,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_STEP_DAYS,
  FLIP_SEARCH_ITERATIONS,
} from "./constants"
import { evaluateCandidate } from "./candidate"
import type {
  HarvestBaseline,
  HarvestCandidate,
  HarvestCostInput,
  HarvestContext,
} from "./candidate"
import { addDays, dateKey } from "./dates"
import { mergeHarvestExclusions } from "./exclusions"
import type { HarvestExclusion } from "./exclusions"
import { outlookExclusions } from "./outlook"
import type { AbwOutlook } from "./outlook"
import { resolveHarvestAnchor } from "./price"
import type { HarvestAnchorFailure, HarvestPriceInput } from "./price"
import { resolveDailySurvival } from "./survival"
import type { DailySurvivalSource, HarvestSurvivalInput } from "./survival"

/** 후보 시점을 어떻게 잡나. */
export type CandidateSchedule = {
  /** 후보 간격(일). 기본 7. */
  stepDays?: number | null
  /** 지평(일). 기본 28. 끝 날도 후보에 들어간다. */
  horizonDays?: number | null
  /** 후보를 직접 지정한다. 주면 step·horizon 을 무시한다. */
  dayOffsets?: readonly number[]
}

export type HarvestWindowInput = {
  /**
   * 기준일(YYYY-MM-DD). 주면 후보와 추천 구간에 날짜가 붙는다. **안 주면
   * 날짜 칸이 null 이고 일수만 나간다** — 엔진이 `new Date()` 로 오늘을 혼자
   * 정하면 순수 계산 모듈이 아니게 되고 시간대에 따라 하루가 밀린다.
   */
  asOfDate?: string | null
  /** 지금 살아 있는 마리수. **필수다** — 모르면 바이오매스가 정의되지 않는다. */
  survivingCountNow?: number | null
  /** 입식 마리수. 엔진 2 가 코호트 생존율을 반환값에 담는 데만 쓴다. */
  stockedCount?: number | null
  /** 개체중 전망. 엔진 1 의 적합 결과 + 수온 전망, 또는 일별 개체중. */
  abw: AbwOutlook
  /**
   * 일별 생존율. **안 주면 0% 폐사로 가정하지 않고** 천황수산 환산 기본값으로
   * 떨어지며 경고가 올라간다(survival.ts).
   */
  survival?: HarvestSurvivalInput
  /** 단가 앵커. **농가 수취 단계가 아니면 거부되거나 변환된다**(price.ts). */
  price: HarvestPriceInput
  /** 지금까지의 누적 비용. 엔진 2 computeCost 의 결과를 넣는다. */
  incurredCost: CostBreakdown
  /** 이미 확정된 매출(부분 출하분). 없으면 생략한다 — 0 과 다르다. */
  confirmedRevenueKrw?: number | null
  /** 하루치 추가 비용. 안 주면 이익이 과대평가되고 엔진 2 가 경고를 올린다. */
  dailyCost?: HarvestCostInput
  /** 비용 단가. 기본값은 엔진 2 constants.ts(사료 2,300원/kg, 전기 실청구 88.6원). */
  unitPrices?: CostUnitPrices
  candidates?: CandidateSchedule
  /**
   * 이익 밴드에 담을 개체중 폭(±g). **기본 0** — 엔진 1 의 홀드아웃 MAE 를
   * 엔진 3 이 제 값으로 박아 넣지 않는다. 넣으면 밴드가 그만큼 넓어지고
   * `band.sources` 에 "abw_uncertainty" 가 들어간다.
   */
  abwUncertaintyG?: number | null
}

export type HarvestDecisionCode =
  /** 이익 최대가 지금이고, 구간이 지금 하나뿐이다. */
  | "harvest_now"
  /** 이익 최대가 뒤이고, 지금은 구간 밖이다. */
  | "hold"
  /** **추천 구간이 "지금" 을 포함한다 — 지금 출하와 최대가 구분되지 않는다.** */
  | "window_includes_now"
  /**
   * **이익 최대의 뒤쪽을 끝까지 보지 못했다.** 최대가 지평의 마지막 후보이거나,
   * 그 뒤의 후보를 평가할 수 없었다(수온 전망·개체중 전망이 거기까지 닿지
   * 않는다). 어느 쪽이든 최적이 본 구간 밖에 있을 수 있다.
   */
  | "hold_beyond_horizon"
  /**
   * **판정할 수 없다.** 이익을 구한 후보가 하나도 없거나, 이익 최대가 "지금"
   * 인데 그 뒤의 후보를 평가하지 못했다 — 뒤를 못 본 채로 "지금 출하" 라고
   * 하면 보지 않은 날을 보고 고른 것처럼 읽힌다.
   */
  | "indeterminate"

export type HarvestWindowFailure =
  /** 지금 마리수를 안 받았다. */
  | "count_unavailable"
  /** 일별 생존율 입력이 0~1 밖이거나 수가 아니다. */
  | "survival_rate_invalid"
  /** 후보가 하나도 만들어지지 않았다. */
  | "no_candidates"
  /** "지금 출하" 후보를 평가할 수 없어 비교 기준이 없다. */
  | "now_not_evaluable"
  /** 앵커가 농가 수취 단계가 아니다(price.ts). */
  | HarvestAnchorFailure

/** 한계 분석 한 줄 — 후보와 후보 사이. */
export type MarginalRow = {
  fromDayOffset: number
  toDayOffset: number
  days: number
  deltaProfitKrw: number | null
  /** 하루당 이익 변화(원/일). **0 을 지나는 지점이 경제적 출하 적기다.** */
  perDayKrw: number | null
  perDayBandKrw: { low: number; high: number } | null
  /** 밴드가 0 을 품지 않는가. false 면 부호를 단정할 수 없다. */
  signCertain: boolean
}

export type MarginalSign =
  | "always_positive"
  | "always_negative"
  | "crosses"
  /**
   * 부호가 두 번 이상 바뀌거나, 바뀌지만 +→− 전이가 없다(−→+ 뿐이다).
   * 첫 +→− 만 crossing 에 담으므로 후자는 crossing 이 null 이다.
   */
  | "mixed"
  | "indeterminate"

export type MarginalAnalysis = {
  rows: readonly MarginalRow[]
  sign: MarginalSign
  /** 한계이익이 +에서 −로 바뀌는 두 구간. */
  crossing: { fromDayOffset: number; toDayOffset: number } | null
  /** 선형보간한 0 통과 일수. 구간 중점 사이를 잇는다. */
  zeroCrossingDayOffset: number | null
}

/**
 * 추천 — **점이 아니라 구간이다.** 화면이 달력에 띠로 그린다.
 */
export type RecommendedWindow = {
  startDayOffset: number
  endDayOffset: number
  /** 기준일을 받았을 때만 채워진다. **지어내지 않는다.** */
  startDate: string | null
  endDate: string | null
  /** 구간에 든 후보 수. */
  candidateCount: number
  /**
   * **구간 안에서 이익 밴드가 겹쳐 구분되지 않는가.** 화면이 번역할 사실이다.
   * candidateCount 가 1 이면 false — 그때는 구간이 한 점이고 겹칠 상대가 없다.
   */
  indistinguishableWithinWindow: boolean
  /** 구간이 "지금 출하"(0일)를 포함하는가. */
  includesNow: boolean
}

export type HarvestWindow = {
  asOfDate: string | null
  stepDays: number | null
  horizonDays: number
  candidates: readonly HarvestCandidate[]
  /**
   * 평가하지 못한 후보 수. 0 이 아니면 그 시점의 개체중·단가·이익이 null 이고,
   * 최대가 그 뒤에 있을 수 있다.
   */
  unevaluableCandidateCount: number
  /** 이익이 최대인 후보. */
  best: {
    index: number
    dayOffset: number
    date: string | null
    operatingProfitKrw: number
    profitBandKrw: { low: number; high: number } | null
  } | null
  recommended: RecommendedWindow | null
  /** 판정 코드. **문장이 아니다.** */
  decision: HarvestDecisionCode | null
  /**
   * 이익 밴드의 폭이 **어디서 왔나.** 「신뢰구간」이 아니다 — 분포 가정이 없다.
   */
  band: {
    sources: readonly ("price_elasticity" | "abw_uncertainty")[]
    priceElasticity: { low: number; high: number }
    abwUncertaintyG: number
  }
  marginal: MarginalAnalysis
  survival: {
    dailySurvivalRate: number | null
    /** 1 − 일별 생존율. 0.003 이면 하루 0.30% 다. */
    dailyMortalityRate: number | null
    source: DailySurvivalSource
  }
  price: {
    stage: DistributionStage | null
    form: ProductForm | null
    anchorKrwPerKg: number | null
    anchorAbwG: number | null
    elasticity: SizeElasticity
    /** 농가 수취 단계로 변환했으면 원래 단계. */
    convertedFrom: DistributionStage | null
    conversionMultiplier: number | null
  }
  failure: HarvestWindowFailure | null
  exclusions: HarvestExclusion[]
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 두 밴드가 겹치는가. 겹치면 **구분 불가**다. */
function overlaps(a: { low: number; high: number }, b: { low: number; high: number }): boolean {
  return a.low <= b.high && b.low <= a.high
}

type Schedule = {
  offsets: readonly number[]
  stepDays: number | null
  horizonDays: number
  nowAdded: boolean
}

/** 후보 일수 목록. **"지금"(0일)이 반드시 들어간다** — 비교 기준이기 때문이다. */
function buildSchedule(schedule: CandidateSchedule | undefined): Schedule {
  if (schedule?.dayOffsets !== undefined) {
    const cleaned = [...new Set(schedule.dayOffsets.filter((d) => Number.isInteger(d) && d >= 0))].sort(
      (a, b) => a - b,
    )
    const nowAdded = !cleaned.includes(0)
    const offsets = nowAdded ? [0, ...cleaned] : cleaned
    return {
      offsets,
      stepDays: null,
      horizonDays: offsets.length > 0 ? offsets[offsets.length - 1] : 0,
      nowAdded,
    }
  }

  const stepDays =
    isNum(schedule?.stepDays) && schedule.stepDays >= 1
      ? Math.floor(schedule.stepDays)
      : DEFAULT_STEP_DAYS
  const horizonDays =
    isNum(schedule?.horizonDays) && schedule.horizonDays >= 0
      ? Math.floor(schedule.horizonDays)
      : DEFAULT_HORIZON_DAYS

  const offsets: number[] = []
  for (let d = 0; d <= horizonDays; d += stepDays) offsets.push(d)
  // 지평의 끝 날이 간격에 안 맞아 빠지면 넣는다 — 지평까지 봤다고 하면서 그
  // 날을 안 보면 `harvest_horizon_truncated` 의 뜻이 달라진다.
  if (offsets[offsets.length - 1] !== horizonDays) offsets.push(horizonDays)

  return { offsets, stepDays, horizonDays, nowAdded: false }
}

/** 한계 분석. 후보 사이의 하루당 이익 변화와 0 통과 지점. */
function analyzeMarginal(candidates: readonly HarvestCandidate[]): MarginalAnalysis {
  const rows: MarginalRow[] = []
  for (let i = 1; i < candidates.length; i++) {
    const a = candidates[i - 1]
    const b = candidates[i]
    const days = b.dayOffset - a.dayOffset
    const deltaProfitKrw =
      isNum(a.operatingProfitKrw) && isNum(b.operatingProfitKrw)
        ? b.operatingProfitKrw - a.operatingProfitKrw
        : null
    const perDayKrw = deltaProfitKrw !== null && days > 0 ? deltaProfitKrw / days : null

    let perDayBandKrw: { low: number; high: number } | null = null
    if (a.profitBandKrw !== null && b.profitBandKrw !== null && days > 0) {
      // 같은 쪽 끝끼리 뺀다 — 낮은 쪽 끝과 높은 쪽 끝을 섞으면 폭이 가짜로 넓어진다.
      const ends = [
        (b.profitBandKrw.low - a.profitBandKrw.low) / days,
        (b.profitBandKrw.high - a.profitBandKrw.high) / days,
      ]
      perDayBandKrw = { low: Math.min(...ends), high: Math.max(...ends) }
    }

    rows.push({
      fromDayOffset: a.dayOffset,
      toDayOffset: b.dayOffset,
      days,
      deltaProfitKrw,
      perDayKrw,
      perDayBandKrw,
      signCertain: perDayBandKrw !== null && (perDayBandKrw.low > 0 || perDayBandKrw.high < 0),
    })
  }

  if (rows.length === 0 || rows.some((r) => r.perDayKrw === null)) {
    return { rows, sign: "indeterminate", crossing: null, zeroCrossingDayOffset: null }
  }

  const values = rows.map((r) => r.perDayKrw as number)
  const allPositive = values.every((v) => v > 0)
  const allNegative = values.every((v) => v < 0)

  let crossing: { fromDayOffset: number; toDayOffset: number } | null = null
  let zeroCrossingDayOffset: number | null = null
  let changes = 0
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const cur = values[i]
    if ((prev > 0 && cur <= 0) || (prev <= 0 && cur > 0)) changes++
    if (crossing === null && prev > 0 && cur <= 0) {
      crossing = { fromDayOffset: rows[i - 1].fromDayOffset, toDayOffset: rows[i].toDayOffset }
      // 구간 중점 사이를 선형으로 잇는다. 한계이익은 구간의 평균값이므로
      // 구간의 중점에 놓는 쪽이 맞다.
      const mPrev = (rows[i - 1].fromDayOffset + rows[i - 1].toDayOffset) / 2
      const mCur = (rows[i].fromDayOffset + rows[i].toDayOffset) / 2
      zeroCrossingDayOffset = mPrev + ((mCur - mPrev) * prev) / (prev - cur)
    }
  }

  const sign: MarginalSign = allPositive
    ? "always_positive"
    : allNegative
      ? "always_negative"
      : changes > 1 || crossing === null
        ? "mixed"
        : "crosses"

  return { rows, sign, crossing, zeroCrossingDayOffset }
}

function failWindow(
  input: HarvestWindowInput,
  schedule: Schedule,
  failure: HarvestWindowFailure,
  survival: HarvestWindow["survival"],
  elasticity: SizeElasticity,
  abwUncertaintyG: number,
  exclusions: HarvestExclusion[],
): HarvestWindow {
  return {
    asOfDate: typeof input.asOfDate === "string" ? dateKey(input.asOfDate) : null,
    stepDays: schedule.stepDays,
    horizonDays: schedule.horizonDays,
    candidates: [],
    unevaluableCandidateCount: 0,
    best: null,
    recommended: null,
    decision: null,
    band: {
      sources:
        abwUncertaintyG > 0 ? ["price_elasticity", "abw_uncertainty"] : ["price_elasticity"],
      priceElasticity: elasticity.band,
      abwUncertaintyG,
    },
    marginal: { rows: [], sign: "indeterminate", crossing: null, zeroCrossingDayOffset: null },
    survival,
    price: {
      stage: null,
      form: null,
      anchorKrwPerKg: null,
      anchorAbwG: null,
      elasticity,
      convertedFrom: null,
      conversionMultiplier: null,
    },
    failure,
    exclusions,
  }
}

/**
 * 출하 윈도우. **"지금 출하할까, 2주 더 키울까" 에 구간으로 답한다.**
 *
 * 돌려주는 것은 전부 코드와 수치다 — 문장은 화면(엔진 6)이 만든다.
 */
export function harvestWindow(input: HarvestWindowInput): HarvestWindow {
  const schedule = buildSchedule(input.candidates)
  const asOfDate = typeof input.asOfDate === "string" ? dateKey(input.asOfDate) : null
  const elasticity = input.price.elasticity ?? DEFAULT_SIZE_ELASTICITY
  const abwUncertaintyG =
    isNum(input.abwUncertaintyG) && input.abwUncertaintyG > 0 ? input.abwUncertaintyG : 0

  // ── 생존율 ─────────────────────────────────────────────────────────────
  const survivalResolved = resolveDailySurvival(input.survival)
  const survival: HarvestWindow["survival"] = {
    dailySurvivalRate: survivalResolved.dailySurvivalRate,
    dailyMortalityRate:
      survivalResolved.dailySurvivalRate === null ? null : 1 - survivalResolved.dailySurvivalRate,
    source: survivalResolved.source,
  }

  const bandOwn: HarvestExclusion[] = []
  if (abwUncertaintyG === 0) {
    // 밴드에 담긴 개체중 폭이 0 이라는 사실. "모른다" 가 아니라 "0" 이다.
    bandOwn.push({ code: "harvest_abw_uncertainty_not_in_band", quantity: 0, unit: "gram" })
  }
  if (schedule.nowAdded) {
    bandOwn.push({ code: "harvest_candidate_now_added", quantity: 0, unit: "day" })
  }

  const preamble = mergeHarvestExclusions(survivalResolved.exclusions, bandOwn)

  if (survivalResolved.dailySurvivalRate === null) {
    return failWindow(input, schedule, "survival_rate_invalid", survival, elasticity, abwUncertaintyG, preamble)
  }
  if (!isNum(input.survivingCountNow) || input.survivingCountNow <= 0) {
    return failWindow(input, schedule, "count_unavailable", survival, elasticity, abwUncertaintyG, preamble)
  }
  if (schedule.offsets.length === 0) {
    return failWindow(input, schedule, "no_candidates", survival, elasticity, abwUncertaintyG, preamble)
  }

  // ── 단가 앵커 검문 ─────────────────────────────────────────────────────
  // **소매 앵커를 그냥 통과시키지 않는다** — 거부하거나 변환한다.
  const anchorResolved = resolveHarvestAnchor(input.price)
  const withAnchor = mergeHarvestExclusions(preamble, anchorResolved.exclusions)
  if (anchorResolved.anchor === null) {
    return failWindow(
      input,
      schedule,
      anchorResolved.failure ?? "price_anchor_not_farmgate",
      survival,
      elasticity,
      abwUncertaintyG,
      withAnchor,
    )
  }

  const ctx: HarvestContext = {
    survivingCountNow: input.survivingCountNow,
    stockedCount: isNum(input.stockedCount) ? input.stockedCount : null,
    abw: input.abw,
    dailySurvivalRate: survivalResolved.dailySurvivalRate,
    anchor: anchorResolved.anchor,
    elasticity,
    incurredCost: input.incurredCost,
    confirmedRevenueKrw: isNum(input.confirmedRevenueKrw) ? input.confirmedRevenueKrw : null,
    dailyCost: input.dailyCost ?? {},
    unitPrices: input.unitPrices ?? {},
    abwUncertaintyG,
    asOfDate,
  }

  const priceInfo: HarvestWindow["price"] = {
    stage: anchorResolved.anchor.stage,
    form: anchorResolved.anchor.form,
    anchorKrwPerKg: anchorResolved.anchor.krwPerKg,
    anchorAbwG: anchorResolved.anchor.abwG,
    elasticity,
    convertedFrom: anchorResolved.convertedFrom,
    conversionMultiplier: anchorResolved.conversionMultiplier,
  }

  // ── "지금 출하" 를 먼저 평가한다 — 모든 비교의 기준이다 ────────────────
  const nowEval = evaluateCandidate(ctx, 0, null)
  if (nowEval.variants.point === null || nowEval.candidate.survivingCount === null) {
    return {
      ...failWindow(input, schedule, "now_not_evaluable", survival, elasticity, abwUncertaintyG, withAnchor),
      candidates: [nowEval.candidate],
      unevaluableCandidateCount: 1,
      price: priceInfo,
      // **후보가 올린 경고를 같이 내보낸다.** 성공 경로는 아래에서
      // `...candidates.map(c => c.exclusions)` 로 합치는데, 이 조기 반환만
      // 앵커 경고(withAnchor)로 끝나고 있었다. 그래서 "지금" 을 평가하지 못한
      // **이유**가 반환값에서 사라졌다 — 예컨대 냉동 앵커로 단가가 거부되면
      // `price_ladder_form_not_slope_eligible` 가 후보에만 남고 호출자는
      // `now_not_evaluable` 만 받는다. 화면은 「비교 기준이 없습니다」라고만
      // 쓰게 되고, 농가는 자기 데이터가 모자란 줄 안다.
      //
      // 실패할 때야말로 이유가 필요하다. 실패 경로에서 경고를 버리면 이 엔진이
      // 「금액 옆에 언제나 빠진 것을 붙인다」고 한 설계가 가장 중요한 순간에
      // 깨진다.
      exclusions: mergeHarvestExclusions(withAnchor, nowEval.candidate.exclusions),
    }
  }

  const baseline: HarvestBaseline = {
    dayOffset: 0,
    survivingCount: nowEval.candidate.survivingCount,
    variants: nowEval.variants,
  }

  // "지금" 후보도 **기준을 자기 자신으로 두고 한 번 더** 평가한다. 그러면
  // 차액이 null 이 아니라 0 으로 나오고 근거 분해의 항목이 전부 0 으로 채워져,
  // 화면이 첫 줄만 다른 모양으로 그리지 않아도 된다. 0 은 여기서 「모른다」가
  // 아니라 「자기와의 차이가 없다」이므로 채워도 되는 0 이다.
  const candidates: HarvestCandidate[] = [evaluateCandidate(ctx, 0, baseline).candidate]
  for (const dayOffset of schedule.offsets) {
    if (dayOffset === 0) continue
    candidates.push(evaluateCandidate(ctx, dayOffset, baseline).candidate)
  }
  const unevaluableCandidateCount = candidates.filter((c) => c.failure !== null).length

  // ── 최대와 구간 ────────────────────────────────────────────────────────
  let bestIndex = -1
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i].operatingProfitKrw
    if (!isNum(p)) continue
    if (bestIndex === -1 || p > (candidates[bestIndex].operatingProfitKrw as number)) bestIndex = i
  }

  const marginal = analyzeMarginal(candidates)

  const own: HarvestExclusion[] = []
  // 한계이익이 +에서 −로 바뀌는 지점이 지평 안에 없다. **폐사율을 안 넣었을
  // 때 가장 흔하게 나오는 모양**이고, 그때 판정은 거의 언제나 "더 키우라" 다.
  if (marginal.crossing === null && marginal.sign !== "indeterminate") {
    own.push({
      code: "harvest_marginal_never_crosses_zero",
      quantity: schedule.horizonDays,
      unit: "day",
    })
  }

  let recommended: RecommendedWindow | null = null
  let decision: HarvestDecisionCode | null = null
  let best: HarvestWindow["best"] = null

  if (bestIndex === -1) {
    decision = "indeterminate"
  } else {
    const bestCandidate = candidates[bestIndex]
    best = {
      index: bestIndex,
      dayOffset: bestCandidate.dayOffset,
      date: addDays(asOfDate, bestCandidate.dayOffset),
      operatingProfitKrw: bestCandidate.operatingProfitKrw as number,
      profitBandKrw: bestCandidate.profitBandKrw,
    }

    // 최대의 밴드와 겹치는 후보를 양쪽으로 **이어진 채로** 넓힌다. 밴드가 없는
    // 후보(평가 실패)에서 멈춘다 — 건너뛰면 구간이 끊긴 채 이어진 것처럼 보인다.
    let from = bestIndex
    let to = bestIndex
    const bestBand = bestCandidate.profitBandKrw
    if (bestBand !== null) {
      while (from - 1 >= 0) {
        const b = candidates[from - 1].profitBandKrw
        if (b === null || !overlaps(b, bestBand)) break
        from--
      }
      while (to + 1 < candidates.length) {
        const b = candidates[to + 1].profitBandKrw
        if (b === null || !overlaps(b, bestBand)) break
        to++
      }
    }

    const candidateCount = to - from + 1
    const startDayOffset = candidates[from].dayOffset
    const endDayOffset = candidates[to].dayOffset
    recommended = {
      startDayOffset,
      endDayOffset,
      startDate: addDays(asOfDate, startDayOffset),
      endDate: addDays(asOfDate, endDayOffset),
      candidateCount,
      indistinguishableWithinWindow: candidateCount > 1,
      includesNow: startDayOffset === 0,
    }

    if (candidateCount > 1) {
      own.push({
        code: "harvest_window_indistinguishable",
        quantity: candidateCount,
        unit: "count",
      })
    }
    // 최대 뒤쪽을 끝까지 보았는가. 마지막 후보가 최대이거나, 그 뒤에 평가하지
    // 못한 후보가 있으면 **최적이 본 구간 밖에 있을 수 있다.**
    const tailFailed = candidates.slice(bestIndex + 1).some((c) => c.failure !== null)
    const bestIsLast = bestIndex === candidates.length - 1
    if ((bestIsLast || tailFailed) && candidates.length > 1) {
      own.push({ code: "harvest_horizon_truncated", quantity: schedule.horizonDays, unit: "day" })
    }

    // **최대가 "지금" 인데 뒤를 못 봤으면 "지금 출하" 라고 하지 않는다.** 그때
    // 아는 것은 "평가된 후보 중에서는 지금이 최대" 뿐이고, 평가하지 못한 날이
    // 더 나을 수 있다. 최대가 뒤쪽이면 방향은 이미 정해졌으므로(지금보다
    // 낫다) hold_beyond_horizon 으로 족하다 — 끝을 못 봤다는 사실은 그 코드와
    // harvest_horizon_truncated 가 같이 말한다.
    decision =
      recommended.includesNow && candidateCount > 1
        ? "window_includes_now"
        : bestCandidate.dayOffset === 0
          ? tailFailed
            ? "indeterminate"
            : "harvest_now"
          : bestIsLast || tailFailed
            ? "hold_beyond_horizon"
            : "hold"
  }

  // 경고 병합 순서 — **먼저 들어온 quantity 가 남는다.**
  //  1. 생존율·밴드·앵커 : 엔진 3 자신의 가정. `survival_rate_assumed` 의
  //     quantity 가 **일별** 생존율이 되도록 맨 앞에 둔다(엔진 2 의 같은 코드는
  //     코호트 생존율을 담으므로, 뒤에 와서 밀린다).
  //  2. 추천 시점의 후보 : 단가 경고의 quantity 가 추천 시점의 수가 된다.
  //  3. 나머지 후보 : 범위 밖 경고 같은 것이 여기서 올라온다 — **어느 후보에서
  //     나왔든 결과까지 따라와야 한다.**
  const bestExclusions = bestIndex === -1 ? [] : candidates[bestIndex].exclusions
  const exclusions = mergeHarvestExclusions(
    withAnchor,
    outlookExclusions(input.abw, schedule.horizonDays),
    bestExclusions,
    ...candidates.map((c) => c.exclusions),
    own,
  )

  return {
    asOfDate,
    stepDays: schedule.stepDays,
    horizonDays: schedule.horizonDays,
    candidates,
    unevaluableCandidateCount,
    best,
    recommended,
    decision,
    band: {
      sources: abwUncertaintyG > 0 ? ["price_elasticity", "abw_uncertainty"] : ["price_elasticity"],
      priceElasticity: elasticity.band,
      abwUncertaintyG,
    },
    marginal,
    survival,
    price: priceInfo,
    failure: null,
    exclusions,
  }
}

// ── 폐사율 민감도 ──────────────────────────────────────────────────────────
// 엔진 2 의 survivalSensitivity 가 **사이클 생존율**로 손익을 흔들어 "생존율이
// 손익을 지배한다" 를 보였다(−2,921만원 ~ +1,104만원, 4,000만원 폭). 엔진 3 의
// 같은 질문은 **일별 생존율**이다 — "하루 몇 %씩 죽으면 2주 더 키우는 것이
// 손해로 뒤집히나".
//
// 천황수산은 하루 0.30% 였다. 뒤집히는 경계는 그보다 훨씬 높고, 그 차이가
// "이 농가에서 2주는 비싸다" 를 수로 말해 준다.

export type SurvivalSweepRow = {
  dailySurvivalRate: number
  dailyMortalityRate: number
  decision: HarvestDecisionCode | null
  bestDayOffset: number | null
  recommendedStartDayOffset: number | null
  recommendedEndDayOffset: number | null
  /** 기준 시점(보통 지평)에서의 "지금 대비" 이익 차액. */
  profitDeltaKrw: number | null
  profitDeltaBandKrw: { low: number; high: number } | null
}

export type SurvivalSweep = {
  atDayOffset: number
  rows: readonly SurvivalSweepRow[]
}

function deltaAt(window: HarvestWindow, atDayOffset: number): HarvestCandidate | undefined {
  return window.candidates.find((c) => c.dayOffset === atDayOffset)
}

/** 기준 시점 — 안 주면 지평(마지막 후보)이다. */
function resolveAtDayOffset(window: HarvestWindow, atDayOffset: number | null | undefined): number {
  if (isNum(atDayOffset)) return atDayOffset
  const last = window.candidates[window.candidates.length - 1]
  return last === undefined ? 0 : last.dayOffset
}

/**
 * 일별 생존율을 바꿔 가며 판정이 어떻게 달라지는지. **입력 순서를 그대로
 * 유지한다** — 엔진 2 의 survivalSensitivity 와 같은 규칙이다.
 */
export function harvestWindowBySurvival(
  input: HarvestWindowInput,
  dailySurvivalRates: readonly number[],
  options: { atDayOffset?: number | null } = {},
): SurvivalSweep {
  const base = harvestWindow(input)
  const atDayOffset = resolveAtDayOffset(base, options.atDayOffset)

  const rows: SurvivalSweepRow[] = []
  for (const dailySurvivalRate of dailySurvivalRates) {
    const w = harvestWindow({ ...input, survival: { dailySurvivalRate } })
    const candidate = deltaAt(w, atDayOffset)
    rows.push({
      dailySurvivalRate,
      dailyMortalityRate: isNum(dailySurvivalRate) ? 1 - dailySurvivalRate : NaN,
      decision: w.decision,
      bestDayOffset: w.best?.dayOffset ?? null,
      recommendedStartDayOffset: w.recommended?.startDayOffset ?? null,
      recommendedEndDayOffset: w.recommended?.endDayOffset ?? null,
      profitDeltaKrw: candidate?.profitDeltaFromNowKrw ?? null,
      profitDeltaBandKrw: candidate?.profitDeltaBandKrw ?? null,
    })
  }

  return { atDayOffset, rows }
}

export type SurvivalFlipPoint = {
  /** 어느 시점의 차액이 0 이 되는 지점을 찾았나. */
  atDayOffset: number
  /** 뒤집히는 일별 생존율. */
  dailySurvivalRate: number | null
  /** 1 − 그 값. 0.0107 이면 하루 1.07% 폐사에서 뒤집힌다. */
  dailyMortalityRate: number | null
  /** 탐색 구간과 양 끝의 차액. 부호가 같으면 뒤집힘이 구간 안에 없다. */
  bracket: {
    min: number
    max: number
    deltaAtMinKrw: number | null
    deltaAtMaxKrw: number | null
  }
  iterations: number
  failure: "no_flip_in_range" | "delta_unavailable" | null
}

/**
 * **"하루 몇 % 죽으면 더 키우는 것이 손해로 뒤집히나."** 이분법으로 찾는다.
 *
 * 기준 시점의 「지금 대비 이익 차액」이 0 이 되는 일별 생존율이다. 차액은
 * 생존율에 대해 단조 증가한다 — 생존율이 높을수록 그 시점의 마리수가 많고
 * "지금 출하" 쪽 금액은 생존율과 무관하기 때문이다. 그래서 이분법이 성립한다.
 *
 * **구간 양 끝에서 부호가 같으면 수를 돌려주지 않는다**(no_flip_in_range).
 * 끌어당겨 그럴듯한 값을 내놓으면 호출자는 뒤집힘이 있는 줄 안다.
 */
export function dailySurvivalFlipPoint(
  input: HarvestWindowInput,
  options: {
    atDayOffset?: number | null
    range?: { min: number; max: number }
    iterations?: number
  } = {},
): SurvivalFlipPoint {
  const base = harvestWindow(input)
  const atDayOffset = resolveAtDayOffset(base, options.atDayOffset)
  const range = options.range ?? DEFAULT_FLIP_SEARCH_RANGE
  const iterations = isNum(options.iterations) ? options.iterations : FLIP_SEARCH_ITERATIONS

  const delta = (s: number): number | null => {
    const w = harvestWindow({ ...input, survival: { dailySurvivalRate: s } })
    return deltaAt(w, atDayOffset)?.profitDeltaFromNowKrw ?? null
  }

  const deltaAtMinKrw = delta(range.min)
  const deltaAtMaxKrw = delta(range.max)
  const bracket = { min: range.min, max: range.max, deltaAtMinKrw, deltaAtMaxKrw }

  if (deltaAtMinKrw === null || deltaAtMaxKrw === null) {
    return {
      atDayOffset,
      dailySurvivalRate: null,
      dailyMortalityRate: null,
      bracket,
      iterations: 0,
      failure: "delta_unavailable",
    }
  }
  if (deltaAtMinKrw > 0 || deltaAtMaxKrw < 0) {
    return {
      atDayOffset,
      dailySurvivalRate: null,
      dailyMortalityRate: null,
      bracket,
      iterations: 0,
      failure: "no_flip_in_range",
    }
  }

  let lo = range.min
  let hi = range.max
  let used = 0
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    const d = delta(mid)
    used++
    if (d === null) break
    if (d < 0) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }

  const dailySurvivalRate = (lo + hi) / 2
  return {
    atDayOffset,
    dailySurvivalRate,
    dailyMortalityRate: 1 - dailySurvivalRate,
    bracket,
    iterations: used,
    failure: null,
  }
}
