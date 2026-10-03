import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UseSiteReadingsResult } from "../hooks/useSiteReadings";

/*
 * PowerTimeSeriesChart: 로딩/에러/빈/정상 상태 + quality_flag='bad' 표시 로직 검증.
 * useSiteReadings 훅을 mock하여 백엔드 없이 상태별 렌더를 확인한다.
 */

const hookState: { value: UseSiteReadingsResult } = {
  value: { series: [], isLoading: false, isError: false, isEmpty: true },
};

vi.mock("../hooks/useSiteReadings", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useSiteReadings")>(
    "../hooks/useSiteReadings",
  );
  return {
    ...actual,
    useSiteReadings: () => hookState.value,
  };
});

import { PowerTimeSeriesChart } from "./PowerTimeSeriesChart";
import { buildChartOption } from "./chartOption";

const baseProps = {
  siteId: "demo-site",
  from: "2026-06-01T00:00:00Z",
  to: "2026-06-02T00:00:00Z",
  granularity: "hourly" as const,
  targets: [{ key: "mtr_power_main", meterId: "mtr_power_main" }],
};

describe("PowerTimeSeriesChart", () => {
  beforeEach(() => {
    hookState.value = {
      series: [],
      isLoading: false,
      isError: false,
      isEmpty: true,
    };
  });

  it("로딩 중이고 데이터가 없으면 로딩 상태를 표시한다", () => {
    hookState.value = { series: [], isLoading: true, isError: false, isEmpty: false };
    render(<PowerTimeSeriesChart {...baseProps} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "차트 데이터를 불러오는 중",
    );
  });

  it("에러이고 데이터가 없으면 에러 상태를 표시한다", () => {
    hookState.value = { series: [], isLoading: false, isError: true, isEmpty: false };
    render(<PowerTimeSeriesChart {...baseProps} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "차트 데이터를 불러오지 못했습니다.",
    );
  });

  it("포인트가 0개이면 빈 상태를 표시한다", () => {
    hookState.value = {
      series: [
        {
          key: "mtr_power_main",
          target: baseProps.targets[0],
          data: {
            siteId: "demo-site",
            meterId: "mtr_power_main",
            type: "power",
            granularity: "hourly",
            unit: "kWh",
            points: [],
          },
          isLoading: false,
          isError: false,
          error: undefined,
        },
      ],
      isLoading: false,
      isError: false,
      isEmpty: true,
    };
    render(<PowerTimeSeriesChart {...baseProps} />);
    expect(screen.getByText("표시할 시계열 데이터가 없습니다.")).toBeInTheDocument();
  });

  it("정상 데이터가 있으면 차트를 렌더하고 로딩/에러/빈 메시지가 없다", () => {
    hookState.value = {
      series: [
        {
          key: "mtr_power_main",
          target: baseProps.targets[0],
          data: {
            siteId: "demo-site",
            meterId: "mtr_power_main",
            type: "power",
            granularity: "hourly",
            unit: "kWh",
            points: [
              { ts: "2026-06-01T00:00:00Z", value: 12.4, qualityFlag: "ok" },
              { ts: "2026-06-01T01:00:00Z", value: 13.1, qualityFlag: "ok" },
            ],
          },
          isLoading: false,
          isError: false,
          error: undefined,
        },
      ],
      isLoading: false,
      isError: false,
      isEmpty: false,
    };
    const { container } = render(<PowerTimeSeriesChart {...baseProps} />);
    expect(
      screen.queryByText("표시할 시계열 데이터가 없습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // ECharts 캔버스가 마운트되었는지(내부 div)
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("quality_flag='bad' 포인트가 있어도 정상 렌더되며 빈/에러 상태로 빠지지 않는다", () => {
    hookState.value = {
      series: [
        {
          key: "mtr_power_main",
          target: baseProps.targets[0],
          data: {
            siteId: "demo-site",
            meterId: "mtr_power_main",
            type: "power",
            granularity: "hourly",
            unit: "kWh",
            points: [
              { ts: "2026-06-01T00:00:00Z", value: 12.4, qualityFlag: "ok" },
              { ts: "2026-06-01T01:00:00Z", value: 999, qualityFlag: "bad" },
            ],
          },
          isLoading: false,
          isError: false,
          error: undefined,
        },
      ],
      isLoading: false,
      isError: false,
      isEmpty: false,
    };
    render(<PowerTimeSeriesChart {...baseProps} />);
    expect(
      screen.queryByText("표시할 시계열 데이터가 없습니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("buildChartOption (quality_flag 시각 구분 로직)", () => {
  it("bad 포인트는 diamond 심볼 + 강조 itemStyle을 갖는다", () => {
    const option = buildChartOption(["t0", "t1"], [
      {
        name: "총전력",
        unit: "kWh",
        data: [
          { value: 12.4, qualityFlag: "ok" },
          { value: 999, qualityFlag: "bad" },
        ],
      },
    ]);
    const series = option.series as Array<{ data: Array<Record<string, unknown>> }>;
    const [okPoint, badPoint] = series[0].data;
    expect(okPoint.symbol).toBe("circle");
    expect(okPoint.itemStyle).toBeUndefined();
    expect(badPoint.symbol).toBe("diamond");
    expect(badPoint.itemStyle).toBeDefined();
  });
});
