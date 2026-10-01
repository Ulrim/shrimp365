/**
 * 계측 타입 표시 메타데이터 — 라벨 + 집계 의미.
 *
 * MASTER 4장 화면 #3 「통합 대시보드: 전력·DO·수온·pH 실시간 시계열」이 요구하는
 * 지표 목록이다. 데이터·API 는 이식 시점부터 6종을 모두 받았고(`ReadingMeterType`,
 * `readings-service.ts` 의 `DISPLAY_UNIT`), 화면만 전력 전용이었다.
 *
 * ★ `unit` 은 문서용이다. 실제 표시 단위는 서버 응답의 `unit` 을 그대로 쓴다 —
 *   단위를 화면이 정하면 서버가 단위를 바꾼 날 그래프가 조용히 거짓말을 한다.
 *
 * ★ `aggregation` 은 장식이 아니다. `readings-service.ts` 의 `p_sum: type === "power"`
 *   때문에 **전력만 구간 합이고 나머지는 구간 평균**이다. 같은 "일별" 이라는 말이
 *   지표마다 다른 뜻이므로 차트가 그것을 눈에 보이게 적어야 한다. 적지 않으면
 *   운영자가 일별 수온 25.4 를 "그날 측정값" 으로 읽는다(실제로는 그날 평균이다).
 */

import type { ReadingMeterType } from "@/lib/mrv/api-types";

export interface ReadingTypeMeta {
  /** 화면에 쓰는 한국어 라벨. */
  label: string;
  /** 참조용 단위(실제 표시는 서버 응답 unit 을 사용). */
  unit: string;
  /** 구간 집계 방식 — 전력은 누적량이라 합, 나머지는 상태량이라 평균. */
  aggregation: "sum" | "avg";
  /**
   * Y축을 0 에서 시작할 것인가.
   *
   * 집계 방식(`aggregation`)과 **따로 둔다.** 지금은 합계인 지표가 전력뿐이라 두 값이
   * 우연히 일치하지만, 뜻이 다르다 — 합계냐 평균이냐는 시간 축의 문제이고, 0 을 포함할
   * 것인가는 그 지표에서 0 이 의미를 갖느냐의 문제다. 묶어 두면 "구간 합인 상태량" 같은
   * 지표가 생기는 날 축이 조용히 틀린다. ORP 는 음수 구간을 쓰므로 0 고정이면 아예 못 읽는다.
   */
  zeroBaseline: boolean;
}

export const READING_TYPE_META: Record<ReadingMeterType, ReadingTypeMeta> = {
  power: { label: "전력 사용량", unit: "kWh", aggregation: "sum", zeroBaseline: true },
  do: { label: "용존산소(DO)", unit: "mg/L", aggregation: "avg", zeroBaseline: false },
  temp: { label: "수온", unit: "degC", aggregation: "avg", zeroBaseline: false },
  ph: { label: "pH", unit: "pH", aggregation: "avg", zeroBaseline: false },
  orp: { label: "산화환원전위(ORP)", unit: "mV", aggregation: "avg", zeroBaseline: false },
  ec: { label: "전기전도도(EC)", unit: "mS/cm", aggregation: "avg", zeroBaseline: false },
};

/**
 * 차트 표시 순서. 전력이 먼저인 것은 과제의 주 지표(Scope2 산정의 입력)이기 때문이고,
 * 그다음이 DO 인 것은 알림 트리거(`do_low`)가 보는 값이기 때문이다.
 */
export const READING_TYPE_ORDER: ReadingMeterType[] = [
  "power",
  "do",
  "temp",
  "ph",
  "orp",
  "ec",
];

/** 기본으로 켜 두는 지표. 나머지는 사이트에 계측기가 있어도 사용자가 켜야 보인다. */
export const DEFAULT_READING_TYPES: ReadingMeterType[] = ["power", "do"];

/** `granularity` + 집계 방식을 한 문구로. 차트 부제목에 그대로 쓴다. */
export function describeAggregation(
  type: ReadingMeterType,
  granularity: "hourly" | "daily",
): string {
  const bucket = granularity === "hourly" ? "시간별" : "일별";
  const how = READING_TYPE_META[type].aggregation === "sum" ? "합계" : "평균";
  return `${bucket} ${how}`;
}
