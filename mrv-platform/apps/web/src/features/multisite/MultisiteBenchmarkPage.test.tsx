import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { SiteKpiBenchmark } from "@/types/api";

/*
 * MultisiteBenchmarkPage: 정렬 동작(기본 EI 오름차순, 헤더 클릭 시 내림차순 토글)과
 * 빈 상태(site 0개) 렌더를 검증한다.
 */

const benchmarkState: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: SiteKpiBenchmark | undefined;
} = { isLoading: false, isError: false, error: null, data: undefined };

vi.mock("@/hooks/useSiteKpiBenchmark", () => ({
  useSiteKpiBenchmark: () => benchmarkState,
}));

import { MultisiteBenchmarkPage } from "./MultisiteBenchmarkPage";

function renderPage() {
  render(<MultisiteBenchmarkPage />);
}

function clickQuery() {
  fireEvent.click(screen.getByRole("button", { name: "조회하기" }));
}

const sampleBenchmark: SiteKpiBenchmark = {
  period: { from: "2026-07-01T00:00:00Z", to: "2026-07-31T00:00:00Z" },
  sites: [
    {
      site_id: "site-a",
      site_name: "A농장",
      config_version: "2026.2.0",
      metrics: { ei_total: 4.87, ei_aeration: 2.31, oei: 72.4, fcr: 1.42, mortality_rate: 6.1 },
    },
    {
      site_id: "site-b",
      site_name: "B농장",
      config_version: "2026.2.0",
      metrics: { ei_total: 4.1, ei_aeration: 1.95, oei: 78.9, fcr: 1.35, mortality_rate: 4.8 },
    },
  ],
};

function rowLabelsInOrder() {
  const rows = screen.getAllByRole("row").slice(1); // 헤더 제외
  return rows.map((row) => within(row).getAllByRole("cell")[0].textContent);
}

describe("MultisiteBenchmarkPage", () => {
  beforeEach(() => {
    benchmarkState.isLoading = false;
    benchmarkState.isError = false;
    benchmarkState.error = null;
    benchmarkState.data = undefined;
  });

  it("기본 정렬은 EI 오름차순(값이 작은 사이트가 먼저)이다", () => {
    benchmarkState.data = sampleBenchmark;
    renderPage();
    clickQuery();
    expect(rowLabelsInOrder()).toEqual(["B농장", "A농장"]);
  });

  it("같은 열 헤더를 다시 클릭하면 내림차순으로 토글된다", () => {
    benchmarkState.data = sampleBenchmark;
    renderPage();
    clickQuery();
    const eiHeaderButton = screen.getByRole("button", { name: /전력집약도\(EI\)/ });
    fireEvent.click(eiHeaderButton);
    expect(rowLabelsInOrder()).toEqual(["A농장", "B농장"]);
  });

  it("최우수 사이트 셀에 하이라이트 표시(★)가 붙는다", () => {
    benchmarkState.data = sampleBenchmark;
    renderPage();
    clickQuery();
    expect(screen.getAllByLabelText("최우수").length).toBeGreaterThan(0);
  });

  it("site가 0개이면 빈 상태 안내를 표시한다", () => {
    benchmarkState.data = { period: sampleBenchmark.period, sites: [] };
    renderPage();
    clickQuery();
    expect(screen.getByText("비교할 site가 없습니다.")).toBeInTheDocument();
  });
});
