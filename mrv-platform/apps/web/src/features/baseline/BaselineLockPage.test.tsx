import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BaselineResponse, KpiMetric } from "@/types/api";

/*
 * BaselineLockPage: 이미 잠긴(locked) 상태에서 잠금 버튼이 비활성인지 검증.
 * 훅은 계약 타입에 맞춰 mock(백엔드 미기동 무관).
 */

const authState = { canLockBaseline: true, isViewer: false };
const baselineState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: BaselineResponse | null;
} = { isLoading: false, isError: false, error: null, data: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useSiteBaseline", () => ({
  useSiteBaseline: () => baselineState,
}));
vi.mock("@/hooks/useLockBaseline", () => ({
  useLockBaseline: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("@/features/dashboard/hooks/useSiteKpi", () => ({
  useSiteKpi: () => ({ isLoading: false, isError: false, data: undefined }),
}));

import { BaselineLockPage } from "./BaselineLockPage";

const metric = (value: number | null, unit: string): KpiMetric => ({
  value,
  unit,
  status: value === null ? "na" : "green",
});

const lockedBaseline: BaselineResponse = {
  id: "bsl_1",
  site_id: "demo-site",
  org_id: "org_1",
  period: { from: "2026-04-01T00:00:00Z", to: "2026-05-01T00:00:00Z", granularity: "period" },
  status: "locked",
  metrics: {
    ei_total: metric(4.87, "kWh/kg"),
    ei_aeration: metric(2.31, "kWh/kg"),
    oei: metric(72.4, "index"),
    fcr: metric(1.42, "kg/kg"),
    mortality_rate: metric(6.1, "%"),
  },
  kpi_config: { version: "2026.1.0" },
  provenance: { kpi_snapshot_id: "snap_1" },
  locked_by: "user_1",
  locked_at: "2026-07-03T09:00:00Z",
};

describe("BaselineLockPage", () => {
  beforeEach(() => {
    authState.canLockBaseline = true;
    authState.isViewer = false;
    baselineState.isLoading = false;
    baselineState.isError = false;
    baselineState.data = null;
  });

  it("잠긴 상태에서 '잠금됨(불변)' 배지와 비활성 잠금 버튼을 표시한다", () => {
    baselineState.data = lockedBaseline;
    render(<BaselineLockPage />);

    expect(screen.getByText("잠금됨(불변)")).toBeInTheDocument();
    // 잠긴 스냅샷 값 표시(백엔드 값 그대로)
    expect(screen.getByText("4.87")).toBeInTheDocument();
    expect(screen.getByText("2026.1.0")).toBeInTheDocument();

    const lockButton = screen.getByRole("button", { name: /이미 잠김/ });
    expect(lockButton).toBeDisabled();
  });

  it("미잠금 상태에서는 잠금 버튼이 미리보기 전까지 비활성이다", () => {
    baselineState.data = null;
    render(<BaselineLockPage />);
    const lockButton = screen.getByRole("button", { name: "기준선 잠금" });
    expect(lockButton).toBeDisabled();
  });
});
