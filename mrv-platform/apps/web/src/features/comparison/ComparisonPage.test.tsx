import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import type { ComparisonResponse } from "@/types/api";

/*
 * ComparisonPage: 404(baseline 미잠금)/403(플랜·권한 부족) 안내가 각각 다르게 렌더되는지,
 * config_version 차이일 때만 "산식 버전 차이" 배지가 뜨는지 검증.
 */

const authState = { isViewer: false };
const comparisonState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: ComparisonResponse | undefined;
} = { isLoading: false, isError: false, error: null, data: undefined };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useSiteComparison", () => ({
  useSiteComparison: () => comparisonState,
}));

import { ComparisonPage } from "./ComparisonPage";

function renderPage() {
  render(
    <MemoryRouter>
      <ComparisonPage />
    </MemoryRouter>,
  );
}

function clickCompare() {
  fireEvent.click(screen.getByRole("button", { name: "비교하기" }));
}

const sampleResponse: ComparisonResponse = {
  site_id: "demo-site",
  baseline: {
    period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z" },
    config_version: "2026.1.0",
    metrics: { ei_total: 4.87, ei_aeration: 2.31, oei: 72.4, fcr: 1.42, mortality_rate: 6.1 },
  },
  current: {
    period: { from: "2026-07-01T00:00:00Z", to: "2026-07-31T00:00:00Z" },
    config_version: "2026.2.0",
    metrics: { ei_total: 4.1, ei_aeration: 1.95, oei: 78.9, fcr: 1.35, mortality_rate: 4.8 },
  },
  comparison: {
    ei_total: { delta: -0.77, improvement_pct: 15.8, direction: "lower_is_better" },
    ei_aeration: { delta: -0.36, improvement_pct: 15.6, direction: "lower_is_better" },
    oei: { delta: 6.5, improvement_pct: 9.0, direction: "higher_is_better" },
    fcr: { delta: -0.07, improvement_pct: 4.9, direction: "lower_is_better" },
    mortality_rate: { delta: -1.3, improvement_pct: 21.3, direction: "lower_is_better" },
  },
  provenance: { baseline_id: "bsl-1", current_kpi_snapshot_id: null },
};

describe("ComparisonPage", () => {
  beforeEach(() => {
    authState.isViewer = false;
    comparisonState.isLoading = false;
    comparisonState.isError = false;
    comparisonState.error = null;
    comparisonState.data = undefined;
  });

  it("404(baseline 미잠금)이면 '먼저 기준선을 잠가주세요' 안내를 표시한다", () => {
    comparisonState.isError = true;
    comparisonState.error = new ApiError(404, "baseline not locked");
    renderPage();
    clickCompare();
    expect(screen.getByText("먼저 기준선을 잠가주세요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "기준선 잠금으로 이동" })).toBeInTheDocument();
  });

  it("403(플랜/권한 부족)이면 PRO 안내를 표시한다", () => {
    comparisonState.isError = true;
    comparisonState.error = new ApiError(403, "requires plan in ['ENTERPRISE', 'PRO']");
    renderPage();
    clickCompare();
    expect(screen.getByText("전·후 비교를 사용할 수 없습니다")).toBeInTheDocument();
    expect(
      screen.getByText(/PRO 이상 요금제에서 제공됩니다/),
    ).toBeInTheDocument();
  });

  it("403이고 viewer이면 viewer 전용 안내 문구를 표시한다", () => {
    authState.isViewer = true;
    comparisonState.isError = true;
    comparisonState.error = new ApiError(403, "viewer role cannot access comparison");
    renderPage();
    clickCompare();
    expect(
      screen.getByText("전·후 비교는 owner/operator만 볼 수 있습니다."),
    ).toBeInTheDocument();
  });

  it("config_version이 다르면 '산식 버전 차이' 배지를 표시한다", () => {
    comparisonState.data = sampleResponse;
    renderPage();
    clickCompare();
    expect(screen.getByText("산식 버전 차이")).toBeInTheDocument();
  });

  it("config_version이 같으면 배지를 표시하지 않는다", () => {
    comparisonState.data = {
      ...sampleResponse,
      current: { ...sampleResponse.current, config_version: "2026.1.0" },
    };
    renderPage();
    clickCompare();
    expect(screen.queryByText("산식 버전 차이")).not.toBeInTheDocument();
  });
});
