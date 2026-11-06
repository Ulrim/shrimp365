import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "@/lib/api-client";

/*
 * RequireAuth 가드 (FED-3, ADR 0006 4절 / shrimp365-integration.md FED-3).
 *
 * 검증 축:
 *  - 미인증 → /login 리다이렉트(기존 동작 회귀 없음)
 *  - 인증 + /auth/me 403 또는 409 → NotInvitedPage(앱 셸/네비 미노출)
 *  - 인증 + 정상 → children 렌더(회귀 없음)
 *  - 로딩 중 → children 렌더(안내 화면이 성급히 뜨지 않는다 = 깜빡임 방지)
 *  - 401/네트워크 오류 → 이 가드가 다루지 않는다(children 유지)
 */

const authState = {
  isAuthenticated: true,
  sessionReady: true,
};

const meState: { data: unknown; error: unknown; isLoading: boolean } = {
  data: undefined,
  error: undefined,
  isLoading: false,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/hooks/useAuthMe", () => ({
  useAuthMe: () => meState,
  authMeQueryKey: ["auth-me"],
}));

vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({
    plan: "PRO",
    isLoading: false,
    isError: false,
    isPro: true,
    isEnterprise: false,
  }),
}));

vi.mock("@/lib/supabase-client", () => ({
  supabase: { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } },
  getCachedAccessToken: () => "test-token",
  isSessionReady: () => true,
  subscribeAccessToken: () => () => {},
}));

import { RequireAuth, NavBar } from "./App";

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route
          path="/protected"
          element={
            <RequireAuth>
              <div>
                <NavBar />
                <span>보호된 콘텐츠</span>
              </div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>로그인 화면</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.sessionReady = true;
    meState.data = undefined;
    meState.error = undefined;
    meState.isLoading = false;
  });

  it("세션 복원 전(sessionReady=false)에는 아무것도 렌더하지 않는다", () => {
    authState.sessionReady = false;
    const { container } = renderGuard();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("로그인 화면")).not.toBeInTheDocument();
  });

  it("미인증이면 /login으로 리다이렉트한다(회귀 없음)", () => {
    authState.isAuthenticated = false;
    renderGuard();
    expect(screen.getByText("로그인 화면")).toBeInTheDocument();
    expect(screen.queryByText("보호된 콘텐츠")).not.toBeInTheDocument();
  });

  it("/auth/me 200이면 children을 렌더한다(회귀 없음)", () => {
    meState.data = { org_id: "org-1", role: "owner", user_id: "u-1", plan: "PRO" };
    renderGuard();
    expect(screen.getByText("보호된 콘텐츠")).toBeInTheDocument();
    expect(screen.queryByText("이용 신청이 필요합니다")).not.toBeInTheDocument();
  });

  it("/auth/me 403이면 NotInvitedPage를 렌더하고 앱 셸(네비)을 노출하지 않는다", () => {
    meState.error = new ApiError(403, "no invitation found for this account");
    renderGuard();
    expect(screen.getByRole("heading", { name: "이용 신청이 필요합니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByText("보호된 콘텐츠")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주요 메뉴" })).not.toBeInTheDocument();
  });

  it("email 클레임 없는 계정(403)도 같은 안내 화면으로 보낸다", () => {
    meState.error = new ApiError(
      403,
      "account has no email claim; ask your administrator to link this account by supabase user id",
    );
    renderGuard();
    expect(screen.getByRole("heading", { name: "이용 신청이 필요합니다" })).toBeInTheDocument();
    expect(
      screen.getByText(/이메일이 제공되지 않는 경우에도 관리자가 직접 연결할 수 있습니다/),
    ).toBeInTheDocument();
  });

  it("/auth/me 409면 같은 화면 + 다중 조직 문구를 렌더한다", () => {
    meState.error = new ApiError(409, "multiple invitations found");
    renderGuard();
    expect(screen.getByRole("heading", { name: "이용 신청이 필요합니다" })).toBeInTheDocument();
    expect(screen.getByText(/둘 이상의 조직에 초대되어 있어/)).toBeInTheDocument();
    expect(screen.queryByText("보호된 콘텐츠")).not.toBeInTheDocument();
  });

  it("로딩 중에는 안내 화면이 뜨지 않는다(깜빡임 회귀 방지)", () => {
    meState.isLoading = true;
    renderGuard();
    expect(screen.getByText("보호된 콘텐츠")).toBeInTheDocument();
    expect(screen.queryByText("이용 신청이 필요합니다")).not.toBeInTheDocument();
  });

  it("401은 이 가드가 다루지 않는다(children 유지 — 세션 갱신/로그아웃 경로 담당)", () => {
    meState.error = new ApiError(401, "invalid token");
    renderGuard();
    expect(screen.getByText("보호된 콘텐츠")).toBeInTheDocument();
    expect(screen.queryByText("이용 신청이 필요합니다")).not.toBeInTheDocument();
  });

  it("ApiError가 아닌 오류(네트워크 등)로는 안내 화면을 띄우지 않는다", () => {
    meState.error = new Error("Failed to fetch");
    renderGuard();
    expect(screen.getByText("보호된 콘텐츠")).toBeInTheDocument();
    expect(screen.queryByText("이용 신청이 필요합니다")).not.toBeInTheDocument();
  });
});
