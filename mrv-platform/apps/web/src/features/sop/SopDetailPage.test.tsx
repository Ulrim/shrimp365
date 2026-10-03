import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { SopDetail } from "@/types/api";

/*
 * SopDetailPage: viewer일 때 체크리스트 제출 버튼이 비활성인지, owner/operator(canWriteLogs)일
 * 때는 활성인지 검증한다. 본문(마크다운) 렌더/이력 조회는 훅 mock으로 대체(백엔드 무관).
 */

const authState = { isViewer: false, canWriteLogs: true };
const detailState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: SopDetail | undefined;
} = {
  isLoading: false,
  isError: false,
  error: null,
  data: {
    id: "sop-1",
    title: "DO 저하 대응",
    category: "do_drop",
    body_markdown: "## 조치\n- 산소 공급 점검\n- 순환 강화",
    checklist_items: [
      { id: "item-1", label: "산소 공급 라인 확인" },
      { id: "item-2", label: "DO 센서 값 재확인" },
    ],
  },
};
const submitState = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null };
const historyState = { isLoading: false, isError: false, data: { items: [], total: 0 } };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useSopDetail", () => ({
  useSopDetail: () => detailState,
}));
vi.mock("@/hooks/useSubmitChecklistRun", () => ({
  useSubmitChecklistRun: () => submitState,
}));
vi.mock("@/hooks/useChecklistRuns", () => ({
  useChecklistRuns: () => historyState,
}));

import { SopDetailPage } from "./SopDetailPage";

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/sop/sop-1"]}>
      <Routes>
        <Route path="/sop/:id" element={<SopDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SopDetailPage", () => {
  beforeEach(() => {
    authState.isViewer = false;
    authState.canWriteLogs = true;
    submitState.mutate = vi.fn();
    submitState.isPending = false;
    submitState.isError = false;
    submitState.isSuccess = false;
  });

  it("viewer일 때 체크리스트 제출 버튼이 비활성이고 안내 문구를 표시한다", () => {
    authState.isViewer = true;
    authState.canWriteLogs = false;
    renderPage();

    expect(screen.getByRole("button", { name: "체크리스트 제출" })).toBeDisabled();
    expect(
      screen.getByText("읽기 전용 권한(viewer)입니다. 체크리스트 실행 기록 제출은 owner/operator만 가능합니다."),
    ).toBeInTheDocument();
    // 체크박스도 비활성이어야 한다.
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
  });

  it("owner/operator(canWriteLogs)일 때 체크리스트 제출 버튼이 활성이다", () => {
    authState.isViewer = false;
    authState.canWriteLogs = true;
    renderPage();

    expect(screen.getByRole("button", { name: "체크리스트 제출" })).not.toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeDisabled();
    }
  });

  it("본문(마크다운)과 체크리스트 항목 라벨을 렌더한다", () => {
    renderPage();
    expect(screen.getByText("DO 저하 대응")).toBeInTheDocument();
    expect(screen.getByText("조치")).toBeInTheDocument();
    expect(screen.getByText("산소 공급 라인 확인")).toBeInTheDocument();
    expect(screen.getByText("DO 센서 값 재확인")).toBeInTheDocument();
  });
});
