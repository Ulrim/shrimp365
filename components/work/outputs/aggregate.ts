// 승인된 작업일보를 기간 단위로 취합하는 순수 함수 (DB 접근 없음, 단위 테스트 대상)
import { eachDay } from "@/lib/work/dates";
import type { ItemStatus } from "@/lib/work/types";

export interface AggReport {
  id: string;
  author_id: string;
  author_name: string;
  company: string | null;
  work_date: string;
  work_minutes: number;
  notes: string | null;
  support_request: string | null;
  next_day_plan: string | null;
}

export interface AggItem {
  report_id: string;
  process_id: string | null;
  sort_order?: number;
  content: string;
  result: string | null;
  quantity: number | string | null;
  unit: string | null;
  status: ItemStatus;
}

export interface AggProcess {
  id: string;
  name: string;
  sort_order: number;
}

export interface AggregateInput {
  from: string;
  to: string;
  /** 승인된 작업일보만 전달한다. 기간 밖의 작업일보는 무시한다. */
  reports: AggReport[];
  items: AggItem[];
  processes: AggProcess[];
}

export interface ProcessRow {
  date: string;
  author_name: string;
  content: string;
  result: string | null;
  quantity: number | null;
  unit: string | null;
  status: ItemStatus;
}

export interface NoteRow {
  date: string;
  author_name: string;
  text: string;
}

export interface ReportAggregate {
  /** 승인된 작업일보가 1건 이상 있는 날 수 */
  workDays: number;
  /** 연인원 = 승인된 작업일보 건수 */
  personDays: number;
  totalMinutes: number;
  daily: { date: string; workers: number; minutes: number }[];
  byProcess: {
    process_id: string | null;
    process_name: string;
    rows: ProcessRow[];
    /** 단위가 입력된 수량의 단위별 합계 */
    totals: { unit: string; quantity: number }[];
  }[];
  byWorker: { author_id: string; author_name: string; company: string | null; days: number; minutes: number }[];
  issues: NoteRow[];
  supportRequests: NoteRow[];
  nextDayPlans: NoteRow[];
  delayed: (ProcessRow & { process_name: string })[];
}

export const NO_PROCESS = "공정 미지정";

const hasText = (v: string | null | undefined): v is string => !!v && v.trim().length > 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateReports(input: AggregateInput): ReportAggregate {
  const reports = input.reports
    .filter((r) => r.work_date >= input.from && r.work_date <= input.to)
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.author_name.localeCompare(b.author_name, "ko"));
  const byId = new Map(reports.map((r) => [r.id, r]));

  const daily = eachDay(input.from, input.to).map((date) => {
    const list = reports.filter((r) => r.work_date === date);
    return { date, workers: list.length, minutes: list.reduce((sum, r) => sum + r.work_minutes, 0) };
  });

  const workers = new Map<string, ReportAggregate["byWorker"][number]>();
  for (const r of reports) {
    const w = workers.get(r.author_id) ?? { author_id: r.author_id, author_name: r.author_name, company: r.company, days: 0, minutes: 0 };
    w.days += 1;
    w.minutes += r.work_minutes;
    workers.set(r.author_id, w);
  }

  const processOf = new Map(input.processes.map((p) => [p.id, p]));
  const groups = new Map<string, ReportAggregate["byProcess"][number] & { order: number; sums: Map<string, number> }>();
  const delayed: ReportAggregate["delayed"] = [];
  const items = input.items
    .filter((i) => byId.has(i.report_id))
    .map((i) => ({ item: i, report: byId.get(i.report_id)! }))
    .sort(
      (a, b) =>
        a.report.work_date.localeCompare(b.report.work_date) ||
        a.report.author_name.localeCompare(b.report.author_name, "ko") ||
        (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0),
    );
  for (const { item, report } of items) {
    const process = item.process_id ? processOf.get(item.process_id) : undefined;
    const key = process?.id ?? "";
    const group =
      groups.get(key) ??
      {
        process_id: process?.id ?? null,
        process_name: process?.name ?? NO_PROCESS,
        rows: [],
        totals: [],
        order: process ? process.sort_order : Number.MAX_SAFE_INTEGER,
        sums: new Map<string, number>(),
      };
    const quantity = item.quantity == null || item.quantity === "" ? null : Number(item.quantity);
    const unit = hasText(item.unit) ? item.unit.trim() : null;
    const row: ProcessRow = {
      date: report.work_date,
      author_name: report.author_name,
      content: item.content,
      result: item.result,
      quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
      unit,
      status: item.status,
    };
    group.rows.push(row);
    if (row.quantity != null && unit) group.sums.set(unit, (group.sums.get(unit) ?? 0) + row.quantity);
    groups.set(key, group);
    if (item.status === "delayed") delayed.push({ ...row, process_name: group.process_name });
  }
  const byProcess = [...groups.values()]
    .sort((a, b) => a.order - b.order || a.process_name.localeCompare(b.process_name, "ko"))
    .map(({ order: _order, sums, ...group }) => ({
      ...group,
      totals: [...sums.entries()].map(([unit, quantity]) => ({ unit, quantity: round2(quantity) })),
    }));

  const notes = (pick: (r: AggReport) => string | null): NoteRow[] =>
    reports.flatMap((r) => {
      const text = pick(r);
      return hasText(text) ? [{ date: r.work_date, author_name: r.author_name, text: text.trim() }] : [];
    });

  return {
    workDays: daily.filter((d) => d.workers > 0).length,
    personDays: reports.length,
    totalMinutes: reports.reduce((sum, r) => sum + r.work_minutes, 0),
    daily,
    byProcess,
    byWorker: [...workers.values()].sort((a, b) => a.author_name.localeCompare(b.author_name, "ko")),
    issues: notes((r) => r.notes),
    supportRequests: notes((r) => r.support_request),
    nextDayPlans: notes((r) => r.next_day_plan),
    delayed,
  };
}

export type OutputType = "daily" | "weekly" | "monthly";
