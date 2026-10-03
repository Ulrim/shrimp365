import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AuditLogListResponse } from "@/types/api";

/*
 * AuditLogPage: 필터 폼 입력 → 검색 클릭 시 useAuditLogs가 올바른 필터로 호출되는지,
 * diff가 pretty-print(<pre>)로 렌더되는지, 빈 상태를 검증한다.
 */

const useAuditLogsMock = vi.fn();
vi.mock("@/hooks/useAuditLogs", () => ({
  useAuditLogs: (...args: unknown[]) => useAuditLogsMock(...args),
}));

import { AuditLogPage } from "./AuditLogPage";

const emptyResponse: AuditLogListResponse = { items: [], total: 0 };

function renderPage() {
  render(<AuditLogPage />);
}

describe("AuditLogPage", () => {
  beforeEach(() => {
    useAuditLogsMock.mockReset();
    useAuditLogsMock.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: emptyResponse,
    });
  });

  it("초기 렌더 시 빈 필터로 useAuditLogs를 호출한다", () => {
    renderPage();
    expect(useAuditLogsMock).toHaveBeenCalledWith({});
  });

  it("entity/action/기간을 입력하고 검색하면 해당 필터로 재호출된다", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("entity"), { target: { value: "baselines" } });
    fireEvent.change(screen.getByLabelText("action"), { target: { value: "lock" } });
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-07-31" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    const calls = useAuditLogsMock.mock.calls;
    const lastCallArgs = calls[calls.length - 1]?.[0];
    expect(lastCallArgs.entity).toBe("baselines");
    expect(lastCallArgs.action).toBe("lock");
    expect(lastCallArgs.from).toBe("2026-07-01T00:00:00Z");
    expect(lastCallArgs.to).toBe("2026-07-31T23:59:59Z");
  });

  it("항목이 없으면 빈 상태 안내를 표시한다", () => {
    renderPage();
    expect(screen.getByText("조건에 해당하는 감사 로그가 없습니다.")).toBeInTheDocument();
  });

  it("diff는 접었다 펼 수 있는 pre 태그로 pretty-print 된다", () => {
    useAuditLogsMock.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      data: {
        items: [
          {
            id: "audit-1",
            entity: "baselines",
            entity_id: "bsl-1",
            action: "lock",
            actor_id: "user_1",
            diff: { before: null, after: { status: "locked" } },
            ts: "2026-07-10T00:00:00Z",
          },
        ],
        total: 1,
      },
    });
    renderPage();
    expect(screen.getByText("diff 보기")).toBeInTheDocument();
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("\"status\": \"locked\"");
  });
});
