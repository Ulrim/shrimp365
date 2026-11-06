import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import type { ControlAction, ControlActionListResponse } from "@/types/api";

/*
 * ControlConsolePage: viewer일 때 승인/적용/거부 버튼이 전혀 렌더되지 않는지,
 * approved 상태 항목에서만 적용 버튼이 노출되는지(pending에는 승인/거부만),
 * 409 응답 시 "이미 처리된 항목입니다. 새로고침해 주세요" 안내가 뜨는지 검증한다.
 */

const authState = { isViewer: false };
const listState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: ControlActionListResponse | undefined;
  refetch: ReturnType<typeof vi.fn>;
} = { isLoading: false, isError: false, error: null, data: undefined, refetch: vi.fn() };

const approveState: { mutate: ReturnType<typeof vi.fn>; isPending: boolean; error: unknown } = {
  mutate: vi.fn(),
  isPending: false,
  error: null,
};
const rejectState: { mutate: ReturnType<typeof vi.fn>; isPending: boolean; error: unknown } = {
  mutate: vi.fn(),
  isPending: false,
  error: null,
};
const applyState: { mutate: ReturnType<typeof vi.fn>; isPending: boolean; error: unknown } = {
  mutate: vi.fn(),
  isPending: false,
  error: null,
};
const proposeState = { mutate: vi.fn(), isPending: false, isError: false };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useControlActions", () => ({
  useControlActions: () => listState,
}));
vi.mock("@/hooks/useApproveControlAction", () => ({
  useApproveControlAction: () => approveState,
}));
vi.mock("@/hooks/useRejectControlAction", () => ({
  useRejectControlAction: () => rejectState,
}));
vi.mock("@/hooks/useApplyControlAction", () => ({
  useApplyControlAction: () => applyState,
}));
vi.mock("@/hooks/useProposeControlAction", () => ({
  useProposeControlAction: () => proposeState,
}));

import { ControlConsolePage } from "./ControlConsolePage";

function renderPage() {
  render(
    <MemoryRouter>
      <ControlConsolePage />
    </MemoryRouter>,
  );
}

const pendingAction: ControlAction = {
  id: "ca-1",
  tank_id: "tank-1",
  recipe_version_id: "rv-1",
  site_id: "demo-site",
  org_id: "org_1",
  recommended_json: { feed_kg_per_day: 10 },
  status: "pending",
  approved_by: null,
  approved_at: null,
  applied_at: null,
  result_json: null,
  created_at: "2026-07-10T00:00:00Z",
};

const approvedAction: ControlAction = {
  ...pendingAction,
  id: "ca-2",
  status: "approved",
  approved_by: "user_1",
  approved_at: "2026-07-11T00:00:00Z",
};

describe("ControlConsolePage", () => {
  beforeEach(() => {
    authState.isViewer = false;
    listState.isLoading = false;
    listState.isError = false;
    listState.error = null;
    listState.data = undefined;
    listState.refetch = vi.fn();
    approveState.mutate = vi.fn();
    approveState.isPending = false;
    approveState.error = null;
    rejectState.mutate = vi.fn();
    rejectState.isPending = false;
    rejectState.error = null;
    applyState.mutate = vi.fn();
    applyState.isPending = false;
    applyState.error = null;
    proposeState.mutate = vi.fn();
    proposeState.isPending = false;
    proposeState.isError = false;
  });

  it("viewer일 때는 승인/적용/거부 버튼이 렌더되지 않는다", () => {
    authState.isViewer = true;
    listState.data = { items: [pendingAction, approvedAction], total: 2 };
    renderPage();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "거부" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
    // 목록 자체는 조회 가능하다(조회만).
    expect(screen.getAllByText(/탱크 tank-1/).length).toBe(2);
  });

  it("pending 상태 항목에는 승인/거부 버튼만, 적용 버튼은 없다", () => {
    listState.data = { items: [pendingAction], total: 1 };
    renderPage();
    expect(screen.getByRole("button", { name: "승인" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "거부" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "적용" })).not.toBeInTheDocument();
  });

  it("approved 상태 항목에는 적용 버튼만 노출되고 승인/거부 버튼은 없다", () => {
    listState.data = { items: [approvedAction], total: 1 };
    renderPage();
    expect(screen.getByRole("button", { name: "적용" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "거부" })).not.toBeInTheDocument();
  });

  it("409 에러 시 경합 안내 문구를 표시한다", () => {
    listState.data = { items: [pendingAction], total: 1 };
    approveState.error = new ApiError(409, "invalid transition");
    renderPage();
    expect(
      screen.getByText("이미 처리된 항목입니다. 새로고침해 주세요."),
    ).toBeInTheDocument();
  });

  it("빈 목록이면 빈 상태 안내를 표시한다", () => {
    listState.data = { items: [], total: 0 };
    renderPage();
    expect(screen.getByText("해당 상태의 제어 항목이 없습니다.")).toBeInTheDocument();
  });
});
