import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import type { BaselineResponse } from "@/types/api";

/*
 * MrvReportGeneratePage: baseline 미잠금(null) 사전 안내, 생성 요청 404(경합) 시 동일 안내,
 * START 플랜(403) 안내가 각각 올바르게 분기되는지 검증한다.
 */

const authState = { canLockBaseline: true, isViewer: false };
const baselineState: {
  isLoading: boolean;
  data: BaselineResponse | null | undefined;
} = { isLoading: false, data: null };
const generateState: {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
} = { mutate: vi.fn(), isPending: false, isError: false, error: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useSiteBaseline", () => ({
  useSiteBaseline: () => baselineState,
}));
vi.mock("@/hooks/useGenerateMrvReport", () => ({
  useGenerateMrvReport: () => generateState,
}));
vi.mock("@/hooks/useEmissionFactors", () => ({
  useEmissionFactors: () => ({ data: undefined, isError: false }),
}));

import { MrvReportGeneratePage } from "./MrvReportGeneratePage";

function renderPage() {
  render(
    <MemoryRouter>
      <MrvReportGeneratePage />
    </MemoryRouter>,
  );
}

describe("MrvReportGeneratePage", () => {
  beforeEach(() => {
    authState.canLockBaseline = true;
    authState.isViewer = false;
    baselineState.isLoading = false;
    baselineState.data = null;
    generateState.mutate = vi.fn();
    generateState.isPending = false;
    generateState.isError = false;
    generateState.error = null;
  });

  it("baseline이 잠기지 않았으면(null) 사전에 '먼저 기준선을 잠가주세요' 안내를 표시하고 생성 버튼을 비활성화한다", () => {
    baselineState.data = null;
    renderPage();
    expect(screen.getByText("먼저 기준선을 잠가주세요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "기준선 잠금으로 이동" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "리포트 생성" })).toBeDisabled();
  });

  it("생성 요청이 404로 응답해도 동일한 baseline 안내를 표시한다", () => {
    baselineState.data = {
      id: "bsl-1",
      site_id: "demo-site",
      org_id: "org_1",
      period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z", granularity: "period" },
      status: "locked",
      metrics: {
        ei_total: null,
        ei_aeration: null,
        oei: null,
        fcr: null,
        mortality_rate: null,
      },
      kpi_config: { version: "2026.1.0" },
      provenance: { kpi_snapshot_id: null },
      locked_by: "user_1",
      locked_at: "2026-07-01T00:00:00Z",
    };
    generateState.isError = true;
    generateState.error = new ApiError(404, "baseline not locked");
    renderPage();
    expect(screen.getByText("먼저 기준선을 잠가주세요")).toBeInTheDocument();
  });

  it("생성 요청이 403(START 플랜)이면 PRO 안내 문구를 표시한다", () => {
    baselineState.data = {
      id: "bsl-1",
      site_id: "demo-site",
      org_id: "org_1",
      period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z", granularity: "period" },
      status: "locked",
      metrics: {
        ei_total: null,
        ei_aeration: null,
        oei: null,
        fcr: null,
        mortality_rate: null,
      },
      kpi_config: { version: "2026.1.0" },
      provenance: { kpi_snapshot_id: null },
      locked_by: "user_1",
      locked_at: "2026-07-01T00:00:00Z",
    };
    generateState.isError = true;
    generateState.error = new ApiError(403, "requires plan in ['ENTERPRISE', 'PRO']");
    renderPage();
    expect(
      screen.getByText("MRV 리포트 생성은 PRO 이상 요금제에서 제공됩니다."),
    ).toBeInTheDocument();
    expect(screen.queryByText("먼저 기준선을 잠가주세요")).not.toBeInTheDocument();
  });

  it("baseline이 이미 잠겨 있으면(null 아님) 사전 안내를 표시하지 않고 생성 버튼을 활성화한다", () => {
    baselineState.data = {
      id: "bsl-1",
      site_id: "demo-site",
      org_id: "org_1",
      period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z", granularity: "period" },
      status: "locked",
      metrics: {
        ei_total: null,
        ei_aeration: null,
        oei: null,
        fcr: null,
        mortality_rate: null,
      },
      kpi_config: { version: "2026.1.0" },
      provenance: { kpi_snapshot_id: null },
      locked_by: "user_1",
      locked_at: "2026-07-01T00:00:00Z",
    };
    renderPage();
    expect(screen.queryByText("먼저 기준선을 잠가주세요")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "리포트 생성" })).not.toBeDisabled();
  });

  it("생성 버튼 클릭 시 확인 다이얼로그가 열린다", () => {
    baselineState.data = {
      id: "bsl-1",
      site_id: "demo-site",
      org_id: "org_1",
      period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z", granularity: "period" },
      status: "locked",
      metrics: {
        ei_total: null,
        ei_aeration: null,
        oei: null,
        fcr: null,
        mortality_rate: null,
      },
      kpi_config: { version: "2026.1.0" },
      provenance: { kpi_snapshot_id: null },
      locked_by: "user_1",
      locked_at: "2026-07-01T00:00:00Z",
    };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "리포트 생성" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("MRV 리포트를 생성하시겠습니까?"),
    ).toBeInTheDocument();
  });
});
