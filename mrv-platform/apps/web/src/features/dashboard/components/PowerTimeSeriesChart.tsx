import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import {
  useSiteReadings,
  type UseSiteReadingsTarget,
} from "../hooks/useSiteReadings";
import { buildChartOption, type ChartDatum, type ChartSeries } from "./chartOption";

/*
 * 시계열 차트 (ECharts) — phase-2 4.1/4.3절 실데이터 전환.
 * 더미 배열 대신 useSiteReadings(siteId, targets, from, to, granularity) 결과를 그대로 표시한다.
 * 절대 규칙: value는 백엔드 응답 그대로(재계산 금지). 로딩/에러/빈 상태 명시.
 * quality_flag='bad' 포인트 시각 구분 로직은 chartOption.ts(buildChartOption)에 위치.
 */

export interface PowerTimeSeriesChartProps {
  siteId: string;
  /** ISO8601 UTC */
  from: string;
  /** ISO8601 UTC */
  to: string;
  granularity: "hourly" | "daily";
  /** meterId 단일 조회 또는 tankId+type 다건(수조별 비교) */
  targets: UseSiteReadingsTarget[];
}

export function PowerTimeSeriesChart({
  siteId,
  from,
  to,
  granularity,
  targets,
}: PowerTimeSeriesChartProps) {
  const { series, isLoading, isError, isEmpty } = useSiteReadings({
    siteId,
    targets,
    from,
    to,
    granularity,
  });

  const { categories, chartSeries } = useMemo(() => {
    // meter_id 기준 series 분리(4.3절 "수조별 비교") — tank_id+type 조회는 응답에 복수 meter_id가
    // 섞여 올 수 있으므로 point.meterId를, 없으면 응답의 meterId를, 그마저 없으면 target.key를 쓴다.
    const groups = new Map<
      string,
      { label: string; unit: string; points: Map<string, ChartDatum> }
    >();

    for (const s of series) {
      if (!s.data) continue;
      const targetLabel = s.label ?? s.target.tankId ?? s.target.meterId ?? s.key;
      for (const p of s.data.points) {
        const meterKey = p.meterId ?? s.data.meterId ?? s.key;
        const groupKey = `${s.key}::${meterKey}`;
        const label =
          meterKey && meterKey !== s.key
            ? `${targetLabel} · ${meterKey}`
            : targetLabel;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { label, unit: s.data.unit, points: new Map() });
        }
        groups.get(groupKey)!.points.set(p.ts, {
          value: p.value,
          qualityFlag: p.qualityFlag,
        });
      }
    }

    const categorySet = new Set<string>();
    for (const g of groups.values()) {
      for (const ts of g.points.keys()) categorySet.add(ts);
    }
    const sortedCategories = Array.from(categorySet).sort();

    const builtSeries: ChartSeries[] = Array.from(groups.values()).map((g) => ({
      name: g.label,
      unit: g.unit,
      data: sortedCategories.map((ts) => g.points.get(ts) ?? { value: null }),
    }));

    return { categories: sortedCategories, chartSeries: builtSeries };
  }, [series]);

  const option = useMemo(
    () => buildChartOption(categories, chartSeries),
    [categories, chartSeries],
  );

  const hasAnyData = chartSeries.length > 0;
  // 점진적 렌더: 일부 series가 아직 로딩 중이어도 이미 도착한 데이터는 바로 표시한다.
  const showSkeleton = isLoading && !hasAnyData;
  const showError = isError && !hasAnyData;
  const showEmpty = !isLoading && !isError && isEmpty && !hasAnyData;
  const showChart = hasAnyData;

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 shadow-sm"
      aria-label="시계열 차트"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-fg">
          전력 사용량 시계열 ({granularity === "hourly" ? "시간별" : "일별"})
        </h3>
        {isLoading && hasAnyData && (
          <span className="text-[11px] text-muted" role="status">
            일부 데이터를 불러오는 중…
          </span>
        )}
      </header>

      {showSkeleton && (
        <div
          className="flex h-64 items-center justify-center text-sm text-muted"
          role="status"
        >
          차트 데이터를 불러오는 중…
        </div>
      )}

      {showError && (
        <div
          className="flex h-64 flex-col items-center justify-center gap-2 text-sm"
          role="alert"
        >
          <p className="text-signal-red">차트 데이터를 불러오지 못했습니다.</p>
        </div>
      )}

      {showEmpty && (
        <div
          className="flex h-64 items-center justify-center text-sm text-muted"
          role="status"
        >
          표시할 시계열 데이터가 없습니다.
        </div>
      )}

      {showChart && (
        <ReactECharts
          option={option}
          style={{ height: 256, width: "100%" }}
          notMerge
          aria-label="전력 사용량 시계열 라인 차트"
        />
      )}
    </section>
  );
}
