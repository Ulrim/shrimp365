import { describe, expect, it } from "vitest";
import { aggregateReports, NO_PROCESS, type AggItem, type AggReport } from "@/components/work/outputs/aggregate";

const report = (id: string, author: string, date: string, patch: Partial<AggReport> = {}): AggReport => ({
  id, author_id: author, author_name: author, company: "컬리버", work_date: date, work_minutes: 480,
  notes: null, support_request: null, next_day_plan: null, ...patch,
});
const item = (report_id: string, patch: Partial<AggItem> = {}): AggItem => ({
  report_id, process_id: "p1", content: "작업", result: null, quantity: null, unit: null, status: "in_progress", ...patch,
});
const processes = [
  { id: "p1", name: "온실 골조", sort_order: 2 },
  { id: "p2", name: "기초공사", sort_order: 1 },
];

describe("보고서 자동 취합", () => {
  const result = aggregateReports({
    from: "2026-11-16",
    to: "2026-11-22",
    processes,
    reports: [
      report("r1", "박작업", "2026-11-16", { notes: "자재 지연" }),
      report("r2", "이시공", "2026-11-16", { work_minutes: 510 }),
      report("r3", "박작업", "2026-11-18", { support_request: "크레인 필요", next_day_plan: "기둥 검측" }),
      report("r4", "박작업", "2026-11-23"), // 기간 밖
    ],
    items: [
      item("r1", { quantity: 8, unit: "본" }),
      item("r2", { quantity: "4", unit: "본" }),
      item("r2", { process_id: "p2", quantity: 10, unit: "m", status: "delayed", content: "거푸집 해체" }),
      item("r3", { quantity: 3, unit: null }),
      item("r3", { process_id: null, content: "현장 정리" }),
      item("r4", { quantity: 100, unit: "본" }),
    ],
  });

  it("기간 안의 작업일보만 집계한다", () => {
    expect(result.personDays).toBe(3);
    expect(result.workDays).toBe(2);
    expect(result.totalMinutes).toBe(480 + 510 + 480);
  });

  it("일자별 인원·시간은 기간의 모든 날짜를 포함한다", () => {
    expect(result.daily).toHaveLength(7);
    expect(result.daily[0]).toEqual({ date: "2026-11-16", workers: 2, minutes: 990 });
    expect(result.daily[1]).toEqual({ date: "2026-11-17", workers: 0, minutes: 0 });
  });

  it("작업자별 근무일수와 시간을 합산한다", () => {
    const park = result.byWorker.find((w) => w.author_name === "박작업");
    expect(park).toMatchObject({ days: 2, minutes: 960 });
  });

  it("공정 순서대로 묶고, 단위가 있는 수량만 단위별로 합산한다", () => {
    expect(result.byProcess.map((p) => p.process_name)).toEqual(["기초공사", "온실 골조", NO_PROCESS]);
    const frame = result.byProcess.find((p) => p.process_id === "p1")!;
    expect(frame.rows).toHaveLength(3);
    expect(frame.totals).toEqual([{ unit: "본", quantity: 12 }]);
  });

  it("특이사항·지원 요청·지연 작업을 모은다", () => {
    expect(JSON.stringify(result)).toContain("자재 지연");
    expect(JSON.stringify(result)).toContain("크레인 필요");
    expect(JSON.stringify(result)).toContain("거푸집 해체");
    expect(JSON.stringify(result)).not.toContain('"quantity":100');
  });

  it("작업일보가 없으면 0으로 집계한다", () => {
    const empty = aggregateReports({ from: "2026-11-16", to: "2026-11-16", processes, reports: [], items: [] });
    expect(empty).toMatchObject({ personDays: 0, workDays: 0, totalMinutes: 0, byProcess: [], byWorker: [] });
  });
});
