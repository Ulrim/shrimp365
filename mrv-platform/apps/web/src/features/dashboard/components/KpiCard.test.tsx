import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "./KpiCard";
import type { KpiCardProps } from "@/types/api";

const basePeriod = { from: "2026-06-01T00:00:00Z", to: "2026-06-30T23:59:59Z" };

function renderCard(overrides: Partial<KpiCardProps> = {}) {
  const props: KpiCardProps = {
    title: "전력집약도(EI)",
    metricKey: "ei_total",
    metric: { value: 4.87, unit: "kWh/kg", status: "green" },
    configVersion: "2026.1.0",
    period: basePeriod,
    betterWhen: "lower",
    ...overrides,
  };
  return render(<KpiCard {...props} />);
}

describe("KpiCard", () => {
  it("정상 값일 때 값 + 단위 + 산식 버전을 렌더한다", () => {
    renderCard();
    expect(screen.getByText("4.87")).toBeInTheDocument();
    expect(screen.getByText("kWh/kg")).toBeInTheDocument();
    // 증빙: 어떤 산식 버전으로 산출됐는지
    expect(screen.getByText(/2026\.1\.0/)).toBeInTheDocument();
    // 신호등은 색 + 텍스트로 의미 전달
    expect(screen.getByText("정상")).toBeInTheDocument();
    // 방향 표기
    expect(screen.getByText("낮을수록 좋은 지표")).toBeInTheDocument();
    // "산출 불가"는 나타나지 않아야 한다
    expect(screen.queryByText("산출 불가")).not.toBeInTheDocument();
  });

  it("value=null 이면 '산출 불가'를 렌더한다", () => {
    renderCard({
      metric: { value: null, unit: "kWh/kg", status: "na" },
    });
    // 상태 배지 + 본문 두 곳에 표기될 수 있으므로 최소 1개 이상
    expect(screen.getAllByText("산출 불가").length).toBeGreaterThan(0);
    // 값이 없으므로 단위 숫자는 표시되지 않는다
    expect(screen.queryByText("4.87")).not.toBeInTheDocument();
    // 산식 버전 증빙은 여전히 표기
    expect(screen.getByText(/2026\.1\.0/)).toBeInTheDocument();
  });

  it("metric===null 이면 '산출 불가'로 취급한다", () => {
    renderCard({ metric: null });
    expect(screen.getAllByText("산출 불가").length).toBeGreaterThan(0);
  });

  it("OEI(높을수록 좋음)는 EI와 다른 방향을 표기한다", () => {
    // phase-1 1절: OEI는 유일하게 "높을수록 좋음".
    renderCard({
      title: "산소효율지수(OEI)",
      metricKey: "oei",
      metric: { value: 72.4, unit: "index", status: "green" },
      betterWhen: "higher",
    });
    expect(screen.getByText("높을수록 좋은 지표")).toBeInTheDocument();
    // EI 방향 라벨이 잘못 붙지 않아야 한다.
    expect(screen.queryByText("낮을수록 좋은 지표")).not.toBeInTheDocument();
    expect(screen.getByText("index")).toBeInTheDocument();
  });
});
