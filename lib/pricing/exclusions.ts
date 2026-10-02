// 「이 단가에 포함되지 않은 것」 목록 — **엔진 2 의 Exclusion 어휘를 그대로
// 쓴다.** 새 경고 체계를 만들지 않았다.
//
// 모양·단위·병합 규칙이 lib/profitability/exclusions.ts 와 같다. 다른 것은
// code 의 집합뿐이다. ExclusionCode 유니온을 넓히려면 엔진 2 의 파일을 고쳐야
// 하는데 이 작업의 범위가 아니므로(lib/profitability 는 읽기만), 엔진 2 의
// Exclusion 에서 code 만 빼고 넓힌 유니온을 붙인다. 그래서
//   · PricingExclusion 은 Exclusion 과 같은 필드를 갖는다
//   · ExclusionUnit 은 엔진 2 것을 그대로 쓴다(새 단위를 만들지 않았다)
//   · 엔진 2 가 돌려준 Exclusion[] 은 PricingExclusion[] 자리에 그대로 들어간다
// 엔진 3 이 두 엔진의 목록을 합칠 때 변환이 필요 없다.
//
// **문장은 만들지 않는다.** 코드와 수치만 돌려주고 번역은 화면이 맡는다.

import type { Exclusion, ExclusionUnit } from "@/lib/profitability/exclusions"

export type { ExclusionUnit }

export type PricingExclusionCode =
  /**
   * **탄력성이 잠정값이다.** 농가 입력이 쌓이면 교체되는 설정값이고 점추정이
   * 아니다. quantity 는 쓰인 탄력성(unit "ratio").
   */
  | "price_elasticity_provisional"
  /**
   * **탄력성 근거가 판매처 한 곳의 사다리다.** 시장 평균이 아닐 수 있다.
   * 두 번째 사다리를 찾지 못한 것이 이 모델의 현재 최대 약점이다.
   * quantity 는 근거가 된 판매처 수(unit "count").
   */
  | "price_elasticity_single_vendor"
  /**
   * **쓰인 탄력성이 하한이다.** 소매가에 섞인 택배 고정비(약 4,000 원/kg)를
   * 빼면 0.73 으로 올라간다. 즉 크기 프리미엄이 과소평가되고, 엔진 3 의
   * "더 키우자" 가 과소 권고된다. quantity 는 밴드 상한(unit "ratio").
   */
  | "price_elasticity_lower_bound"
  /**
   * **구간별 탄력성이 크기와 함께 커진다**(0.557 → 0.612 → 0.718). 상수
   * 탄력성은 이 효과를 놓치고 큰 개체를 과소평가한다. quantity 는 관측된
   * 최대 구간 탄력성(unit "ratio").
   */
  | "price_elasticity_size_dependent"
  /** 탄력성이 활·생물 사다리에서 나왔다. 선·냉동에는 쓸 수 없다. */
  | "price_elasticity_form_specific"
  /**
   * **계절 보정이 모델에 없다(factor 1.0).** 추계 출하기 하락 방향만 확인됐고
   * 정량화 불가(C)다. quantity 는 0(unit "ratio") — 보정량이 0 이라는 뜻이고
   * "모른다" 가 아니다. 모르는 것은 modeled: false 가 말한다.
   */
  | "price_seasonality_not_modeled"
  /**
   * **판매처가 섞여 적합을 거부했다.** quantity 는 섞여 들어온 묶음 수
   * (unit "count"). 판매처 간 노이즈가 크기 신호의 3배라서 섞으면 기울기
   * 부호가 뒤집힌다.
   */
  | "price_ladder_vendor_mixed"
  /** 프리미엄 인증 상품이 제외됐다. quantity 는 제외된 점 수(unit "count"). */
  | "price_ladder_premium_excluded"
  /**
   * **사다리에서 단가가 크기와 같이 오르지 않는다.** 라벨이 한 판매처라고
   * 말해도 실제로는 다른 상품이 섞여 있다는 뜻이다. quantity 는 어긋난 점의
   * 미/kg(unit "count").
   */
  | "price_ladder_not_monotonic"
  /** 구간 탄력성이 크기 효과로 설명되지 않는 크기다. quantity 는 그 값(unit "ratio"). */
  | "price_ladder_elasticity_implausible"
  /** 냉동·선 사다리는 기울기 근거가 되지 않는다. 활·생물만 쓴다. */
  | "price_ladder_form_not_slope_eligible"
  /** 유통단계 배수가 관측이 아니라 가정이다. quantity 는 쓰인 배수(unit "ratio"). */
  | "price_stage_multiplier_assumed"
  /**
   * 단계 배수가 점이 아니라 범위다(온라인몰 소매 1.96~2.44). quantity 는
   * 범위 폭(unit "ratio"). 변환 결과의 low·high 가 그 폭이다.
   */
  | "price_stage_multiplier_ranged"
  /** 단가가 앵커에서 외삽됐다 — 그 크기의 실관측이 아니다. quantity 는 목표 ABW(unit "gram"). */
  | "price_extrapolated_from_anchor"
  /**
   * **목표 크기가 사다리 관측 범위 밖이다**(23.5~33.3 g). quantity 는 목표
   * ABW(unit "gram"). 범위 밖에서는 상수 탄력성 가정 자체가 근거를 잃는다.
   */
  | "price_target_outside_observed_size"
  /**
   * **크기별 공시 통계가 없다.** 해수부 위탁판매 데이터셋에 컬럼은 있으나 이
   * 환경에서 호출이 막혀 있다. quantity 는 대기 중인 데이터셋 수(unit "count").
   */
  | "price_official_statistics_unavailable"
  /**
   * **앵커가 농가 수취 단계가 아니다.** 결과는 그 단계의 단가이지 농가가 받는
   * 돈이 아니다. quantity 는 농가 수취가로 환산할 때 나눌 배수(unit "ratio").
   *
   * 이 경고가 있는 이유 — 소매 앵커(28,000원 @23.5 g)에 기울기만 때리면 31.6 g
   * 에서 33,743원이 나오고, 같은 크기의 농가 수취가(18,114원)의 **1.9배**다.
   * 수는 멀쩡해 보이고 `stage` 필드를 읽지 않으면 그대로 수익이 된다. 이 모듈의
   * 다른 사고는 전부 단가를 null 로 막지만 이것만은 막을 수 없다 — 소매 단가를
   * 묻는 것 자체는 정당한 질의이기 때문이다. 그래서 거부 대신 경고로 둔다.
   *
   * **엔진 3 은 이 경고가 붙은 단가를 농가 수익 계산에 그대로 넣으면 안 된다.**
   * `retailToFarmgate` 를 먼저 통과시키거나 `FARM_PRICE_ANCHOR` 를 쓸 것.
   */
  | "price_anchor_not_farmgate"

/** 엔진 2 의 Exclusion 과 같은 모양. code 만 넓다. */
export type PricingExclusion = Omit<Exclusion, "code"> & {
  code: Exclusion["code"] | PricingExclusionCode
}

/**
 * 같은 (code, item) 중복을 없앤다. lib/profitability/exclusions.ts 의
 * mergeExclusions 와 **같은 규칙**이고, 넓힌 code 유니온을 받기 위해서만
 * 따로 있다. 규칙을 바꾸지 말 것 — 두 엔진의 목록이 한 화면에서 합쳐진다.
 */
export function mergePricingExclusions(
  ...groups: readonly (readonly PricingExclusion[] | undefined)[]
): PricingExclusion[] {
  const out: PricingExclusion[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const e of group ?? []) {
      const key = `${e.code}|${e.item ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
  }
  return out
}
