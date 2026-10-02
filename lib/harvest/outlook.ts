// 「며칠 뒤에 몇 g 인가」 — 엔진 1 의 출력을 **날짜 축으로 올리는 층**이다.
//
// 엔진 1 은 적산수온(℃·일)에 대해 적합하고, **적산수온을 날짜로 바꾸지
// 않는다.** 그 변환에는 수온 전망이 필요하고 그것이 엔진 3 의 몫이라고
// lib/growth/gompertz.ts 의 cddForAbw 주석과 엔진 2 projection.ts 가 둘 다
// 명시해 두었다. 이 파일이 그 몫이다.
//
//     적산수온(d) = 지금 적산수온 + Σ_{t=1..d} max(0, 전망수온_t − base)
//     개체중(d)   = predictAbw(엔진1 파라미터, 적산수온(d))
//
// base 는 **엔진 1 의 BASE_TEMP_C(0)를 그대로 쓴다.** 여기서 다른 기준온도를
// 쓰면 적합한 축과 예측하는 축이 달라져 곡선이 조용히 어긋난다.
//
// ── 수온 전망은 관측이 아니다 ────────────────────────────────────────────
// 전망으로 덮은 일수를 `harvest_water_temp_outlook_assumed` 로 돌려준다.
// 전망이 모자라면(일별 배열이 짧으면) **평균으로 메우지 않고 null 을
// 돌려준다** — 엔진 1 의 cumulativeDegreeDays 가 과거 결측을 평균 증분으로
// 메우는 것과 반대 선택이다. 과거의 빈 칸은 메울 근거가 있지만(그 사이에 성장은
// 일어났다), 미래의 빈 칸을 메우면 전망을 엔진이 지어내는 것이 된다.
//
// ── 개체중을 직접 받는 경로를 같이 둔다 ──────────────────────────────────
// 호출자가 이미 일별 개체중 전망을 가진 경우(다른 적합, 농가 실측 추이, 검증)
// 가 있고, **엔진 1 의 기본 Winf 25 g 이 설명하지 못하는 구간도 있다** —
// 천황수산 11월 출하분이 28.6 g 이라 상한을 넘는다. 그때는 호출자가 엔진 1 을
// 더 큰 Winf 로 적합하거나(엔진 1 은 winfG 를 인자로 받는다) 실측 추이를
// 그대로 넣는 쪽이고, 엔진 3 이 Winf 를 몰래 올려 주는 쪽이 아니다.

import { BASE_TEMP_C, predictAbw } from "@/lib/growth"
import type { GompertzParams } from "@/lib/growth"

import { WINF_CEILING_RATIO } from "./constants"
import type { HarvestExclusion } from "./exclusions"

/** 앞으로의 수온 전망. **관측이 아니다.** */
export type WaterTempOutlook =
  /** 지평 전체를 한 수온으로 본다. */
  | { kind: "constant"; waterTempC: number }
  /**
   * 일별 전망. `waterTempC[i]` 는 **지금으로부터 i+1 일째**의 수온이다
   * (오늘 수온은 이미 적산수온에 들어 있으므로 받지 않는다).
   */
  | { kind: "daily"; waterTempC: readonly number[] }

/** 앞으로의 개체중 전망. */
export type AbwOutlook =
  /** 엔진 1 적합 결과 + 지금 적산수온 + 수온 전망. */
  | { kind: "gompertz"; params: GompertzParams; cddNow: number; waterTemp: WaterTempOutlook }
  /**
   * 일별 개체중(g)을 직접 받는다. `abwG[0]` 이 **지금**이고 `abwG[d]` 가 d일
   * 뒤다. 길이가 모자라면 그 후보는 null 이 된다 — 외삽하지 않는다.
   */
  | { kind: "daily_abw_g"; abwG: readonly number[] }

export type AbwAtDay = {
  abwG: number | null
  /** gompertz 경로일 때의 그 시점 적산수온(℃·일). 직접 받은 경로면 null. */
  cdd: number | null
  /** 예측이 고정 상한(Winf)의 WINF_CEILING_RATIO 배 이상인가. */
  atWinfCeiling: boolean
  /** 그 상한(g). gompertz 경로에서만 나온다. */
  winfG: number | null
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 전망 수온이 몇 일치인가. constant 는 무한이므로 null 이다. */
export function outlookCoverageDays(outlook: WaterTempOutlook): number | null {
  return outlook.kind === "daily" ? outlook.waterTempC.length : null
}

/**
 * 지금 적산수온에서 d일 뒤의 적산수온. **기준온도를 차감하지 않는다**(base 0,
 * 엔진 1 설계 규칙 4).
 *
 * 음수 증분은 0 으로 자른다 — 엔진 1 의 cumulativeDegreeDays 와 같은 규칙이다.
 * 적산이 거꾸로 흐르면 축이 단조가 아니게 되고 성장이 줄어드는 것으로 계산된다.
 */
export function cddAtDay(cddNow: number, outlook: WaterTempOutlook, dayOffset: number): number | null {
  if (!isNum(cddNow)) return null
  if (!Number.isInteger(dayOffset) || dayOffset < 0) return null
  if (dayOffset === 0) return cddNow

  if (outlook.kind === "constant") {
    if (!isNum(outlook.waterTempC)) return null
    const inc = Math.max(0, outlook.waterTempC - BASE_TEMP_C)
    return cddNow + inc * dayOffset
  }

  // 일별 전망이 모자라면 **메우지 않는다.**
  if (outlook.waterTempC.length < dayOffset) return null
  let cdd = cddNow
  for (let t = 0; t < dayOffset; t++) {
    const temp = outlook.waterTempC[t]
    if (!isNum(temp)) return null
    cdd += Math.max(0, temp - BASE_TEMP_C)
  }
  return cdd
}

/** d일 뒤의 예측 개체중(g). 엔진 1 의 predictAbw 를 그대로 쓴다. */
export function abwAtDay(outlook: AbwOutlook, dayOffset: number): AbwAtDay {
  const empty: AbwAtDay = { abwG: null, cdd: null, atWinfCeiling: false, winfG: null }
  if (!Number.isInteger(dayOffset) || dayOffset < 0) return empty

  if (outlook.kind === "daily_abw_g") {
    const abwG = outlook.abwG[dayOffset]
    if (!isNum(abwG) || abwG <= 0) return empty
    return { abwG, cdd: null, atWinfCeiling: false, winfG: null }
  }

  const { params, cddNow, waterTemp } = outlook
  const winfG = isNum(params?.winfG) ? params.winfG : null
  if (winfG === null || winfG <= 0 || !isNum(params?.b) || !isNum(params?.k)) return empty

  const cdd = cddAtDay(cddNow, waterTemp, dayOffset)
  if (cdd === null) return { abwG: null, cdd: null, atWinfCeiling: false, winfG }

  const abwG = predictAbw(params, cdd)
  if (!isNum(abwG) || abwG <= 0) return { abwG: null, cdd, atWinfCeiling: false, winfG }

  return { abwG, cdd, atWinfCeiling: abwG >= winfG * WINF_CEILING_RATIO, winfG }
}

/** 전망이 전망이라는 사실. gompertz 경로에서만 나온다. */
export function outlookExclusions(
  outlook: AbwOutlook,
  horizonDays: number,
): HarvestExclusion[] {
  if (outlook.kind !== "gompertz") return []
  const coverage = outlookCoverageDays(outlook.waterTemp)
  const days = coverage === null ? horizonDays : Math.min(coverage, horizonDays)
  return [{ code: "harvest_water_temp_outlook_assumed", quantity: days, unit: "day" }]
}
