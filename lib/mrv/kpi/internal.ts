/**
 * KPI 엔진 내부 공용 헬퍼. 산식이 아니라 산식이 공유하는 규약(기간 필터·UTC 일 버킷·
 * 방어 검사·표시용 포맷)만 담는다. 엔진 밖으로 내보내지 않는다.
 *
 * 원본의 각 모듈에 중복돼 있던 `_is_included` / `_utc_date` / `_require_finite` 를
 * 한곳으로 모은 것이며, 판정 규칙 자체는 원본과 한 글자도 다르지 않다.
 */

import { KpiValueError } from "./status"
import type { UtcDate } from "./types"

/**
 * 기간 [periodStart, periodEnd) 반열림 판정(end 미포함).
 * 인접 기간 경계에서 계측값이 중복 집계되지 않게 하는 전 지표 공통 규약이다.
 */
export function inPeriod(ts: Date, periodStart: Date, periodEnd: Date): boolean {
  const t = ts.getTime()
  return t >= periodStart.getTime() && t < periodEnd.getTime()
}

/** quality_flag 화이트리스트 + 기간 반열림을 함께 판정한다. */
export function isIncluded(
  ts: Date,
  qualityFlag: string,
  includedQualityFlags: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (!includedQualityFlags.includes(qualityFlag)) return false
  return inPeriod(ts, periodStart, periodEnd)
}

/** 계측 시각 → UTC 기준 일자("YYYY-MM-DD"). 결정론적 버킷팅. */
export function utcDate(ts: Date): UtcDate {
  return ts.toISOString().slice(0, 10)
}

/** UTC 일자에서 days 일을 뺀 일자. 캘린더 일 기준(이동평균 창 계산용). */
export function utcDateMinusDays(d: UtcDate, days: number): UtcDate {
  const ms = Date.parse(`${d}T00:00:00.000Z`) - days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** 기간 역전/빈 기간 방어. 전 지표가 동일하게 적용한다. */
export function requirePeriod(periodStart: Date, periodEnd: Date): void {
  if (periodStart.getTime() >= periodEnd.getTime()) {
    throw new KpiValueError(
      "periodStart must be strictly before periodEnd: " +
        `${periodStart.toISOString()} >= ${periodEnd.toISOString()}`,
    )
  }
}

/** 비유한(NaN/Infinity) 입력 방어. 조용한 NaN 전파를 막는다. */
export function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new KpiValueError(`${label} must be finite, got ${value}`)
  }
}

/** 정렬·중복제거로 결정론적 순서를 보장한다(drill-down 근거 목록). */
export function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort()
}

/** 단순 상하한 클램프(결정론적, 부작용 없음). */
export function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo
  if (value > hi) return hi
  return value
}

/**
 * BigInt 리터럴(`0n`)은 tsconfig 의 target(ES2017)에서 쓸 수 없으므로 생성자로 만든다.
 * 런타임(Node/모던 브라우저)은 BigInt 를 지원하며, 타입도 lib "esnext" 로 들어와 있다.
 */
const B1 = BigInt(1)
const B2 = BigInt(2)
const B10 = BigInt(10)
const B32 = BigInt(32)
const B52 = BigInt(52)

/**
 * IEEE754 double 을 정확한 유리수 (가수, 2의 지수) 로 분해한다.
 * |value| = mant * 2^exp 가 **정확히** 성립한다(근사 아님). 부호는 호출측이 다룬다.
 */
function decompose(x: number): { mant: bigint; exp: number } {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const hi = view.getUint32(0)
  const lo = view.getUint32(4)
  const rawExp = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xf_ffff) << B32) | BigInt(lo)
  let exp: number
  if (rawExp === 0) {
    exp = -1074 // 비정규수
  } else {
    mant |= B1 << B52
    exp = rawExp - 1075
  }
  return { mant, exp }
}

/**
 * Python `round(value, ndigits)` 와 **정확히** 같은 half-to-even 반올림.
 *
 * 산식 문자열(formulaText)과 추천 rationale 이 원본 Python 구현과 문자 단위로 같아야
 * MRV 리포트의 재현성이 성립한다. 두 언어의 반올림 규칙이 다른 지점이 둘 있다:
 *   - JS `toFixed` 는 half-away-from-zero, Python `round` 는 half-to-even.
 *   - `value * 10**n` 으로 자리를 옮기면 그 곱셈 자체가 새 반올림 오차를 낳는다
 *     (예: 41.8876*0.125 는 Python 이 5.2359 로 가는데 곱셈 경유로는 5.236 이 된다).
 * 그래서 double 을 정확한 유리수로 분해해 BigInt 로 나눗셈·비교한다 — 곱셈 오차가 없고
 * 동점(exact tie)도 정확히 판별하므로 Python 과 결과가 항상 일치한다.
 */
export function roundHalfEven(value: number, ndigits: number): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return 0

  const negative = value < 0
  const { mant, exp } = decompose(Math.abs(value))
  const pow10 = B10 ** BigInt(ndigits)

  // |value| * 10^n = (mant * 10^n * 2^exp) 를 정수부/나머지로 나눈다.
  let num = mant * pow10
  let den = B1
  if (exp >= 0) num <<= BigInt(exp)
  else den = B1 << BigInt(-exp)

  let q = num / den
  const twice = (num % den) * B2
  if (twice > den) q += B1
  else if (twice === den && q % B2 === B1) q += B1 // 정확한 동점 → 짝수 쪽

  const magnitude = Number(q) / Number(pow10)
  return negative ? -magnitude : magnitude
}

/**
 * 산식 문자열용 숫자 포맷(표시 전용 — 계산에는 원값을 그대로 쓴다).
 * ndigits 자리 반올림 후 불필요한 trailing zero/decimal point 제거. 결정론적.
 */
export function fmt(value: number, ndigits = 4): string {
  const rounded = roundHalfEven(value, ndigits)
  if (rounded === 0) return "0"
  return rounded.toFixed(ndigits).replace(/0+$/, "").replace(/\.$/, "")
}

/** Python f"{x:.2f}" 와 같은 고정 소수점 포맷(rationale 문자열용). */
export function fixed(value: number, ndigits: number): string {
  return roundHalfEven(value, ndigits).toFixed(ndigits)
}

/**
 * 산식 문자열 안에서 '산출 불가'를 나타내는 값의 표기.
 * 원본 Python 이 `None` 을 그대로 찍었고, 이 문자열은 MRV 리포트에 증빙으로 박제되므로
 * 표기를 바꾸면 같은 입력의 리포트가 두 가지로 갈린다. 원본 표기를 유지한다.
 */
export function optionalRepr(value: number | null): string {
  return value === null ? "None" : String(value)
}
