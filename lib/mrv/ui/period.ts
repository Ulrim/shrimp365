/**
 * 화면 기본 조회 기간.
 *
 * 원본은 데모 데이터에 맞춘 고정 날짜(2026-06-01~06-30)를 상수로 박아 두었다. 실제
 * 사이트에는 그 기간이 의미가 없으므로, 이식본은 "최근 30일"을 기본으로 잡는다.
 * 사용자가 필터를 바꾸면 그 값이 그대로 쓰인다 — 기본값은 시작점일 뿐이다.
 */

const DAY_MS = 86_400_000

export type PeriodValue = { from: string; to: string }

/** 오늘 23:59:59Z 까지, 그로부터 days 일 전 00:00:00Z 부터. */
export function recentPeriod(days = 30, now: Date = new Date()): PeriodValue {
  const toDay = now.toISOString().slice(0, 10)
  const fromDay = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10)
  return { from: `${fromDay}T00:00:00.000Z`, to: `${toDay}T23:59:59.999Z` }
}

/** ISO 시각 → "YYYY-MM-DD". 화면 부제에 기간을 짧게 적을 때 쓴다. */
export function isoDay(iso: string): string {
  return iso.slice(0, 10)
}
