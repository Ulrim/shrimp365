import { METRIC_META, METRIC_ORDER } from "@/lib/metric-meta";
import type {
  ComparisonMetricRow,
  ComparisonResponse,
  ComparisonViewModel,
} from "@/types/api";

/*
 * ComparisonResponse(백엔드 그대로) → ComparisonViewModel(FE 표시용, phase-2 3.3절).
 * 단순 매핑/라벨 부여일 뿐 delta·improvement_pct 등은 재계산하지 않는다(백엔드 값 그대로 사용).
 */
export function toComparisonViewModel(
  data: ComparisonResponse,
): ComparisonViewModel {
  const rows: ComparisonMetricRow[] = METRIC_ORDER.map((key) => {
    const row = data.comparison[key];
    const meta = METRIC_META[key];
    return {
      key,
      label: meta.title,
      baselineValue: data.baseline.metrics[key] ?? null,
      currentValue: data.current.metrics[key] ?? null,
      deltaValue: row?.delta ?? null,
      improvementPct: row?.improvement_pct ?? null,
      direction: row?.direction ?? (meta.betterWhen === "lower" ? "lower_is_better" : "higher_is_better"),
    };
  });

  return {
    baselinePeriod: { from: data.baseline.period.from, to: data.baseline.period.to },
    currentPeriod: { from: data.current.period.from, to: data.current.period.to },
    rows,
    baselineConfigVersion: data.baseline.config_version,
    currentConfigVersion: data.current.config_version,
  };
}
