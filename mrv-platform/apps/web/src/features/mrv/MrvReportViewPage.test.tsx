import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { MrvReportResponse } from "@/types/api";

/*
 * MrvReportViewPage: formula_text가 줄바꿈 유지 렌더되는지, 수치 클릭 시 drill-down 훅
 * (useKpiSnapshot)이 해당 kpi_snapshot_id로 호출되는지, config_version 차이 배지가 조건부로
 * 렌더되는지 검증한다(절대 규칙: 모든 숫자는 클릭 시 근거 데이터로 이동 가능해야 한다).
 */

const reportState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: MrvReportResponse | undefined;
} = { isLoading: false, isError: false, error: null, data: undefined };

const useKpiSnapshotMock = vi.fn((id: string | null) => {
  void id; // 인자는 호출 검증(toHaveBeenCalledWith)에만 쓰인다.
  return { isLoading: false, isError: false, error: null, data: undefined };
});

vi.mock("@/hooks/useMrvReport", () => ({
  useMrvReport: () => reportState,
}));
vi.mock("@/hooks/useKpiSnapshot", () => ({
  useKpiSnapshot: (id: string | null) => useKpiSnapshotMock(id),
}));

import { MrvReportViewPage } from "./MrvReportViewPage";

function renderPage(id = "mrv-1") {
  render(
    <MemoryRouter initialEntries={[`/mrv-reports/${id}`]}>
      <Routes>
        <Route path="/mrv-reports/:id" element={<MrvReportViewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function baseSummary(overrides: Partial<MrvReportResponse["before"]> = {}) {
  return {
    period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z", granularity: "period" },
    config_version: "2026.1.0",
    ei_total: 4.87,
    ei_aeration: 2.31,
    total_power_kwh: 12480.0,
    aeration_power_kwh: 5920.0,
    biomass_delta_kg: 2560.0,
    scope2_tco2e: 5.92,
    kpi_snapshot_id: "snap-before-1",
    ...overrides,
  };
}

const sampleReport: MrvReportResponse = {
  id: "mrv-1",
  site_id: "demo-site",
  org_id: "org_1",
  baseline_id: "bsl-1",
  period: { from: "2026-07-01T00:00:00Z", to: "2026-07-31T00:00:00Z", granularity: "period" },
  before: baseSummary(),
  after: baseSummary({
    ei_total: 4.1,
    scope2_tco2e: 4.5,
    kpi_snapshot_id: "snap-after-1",
    config_version: "2026.1.0",
  }),
  reduction_tco2e: 0.936,
  formula_text:
    "감축량 = (4.87 - 4.10) kWh/kg × 2560 kg / 1000 × 0.4747 tCO2e/MWh = 0.936 tCO2e\n(2줄째 근거 문구)",
  emission_factor: { version: "2024-GIR-v1", source: "GIR", year: 2024 },
  boundary: {
    site_id: "demo-site",
    site_name: "데모 사이트",
    included_meter_ids: ["mtr_power_main", "mtr_power_blower"],
    included_quality_flags: ["ok"],
    biomass_source_refs: { before: ["harvest-1"], after: ["harvest-2"] },
    config_version: { before: "2026.1.0", after: "2026.1.0" },
    assumptions: ["가정1", "가정2", "가정3"],
  },
  pdf_available: true,
  generated_by: "user_1",
  generated_at: "2026-07-31T09:00:00Z",
};

describe("MrvReportViewPage", () => {
  beforeEach(() => {
    reportState.isLoading = false;
    reportState.isError = false;
    reportState.error = null;
    reportState.data = undefined;
    useKpiSnapshotMock.mockClear();
    useKpiSnapshotMock.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: undefined,
    });
  });

  it("formula_text를 줄바꿈 유지해서 렌더한다", () => {
    reportState.data = sampleReport;
    renderPage();
    const pre = screen.getByTestId("mrv-formula-text");
    expect(pre.textContent).toBe(sampleReport.formula_text);
    expect(pre.textContent).toContain("\n");
  });

  it("Before 열의 수치를 클릭하면 해당 기간의 kpi_snapshot_id로 drill-down 훅을 호출한다", () => {
    reportState.data = sampleReport;
    renderPage();

    // 초기에는 아직 선택 안 됨(null) — 훅은 마운트 시점에 null로 최소 1회 호출된다.
    expect(useKpiSnapshotMock).toHaveBeenCalledWith(null);

    const beforeButton = screen.getByRole("button", { name: /4.87/ });
    fireEvent.click(beforeButton);

    expect(useKpiSnapshotMock).toHaveBeenCalledWith("snap-before-1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("After 열의 수치를 클릭하면 after의 kpi_snapshot_id로 drill-down 훅을 호출한다", () => {
    reportState.data = sampleReport;
    renderPage();

    const afterButton = screen.getByRole("button", { name: /4.10/ });
    fireEvent.click(afterButton);

    expect(useKpiSnapshotMock).toHaveBeenCalledWith("snap-after-1");
  });

  it("config_version이 before/after 다르면 '산식 버전 차이' 배지를 표시한다", () => {
    reportState.data = {
      ...sampleReport,
      boundary: {
        ...sampleReport.boundary,
        config_version: { before: "2026.1.0", after: "2026.2.0" },
      },
    };
    renderPage();
    expect(screen.getByText("산식 버전 차이")).toBeInTheDocument();
  });

  it("config_version이 같으면 배지를 표시하지 않는다", () => {
    reportState.data = sampleReport; // before === after === "2026.1.0"
    renderPage();
    expect(screen.queryByText("산식 버전 차이")).not.toBeInTheDocument();
  });

  it("reduction_tco2e가 양수면 '감축 달성'을 표시한다", () => {
    reportState.data = sampleReport;
    renderPage();
    expect(screen.getByText("감축 달성")).toBeInTheDocument();
  });

  it("reduction_tco2e가 null이면 '산출 불가'를 강조 표시한다", () => {
    reportState.data = { ...sampleReport, reduction_tco2e: null };
    renderPage();
    const badges = screen.getAllByText("산출 불가");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("404이면 리포트를 찾을 수 없다는 안내를 표시한다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    reportState.isError = true;
    reportState.error = new ApiError(404, "mrv report not found");
    renderPage();
    expect(screen.getByText("해당 MRV 리포트를 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("403이면 PRO/조직 안내를 표시한다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    reportState.isError = true;
    reportState.error = new ApiError(403, "cross-org");
    renderPage();
    expect(screen.getByText("이 리포트를 볼 수 없습니다")).toBeInTheDocument();
  });
});
