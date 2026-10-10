// 엔진 2(수익성 예측)의 고정 숫자. **값만 옮겨 적지 않고 출처와 날짜를 함께
// 적는다** — lib/growth/constants.ts 와 같은 방식이다. 근거를 적지 않으면 나중에
// 아무도 왜 이 값인지 확인하지 못하고, 특히 비용 단가는 고치고 싶어지는 숫자다.
//
// 여기 있는 것은 **기본값**이고, 전부 호출자가 인자로 바꿀 수 있다. 농가가
// 바뀌면 단가가 바뀌기 때문이다.

// ── 사료 ──────────────────────────────────────────────────────────────────
// 2,300 원/kg. **출처: 천황수산 농가 제공, 2026-10-02.**
// 사료 종류·입자 크기별 구분 없이 단일 단가로 받았다. 구분이 생기면 호출자가
// 단계별 단가로 나눠 넣는 쪽이고, 이 상수를 여러 개로 쪼개는 쪽이 아니다.
export const DEFAULT_FEED_KRW_PER_KG = 2300

// ── 종묘(PL) ──────────────────────────────────────────────────────────────
// 10 원/마리. **출처: 천황수산 농가 제공, 2026-10-02.**
// PL 단계(PL10·PL12 등)별 구분 없이 단일 단가로 받았다.
export const DEFAULT_SEED_KRW_PER_PL = 10

// ── 전기 ──────────────────────────────────────────────────────────────────
// 2024년 한전 월별 고지서. **출처: 한전 계약종합정보 — 농사용(을) · 계약전력
// 90 kW, 천황수산, 2026-10-02 제공.**
//
// 사이클 구간은 2024-03 ~ 2024-10 이다. **11·12월 고지서가 없다** — 고지서가
// 10월까지만 전달됐다. 그래서 이 표의 합은 사이클 전기요금 전액이 아니고,
// 그 사실은 EXCLUSION 코드 "electricity_billing_incomplete" 로 알린다.
export type ElectricityBill = {
  /** YYYY-MM. */
  month: string
  kwh: number
  krw: number
}

export const ELECTRICITY_BILLS_2024: readonly ElectricityBill[] = [
  { month: "2024-03", kwh: 69797, krw: 5869350 },
  { month: "2024-04", kwh: 47415, krw: 4044050 },
  { month: "2024-05", kwh: 38425, krw: 3419770 },
  { month: "2024-06", kwh: 37403, krw: 3450130 },
  { month: "2024-07", kwh: 20026, krw: 1888580 },
  { month: "2024-08", kwh: 19617, krw: 1839780 },
  { month: "2024-09", kwh: 21538, krw: 1970940 },
  { month: "2024-10", kwh: 20972, krw: 1909650 },
]

/** 고지서 묶음의 사용량·청구액·실청구 단가. 단가는 **나눗셈 결과 그대로** 돌려준다. */
export function summarizeElectricityBills(bills: readonly ElectricityBill[]): {
  kwh: number
  krw: number
  krwPerKwh: number | null
  months: number
} {
  let kwh = 0
  let krw = 0
  for (const b of bills) {
    kwh += b.kwh
    krw += b.krw
  }
  return { kwh, krw, krwPerKwh: kwh > 0 ? krw / kwh : null, months: bills.length }
}

// 2024-03~10 합계: 275,193 kWh · 24,392,250 원 · 88.6 원/kWh.
/** 고지서가 전달된 구간(2024-03~10)의 합. 사이클 전기요금 **전액이 아니다.** */
export const ELECTRICITY_BILLED_KWH = ELECTRICITY_BILLS_2024.reduce((s, b) => s + b.kwh, 0)
export const ELECTRICITY_BILLED_KRW = ELECTRICITY_BILLS_2024.reduce((s, b) => s + b.krw, 0)

/**
 * 기본 전기 단가(원/kWh) — **실청구 기준**이다. 위 고지서 8개월을
 * `청구액 합 ÷ 사용량 합` 으로 나눈 값이고, 약 88.6 원/kWh 다.
 *
 * ── 65.9 원/kWh 로 바꾸지 말 것 ──────────────────────────────────────────
 * 지훈이 조사한 **농사용(을) 전력량요금은 65.9 원/kWh** 다. 이 상수와 22.7 원
 * 차이가 나는데, **둘 다 맞는 숫자이고 가리키는 것이 다르다.**
 *
 *   · 65.9 원/kWh — 사용량에 비례하는 전력량요금 단가. 한전 요금표의 값이다.
 *   · 88.6 원/kWh — 고지서 실청구액 ÷ 사용량. 기본요금(계약전력 90 kW 에
 *     비례하며 사용량과 무관), 부가가치세, 전력산업기반기금이 전부 들어가 있다.
 *
 * **엔진은 실청구 기준을 쓴다.** 농가가 실제로 내는 돈이 영업이익을 깎고,
 * 기본요금은 사용량을 줄여도 줄지 않는다. 요금표 단가로 계산하면 전기비가
 * 25.65% 과소 추정되고(24,392,250 → 18,135,219 원), 그만큼 영업이익이
 * 625만원 좋아 보인다.
 *
 * 전력량요금 단가가 필요한 계산(예: "폭기를 줄이면 얼마가 절약되나" — 한계
 * 절감액은 기본요금을 건드리지 않으므로 65.9 쪽이 맞다)은 호출자가
 * electricityKrwPerKwh 인자로 65.9 를 넣어 쓴다. **기본값을 바꾸는 쪽이 아니다.**
 */
export const DEFAULT_ELECTRICITY_KRW_PER_KWH = ELECTRICITY_BILLED_KRW / ELECTRICITY_BILLED_KWH

/** 농사용(을) 전력량요금 단가(원/kWh). 기본값이 아니다 — 위 주석을 읽을 것. */
export const AGRICULTURAL_ENERGY_CHARGE_KRW_PER_KWH = 65.9

// ── 채널별 판매 단가 ──────────────────────────────────────────────────────
// **출처: 천황수산 SalesInventory 2024년 실거래 40건.** 근거는
// docs/plans/tips-2026-dataset-assessment.md 3-1·3-4.
//
// 도매 17,000 원 대 소매 활새우 26,500 원 — **소매가 56% 높다.** 성장 예측
// 오차(홀드아웃 MAE 0.895 g = 20 g 기준 4.5%)보다 훨씬 큰 레버다. 그래서 채널은
// 엔진 2 의 인자이고, **기본값으로 하나를 박지 않는다**(channel.ts).
export type SalesChannel = "wholesale" | "retail_live" | "retail_frozen"

/** 채널 중앙값(원/kg). **실거래 중앙값이지, 다음 거래의 예상 단가가 아니다.** */
export const CHANNEL_MEDIAN_KRW_PER_KG: Readonly<Record<SalesChannel, number>> = {
  wholesale: 17000,
  retail_live: 26500,
  retail_frozen: 18000,
}

/**
 * 채널별 관측 범위와 건수. 중앙값만 쥐여 주면 "17,000 원" 이 확정 단가처럼
 * 쓰이므로, 표본 수와 최저·최고를 같이 돌려줘 호출자가 폭을 알 수 있게 한다.
 * 소매 활새우는 16,000~28,000 원으로 거의 두 배 벌어진다.
 */
export const CHANNEL_PRICE_OBSERVED: Readonly<
  Record<SalesChannel, { n: number; minKrwPerKg: number; medianKrwPerKg: number; maxKrwPerKg: number }>
> = {
  wholesale: { n: 9, minKrwPerKg: 17000, medianKrwPerKg: 17000, maxKrwPerKg: 17000 },
  retail_live: { n: 14, minKrwPerKg: 16000, medianKrwPerKg: 26500, maxKrwPerKg: 28000 },
  retail_frozen: { n: 17, minKrwPerKg: 16000, medianKrwPerKg: 18000, maxKrwPerKg: 24900 },
}

/**
 * **크기별 단가 곡선은 없다.** 실데이터에서 (크기, 단가) 조합이 단 1개 나왔다 —
 * 35마리/kg @ 17,000 원/kg (2024년 11월, 도매). 점 1개로는 기울기가 정의되지
 * 않으므로 **엔진 2 는 크기에 따라 단가를 올리지 않는다.** 같은 kg 이면 같은
 * 매출로 계산한다. 크기-가격 기울기가 필요한 엔진 3 은 외부 시세를 기다린다.
 * 근거: docs/plans/tips-2026-dataset-assessment.md 3-2.
 */
export const SIZE_PRICE_ANCHOR = {
  countPerKg: 35,
  krwPerKg: 17000,
  channel: "wholesale" as SalesChannel,
  observedAt: "2024-11",
} as const
