import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/*
 * NavBar: plan(usePlan)에 따라 "/comparison"·"/recommend" 링크 노출 여부를 검증한다
 * (phase-2 QA 갭 해소 — GET /auth/me 기반 선제 게이팅, MASTER 4장/CLAUDE.md 요금제 게이팅 규칙).
 * plan 로딩 중에는 깜빡임 방지를 위해 PRO 전용 항목을 렌더하지 않는다(확정 후 렌더).
 */

const planState: { plan: string | null; isLoading: boolean; isError: boolean; isPro: boolean; isEnterprise: boolean } = {
  plan: null,
  isLoading: true,
  isError: false,
  isPro: false,
  isEnterprise: false,
};

vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => planState,
}));

import { NavBar } from "./App";

function renderNavBar() {
  render(
    <MemoryRouter>
      <NavBar />
    </MemoryRouter>,
  );
}

describe("NavBar", () => {
  beforeEach(() => {
    planState.plan = null;
    planState.isLoading = true;
    planState.isError = false;
    planState.isPro = false;
    planState.isEnterprise = false;
  });

  it("plan 로딩 중에는 PRO 전용 링크(전·후 비교/추천 보드)를 렌더하지 않는다", () => {
    renderNavBar();
    expect(screen.queryByRole("link", { name: "전·후 비교" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "추천 보드" })).not.toBeInTheDocument();
    // 기본 항목은 로딩 여부와 무관하게 항상 노출된다.
    expect(screen.getByRole("link", { name: "개요" })).toBeInTheDocument();
  });

  it("plan=START이면 전·후 비교/추천 보드 링크가 없다", () => {
    planState.plan = "START";
    planState.isLoading = false;
    planState.isPro = false;
    renderNavBar();
    expect(screen.queryByRole("link", { name: "전·후 비교" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "추천 보드" })).not.toBeInTheDocument();
  });

  it("plan=PRO이면 전·후 비교/추천 보드 링크가 있다", () => {
    planState.plan = "PRO";
    planState.isLoading = false;
    planState.isPro = true;
    renderNavBar();
    expect(screen.getByRole("link", { name: "전·후 비교" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "추천 보드" })).toBeInTheDocument();
  });

  it("plan=ENTERPRISE이면 전·후 비교/추천 보드 링크가 있다", () => {
    planState.plan = "ENTERPRISE";
    planState.isLoading = false;
    planState.isPro = true;
    planState.isEnterprise = true;
    renderNavBar();
    expect(screen.getByRole("link", { name: "전·후 비교" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "추천 보드" })).toBeInTheDocument();
  });
});
