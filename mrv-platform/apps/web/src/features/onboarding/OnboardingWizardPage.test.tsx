import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { OnboardingStatus } from "@/types/api";

/*
 * OnboardingWizardPage: 각 단계의 done/미완료 배지가 GET onboarding-status 응답을 그대로
 * 반영하는지, 요금제 변경 버튼이 owner가 아니면 숨겨지는지 검증한다.
 */

const authState: { role: "owner" | "operator" | "viewer"; orgId: string; isViewer: boolean; canWriteLogs: boolean } = {
  role: "owner",
  orgId: "org_1",
  isViewer: false,
  canWriteLogs: true,
};
const planState = { plan: "START" as const };
const statusState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: OnboardingStatus | undefined;
} = {
  isLoading: false,
  isError: false,
  error: null,
  data: {
    steps: {
      install_kit: { done: true, detail: "api_keys 1개 이상 발급됨" },
      sensor_mapping: { done: true, detail: "meters 2개 등록됨" },
      baseline_locked: { done: false, detail: "잠긴 baseline 없음" },
      plan_active: { done: false, detail: "현재 플랜: START(무료/평가)" },
    },
    current_step: "baseline_locked",
  },
};
const metersState = { isLoading: false, isError: false, data: { items: [] } };
const sitesState = { data: { items: [{ id: "demo-site", name: "데모 사이트", region: "kr", ras_type: "shrimp" }], total: 1 } };
const updatePlanState = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => planState,
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  useOnboardingStatus: () => statusState,
}));
vi.mock("@/hooks/useSiteMeters", () => ({
  useSiteMeters: () => metersState,
}));
vi.mock("@/hooks/useSites", () => ({
  useSites: () => sitesState,
}));
vi.mock("@/hooks/useUpdateOrgPlan", () => ({
  useUpdateOrgPlan: () => updatePlanState,
}));
vi.mock("@/hooks/useCreateMeter", () => ({
  useCreateMeter: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null }),
}));

import { OnboardingWizardPage } from "./OnboardingWizardPage";

function renderPage() {
  render(
    <MemoryRouter>
      <OnboardingWizardPage />
    </MemoryRouter>,
  );
}

describe("OnboardingWizardPage", () => {
  beforeEach(() => {
    authState.role = "owner";
    updatePlanState.mutate = vi.fn();
  });

  it("각 단계의 완료/미완료 배지를 onboarding-status 응답 그대로 표시한다", () => {
    renderPage();
    const badges = screen.getAllByRole("status").map((el) => el.textContent);
    // install_kit·sensor_mapping = 완료, baseline_locked·plan_active = 미완료(순서대로).
    expect(badges.filter((t) => t === "완료")).toHaveLength(2);
    expect(badges.filter((t) => t === "미완료")).toHaveLength(2);
  });

  it("각 단계 detail 문구를 표시한다", () => {
    renderPage();
    expect(screen.getByText("api_keys 1개 이상 발급됨")).toBeInTheDocument();
    expect(screen.getByText("meters 2개 등록됨")).toBeInTheDocument();
    expect(screen.getByText("잠긴 baseline 없음")).toBeInTheDocument();
    expect(screen.getByText("현재 플랜: START(무료/평가)")).toBeInTheDocument();
  });

  it("owner이면 요금제 변경 버튼을 표시한다", () => {
    authState.role = "owner";
    renderPage();
    expect(screen.getByRole("button", { name: "PRO" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ENTERPRISE" })).toBeInTheDocument();
  });

  it("owner가 아니면(operator) 요금제 변경 버튼을 숨긴다", () => {
    authState.role = "operator";
    renderPage();
    expect(screen.queryByRole("button", { name: "PRO" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ENTERPRISE" })).not.toBeInTheDocument();
    expect(screen.getByText("요금제 변경은 owner만 가능합니다.")).toBeInTheDocument();
  });

  it("owner가 아니면(viewer) 요금제 변경 버튼을 숨긴다", () => {
    authState.role = "viewer";
    renderPage();
    expect(screen.queryByRole("button", { name: "PRO" })).not.toBeInTheDocument();
  });
});
