// 일수 → 날짜. **화면이 달력에 띠를 그리려면 날짜가 필요하다.**
//
// 엔진 3 의 계산은 전부 「지금부터 d일」로 돌아간다 — 그래야 수온 전망과
// 적산수온 축이 한 줄로 이어지고, 달력·시간대·서머타임이 계산에 섞이지 않는다.
// 날짜는 **마지막에 한 번만** 붙인다.
//
// ── 기준일을 안 받으면 날짜를 지어내지 않는다 ────────────────────────────
// `asOfDate` 가 없으면 날짜 칸이 전부 null 이고 일수만 나간다. 엔진이 "오늘"
// 을 혼자 정하면(`new Date()`) 같은 입력이 날마다 다른 답을 내고, 순수 계산
// 모듈이 아니게 된다. 서버와 농가의 시간대가 다를 때 하루가 밀리는 사고도
// 거기서 난다.
//
// ── UTC 로만 더한다 ──────────────────────────────────────────────────────
// 날짜 키(YYYY-MM-DD)에 일수를 더하는 계산은 지역 시간대로 하면 서머타임이
// 있는 지역에서 23·25시간 날이 생겨 하루가 어긋난다. UTC 자정 기준으로만
// 더한다 — 날짜 키는 시각이 없는 값이므로 이 쪽이 맞다.

import { dateKey } from "@/lib/growth"

/** 'YYYY-MM-DD' 또는 ISO 타임스탬프 → 날짜 키. 엔진 1 의 것을 그대로 쓴다. */
export { dateKey }

const DAY_MS = 86_400_000

/** 날짜 키가 실제 날짜인가. 2026-02-30 같은 것을 걸러낸다. */
function parseDateKey(date: string): number | null {
  const key = dateKey(date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [y, m, d] = key.split("-").map((s) => Number(s))
  const ms = Date.UTC(y, m - 1, d)
  if (!Number.isFinite(ms)) return null
  // 존재하지 않는 날짜(2026-02-30)는 다른 날로 굴러가므로 되돌려 비교한다.
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null
  }
  return ms
}

/**
 * 날짜 키 + 일수 → 날짜 키. 기준일이 없거나 날짜가 아니면 null 이다 —
 * **지어내지 않는다.**
 */
export function addDays(date: string | null | undefined, days: number): string | null {
  if (typeof date !== "string") return null
  if (!Number.isFinite(days)) return null
  const ms = parseDateKey(date)
  if (ms === null) return null
  const shifted = new Date(ms + Math.round(days) * DAY_MS)
  return shifted.toISOString().slice(0, 10)
}
