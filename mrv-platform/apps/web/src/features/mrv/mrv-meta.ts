import type { MrvReportPeriodSummary } from "@/types/api";

/*
 * MRV 리포트 Before/After 비교표 행 메타데이터(phase-3 1.4절 before_json/after_json 구조).
 * 라벨/단위/접근자만 담는다 — 값은 항상 MrvReportResponse.before/after에서 그대로 읽는다
 * (재계산 금지, 절대 규칙).
 */
export interface MrvMetricRowMeta {
  key: string;
  label: string;
  unit: string;
  getValue: (summary: MrvReportPeriodSummary) => number | null;
}

export const MRV_METRIC_ROWS: MrvMetricRowMeta[] = [
  { key: "ei_total", label: "전력집약도(EI)", unit: "kWh/kg", getValue: (s) => s.ei_total },
  { key: "ei_aeration", label: "폭기 EI", unit: "kWh/kg", getValue: (s) => s.ei_aeration },
  {
    key: "total_power_kwh",
    label: "총 전력사용량",
    unit: "kWh",
    getValue: (s) => s.total_power_kwh,
  },
  {
    key: "biomass_delta_kg",
    label: "생산량(Δbiomass)",
    unit: "kg",
    getValue: (s) => s.biomass_delta_kg,
  },
  {
    key: "scope2_tco2e",
    label: "Scope2 배출량",
    unit: "tCO2e",
    getValue: (s) => s.scope2_tco2e,
  },
];

/** 숫자 표시 포맷(단순 반올림, 산식 아님). null이면 "산출 불가". */
export function formatMrvNumber(value: number | null, digits = 2): string {
  return value === null ? "산출 불가" : value.toFixed(digits);
}
