import type { SiteBenchmarkMetrics, SiteBenchmarkRow } from "@/types/api";

/*
 * 멀티사이트 벤치마크 표시/정렬 메타데이터(phase-3 4.2절, MASTER 화면12).
 * 여기의 정렬/최우수·최하위 판정은 "단순 비교"일 뿐 신규 산식이 아니다(phase-3 4.2절 명시
 * — architect가 이미 "정렬/랭킹·색상 하이라이트는 FE 표시 로직"으로 확정). 값 자체는
 * 백엔드가 반환한 metrics를 그대로 사용한다(재계산 금지).
 */

export type SiteBenchmarkMetricKey = keyof SiteBenchmarkMetrics;

export interface BenchmarkMetricMeta {
  key: SiteBenchmarkMetricKey;
  label: string;
  unit: string;
  betterWhen: "lower" | "higher";
}

export const BENCHMARK_METRIC_META: BenchmarkMetricMeta[] = [
  { key: "ei_total", label: "전력집약도(EI)", unit: "kWh/kg", betterWhen: "lower" },
  { key: "ei_aeration", label: "폭기 EI", unit: "kWh/kg", betterWhen: "lower" },
  { key: "oei", label: "산소효율지수(OEI)", unit: "index", betterWhen: "higher" },
  { key: "fcr", label: "사료요구율(FCR)", unit: "kg/kg", betterWhen: "lower" },
  { key: "mortality_rate", label: "폐사율", unit: "%", betterWhen: "lower" },
];

export type BenchmarkSortDirection = "asc" | "desc";

/** 지표값 오름/내림차순 정렬(단순 비교). 값이 null인 site는 항상 맨 뒤로 보낸다. */
export function sortBenchmarkRows(
  rows: SiteBenchmarkRow[],
  key: SiteBenchmarkMetricKey,
  dir: BenchmarkSortDirection,
): SiteBenchmarkRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a.metrics[key];
    const bv = b.metrics[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * sign;
  });
}

/** 열별 최우수/최하위 site_id 판정(betterWhen 방향 반영, 단순 비교). 유효값이 없으면 둘 다 null. */
export function findBestWorst(
  rows: SiteBenchmarkRow[],
  key: SiteBenchmarkMetricKey,
  betterWhen: "lower" | "higher",
): { bestSiteId: string | null; worstSiteId: string | null } {
  const valid = rows.filter((r) => r.metrics[key] !== null);
  if (valid.length === 0) return { bestSiteId: null, worstSiteId: null };
  const sorted = [...valid].sort((a, b) => {
    const av = a.metrics[key] as number;
    const bv = b.metrics[key] as number;
    return betterWhen === "lower" ? av - bv : bv - av;
  });
  return {
    bestSiteId: sorted[0].site_id,
    worstSiteId: sorted[sorted.length - 1].site_id,
  };
}

/** 숫자 표시 포맷(단순 반올림). null이면 "산출 불가". */
export function formatBenchmarkNumber(value: number | null, digits = 2): string {
  return value === null ? "산출 불가" : value.toFixed(digits);
}
