/*
 * 원본: mrv-platform/apps/web/src/features/comparison/comparisonViewModel.ts
 * 표시 전용 메타데이터/순수 함수라 그대로 옮겼다. 바꾼 것은 두 가지뿐이다:
 *   - import 경로(@/types/api → @/lib/mrv/api-types)
 *   - 디자인 토큰 클래스 이름(signal-*, fg/surface/... → mrv-* 네임스페이스)
 */
import { METRIC_META, METRIC_ORDER } from "@/lib/mrv/ui/metric-meta";
import type {
  ComparisonMetricRow,
  ComparisonResponse,
  ComparisonViewModel,
} from "@/lib/mrv/api-types";

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
