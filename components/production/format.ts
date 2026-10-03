// 생산 화면의 표시 포맷. **엔진 밖, 화면 안이다.**
//
// 왜 모듈로 따로 뺐나 — 엔진 넷(lib/growth·profitability·pricing·harvest)이
// 하나같이 「반올림하지 않는다」를 설계 규칙으로 못 박았다. 반올림은 전부 이
// 층의 일이고, 새 컴포넌트 열 개가 각자 금액 포맷을 복제하면 같은 금액이 화면
// 두 곳에서 다르게 보인다. 함수는 여기만 있다.
//
// localeTag·fmt·fmtKRW 는 app/(dashboard)/production/page.tsx 에서 **옮겨온
// 것이고 본문을 바꾸지 않았다** — 기존 화면의 표시가 바뀌면 안 된다.
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
//  1. **null 과 0 을 같게 보이지 않게 한다.** null 은 "-"(fmt) 또는 호출자가
//     고른 미입력 문구이고, 0 은 "0" 이다. 엔진 2 가 합계 필드를 totalKrw 가
//     아니라 knownTotalKrw 로 지은 이유를 화면에서 되돌리지 않는다.
//  2. **반올림된 값에서 다시 계산하지 않는다.** 이 모듈의 반환값은 문자열이고,
//     문자열을 다시 parseFloat 해서 쓰는 코드를 쓰지 말 것.
//  3. 금액·g·%·kg·미/kg 은 호출처에서 `tabular-nums` 를 건다.

import type { Dict, Locale } from "@/lib/i18n"

export function localeTag(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"
}

export function fmt(n: number | null | undefined, locale: Locale, digits = 0): string {
  if (n == null) return "-"
  return n.toLocaleString(localeTag(locale), { maximumFractionDigits: digits })
}

export function fmtKRW(n: number | null | undefined, locale: Locale, t: Dict): string {
  if (n == null) return "-"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + t.production.millionWon
  return n.toLocaleString(localeTag(locale)) + t.production.won
}

/**
 * 금액 표시. **언어마다 자리수 단위가 다르다.**
 *
 * 한국어는 만원으로 말한다 — 농가가 「2,921만원」이라고 말하고 「29,209,700원」
 * 이라고 말하지 않는다. 그런데 **영어·인도네시아어에는 만 단위가 없다.**
 * `10,000` 으로 나눈 수에 "10k won" 을 붙이면 "1,200 10k won" 이 되는데, 값은
 * 맞지만 읽을 수 없는 표기다. 그래서 ko 만 만원으로 쓰고 나머지는 기존
 * `fmtKRW` 의 백만원/원 표기를 그대로 쓴다. **수를 바꾸는 것이 아니라 단위를
 * 그 언어가 쓰는 것으로 고르는 것이다.**
 *
 * 부호를 문자열에 붙이지 않는다 — 색 단독 금지(§1 color-not-only) 때문에
 * 호출처가 ▲/▼ 글리프와 「이익」/「손실」 텍스트를 따로 붙여야 하고, 그때
 * 부호가 두 번 나오면 "−▼ 손실 845만원" 처럼 읽힌다. `signGlyph` 를 쓸 것.
 */
export function fmtAmount(n: number | null | undefined, locale: Locale, t: Dict, opts?: { abs?: boolean }): string {
  if (n == null) return "-"
  const v = opts?.abs ? Math.abs(n) : n
  if (locale !== "ko") return fmtKRW(v, locale, t)
  const man = v / 10_000
  // 1만원 미만은 만원으로 쓰면 전부 0 이 된다. 그때는 원 단위로 떨어진다.
  if (Math.abs(man) < 1 && v !== 0) return v.toLocaleString(localeTag(locale), { maximumFractionDigits: 0 }) + t.production.won
  return man.toLocaleString(localeTag(locale), { maximumFractionDigits: 0 }) + t.production.tenThousandWon
}

/**
 * 차트 축·툴팁용 짧은 금액. **원 단위 원자료를 받는다.**
 *
 * 차트가 `원 ÷ 10,000` 을 데이터로 들고 있으면 축 라벨의 단위가 언어마다
 * 달라질 수 없다 — 데이터에 단위가 박히기 때문이다. 그래서 **차트는 원 단위를
 * 그대로 그리고 라벨만 이 함수로 줄인다.**
 */
export function fmtAmountTick(n: number | null | undefined, locale: Locale, t: Dict): string {
  if (n == null) return ""
  if (locale !== "ko") {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + t.production.millionWon
    return (n / 1_000).toLocaleString(localeTag(locale), { maximumFractionDigits: 0 }) + "k"
  }
  return (n / 10_000).toLocaleString(localeTag(locale), { maximumFractionDigits: 0 }) + t.production.tenThousandWon
}

/** 비율(0~1) → 백분율 문자열. **1 을 넘어도 자르지 않는다** — 112% 가 신호다. */
export function fmtPct(rate: number | null | undefined, locale: Locale, digits = 1): string {
  if (rate == null) return "-"
  return (rate * 100).toLocaleString(localeTag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + "%"
}

/** %p(백분율 포인트) 차이. 비율 두 개의 차를 받는다. */
export function fmtPctPoint(diff: number | null | undefined, locale: Locale, digits = 1): string {
  if (diff == null) return "-"
  return (diff * 100).toLocaleString(localeTag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + "%p"
}

export function fmtG(g: number | null | undefined, locale: Locale, digits = 1): string {
  if (g == null) return "-"
  return g.toLocaleString(localeTag(locale), { maximumFractionDigits: digits }) + "g"
}

/** 미/kg. 농가가 등급으로 읽는 표기다. */
export function fmtCountPerKg(n: number | null | undefined, locale: Locale, t: Dict): string {
  if (n == null) return "-"
  return n.toLocaleString(localeTag(locale), { maximumFractionDigits: 0 }) + t.engines.unit.countPerKg
}

/** 배수(1.0655 → "1.07배"). 프리미엄 비는 fmtRatioDelta 를 쓸 것. */
export function fmtRatio(r: number | null | undefined, locale: Locale, t: Dict, digits = 2): string {
  if (r == null) return "-"
  return r.toLocaleString(localeTag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + t.engines.unit.ratio
}

/** 앵커 대비 증감(1.0655 → "+6.6%"). 부호를 붙인다 — 이건 증감이라 부호가 뜻이다. */
export function fmtRatioDelta(r: number | null | undefined, locale: Locale, digits = 1): string {
  if (r == null) return "-"
  const pct = (r - 1) * 100
  const sign = pct > 0 ? "+" : ""
  return sign + pct.toLocaleString(localeTag(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }) + "%"
}

/**
 * 부호 글리프. **색만으로 손익을 말하지 않기 위한 것이다**(§1 color-not-only).
 * 적록색약 사용자에게 emerald 와 red 는 같은 색이다.
 *
 * `aria-hidden` 으로 쓰고 뜻은 옆 텍스트(t.production.profitPositive /
 * profitNegative)가 진다 — 글리프는 아이콘이 아니라 텍스트이기 때문이다.
 * 0 은 어느 쪽도 아니므로 글리프가 없다.
 */
export function signGlyph(n: number | null | undefined): "▲" | "▼" | "" {
  if (n == null || n === 0) return ""
  return n > 0 ? "▲" : "▼"
}

/** 손익 부호에 쓰는 색 클래스. 글리프·텍스트와 **반드시 같이** 쓴다. */
export function signColorClass(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground"
  if (n === 0) return "text-foreground"
  return n > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
}

/** `{{n}}` 한 자리 보간. 저장소 관례(lib/i18n/ko.ts dayN)를 따르고 새 헬퍼를 만들지 않는다. */
export function tpl(template: string, n: string | number): string {
  return template.replace("{{n}}", String(n))
}

/** YYYY-MM-DD → MM/DD. 차트 x축 라벨용. 날짜가 없으면 빈 문자열이다. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return ""
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`
}
