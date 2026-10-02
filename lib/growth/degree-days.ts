// 적산수온(TGC) 시간축 — 엔진 1 의 x 축을 만든다.
//
// 성장곡선은 경과일이 아니라 적산수온에 대해 적합한다. 같은 30일이라도 28 ℃ 에서
// 자란 30일과 20 ℃ 에서 자란 30일은 다른 성장량이고, 그 차이를 축이 흡수해 주면
// 곡선 하나로 계절이 다른 회차를 함께 볼 수 있다.
//
// 참조 구현의 cumulative_degree_days 와 같은 동작을 한다.
// scripts/analysis/growth_curve_feasibility.py

import { BASE_TEMP_C } from "./constants"

/** 하루치 수온 평균. 수온이 없는 날도 **행을 빼지 말고** null 로 넣는다. */
export type DailyWaterTemp = {
  /** YYYY-MM-DD 또는 ISO 타임스탬프. 앞 10자만 날짜 키로 쓴다. */
  date: string
  /** 그날 수온 평균(℃). 결측은 null. */
  waterTempC: number | null | undefined
}

export type DegreeDayPoint = { date: string; cdd: number }

export type DegreeDayAxis = {
  /** 날짜 오름차순. cdd 는 그날까지의 적산수온(℃·일). */
  points: DegreeDayPoint[]
  /** 날짜 키(YYYY-MM-DD) → cdd. 성장 실측을 축에 올릴 때 쓴다. */
  byDate: Map<string, number>
  baseTempC: number
  /** 수온이 실제로 있었던 날 수. */
  observedDays: number
  /** 수온이 없어서 평균 증분으로 메운 날 수. 0 이 아니면 화면에 알린다. */
  filledDays: number
  /** 메울 때 쓴 하루 증분(℃). null 이면 관측 수온이 0건이어서 축을 못 만들었다. */
  fillIncrementC: number | null
  /** 같은 날짜가 두 번 이상 들어온 날짜 키. 데이터 버그 신호다. */
  duplicateDates: string[]
}

/** 날짜 키. 'YYYY-MM-DD' 와 ISO 타임스탬프를 같은 키로 모은다. */
export function dateKey(date: string): string {
  return date.slice(0, 10)
}

/**
 * 날짜별 수온 평균 → 적산수온 축.
 *
 * **수온이 없는 날은 그 수조의 평균 증분으로 메운다.** 0 으로 두면 그날 성장이
 * 멈춘 것으로 보게 되고, 행을 버리면 적산이 끊겨 뒤의 모든 cdd 가 실제보다
 * 작아진다. 둘 다 곡선을 조용히 망가뜨리므로 메우고, 몇 날을 메웠는지
 * filledDays 로 돌려준다.
 *
 * 관측 수온이 한 건도 없으면 메울 값 자체가 없다. 이때는 0 으로 채워 그럴듯한
 * 축을 만들어 주지 않고 points 를 비워 돌려준다(fillIncrementC === null).
 *
 * 음수 증분은 0 으로 자른다 — base 0 에서는 영하 수온뿐이고, 적산이 거꾸로
 * 흐르면 x 축이 단조가 아니게 되어 역산이 성립하지 않는다.
 */
export function cumulativeDegreeDays(
  daily: readonly DailyWaterTemp[],
  options: { baseTempC?: number } = {},
): DegreeDayAxis {
  const baseTempC = options.baseTempC ?? BASE_TEMP_C

  // 입력 순서를 믿지 않는다. 적산은 순서가 틀리면 조용히 다른 값이 된다.
  const rows = [...daily].sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? -1 : dateKey(a.date) > dateKey(b.date) ? 1 : 0))

  // 1차 통과 — 관측된 증분으로 메울 값을 먼저 구한다.
  const increments: (number | null)[] = rows.map((r) => {
    const t = r.waterTempC
    if (typeof t !== "number" || !Number.isFinite(t)) return null
    return Math.max(0, t - baseTempC)
  })
  const observed = increments.filter((v): v is number => v !== null)
  const observedDays = observed.length
  const fillIncrementC =
    observedDays > 0 ? observed.reduce((s, v) => s + v, 0) / observedDays : null

  if (fillIncrementC === null) {
    return {
      points: [],
      byDate: new Map(),
      baseTempC,
      observedDays: 0,
      filledDays: 0,
      fillIncrementC: null,
      duplicateDates: [],
    }
  }

  // 2차 통과 — 메우고 누적한다.
  const points: DegreeDayPoint[] = []
  const byDate = new Map<string, number>()
  const duplicateDates: string[] = []
  const seen = new Set<string>()
  let filledDays = 0
  let cdd = 0

  for (let i = 0; i < rows.length; i++) {
    const inc = increments[i]
    if (inc === null) filledDays++
    cdd += inc ?? fillIncrementC
    const key = dateKey(rows[i].date)
    if (seen.has(key)) duplicateDates.push(key)
    seen.add(key)
    points.push({ date: key, cdd })
    // 같은 날짜가 두 번 오면 나중 값이 남는다. 참조 구현(pandas cumsum)과 같다.
    byDate.set(key, cdd)
  }

  return { points, byDate, baseTempC, observedDays, filledDays, fillIncrementC, duplicateDates }
}
