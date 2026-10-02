// 크기별 단가 모델의 관측 데이터와 고정 숫자. **값만 옮겨 적지 않고 출처·근거
// 등급·시점을 함께 적는다** — lib/profitability/constants.ts 와 같은 방식이다.
//
// 이 파일의 숫자는 거의 전부 **판매처 한 곳의 상품 페이지**에서 나왔다. 그
// 사실을 주석에 적지 않으면 다음 사람이 "시세" 로 읽고 엔진 3 의 출하 판정에
// 점추정으로 박아 넣는다.

// ── 근거 등급 ─────────────────────────────────────────────────────────────
/**
 * A — 동일 조건 독립 조회에서 재현된 1차 관측. B — 1회 관측 또는 2차 인용.
 * C — 방향만 알 수 있고 수치를 신뢰할 수 없음. **C 는 기본값이 되지 않는다.**
 */
export type EvidenceGrade = "A" | "B" | "C"

// ── 상태(활·생물·선·냉동) ────────────────────────────────────────────────
/**
 * 상품 상태. **한 테이블에 섞지 않는다** — 활 ÷ 냉동 ≈ 2.2 배이고(근거 B),
 * 크기 기울기 자체도 냉동이 활·생물의 1/3 수준으로 완전히 다르다.
 */
export type ProductForm = "live" | "fresh" | "chilled" | "frozen"

/**
 * 기울기를 공유할 수 있는 상태 묶음. 활과 생물은 같은 묶음이다 — 근거가 된
 * 11번가 상품 표기가 「생물·활」 하나로 묶여 있어서 둘을 가를 관측이 없다.
 * **선·냉동은 각자 따로다.** 냉동 계수로 활 단가를 계산하는 길을 막는 것이
 * 이 함수의 존재 이유다(size-price.ts 의 form 검사).
 */
export type FormFamily = "live_fresh" | "chilled" | "frozen"

export function formFamily(form: ProductForm): FormFamily {
  if (form === "live" || form === "fresh") return "live_fresh"
  return form
}

/** 크기 기울기를 뽑아도 되는 상태. **냉동은 여기 없다** — 경고 3 참조. */
export const SLOPE_ELIGIBLE_FORMS: readonly ProductForm[] = ["live", "fresh"]

/** 활 ÷ 냉동 단가비 ≈ 2.2. **출처: 채널 중앙값 비교(엔진 2) + 상품 페이지, 등급 B.** */
export const LIVE_TO_FROZEN_PRICE_RATIO = 2.2

// ── 유통단계 ──────────────────────────────────────────────────────────────
/**
 * 유통단계. 크기별로 공개된 시세는 **온라인몰 소매**인데 농가가 받는 것은
 * **산지·도매**다. 그래서 이 모델은 **수준(level)과 기울기(slope)를 분리한다** —
 * 기울기는 소매 사다리에서, 수준은 농가 실수취가에서 가져온다.
 */
export type DistributionStage =
  /** 산지. 신안 2024 평균을 1.00 기준으로 둔다. */
  | "farmgate"
  /** 도매. 천황수산 실수취가가 여기 있다. */
  | "wholesale"
  /** 대형마트 행사 생새우. */
  | "mart_promo"
  /** 산지직송 벌크. */
  | "direct_bulk"
  /** 온라인몰 소매. 크기별 사다리가 여기서 나왔다. */
  | "online_retail"
  /** 온라인몰 프리미엄(무항생제·친환경 인증). **변환에서 제외된다.** */
  | "online_premium"

/**
 * 산지 평균(2024) 대비 단계 배수. **기준 1.00 = 신안 산지 평균
 * 14,286 원/kg.** 출처: 지훈 조사 2026-10-01, 등급 B(단계별로 출처가 다르고
 * 동일 시점·동일 규격이 아니다).
 *
 * low·high 는 관측 폭이다. **point 만 쥐여 주면 배수가 확정값처럼 쓰이므로**
 * 폭을 같이 돌려준다(엔진 2 의 CHANNEL_PRICE_OBSERVED 와 같은 이유).
 *
 * 온라인몰 소매 point 2.20 은 1.96~2.44 의 중앙이고, **소매 → 산지 변환
 * ÷2.2 가 여기서 나온다.**
 */
export type StageMultiplier = {
  low: number
  point: number
  high: number
  grade: EvidenceGrade
  /** 무엇을 관측한 배수인가. */
  note: string
}

export const STAGE_MULTIPLIER: Readonly<Record<DistributionStage, StageMultiplier>> = {
  farmgate: {
    low: 0.84,
    point: 1.0,
    high: 1.0,
    grade: "B",
    // 0.84 는 2019 하락기다. **계절 근거가 아니다** — 연도 간 비교이고 원인도
    // 생산량 증가·소비 부진이다(경고 4).
    note: "신안 산지 평균 2024 = 14,286 원/kg 기준 1.00. low 0.84 는 2019 하락기 연평균.",
  },
  wholesale: {
    low: 1.19,
    point: 1.19,
    high: 1.19,
    grade: "A",
    note: "천황수산 도매 17,000 원/kg @ 35미/kg, 2024-11. 관측 1점이라 폭이 없다.",
  },
  mart_promo: { low: 1.39, point: 1.39, high: 1.39, grade: "B", note: "대형마트 행사 생새우. 관측 1점." },
  direct_bulk: { low: 1.54, point: 1.54, high: 1.54, grade: "B", note: "산지직송 벌크. 관측 1점." },
  online_retail: {
    low: 1.96,
    point: 2.2,
    high: 2.44,
    grade: "A",
    note: "온라인몰 소매 28,000~34,900 원/kg. 아래 사다리 4점이 이 범위를 그대로 덮는다.",
  },
  online_premium: {
    low: 3.0,
    point: 3.25,
    high: 3.49,
    grade: "A",
    note: "무항생제·친환경 49,900 · 산지직송 42,900(@40미). **변환·적합에서 제외된다.**",
  },
}

/** 신안 산지 평균(원/kg, 2024). 모든 단계 배수의 분모다. */
export const FARMGATE_BASE_KRW_PER_KG = 14286

/**
 * 소매 → 농가 실수취 변환 계수. **기본 2.2, 허용 범위 2.0~2.4.**
 *
 * 관측된 온라인몰 소매 배수는 1.96~2.44 인데 허용 범위를 2.0~2.4 로 좁혀
 * 받는다 — 양 끝 두 점은 사다리의 최저·최고 한 점씩이라 그 끝값을 변환 계수로
 * 쓰면 가장 싼 상품 하나로 전체를 환산하는 셈이 된다.
 *
 * **범위 밖 계수는 끌어당기지 않고 거부한다**(distribution.ts). 2.6 을 넣어
 * 농가 수취가를 낮게 만들거나 1.5 를 넣어 높게 만드는 길을 열어 두면,
 * 엔진 3 의 "2주 더 키우자" 가 계수 선택으로 뒤집힌다.
 */
export const RETAIL_TO_FARMGATE_DIVISOR = 2.2
export const RETAIL_TO_FARMGATE_DIVISOR_RANGE = { min: 2.0, max: 2.4 } as const

// ── 관측 출처 ─────────────────────────────────────────────────────────────
/**
 * 관측이 어디서 왔나. **공식 통계가 나중에 들어올 자리를 지금 만들어 둔다** —
 * 상품 페이지에서 긁은 수와 위판 실적 통계가 같은 배열에 섞여 들어오면 등급을
 * 구분할 수 없고, 그때 가서 필드를 추가하면 기존 상수 전부를 손대야 한다.
 */
export type ObservationSource =
  /** 판매처 상품 페이지. vendor 가 섞임 판정의 기준이다. */
  | { kind: "vendor_listing"; vendor: string; marketplace: string; productId?: string }
  /** 농가 제공 실거래. */
  | { kind: "farm_record"; farm: string }
  /** 공시 통계. **아직 하나도 없다** — PENDING_OFFICIAL_SOURCES 참조. */
  | { kind: "official_statistic"; publisher: string; datasetId: string; seriesName?: string }

/**
 * 크기별 공시 통계는 **여전히 없다.** 다만 해수부 「일자별위탁판매현황」에
 * `상품규격명`·`위판단가(1킬로그램)` 컬럼이 있는 것은 등급 A 로 재확인됐다.
 *
 * **이 환경은 data.go.kr 이 네트워크 차단이라 호출할 수 없다. 연동을 만들지
 * 않았고 만들지 말 것.** 통계가 들어오면 ObservationSource 의
 * `official_statistic` 로 관측을 넣고, 사다리의 grade 를 A·vendorCount 를 올려
 * 아래 잠정 탄력성을 교체하는 것이 정상 경로다.
 */
export const PENDING_OFFICIAL_SOURCES: readonly {
  publisher: string
  datasetId: string
  seriesName: string
  columns: readonly string[]
  grade: EvidenceGrade
  /** 이 환경에서 호출 가능한가. 전부 false 다. */
  fetchable: false
  reason: string
}[] = [
  {
    publisher: "해양수산부",
    datasetId: "15102791",
    seriesName: "일자별위탁판매현황",
    columns: ["상품규격명", "위판단가(1킬로그램)"],
    grade: "A",
    fetchable: false,
    reason: "data.go.kr 네트워크 차단",
  },
  {
    publisher: "해양수산부",
    datasetId: "15102792",
    seriesName: "일자별위탁판매현황",
    columns: ["상품규격명", "위판단가(1킬로그램)"],
    grade: "A",
    fetchable: false,
    reason: "data.go.kr 네트워크 차단",
  },
  {
    publisher: "해양수산부",
    datasetId: "15102794",
    seriesName: "일자별위탁판매현황",
    columns: ["상품규격명", "위판단가(1킬로그램)"],
    grade: "A",
    fetchable: false,
    reason: "data.go.kr 네트워크 차단",
  },
]

// ── 핵심 관측 — 동일 판매처 4단 사다리 ───────────────────────────────────
/**
 * **이것이 크기 기울기의 유일한 근거다.**
 *
 * 이순신수산 / 11번가 상품 8549532487 / 국내산 / 생물·활 / 온라인몰 소매 /
 * 2026-10 조회 / 1kg 단위. 독립 검색 4회에서 네 칸이 모두 동일하게 재현됐다
 * (등급 A).
 *
 * 같은 상품 페이지의 등급 사다리라서 **판매처·포장·택배·브랜드가 전부 고정**
 * 이고, 변하는 것이 크기뿐이다. 그래서 여기서 나온 기울기는 크기 효과다.
 * 다른 판매처의 점을 여기에 섞으면 그 전제가 깨진다(ladder.ts).
 */
export const LADDER_VENDOR = "이순신수산"
export const LADDER_MARKETPLACE = "11번가"
export const LADDER_PRODUCT_ID = "8549532487"
export const LADDER_OBSERVED_AT = "2026-10"

/** 사다리 한 칸. ABW 는 저장하지 않고 1000/countPerKg 로 파생한다 — 두 수를 따로 들고 있으면 어긋난다. */
export type LadderRung = {
  /** 등급 표기 그대로. */
  label: string
  /** 미/kg 대표값. */
  countPerKg: number
  krwPerKg: number
}

export const SIZE_PRICE_LADDER_RUNGS: readonly LadderRung[] = [
  { label: "소 40-45미", countPerKg: 42.5, krwPerKg: 28000 },
  { label: "중 36-40미", countPerKg: 38, krwPerKg: 29800 },
  { label: "대 34미 내외", countPerKg: 34, krwPerKg: 31900 },
  { label: "특대 30미 내외", countPerKg: 30, krwPerKg: 34900 },
]

// ── 탄력성 ────────────────────────────────────────────────────────────────
/**
 * **단가 ≈ 상수 × ABW^0.63.** 등급 한 단계(약 4미/kg)당 +7.6%, 전구간 +24.6%.
 *
 * 위 사다리 4점에서 계산한 값은 전구간 0.6324, 로그-로그 OLS 0.6315,
 * 구간별 0.5567 / 0.6122 / 0.7181 이다(ladder.ts 가 계산하고
 * scripts/pricing/verify.mjs 가 대조한다).
 *
 * ── 왜 0.6324 가 아니라 0.63 인가 ────────────────────────────────────────
 * **이 값은 점추정이 아니라 잠정 설정값이다.** 소수 네 자리를 박아 두면 다음
 * 사람이 정밀도로 읽는다. 판매처 한 곳의 사다리에서 나온 수에 그런 정밀도는
 * 없으므로 두 자리로 적고, 교체 가능한 설정값임을 타입(SizeElasticity.provisional)
 * 으로 들고 다닌다. 농가 월별 입력이 쌓이면 이 상수가 아니라 농가 추정값이
 * 기본이 된다.
 *
 * ── 왜 구간별이 아니라 상수인가 ──────────────────────────────────────────
 * 구간별 탄력성이 **단조 증가한다**(0.557 → 0.612 → 0.718). 큰 개체일수록
 * 1 g 추가의 값이 비싸고, 상수로 두면 그 효과를 놓친다. 그래도 상수로 둔다.
 *   · 구간이 3개뿐이고 전부 판매처 한 곳에서 나왔다. 3점으로 2차항을 적합하면
 *     곡률이 그 판매처의 등급 가격 정책을 그대로 외운다.
 *   · 사다리 밖(23.5 g 아래·33.3 g 위)으로 나가는 순간 곡률 외삽이 폭주한다.
 *     엔진 3 이 다룰 구간은 20~35 g 로 사다리 안쪽에 가깝지만, 상한을 넘는
 *     질의는 반드시 들어온다.
 *   · 상수 쪽 오차의 방향이 안전하다 — 큰 개체의 프리미엄을 **과소**평가하므로
 *     "더 키우자" 를 덜 권한다.
 * 대신 **구간별 값을 버리지 않고 같이 내보낸다**(ElasticityFit.segments)
 * 그리고 단조 증가가 감지되면 `price_elasticity_size_dependent` 를 올려
 * 엔진 3 이 그 사실을 알 수 있게 한다.
 */
export const SIZE_ELASTICITY_DEFAULT = 0.63

/**
 * **0.63 은 하한이다.** 소매가에 택배비 약 4,000 원/kg 수준의 고정비가 섞여
 * 있다. 고정분은 크기와 무관하므로 단가에 더해지면 기울기를 평평하게 만든다.
 * 사다리 네 점에서 4,000 원을 빼고 다시 계산하면 전구간 탄력성이 **0.7255**
 * (구간별 0.646 / 0.704 / 0.816)로 올라간다.
 *
 * 즉 실제 산지 기울기는 **0.63~0.73** 사이일 가능성이 높고, 0.63 을 쓰면
 * 엔진 3 이 "2주 더 키우자" 를 **과소 권고**한다. 안전한 방향의 편향이지만
 * 알고 써야 하므로, 추정값에 밴드를 같이 실어 보낸다.
 */
export const RETAIL_SHIPPING_FIXED_KRW_PER_KG = 4000
export const SIZE_ELASTICITY_BAND = { low: 0.63, high: 0.73 } as const

/**
 * **냉동 사다리의 기울기는 약 0.19 — 활·생물의 1/3 이다.** 근거가 C 등급이라
 * 수치를 신뢰할 수 없다. **방향만 기억한다: 냉동 사다리로 기울기를 뽑으면
 * 크기 프리미엄이 크게 과소평가된다.**
 *
 * 이 상수는 **기본값이 될 수 없고**, 활·생물 앵커에 적용하면 거부된다
 * (size-price.ts 의 form 검사). 여기 적어 두는 이유는 누군가 냉동 상품
 * 페이지를 보고 "0.63 이 너무 크다" 고 결론 내리는 것을 막기 위해서다.
 */
export const FROZEN_SIZE_ELASTICITY_C_GRADE = 0.19

/**
 * 탄력성이 이 범위를 벗어나면 **크기 효과가 아니라 판매처 노이즈로 본다.**
 *
 * 같은 40미에서 단가가 28,000~49,900 원으로 1.78 배 벌어지는데 크기 전구간
 * 효과는 +24.6% 에 불과하다 — **판매처 간 노이즈가 크기 신호의 3배다.**
 * 프리미엄 점(49,900 @40미)을 사다리에 끼우면 그 구간 탄력성이 9.53 으로
 * 나오고, 전체 적합에 넣으면 기울기 부호가 뒤집힌다. 상한 1.5 는 관측 최대
 * 구간값 0.718 의 두 배로, 크기 효과만으로는 결코 닿지 않는 높이다.
 */
export const ELASTICITY_PLAUSIBLE_RANGE = { min: 0, max: 1.5 } as const

// ── 계절항 ────────────────────────────────────────────────────────────────
/**
 * **계절 보정은 1.0(= 보정 없음)이고, 모델에 없다.**
 *
 * 추계 집중 출하기(9~12월) 단가 하락 방향은 확인됐으나 **정량화 불가(C)** 다.
 * 2019년 산지 −30% 는 **연도 간 비교이고 원인도 생산량 증가·소비 부진이라
 * 계절 근거로 쓰면 오독이다 — 넣지 않았다.** 월별 농가 입력이 쌓인 뒤
 * 추정하는 것이 정직하다.
 *
 * 0 이라는 사실은 숨기지 않는다 — 모든 추정 결과에
 * `seasonal: { factor: 1, modeled: false }` 와
 * `price_seasonality_not_modeled` 가 함께 나간다.
 */
export const SEASONAL_ADJUSTMENT = {
  factor: 1,
  modeled: false,
  grade: "C" as EvidenceGrade,
  direction: "추계 집중 출하기(9~12월) 하락 방향만 확인. 크기·정도 불명.",
} as const
