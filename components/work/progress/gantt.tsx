import { formatPercent } from "@/components/work/ui/misc";
import { addDays, addMonths, diffDays, endOfMonth, formatDate, startOfMonth } from "@/lib/work/dates";
import type { ProcessStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";
import { PROCESS_STATE, processState } from "./status";

const NAME_WIDTH = 132;
const MONTH_WIDTH = 84;

/**
 * 공정별 간트차트. 위 막대는 계획 기간, 아래 막대는 실적(진행 중이면 계획 기간에 실적률을 곱한 길이,
 * 완료되면 실제 시작~종료)이다. 같은 내용을 아래 '계획 대비 실적' 표로도 제공한다.
 */
export function Gantt({ processes, today }: { processes: ProcessStatus[]; today: string }) {
  if (processes.length === 0) return null;
  const dates = processes.flatMap((p) => [p.planned_start, p.planned_end, p.actual_start, p.actual_end]).filter(Boolean) as string[];
  dates.push(today);
  const start = startOfMonth(dates.reduce((a, b) => (a < b ? a : b)));
  const end = endOfMonth(dates.reduce((a, b) => (a > b ? a : b)));
  const total = diffDays(start, end) + 1;
  const months: string[] = [];
  for (let m = start; m <= end; m = addMonths(m, 1)) months.push(m);
  // 날짜의 시작 지점(%)과 기간의 너비(%)
  const left = (date: string) => (diffDays(start, date) / total) * 100;
  const width = (from: string, to: string) => (Math.max(1, diffDays(from, to) + 1) / total) * 100;
  const trackWidth = months.length * MONTH_WIDTH;

  return (
    <div>
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="범례">
        <li className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-sm bg-muted-foreground/40" />계획</li>
        <li className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-sm bg-brand" />실적</li>
        <li className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-sm bg-red-500" />실적(지연)</li>
        <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" />오늘</li>
      </ul>
      <div className="overflow-x-auto rounded-lg border border-border" data-testid="gantt-scroll" tabIndex={0} role="group" aria-label="공정별 간트차트 (좌우로 스크롤)">
        <div style={{ width: NAME_WIDTH + trackWidth, minWidth: "100%" }}>
          {/* 월 눈금 */}
          <div className="flex border-b border-border bg-muted text-xs font-medium text-muted-foreground">
            <div className="sticky left-0 z-10 shrink-0 border-r border-border bg-muted px-3 py-2" style={{ width: NAME_WIDTH }}>
              공정
            </div>
            <div className="relative flex-1">
              <div className="flex h-full">
                {months.map((m) => (
                  <div key={m} className="border-r border-border px-2 py-2 last:border-r-0" style={{ width: `${width(m, endOfMonth(m))}%` }}>
                    {m.slice(5, 7) === "01" || m === start ? `${m.slice(2, 4)}.${Number(m.slice(5, 7))}월` : `${Number(m.slice(5, 7))}월`}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* 공정 행 */}
          {processes.map((p) => {
            const state = processState(p, today);
            const progress = Number(p.progress);
            const plannedDays = diffDays(p.planned_start, p.planned_end) + 1;
            let actual: { from: string; to: string } | null = null;
            if (p.actual_start && p.actual_end) {
              actual = { from: p.actual_start, to: p.actual_end };
            } else if (progress > 0) {
              const from = p.actual_start ?? p.planned_start;
              actual = { from, to: addDays(from, Math.max(1, Math.round((plannedDays * progress) / 100)) - 1) };
            }
            const labelAt = Math.max(left(p.planned_end) + width(p.planned_end, p.planned_end), actual ? left(actual.to) + width(actual.to, actual.to) : 0);
            const labelLeft = labelAt > 88;
            return (
              <div key={p.id} className="flex border-b border-border last:border-b-0" data-testid="gantt-row">
                <div
                  className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-border bg-card px-3 py-2"
                  style={{ width: NAME_WIDTH }}
                >
                  <span className="truncate text-[13px] font-semibold text-foreground" title={p.name}>{p.name}</span>
                  <span className={cn("text-[11px]", state === "delayed" ? "font-semibold dw-fg-red" : "text-muted-foreground")}>
                    {PROCESS_STATE[state].label} · 가중치 {Number(p.weight)}
                  </span>
                </div>
                <div
                  className={cn("relative h-12 flex-1", state === "delayed" && "bg-red-500/10")}
                  title={`${p.name}\n계획 ${formatDate(p.planned_start, false)} ~ ${formatDate(p.planned_end, false)} (계획 ${formatPercent(p.planned_progress)})\n실적 ${formatPercent(progress)}${p.actual_start ? ` · 착수 ${formatDate(p.actual_start, false)}` : ""}${p.actual_end ? ` · 완료 ${formatDate(p.actual_end, false)}` : ""}`}
                >
                  {months.slice(1).map((m) => (
                    <span key={m} className="absolute inset-y-0 w-px bg-border" style={{ left: `${left(m)}%` }} aria-hidden />
                  ))}
                  <span
                    className="absolute top-3 h-2.5 rounded-sm bg-muted-foreground/40"
                    style={{ left: `${left(p.planned_start)}%`, width: `${width(p.planned_start, p.planned_end)}%` }}
                  />
                  {actual && (
                    <span
                      className={cn("absolute top-[26px] h-2.5 rounded-sm", state === "delayed" ? "bg-red-500" : "bg-brand")}
                      style={{ left: `${left(actual.from)}%`, width: `${width(actual.from, actual.to)}%` }}
                    />
                  )}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap px-1.5 text-[11px] font-semibold text-foreground"
                    style={labelLeft ? { right: `${100 - left(p.planned_start)}%` } : { left: `${labelAt}%` }}
                  >
                    {formatPercent(progress)}
                  </span>
                  <span className="absolute inset-y-0 w-0.5 bg-foreground/80" style={{ left: `${left(today)}%` }} aria-hidden />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">기준일 {formatDate(today)} · 막대에 마우스를 올리면 상세 기간이 표시됩니다.</p>
    </div>
  );
}
