import { KpiCard } from "@/features/dashboard/components/KpiCard";
import { METRIC_META, METRIC_ORDER } from "@/lib/metric-meta";
import type { KpiMetrics } from "@/types/api";

/*
 * 기준선/미리보기 지표 그리드. KpiCard를 재사용해 5종을 방향(betterWhen)과 함께 렌더.
 * 값은 백엔드(metrics)에서 온 그대로 표시(재계산 금지).
 */
export function BaselineMetricsGrid({
  metrics,
  configVersion,
  period,
}: {
  metrics: KpiMetrics;
  configVersion: string;
  period: { from: string; to: string };
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {METRIC_ORDER.map((key) => {
        const meta = METRIC_META[key];
        return (
          <KpiCard
            key={key}
            title={meta.title}
            metricKey={key}
            metric={metrics[key]}
            configVersion={configVersion}
            period={period}
            betterWhen={meta.betterWhen}
          />
        );
      })}
    </div>
  );
}
