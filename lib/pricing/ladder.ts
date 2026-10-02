// 크기-단가 사다리와 탄력성 적합. **이 파일의 절반이 섞임 방지다.**
//
// ── 막아야 할 사고 ───────────────────────────────────────────────────────
// "스칼라 단가 테이블을 판매처 무시하고 만들면 엔진 3 이 작은 새우가 더 비싸다고
// 말하게 된다."
//
// 숫자로: 같은 40미/kg 에서 단가가 28,000 ~ 49,900 원으로 **1.78 배** 벌어진다.
// 크기 전구간 효과는 **+24.6%** 에 불과하다. **판매처 간 노이즈가 크기 신호의
// 3배다.** 프리미엄 상품(무항생제·친환경 49,900 원 @40미, 산지직송 42,900 원
// @40미)은 40미인데도 특대(30미, 34,900 원)보다 비싸다. 이들을 한 회귀에 넣으면
// 기울기 부호가 뒤집힌다.
//
// ── 네 겹으로 막는다 ─────────────────────────────────────────────────────
//  1. **타입** — 사다리는 vendor·stage·form·premium·observedAt 을 **사다리
//     단위로** 들고, 칸(rung)은 (미/kg, 원/kg) 둘뿐이다. 칸이 자기 판매처를
//     들고 있지 않으므로 **한 사다리는 구조상 한 판매처다.**
//  2. **묶기** — 느슨한 관측 배열로 들어오는 경로는 buildLadders 가
//     (판매처, 단계, 상태, 프리미엄, 시점)로 묶는다. 묶음이 2개 이상이면
//     fitSizeElasticityFromObservations 는 **수를 돌려주지 않고 거부한다.**
//  3. **단조성** — 라벨이 한 판매처라고 거짓말해도, 사다리 안에서 단가가
//     크기와 같이 오르지 않으면 거부한다. 프리미엄 점이 섞이는 실제 형태가
//     이것이다(25 g @49,900 이 33.3 g @34,900 보다 비싸다).
//  4. **크기 상한** — 구간 탄력성이 1.5 를 넘으면 크기 효과가 아니라 판매처
//     노이즈로 보고 거부한다. 프리미엄 점을 끼우면 9.53 이 나온다.
//
// 네 겹 중 어느 하나라도 걸리면 **elasticity 가 null 로 나가고 failure 가
// 채워진다.** 기본 탄력성으로 조용히 떨어지지 않는다 — 엔진 2 의
// resolvePrice 가 기본 채널로 떨어지지 않는 것과 같은 원칙이다.

import {
  ELASTICITY_PLAUSIBLE_RANGE,
  LADDER_MARKETPLACE,
  LADDER_OBSERVED_AT,
  LADDER_PRODUCT_ID,
  LADDER_VENDOR,
  SIZE_ELASTICITY_BAND,
  SIZE_ELASTICITY_DEFAULT,
  SIZE_PRICE_LADDER_RUNGS,
  SLOPE_ELIGIBLE_FORMS,
  formFamily,
} from "./constants"
import type {
  DistributionStage,
  EvidenceGrade,
  FormFamily,
  ObservationSource,
  ProductForm,
} from "./constants"
import { mergePricingExclusions } from "./exclusions"
import type { PricingExclusion } from "./exclusions"

// ── 크기 환산 ─────────────────────────────────────────────────────────────
// 미/kg 과 ABW 는 **같은 수의 두 표기**다. 둘을 따로 저장하면 반드시 어긋나므로
// 관측에는 미/kg 만 담고 ABW 는 여기서 파생한다.

/** 미/kg → 개체중(g). 1000 / countPerKg. */
export function abwFromCountPerKg(countPerKg: number): number | null {
  if (!Number.isFinite(countPerKg) || countPerKg <= 0) return null
  return 1000 / countPerKg
}

/** 개체중(g) → 미/kg. 1000 / abwG. */
export function countPerKgFromAbwG(abwG: number): number | null {
  if (!Number.isFinite(abwG) || abwG <= 0) return null
  return 1000 / abwG
}

// ── 관측과 사다리 ─────────────────────────────────────────────────────────

/**
 * 낱개 관측. **판매처 식별자가 필수다** — 섞임 판정의 유일한 기준이고,
 * 선택으로 두면 비워서 호출하는 경로가 생긴다.
 */
export type SizePriceObservation = {
  /** 판매처. 빈 문자열은 거부된다. */
  vendor: string
  stage: DistributionStage
  form: ProductForm
  /** 프리미엄 인증(무항생제·친환경 등). true 면 기울기 적합·단계 변환에서 빠진다. */
  premium: boolean
  /** 조회 시점 YYYY-MM. 시점이 다르면 다른 사다리다. */
  observedAt: string
  grade: EvidenceGrade
  source: ObservationSource
  countPerKg: number
  krwPerKg: number
  /** 등급 표기 그대로(있으면). */
  label?: string
}

/** 사다리 한 칸. ABW 는 countPerKg 에서 파생된 값이다. */
export type LadderPoint = {
  label?: string
  countPerKg: number
  abwG: number
  krwPerKg: number
}

/**
 * 한 판매처·한 단계·한 상태·한 시점의 사다리. **칸은 자기 판매처를 들고
 * 있지 않다** — 그래서 한 사다리에 두 판매처가 들어갈 수 없다(1겹).
 */
export type SizePriceLadder = {
  vendor: string
  stage: DistributionStage
  form: ProductForm
  premium: boolean
  observedAt: string
  grade: EvidenceGrade
  source: ObservationSource
  /** ABW 오름차순(= 미/kg 내림차순)으로 정렬되어 들어 있다. */
  points: readonly LadderPoint[]
}

/** (판매처, 단계, 상태, 프리미엄, 시점). 이 다섯이 다르면 다른 사다리다. */
export function ladderGroupKey(o: {
  vendor: string
  stage: DistributionStage
  form: ProductForm
  premium: boolean
  observedAt: string
}): string {
  return `${o.vendor}|${o.stage}|${o.form}|${o.premium ? "premium" : "standard"}|${o.observedAt}`
}

export type BuildLaddersResult = {
  ladders: readonly SizePriceLadder[]
  /** 묶음 키 목록. 길이가 2 이상이면 섞였다는 뜻이다. */
  groupKeys: readonly string[]
  /** 미/kg·단가가 수가 아닌 관측. 조용히 버리지 않고 돌려준다. */
  invalid: readonly SizePriceObservation[]
  exclusions: PricingExclusion[]
}

/**
 * 느슨한 관측 배열을 사다리로 묶는다(2겹). **섞여 있는지 판정만 하고 고르지
 * 않는다** — 어느 판매처를 쓸지는 호출자가 정할 일이다.
 */
export function buildLadders(observations: readonly SizePriceObservation[]): BuildLaddersResult {
  const groups = new Map<string, SizePriceObservation[]>()
  const invalid: SizePriceObservation[] = []

  for (const o of observations) {
    if (typeof o.vendor !== "string" || o.vendor.trim() === "") {
      invalid.push(o)
      continue
    }
    const abwG = abwFromCountPerKg(o.countPerKg)
    if (abwG === null || !Number.isFinite(o.krwPerKg) || o.krwPerKg <= 0) {
      invalid.push(o)
      continue
    }
    const key = ladderGroupKey(o)
    const bucket = groups.get(key)
    if (bucket) bucket.push(o)
    else groups.set(key, [o])
  }

  const ladders: SizePriceLadder[] = []
  for (const bucket of groups.values()) {
    const head = bucket[0]
    const points = bucket
      .map((o) => ({
        label: o.label,
        countPerKg: o.countPerKg,
        abwG: 1000 / o.countPerKg,
        krwPerKg: o.krwPerKg,
      }))
      .sort((a, b) => a.abwG - b.abwG)
    ladders.push({
      vendor: head.vendor,
      stage: head.stage,
      form: head.form,
      premium: head.premium,
      observedAt: head.observedAt,
      grade: head.grade,
      source: head.source,
      points,
    })
  }

  const groupKeys = [...groups.keys()]
  const premiumPoints = observations.filter((o) => o.premium).length
  const exclusions: PricingExclusion[] = []
  if (groupKeys.length > 1) {
    exclusions.push({ code: "price_ladder_vendor_mixed", quantity: groupKeys.length, unit: "count" })
  }
  if (premiumPoints > 0) {
    exclusions.push({ code: "price_ladder_premium_excluded", quantity: premiumPoints, unit: "count" })
  }

  return { ladders, groupKeys, invalid, exclusions }
}

// ── 탄력성 ────────────────────────────────────────────────────────────────

/** 사다리 한 구간의 로그탄력성. */
export type SegmentElasticity = {
  fromCountPerKg: number
  toCountPerKg: number
  fromAbwG: number
  toAbwG: number
  fromKrwPerKg: number
  toKrwPerKg: number
  elasticity: number
}

/**
 * 쓸 수 있는 탄력성. **맨 number 가 아닌 이유가 전부 여기 있다** — 어느 상태
 * 묶음에서 나왔는지(family)를 들고 다니지 않으면 냉동 계수로 활 단가를 계산하는
 * 길이 열린다. 밴드·판매처 수·잠정 여부도 같이 다녀야 추정 결과에 경고를
 * 붙일 수 있다.
 */
export type SizeElasticity = {
  value: number
  /**
   * 하한~상한. 하한은 소매 사다리 그대로(0.63), 상한은 택배 고정비를 뺀 값
   * (0.73)이다. **0.63 은 하한이고 그 편향은 "덜 키우자" 방향이다.**
   */
  band: { low: number; high: number }
  /** 활·생물 / 선 / 냉동. 앵커와 다르면 추정이 거부된다. */
  family: FormFamily
  /** 관측 근거 등급. 잠정 여부와는 다른 축이다. */
  grade: EvidenceGrade
  /** 농가 입력이 쌓이면 교체되는 설정값인가. 기본 탄력성은 true. */
  provisional: boolean
  /** 근거가 된 판매처 수. 1 이면 price_elasticity_single_vendor 가 올라간다. */
  vendorCount: number
  /** 관측된 ABW 범위. 밖으로 나가면 price_target_outside_observed_size 가 올라간다. */
  observedAbwRangeG: { min: number; max: number } | null
  /**
   * 근거 사다리에서 **구간별 탄력성이 크기와 함께 커졌는가**(0.557 → 0.612 →
   * 0.718). true 면 이 상수가 큰 개체를 과소평가한다는 뜻이고, 추정마다
   * `price_elasticity_size_dependent` 가 따라 나간다. 구간이 부족해 판정하지
   * 못했으면 null 이다 — false 로 채우지 않는다.
   */
  sizeDependent: boolean | null
  sourceNote: string
}

export type ElasticityFitFailure =
  /** 판매처 식별자가 비어 있다. */
  | "vendor_missing"
  /** 관측이 2점 미만이다. 1점으로는 기울기가 정의되지 않는다. */
  | "insufficient_points"
  /** 미/kg·단가가 수가 아니거나 0 이하다. */
  | "invalid_point"
  /** 같은 크기가 두 번 들어왔다. 로그비의 분모가 0 이 된다. */
  | "duplicate_size"
  /** 프리미엄 인증 사다리다. 기울기 근거가 되지 않는다. */
  | "premium_excluded"
  /** 냉동·선 사다리다. 활·생물만 기울기 근거가 된다(경고 3). */
  | "form_not_slope_eligible"
  /** 단가가 크기와 같이 오르지 않는다. 다른 상품이 섞였다는 뜻이다(3겹). */
  | "price_not_monotonic"
  /** 구간 탄력성이 크기 효과로 설명되지 않는다(4겹). */
  | "elasticity_implausible"
  /** 느슨한 관측 배열에 판매처가 둘 이상이다(2겹). */
  | "mixed_vendors"

export type ElasticityFit = {
  /** 쓸 수 있는 탄력성. 네 겹 중 하나라도 걸리면 null 이다. */
  elasticity: SizeElasticity | null
  /** 전구간(양 끝점) 로그탄력성. 사다리에서 0.6324 가 나온다. */
  endToEnd: number | null
  /**
   * 로그-로그 OLS 기울기. 사다리에서 0.6315 다. 전구간과 벌어지는 폭이 곡률의
   * 크기다 — 두 수를 같이 내보내는 이유가 그것이다.
   */
  ols: number | null
  /** 구간별 탄력성. **상수로 요약했어도 버리지 않는다.** */
  segments: readonly SegmentElasticity[]
  /**
   * 구간 탄력성이 크기와 함께 단조 증가하는가. 사다리에서는 true
   * (0.557 → 0.612 → 0.718). 구간이 2개 미만이면 **판정 불가라서 null** 이다
   * — false 로 채우지 않는다.
   */
  segmentsMonotoneIncreasing: boolean | null
  observedAbwRangeG: { min: number; max: number } | null
  /** 적합에 쓰인 판매처 수. */
  vendorCount: number
  failure: ElasticityFitFailure | null
  exclusions: PricingExclusion[]
}

function failFit(
  failure: ElasticityFitFailure,
  exclusions: PricingExclusion[] = [],
  partial: Partial<ElasticityFit> = {},
): ElasticityFit {
  return {
    elasticity: null,
    endToEnd: null,
    ols: null,
    segments: [],
    segmentsMonotoneIncreasing: null,
    observedAbwRangeG: null,
    vendorCount: 0,
    failure,
    exclusions,
    ...partial,
  }
}

export type FitOptions = {
  /**
   * 적합 결과를 확정값으로 볼 것인가. **기본은 false(= 잠정)** 이다. 판매처가
   * 둘 이상 쌓이고 사람이 확인한 뒤에만 호출자가 true 로 올린다.
   */
  provisional?: boolean
  /** 근거가 된 판매처 수. 기본 1. */
  vendorCount?: number
}

/**
 * 한 사다리에서 탄력성을 뽑는다. **거부가 기본 동작이다** — 조건을 못 맞추면
 * 수를 돌려주지 않는다.
 */
export function fitSizeElasticity(ladder: SizePriceLadder, options: FitOptions = {}): ElasticityFit {
  if (typeof ladder.vendor !== "string" || ladder.vendor.trim() === "") {
    return failFit("vendor_missing")
  }
  if (ladder.premium) {
    return failFit("premium_excluded", [
      { code: "price_ladder_premium_excluded", quantity: ladder.points.length, unit: "count" },
    ])
  }
  if (!SLOPE_ELIGIBLE_FORMS.includes(ladder.form)) {
    // 냉동 기울기는 약 0.19(활·생물의 1/3)로 완전히 다르고 근거가 C 등급이다.
    // 방향만 기억하고 수치는 쓰지 않는다 — 냉동 사다리로 기울기를 뽑으면
    // 크기 프리미엄이 크게 과소평가된다.
    return failFit("form_not_slope_eligible", [
      { code: "price_ladder_form_not_slope_eligible", quantity: null, unit: null },
    ])
  }

  const points = [...ladder.points].sort((a, b) => a.abwG - b.abwG)
  if (points.length < 2) return failFit("insufficient_points")
  for (const p of points) {
    if (
      !Number.isFinite(p.abwG) ||
      p.abwG <= 0 ||
      !Number.isFinite(p.krwPerKg) ||
      p.krwPerKg <= 0 ||
      !Number.isFinite(p.countPerKg) ||
      p.countPerKg <= 0
    ) {
      return failFit("invalid_point")
    }
  }

  // 3겹 — 단가가 크기와 같이 오르는가. 프리미엄 점이 섞이는 실제 형태다.
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    if (cur.abwG === prev.abwG) return failFit("duplicate_size")
    if (cur.krwPerKg <= prev.krwPerKg) {
      return failFit("price_not_monotonic", [
        { code: "price_ladder_not_monotonic", quantity: cur.countPerKg, unit: "count" },
      ])
    }
  }

  const segments: SegmentElasticity[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    segments.push({
      fromCountPerKg: a.countPerKg,
      toCountPerKg: b.countPerKg,
      fromAbwG: a.abwG,
      toAbwG: b.abwG,
      fromKrwPerKg: a.krwPerKg,
      toKrwPerKg: b.krwPerKg,
      elasticity: Math.log(b.krwPerKg / a.krwPerKg) / Math.log(b.abwG / a.abwG),
    })
  }

  // 4겹 — 크기 효과로 설명되는 크기인가.
  for (const s of segments) {
    if (s.elasticity < ELASTICITY_PLAUSIBLE_RANGE.min || s.elasticity > ELASTICITY_PLAUSIBLE_RANGE.max) {
      return failFit(
        "elasticity_implausible",
        [{ code: "price_ladder_elasticity_implausible", quantity: s.elasticity, unit: "ratio" }],
        { segments },
      )
    }
  }

  const first = points[0]
  const last = points[points.length - 1]
  const endToEnd = Math.log(last.krwPerKg / first.krwPerKg) / Math.log(last.abwG / first.abwG)

  // 로그-로그 OLS. 2점이면 전구간과 같은 수가 나온다.
  let sumX = 0
  let sumY = 0
  for (const p of points) {
    sumX += Math.log(p.abwG)
    sumY += Math.log(p.krwPerKg)
  }
  const meanX = sumX / points.length
  const meanY = sumY / points.length
  let sxy = 0
  let sxx = 0
  for (const p of points) {
    const dx = Math.log(p.abwG) - meanX
    sxy += dx * (Math.log(p.krwPerKg) - meanY)
    sxx += dx * dx
  }
  const ols = sxx > 0 ? sxy / sxx : null

  let monotone: boolean | null = null
  if (segments.length >= 2) {
    monotone = true
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].elasticity <= segments[i - 1].elasticity) {
        monotone = false
        break
      }
    }
  }

  const observedAbwRangeG = { min: first.abwG, max: last.abwG }
  const vendorCount = options.vendorCount ?? 1
  const exclusions: PricingExclusion[] = []
  if (options.provisional !== false) {
    exclusions.push({ code: "price_elasticity_provisional", quantity: endToEnd, unit: "ratio" })
  }
  if (vendorCount <= 1) {
    exclusions.push({ code: "price_elasticity_single_vendor", quantity: vendorCount, unit: "count" })
  }
  if (monotone === true) {
    const maxSegment = segments.reduce((m, s) => Math.max(m, s.elasticity), -Infinity)
    exclusions.push({ code: "price_elasticity_size_dependent", quantity: maxSegment, unit: "ratio" })
  }

  return {
    elasticity: {
      value: endToEnd,
      band: { low: SIZE_ELASTICITY_BAND.low, high: SIZE_ELASTICITY_BAND.high },
      family: formFamily(ladder.form),
      grade: ladder.grade,
      provisional: options.provisional !== false,
      vendorCount,
      observedAbwRangeG,
      sizeDependent: monotone,
      sourceNote: `${ladder.vendor} / ${ladder.stage} / ${ladder.form} / ${ladder.observedAt} · ${points.length}점`,
    },
    endToEnd,
    ols,
    segments,
    segmentsMonotoneIncreasing: monotone,
    observedAbwRangeG,
    vendorCount,
    failure: null,
    exclusions,
  }
}

/**
 * 느슨한 관측 배열에서 탄력성을 뽑는다. **판매처가 섞여 있으면 수를 돌려주지
 * 않는다**(2겹). 어느 사다리가 섞여 들어왔는지는 groupKeys 로 알 수 있다.
 */
export function fitSizeElasticityFromObservations(
  observations: readonly SizePriceObservation[],
  options: FitOptions = {},
): ElasticityFit & { groupKeys: readonly string[] } {
  const built = buildLadders(observations)
  if (built.invalid.length > 0) {
    return { ...failFit("invalid_point", built.exclusions), groupKeys: built.groupKeys }
  }
  if (built.ladders.length === 0) {
    return { ...failFit("insufficient_points", built.exclusions), groupKeys: built.groupKeys }
  }
  if (built.ladders.length > 1) {
    return {
      ...failFit("mixed_vendors", built.exclusions),
      groupKeys: built.groupKeys,
    }
  }
  const fit = fitSizeElasticity(built.ladders[0], options)
  return {
    ...fit,
    exclusions: mergePricingExclusions(built.exclusions, fit.exclusions),
    groupKeys: built.groupKeys,
  }
}

// ── 기준 사다리와 기본 탄력성 ─────────────────────────────────────────────

/** 이순신수산 4단 사다리. constants.ts 의 관측을 사다리 형태로 묶은 것이다. */
export const SIZE_PRICE_LADDER: SizePriceLadder = {
  vendor: LADDER_VENDOR,
  stage: "online_retail",
  // 상품 표기가 「생물·활」 하나다. 둘을 가를 관측이 없어 live 로 둔다 —
  // formFamily 가 live 와 fresh 를 같은 묶음으로 보므로 효과는 같다.
  form: "live",
  premium: false,
  observedAt: LADDER_OBSERVED_AT,
  grade: "A",
  source: {
    kind: "vendor_listing",
    vendor: LADDER_VENDOR,
    marketplace: LADDER_MARKETPLACE,
    productId: LADDER_PRODUCT_ID,
  },
  points: SIZE_PRICE_LADDER_RUNGS.map((r) => ({
    label: r.label,
    countPerKg: r.countPerKg,
    abwG: 1000 / r.countPerKg,
    krwPerKg: r.krwPerKg,
  })),
}

/**
 * 기본 탄력성. **값은 사다리에서 나온 0.6324 가 아니라 두 자리로 자른 0.63**
 * 이다 — 판매처 한 곳의 사다리에서 나온 수에 소수 네 자리의 정밀도는 없고,
 * 박아 두면 다음 사람이 정밀도로 읽는다. 적합 결과 자체가 필요하면
 * `fitSizeElasticity(SIZE_PRICE_LADDER)` 를 쓴다.
 *
 * `provisional: true` 는 **농가 입력이 쌓이면 교체되는 설정값**이라는 뜻이고,
 * 모든 추정 결과에 `price_elasticity_provisional` 로 따라 나간다.
 */
export const DEFAULT_SIZE_ELASTICITY: SizeElasticity = {
  value: SIZE_ELASTICITY_DEFAULT,
  band: { low: SIZE_ELASTICITY_BAND.low, high: SIZE_ELASTICITY_BAND.high },
  family: "live_fresh",
  grade: "A",
  provisional: true,
  vendorCount: 1,
  observedAbwRangeG: {
    min: 1000 / SIZE_PRICE_LADDER_RUNGS[0].countPerKg,
    max: 1000 / SIZE_PRICE_LADDER_RUNGS[SIZE_PRICE_LADDER_RUNGS.length - 1].countPerKg,
  },
  // 사다리 구간 탄력성이 단조 증가한다 — 이 상수는 큰 개체를 과소평가한다.
  sizeDependent: true,
  sourceNote: `${LADDER_VENDOR} / ${LADDER_MARKETPLACE} ${LADDER_PRODUCT_ID} 4단 사다리 ${LADDER_OBSERVED_AT} · 전구간 0.6324 → 잠정 설정값 0.63`,
}

/**
 * 냉동 탄력성(약 0.19, 등급 C). **family 가 frozen 이라서 활·생물 앵커에
 * 적용하면 거부된다**(size-price.ts). 쓰라고 내보내는 값이 아니고, 냉동
 * 사다리를 보고 "0.63 이 너무 크다" 고 결론 내리는 것을 막기 위해 형태를
 * 갖춰 둔 값이다.
 */
export const FROZEN_SIZE_ELASTICITY: SizeElasticity = {
  value: 0.19,
  band: { low: 0.19, high: 0.19 },
  family: "frozen",
  grade: "C",
  provisional: true,
  vendorCount: 1,
  observedAbwRangeG: null,
  sizeDependent: null,
  sourceNote: "냉동 상품 사다리, 등급 C — 수치 신뢰 불가. 방향(활·생물의 1/3)만 유효하다.",
}
