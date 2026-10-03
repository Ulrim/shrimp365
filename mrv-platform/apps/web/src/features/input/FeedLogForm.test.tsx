import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/*
 * FeedLogForm 검증: feed_kg<=0 이면 제출을 거부하고 mutate를 호출하지 않는다.
 * 훅은 mock(백엔드/네트워크 무관).
 */

const mutate = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canWriteLogs: true, isViewer: false }),
}));
vi.mock("@/hooks/useCreateFeedLog", () => ({
  useCreateFeedLog: () => ({
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  }),
}));
// 배치 목록 빈 상태 → 직접 입력(text) 폴백으로 배치 ID 입력 가능.
vi.mock("@/hooks/useSiteBatches", () => ({
  useSiteBatches: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));

import { FeedLogForm } from "./FeedLogForm";

describe("FeedLogForm 검증", () => {
  beforeEach(() => mutate.mockClear());

  it("feed_kg<=0 이면 제출을 거부하고 오류를 표시한다", () => {
    render(<FeedLogForm siteId="demo-site" />);

    // 배치 ID 직접 입력(폴백)
    const batchInput = screen.getByPlaceholderText("배치 ID 직접 입력");
    fireEvent.change(batchInput, { target: { value: "batch_1" } });

    // 급이량 0 입력
    const feedInput = screen.getByLabelText(/급이량/);
    fireEvent.change(feedInput, { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: "급이 기록 저장" }));

    expect(
      screen.getByText("급이량(kg)은 0보다 큰 값이어야 합니다."),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("유효 입력(feed_kg>0)이면 mutate를 호출한다", () => {
    render(<FeedLogForm siteId="demo-site" />);

    fireEvent.change(screen.getByPlaceholderText("배치 ID 직접 입력"), {
      target: { value: "batch_1" },
    });
    fireEvent.change(screen.getByLabelText(/급이량/), {
      target: { value: "12.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "급이 기록 저장" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [body] = mutate.mock.calls[0];
    expect(body.batch_id).toBe("batch_1");
    expect(body.feed_kg).toBe(12.5);
    expect(typeof body.ts).toBe("string");
  });
});
