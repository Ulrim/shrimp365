import type { EChartsOption } from "echarts";
import type { ReadingQualityFlag } from "@/types/api";

/*
 * ECharts 옵션 빌더(순수 함수) — PowerTimeSeriesChart 전용.
 * react-refresh 경고 회피를 위해 컴포넌트 파일에서 분리(비-컴포넌트 export).
 * quality_flag='bad' 포인트는 마커 형태(다이아몬드)+색+툴팁 텍스트로 구분(색만으로 전달 금지).
 */

export interface ChartDatum {
  value: number | null;
  qualityFlag?: ReadingQualityFlag;
}

export interface ChartSeries {
  name: string;
  unit: string;
  data: ChartDatum[]; // categories와 index 정렬
}

const BAD_ITEM_STYLE = { color: "#dc2626", borderColor: "#7f1d1d" };

export function buildChartOption(
  categories: string[],
  chartSeries: ChartSeries[],
): EChartsOption {
  const unit = chartSeries[0]?.unit ?? "";
  return {
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        const lines = list.map((p) => {
          const raw = p.data as ChartDatum | null | undefined;
          const value = raw?.value;
          const isBad = raw?.qualityFlag === "bad";
          const isSuspect = raw?.qualityFlag === "suspect";
          const valueText =
            value === null || value === undefined ? "-" : `${value} ${unit}`;
          const flagText = isBad
            ? " (품질 불량 데이터)"
            : isSuspect
              ? " (품질 의심 데이터)"
              : "";
          return `${p.marker}${p.seriesName}: ${valueText}${flagText}`;
        });
        const axisLabel =
          typeof list[0]?.dataIndex === "number"
            ? (categories[list[0].dataIndex] ?? "")
            : "";
        return [axisLabel, ...lines].join("<br/>");
      },
    },
    legend: { data: chartSeries.map((s) => s.name), top: 0 },
    grid: { left: 48, right: 16, top: 40, bottom: 32 },
    xAxis: {
      type: "category",
      data: categories,
      name: "시각",
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      name: unit,
      nameGap: 12,
    },
    series: chartSeries.map((s) => ({
      name: s.name,
      type: "line",
      smooth: true,
      connectNulls: true,
      data: s.data.map((d) => ({
        value: d.value,
        qualityFlag: d.qualityFlag,
        symbol: d.qualityFlag === "bad" ? "diamond" : "circle",
        symbolSize: d.qualityFlag === "bad" ? 10 : 4,
        itemStyle: d.qualityFlag === "bad" ? BAD_ITEM_STYLE : undefined,
      })),
    })),
  };
}
