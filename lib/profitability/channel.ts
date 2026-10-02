// 판매 채널과 단가 — 엔진 2 가 **조용히 도매가로 계산하지 않도록** 하는 층.
//
// 도매 17,000 · 소매 활새우 26,500 · 소매 냉동 18,000 원/kg. **도매와 소매
// 활새우가 56% 벌어진다.** 같은 새우를 어느 채널로 내보내는가가 성장 몇 주치
// 보다 크게 작용한다(docs/plans/tips-2026-dataset-assessment.md 3-4).
//
// 그래서 단가에 기본값을 박지 않는다. 박아 두면 호출자가 아무것도 고르지 않고
// 호출했을 때 도매가로 계산된 수치가 소매 예상 수익인 것처럼 화면에 올라간다.
// 56% 틀린 금액이 아무 표시 없이 나가는 것이 이 엔진에서 가장 쉬운 사고다.
//
// 두 겹으로 막는다.
//   1. 타입 — PriceBasis 는 필수 인자다. 안 넘기면 컴파일이 안 된다.
//   2. 런타임 — 그래도 안 넘어오면(JS 호출자·DB 에서 온 null) 단가를 null 로
//      돌려주고 "price_basis_not_selected" 를 남긴다. **기본 채널로 떨어지지
//      않는다.**
// 그리고 어느 쪽으로 정해졌든 **결과에 채널과 근거를 담아 돌려준다.**

import { CHANNEL_MEDIAN_KRW_PER_KG, CHANNEL_PRICE_OBSERVED } from "./constants"
import type { SalesChannel } from "./constants"
import type { Exclusion } from "./exclusions"

export type { SalesChannel }

export type PriceBasis =
  /** 채널 중앙값을 쓴다. **실거래 중앙값이지 다음 거래의 확정 단가가 아니다.** */
  | { kind: "channel_median"; channel: SalesChannel }
  /** 단가를 직접 넣는다. 계약 단가·견적이 있을 때. 채널은 선택이다. */
  | { kind: "explicit"; krwPerKg: number; channel?: SalesChannel }
  /**
   * 이미 팔린 실적에서 역산한 **실현 단가** = 확정 매출 ÷ 확정 중량.
   * 채널·등급이 섞인 평균이라 어느 채널도 아니다. 민감도 분석에서 "나머지
   * 조건 고정" 을 지킬 때 쓴다 — 거기서 채널 중앙값을 끼우면 생존율이 아니라
   * 단가를 바꾼 결과가 나온다.
   */
  | { kind: "realized" }

export type PriceFailure = "price_basis_not_selected" | "invalid_price" | "no_realized_basis"

export type ResolvedPrice = {
  krwPerKg: number | null
  /** 어느 근거로 정해졌나. 못 정하면 null. */
  basis: PriceBasis | null
  /**
   * 어느 채널인가. **중앙값을 썼으면 그 채널이 여기 담긴다** — 호출자가
   * 기본값에 기대어 호출했더라도 결과만 보면 어느 채널인지 알 수 있다.
   * 실현 단가는 채널이 섞여 있어 null 이다.
   */
  channel: SalesChannel | null
  failure: PriceFailure | null
  /** 그 채널의 관측 폭과 표본 수. 중앙값이 확정 단가가 아님을 알리는 값이다. */
  observed: { n: number; minKrwPerKg: number; medianKrwPerKg: number; maxKrwPerKg: number } | null
  exclusions: Exclusion[]
}

export type RealizedContext = {
  /** 확정 매출(원). */
  revenueKrw?: number | null
  /** 그 매출에 대응하는 중량(kg). */
  weightKg?: number | null
}

/**
 * 단가를 정한다. **basis 가 없으면 기본 채널로 떨어지지 않고 실패를 돌려준다.**
 */
export function resolvePrice(
  basis: PriceBasis | null | undefined,
  realized?: RealizedContext,
): ResolvedPrice {
  const empty = (failure: PriceFailure, channel: SalesChannel | null = null): ResolvedPrice => ({
    krwPerKg: null,
    basis: basis ?? null,
    channel,
    failure,
    observed: channel === null ? null : CHANNEL_PRICE_OBSERVED[channel],
    exclusions: [{ code: "price_basis_not_selected", quantity: null, unit: "krw_per_kg" }],
  })

  if (basis == null) return empty("price_basis_not_selected")

  if (basis.kind === "channel_median") {
    const krwPerKg = CHANNEL_MEDIAN_KRW_PER_KG[basis.channel]
    if (typeof krwPerKg !== "number" || !Number.isFinite(krwPerKg)) {
      return empty("invalid_price", basis.channel)
    }
    return {
      krwPerKg,
      basis,
      channel: basis.channel,
      failure: null,
      observed: CHANNEL_PRICE_OBSERVED[basis.channel],
      // 중앙값은 가정이다. 금액과 함께 그 사실을 들고 나간다.
      exclusions: [{ code: "price_from_channel_median", quantity: krwPerKg, unit: "krw_per_kg" }],
    }
  }

  if (basis.kind === "explicit") {
    if (!Number.isFinite(basis.krwPerKg)) return empty("invalid_price", basis.channel ?? null)
    return {
      krwPerKg: basis.krwPerKg,
      basis,
      channel: basis.channel ?? null,
      failure: null,
      observed: basis.channel === undefined ? null : CHANNEL_PRICE_OBSERVED[basis.channel],
      exclusions: [],
    }
  }

  // realized — 확정 매출 ÷ 확정 중량.
  const revenueKrw = realized?.revenueKrw
  const weightKg = realized?.weightKg
  if (
    typeof revenueKrw !== "number" ||
    !Number.isFinite(revenueKrw) ||
    typeof weightKg !== "number" ||
    !Number.isFinite(weightKg) ||
    weightKg <= 0
  ) {
    return {
      krwPerKg: null,
      basis,
      channel: null,
      failure: "no_realized_basis",
      observed: null,
      exclusions: [{ code: "price_basis_not_selected", quantity: null, unit: "krw_per_kg" }],
    }
  }
  return {
    krwPerKg: revenueKrw / weightKg,
    basis,
    channel: null,
    failure: null,
    observed: null,
    exclusions: [],
  }
}
