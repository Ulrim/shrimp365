import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AlertsResponse } from "@/types/api";

/*
 * AlertCenterPage: viewer일 때 ack 버튼이 숨겨지는지, 빈 목록 상태가 표시되는지 검증.
 * 훅은 계약 타입에 맞춰 mock(백엔드 미기동 무관).
 */

const authState = { canWriteLogs: true, isViewer: false };
const alertsState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: AlertsResponse | undefined;
} = { isLoading: false, isError: false, error: null, data: undefined };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useSiteAlerts", () => ({
  useSiteAlerts: () => alertsState,
}));
vi.mock("@/hooks/useAckAlert", () => ({
  useAckAlert: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("@/hooks/useUpdateAlertSubscriptions", () => ({
  useUpdateAlertSubscriptions: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AlertCenterPage } from "./AlertCenterPage";

const sampleAlert: AlertsResponse = {
  site_id: "demo-site",
  org_id: "org_1",
  items: [
    {
      id: "alert-1",
      type: "kpi_red",
      severity: "critical",
      payload: { metric: "fcr", value: 1.72, threshold: 1.6 },
      status: "open",
      created_at: "2026-07-07T09:00:00Z",
      acked_by: null,
      acked_at: null,
    },
  ],
  total: 1,
};

describe("AlertCenterPage", () => {
  beforeEach(() => {
    authState.canWriteLogs = true;
    authState.isViewer = false;
    alertsState.isLoading = false;
    alertsState.isError = false;
    alertsState.data = undefined;
  });

  it("빈 목록이면 '알림이 없습니다' 안내를 표시한다", () => {
    alertsState.data = { site_id: "demo-site", org_id: "org_1", items: [], total: 0 };
    render(<AlertCenterPage />);
    expect(screen.getByText("해당 상태의 알림이 없습니다.")).toBeInTheDocument();
  });

  it("owner/operator에게는 확인 처리 버튼이 보인다", () => {
    alertsState.data = sampleAlert;
    render(<AlertCenterPage />);
    expect(screen.getByRole("button", { name: "확인 처리" })).toBeInTheDocument();
  });

  it("viewer에게는 확인 처리 버튼이 숨겨진다", () => {
    authState.isViewer = true;
    authState.canWriteLogs = false;
    alertsState.data = sampleAlert;
    render(<AlertCenterPage />);
    expect(screen.queryByRole("button", { name: "확인 처리" })).not.toBeInTheDocument();
    expect(
      screen.getByText("읽기 전용 권한(viewer)입니다. 구독 설정 변경은 owner/operator만 가능합니다."),
    ).toBeInTheDocument();
  });

  it("알림 유형/심각도 라벨을 한국어로 표시한다", () => {
    alertsState.data = sampleAlert;
    render(<AlertCenterPage />);
    expect(screen.getAllByText("KPI 위험(red)").length).toBeGreaterThan(0);
    expect(screen.getByText("심각")).toBeInTheDocument();
  });
});
