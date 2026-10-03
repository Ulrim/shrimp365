import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import type { RecommendationsResponse } from "@/types/api";

/*
 * RecommendationBoardPage: "추천만" 배지 고정 렌더, null params 카드의 "추천 불가" 표시,
 * rationale 텍스트 그대로 렌더, viewer일 때 수동 버전 추가 폼 숨김을 검증한다.
 */

const authState = { isViewer: false };
const recommendationsState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: RecommendationsResponse | undefined;
} = { isLoading: false, isError: false, error: null, data: undefined };
const addVersionState = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useSiteRecommendations", () => ({
  useSiteRecommendations: () => recommendationsState,
}));
vi.mock("@/hooks/useAddRecipeVersion", () => ({
  useAddRecipeVersion: () => addVersionState,
}));

import { RecommendationBoardPage } from "./RecommendationBoardPage";

function renderPage() {
  render(
    <MemoryRouter>
      <RecommendationBoardPage />
    </MemoryRouter>,
  );
}

const sampleResponse: RecommendationsResponse = {
  site_id: "demo-site",
  items: [
    {
      type: "feed",
      recipe_id: "recipe-feed-1",
      current_version: 12,
      params: { feed_kg_per_day: 48.5 },
      rationale: "최근 7일 FCR 추세 및 생체량 기준 급이량 3% 상향 권장",
      config_version: "2026.2.0",
      generated_at: "2026-07-07T00:00:00Z",
    },
    {
      type: "oxygen",
      recipe_id: "recipe-oxygen-1",
      current_version: 4,
      params: { oxygen_target_do_mg_l: null },
      rationale: "DO 샘플 부족으로 근거가 충분하지 않습니다",
      config_version: "2026.2.0",
      generated_at: "2026-07-07T00:00:00Z",
    },
    {
      type: "circulation",
      recipe_id: "recipe-circulation-1",
      current_version: 2,
      params: { circulation_setting: "normal" },
      rationale: "현재 순환 설정 유지 권장",
      config_version: "2026.2.0",
      generated_at: "2026-07-07T00:00:00Z",
    },
  ],
  status: "recommend_only",
};

describe("RecommendationBoardPage", () => {
  beforeEach(() => {
    authState.isViewer = false;
    recommendationsState.isLoading = false;
    recommendationsState.isError = false;
    recommendationsState.error = null;
    recommendationsState.data = undefined;
    addVersionState.isPending = false;
    addVersionState.isError = false;
    addVersionState.isSuccess = false;
  });

  it("'추천만' 배지를 항상 렌더한다(로딩 상태에서도)", () => {
    recommendationsState.isLoading = true;
    renderPage();
    expect(screen.getByText("추천만")).toBeInTheDocument();
  });

  it("403(플랜 부족)이면 PRO 안내를 표시하면서도 '추천만' 배지는 유지한다", () => {
    recommendationsState.isError = true;
    recommendationsState.error = new ApiError(403, "requires plan in ['ENTERPRISE', 'PRO']");
    renderPage();
    expect(screen.getByText("추천 보드를 사용할 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText("추천만")).toBeInTheDocument();
  });

  it("params 값이 null이면 '추천 불가(근거 부족)'를 렌더한다", () => {
    recommendationsState.data = sampleResponse;
    renderPage();
    expect(screen.getAllByText("추천 불가(근거 부족)").length).toBeGreaterThan(0);
  });

  it("rationale 텍스트를 그대로 렌더한다", () => {
    recommendationsState.data = sampleResponse;
    renderPage();
    expect(
      screen.getByText("최근 7일 FCR 추세 및 생체량 기준 급이량 3% 상향 권장"),
    ).toBeInTheDocument();
  });

  it("viewer이면 수동 버전 추가 폼을 숨긴다", () => {
    authState.isViewer = true;
    recommendationsState.data = sampleResponse;
    renderPage();
    expect(screen.queryByText("수동으로 새 버전 추가(고급)")).not.toBeInTheDocument();
    expect(screen.getAllByText(/읽기 전용 권한\(viewer\)입니다/).length).toBeGreaterThan(0);
  });

  it("owner/operator이면 수동 버전 추가 폼을 노출한다", () => {
    authState.isViewer = false;
    recommendationsState.data = sampleResponse;
    renderPage();
    expect(screen.getAllByText("수동으로 새 버전 추가(고급)").length).toBeGreaterThan(0);
  });
});
