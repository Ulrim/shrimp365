// 「이 판정에 포함되지 않은 것」 목록 — **엔진 2 의 Exclusion 어휘를 그대로
// 쓴다.** 새 경고 체계를 만들지 않았다. lib/pricing/exclusions.ts 가 한 것과
// 같은 방식이고, code 유니온만 한 겹 더 넓힌다.
//
//   엔진 2  Exclusion        = { code: ExclusionCode, item?, quantity, unit }
//   엔진 단가 PricingExclusion = 같은 모양 + PricingExclusionCode
//   엔진 3  HarvestExclusion = 같은 모양 + PricingExclusionCode + HarvestExclusionCode
//
// 그래서 엔진 1·2·단가가 돌려준 목록이 **변환 없이 그대로** 엔진 3 의 목록에
// 들어간다. 엔진 3 의 일 중 하나가 세 엔진의 경고를 한 자리에 모아 화면으로
// 올려 보내는 것이므로, 이 호환성이 깨지면 경고가 조용히 사라진다.
//
// **단위를 새로 만들지 않았다.** ExclusionUnit 은 엔진 2 것 그대로다 — 수온
// 섭씨 단위가 없어서 수온 전망 경고는 「며칠치 전망인가」를 "day" 로 담는다.
//
// **문장은 만들지 않는다.** 코드와 수치만 돌려주고 번역은 화면(엔진 6)이 맡는다.

import type { ExclusionUnit } from "@/lib/profitability/exclusions"
import type { PricingExclusion } from "@/lib/pricing/exclusions"

export type { ExclusionUnit }

export type HarvestExclusionCode =
  /**
   * **일별 생존율을 안 받아 기본값을 썼다.** quantity 는 쓰인 일별 생존율
   * (unit "ratio"). 기본값은 천황수산 코호트 환산 0.448^(1/268) ≈ 0.9970 이고
   * **농가·시기마다 다르다**(constants.ts 주석).
   *
   * 이 경고가 있는 이유 — 폐사를 안 받았을 때 **0% 로 가정하면 엔진이 항상
   * "더 키우라" 고 말한다.** 그래서 0 이 아니라 실측 환산값으로 떨어지고,
   * 떨어졌다는 사실을 반환값에 담는다.
   */
  | "harvest_daily_survival_default"
  /**
   * **폐사 없음(일별 생존율 1.0)으로 계산했다.** quantity 는 0(unit "ratio") —
   * 일별 폐사율이 0 이라는 뜻이다.
   *
   * 현실의 농가가 아니다. 이 가정에서는 바이오매스가 단조 증가하므로 판정이
   * 거의 언제나 "더 키우라" 로 나온다. 호출자가 일부러 넣은 경우에도 그 수가
   * 화면에 그대로 올라가는 것을 막기 위해 경고를 올린다.
   */
  | "harvest_zero_mortality_assumed"
  /**
   * **수온이 관측이 아니라 전망이다.** quantity 는 전망으로 덮은 일수
   * (unit "day"). 적산수온 축이 전망에 올라가 있으므로 그만큼 개체중 예측도
   * 전망이다. (섭씨 단위를 새로 만들지 않았다 — 엔진 2 의 단위 집합을 쓴다.)
   */
  | "harvest_water_temp_outlook_assumed"
  /**
   * **소매 앵커를 농가 수취 단계로 변환해서 썼다.** quantity 는 곱한 배수
   * (unit "ratio"). 1/2.2 ≈ 0.4545 면 ÷2.2 로 내렸다는 뜻이다.
   *
   * 변환하지 않고 그냥 통과시키면 농가 수익이 약 1.9배 과대가 된다
   * (lib/pricing 의 price_anchor_not_farmgate). 엔진 3 은 **거부하거나
   * 변환하거나** 둘 중 하나만 하고, 그냥 통과시키는 경로가 없다.
   */
  | "harvest_anchor_converted_to_farmgate"
  /**
   * **이익 최대가 지평의 마지막 후보다.** quantity 는 지평 일수(unit "day").
   * 최적이 지평 밖에 있을 수 있다. **엔진이 지평을 자동으로 늘리지 않는다** —
   * 늘리면 엔진 1 의 예측 거리가 길어지는 것을 호출자가 모른 채 쓰게 된다.
   */
  | "harvest_horizon_truncated"
  /**
   * **이익 최대와 구분되지 않는 후보가 둘 이상이다.** quantity 는 그 후보 수
   * (unit "count"). 밴드가 겹치면 하루를 억지로 고르지 않는다 — 추천은 구간이다.
   */
  | "harvest_window_indistinguishable"
  /**
   * **이익 밴드에 개체중 예측 오차가 들어 있지 않다.** quantity 는 밴드에 담은
   * 개체중 폭 0(unit "gram") — "폭이 0" 이라는 뜻이고 "모른다" 가 아니다.
   *
   * 기본 밴드는 **단가 탄력성 양끝(0.63 / 0.73)만** 담는다. 엔진 1 의 홀드아웃
   * MAE(출하 크기에서 3~5%)를 엔진 3 이 제 값으로 박아 넣지 않기 때문이다 —
   * 그 수는 엔진 1 의 성능 주장이고, 호출자가 `abwUncertaintyG` 로 넘기면
   * 밴드가 그만큼 넓어지고 이 경고가 사라진다.
   */
  | "harvest_abw_uncertainty_not_in_band"
  /**
   * **후보 시점의 예측 개체중이 고정 상한(Winf)에 닿았다.** quantity 는 그
   * 상한(unit "gram"). 엔진 1 의 Winf 는 적합하지 않는 고정 가정이므로
   * (설계 규칙 1), 상한에 붙은 구간의 성장분은 데이터가 아니라 그 가정이
   * 만든 수다.
   */
  | "harvest_abw_at_winf_ceiling"
  /**
   * **일급이량이 바이오매스 비율로 들어왔다.** quantity 는 그 비율(unit "ratio").
   * **엔진 5(급이 최적화)의 추정이 아니라 호출자가 넣은 수다** — 엔진 3 은
   * 권장 급이량을 만들지 않는다(엔진 2 projection.ts 의 경계와 같다).
   */
  | "harvest_feed_rate_caller_supplied"
  /**
   * **후보에 "지금 출하"(0일)가 없어 엔진이 넣었다.** quantity 는 0(unit "day").
   * 한계 분석과 근거 분해의 기준점이 "지금" 이므로 0 일 후보가 없으면 비교
   * 대상이 사라진다. 조용히 넣지 않고 넣었다는 사실을 알린다.
   */
  | "harvest_candidate_now_added"
  /**
   * **한계이익이 지평 안에서 0 을 지나지 않는다.** quantity 는 지평 일수
   * (unit "day"). 경제적 출하 적기가 지평 밖이거나, 폐사·사료비가 성장·크기
   * 프리미엄을 끝까지 못 이긴다는 뜻이다. 후자는 **폐사율을 안 넣었을 때 가장
   * 흔하게 나오는 모양**이다.
   */
  | "harvest_marginal_never_crosses_zero"

/** 엔진 2·단가의 Exclusion 과 같은 모양. code 만 한 겹 더 넓다. */
export type HarvestExclusion = Omit<PricingExclusion, "code"> & {
  code: PricingExclusion["code"] | HarvestExclusionCode
}

/**
 * 같은 (code, item) 중복을 없앤다. lib/profitability/exclusions.ts ·
 * lib/pricing/exclusions.ts 의 것과 **같은 규칙**이고, 넓힌 code 유니온을 받기
 * 위해서만 따로 있다. 규칙을 바꾸지 말 것 — 세 엔진의 목록이 한 화면에서
 * 합쳐진다.
 *
 * **먼저 들어온 쪽의 quantity 가 남는다.** 그래서 호출부는 대표값(예: 추천
 * 시점의 추정)을 앞에 둔다.
 */
export function mergeHarvestExclusions(
  ...groups: readonly (readonly HarvestExclusion[] | undefined)[]
): HarvestExclusion[] {
  const out: HarvestExclusion[] = []
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

/** 목록에 그 코드가 있는가. 판정 로직이 자기 경고를 다시 읽을 때 쓴다. */
export function hasExclusion(
  exclusions: readonly HarvestExclusion[],
  code: HarvestExclusion["code"],
): boolean {
  return exclusions.some((e) => e.code === code)
}
