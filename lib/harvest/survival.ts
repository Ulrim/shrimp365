// 일별 생존율 — **엔진 3 에서 가장 틀리기 쉬운 자리다.**
//
// 더 키우면 개체가 커지고(엔진 1) 큰 개체는 kg당 단가가 높다(단가 모델).
// 그 둘만 계산하고 **마리수가 주는 것을 빼먹으면 엔진이 항상 "더 키우라" 고
// 말한다.** 농가에게 가장 비싼 방향의 오답이 그것이다.
//
//   바이오매스(d) = 마리수(0) × 일별생존율^d × 개체중(d) ÷ 1000
//                   └── 이 항이 빠지는 것을 막는 것이 이 파일의 존재 이유다
//
// 천황수산 2024 코호트는 268일에 생존율 44.8% 였다. 일별로 환산하면
// 0.448^(1/268) ≈ 0.9970 — **하루 약 0.30%** 다. 그 농장에서 2주는
// 0.9970^14 ≈ 0.9589, 즉 **마리수가 4.1% 줄는다.**
//
// **이 값은 농가·시기마다 다르다.** 268일 평균을 지수로 균등 배분한 수이고
// 실제 폐사는 입식 직후와 수질 사고 때 몰린다. constants.ts 의
// DEFAULT_DAILY_SURVIVAL_RATE 주석을 읽을 것.

import { DEFAULT_DAILY_SURVIVAL_RATE } from "./constants"
import type { HarvestExclusion } from "./exclusions"

/**
 * 일별 생존율을 어떻게 받나. 셋 중 하나이고, **아무것도 안 주면 0% 폐사로
 * 가정하지 않고 기본값으로 떨어지며 경고가 올라간다.**
 */
export type HarvestSurvivalInput = {
  /** 하루 생존율(0~1). 0.9970 이 천황수산 환산값이다. 이 값이 가장 먼저다. */
  dailySurvivalRate?: number | null
  /** 사이클 생존율(0~1)과 일수로 환산한다 — 0.448 / 268 → 0.9970. */
  cycleSurvivalRate?: number | null
  cycleDays?: number | null
}

export type DailySurvivalSource =
  /** 호출자가 일별 생존율을 직접 넘겼다. */
  | "provided"
  /** 사이클 생존율·일수에서 환산했다. */
  | "derived_from_cycle"
  /** 아무것도 안 넘어와 기본값(천황수산 환산)으로 떨어졌다. */
  | "default"

export type ResolvedDailySurvival = {
  dailySurvivalRate: number | null
  source: DailySurvivalSource
  /** 입력이 0~1 밖이거나 수가 아니다. 이때 dailySurvivalRate 는 null 이다. */
  failure: "invalid_survival_rate" | null
  exclusions: HarvestExclusion[]
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/**
 * 사이클 생존율 → 일별 생존율. `s_day = s_cycle^(1/days)`.
 *
 * 0.448 과 268 을 넣으면 0.9970084… 가 나온다. **반올림하지 않는다.**
 */
export function dailySurvivalFromCycle(
  cycleSurvivalRate: number,
  cycleDays: number,
): number | null {
  if (!isNum(cycleSurvivalRate) || cycleSurvivalRate <= 0 || cycleSurvivalRate > 1) return null
  if (!isNum(cycleDays) || cycleDays <= 0) return null
  const daily = Math.pow(cycleSurvivalRate, 1 / cycleDays)
  return Number.isFinite(daily) ? daily : null
}

/** 지금부터 d일 뒤까지의 누적 생존율. `s^d`. */
export function survivalOverDays(dailySurvivalRate: number, days: number): number | null {
  if (!isNum(dailySurvivalRate) || dailySurvivalRate < 0 || dailySurvivalRate > 1) return null
  if (!isNum(days) || days < 0) return null
  const s = Math.pow(dailySurvivalRate, days)
  return Number.isFinite(s) ? s : null
}

/**
 * 일별 생존율을 정한다. **0 으로 가정하지 않고, 조용히 떨어지지도 않는다.**
 *
 * 엔진 2 의 resolvePrice 가 기본 채널로 떨어지지 않는 것과는 다른 선택을 했다.
 * 단가는 안 고르면 매출을 null 로 돌려줄 수 있지만, 생존율을 null 로 두면
 * 엔진 3 이 아무 판정도 못 한다 — 그리고 호출자가 그 자리를 0% 폐사로 메우는
 * 것이 가장 흔한 사고다. 그래서 **실측에서 환산한 값으로 떨어지고, 떨어졌다는
 * 사실을 경고로 올린다.** 폐사 1.0(= 폐사 없음)도 경고 대상이다.
 */
export function resolveDailySurvival(input: HarvestSurvivalInput = {}): ResolvedDailySurvival {
  const exclusions: HarvestExclusion[] = []

  let rate: number | null = null
  let source: DailySurvivalSource = "default"

  if (input.dailySurvivalRate !== undefined && input.dailySurvivalRate !== null) {
    if (!isNum(input.dailySurvivalRate) || input.dailySurvivalRate < 0 || input.dailySurvivalRate > 1) {
      return { dailySurvivalRate: null, source: "provided", failure: "invalid_survival_rate", exclusions }
    }
    rate = input.dailySurvivalRate
    source = "provided"
  } else if (input.cycleSurvivalRate !== undefined && input.cycleSurvivalRate !== null) {
    const derived = dailySurvivalFromCycle(
      input.cycleSurvivalRate,
      isNum(input.cycleDays) ? input.cycleDays : NaN,
    )
    if (derived === null) {
      return {
        dailySurvivalRate: null,
        source: "derived_from_cycle",
        failure: "invalid_survival_rate",
        exclusions,
      }
    }
    rate = derived
    source = "derived_from_cycle"
  } else {
    rate = DEFAULT_DAILY_SURVIVAL_RATE
    source = "default"
    exclusions.push({ code: "harvest_daily_survival_default", quantity: rate, unit: "ratio" })
  }

  // 폐사 없음은 구조적으로 "더 키우라" 를 만든다. 호출자가 일부러 넣었어도
  // 그 사실이 금액과 함께 나가야 한다.
  if (rate === 1) {
    exclusions.push({ code: "harvest_zero_mortality_assumed", quantity: 0, unit: "ratio" })
  }

  // 생존율이 가정이라는 사실은 엔진 2 의 어휘로도 올린다 — 엔진 2 의 시나리오
  // 경고와 같은 코드라서 화면이 한 줄로 합쳐 보여 줄 수 있다.
  exclusions.push({ code: "survival_rate_assumed", quantity: rate, unit: "ratio" })

  return { dailySurvivalRate: rate, source, failure: null, exclusions }
}
