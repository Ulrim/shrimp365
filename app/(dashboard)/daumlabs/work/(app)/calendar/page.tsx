import type { Metadata } from "next";
import Link from "next/link";
import { EventDialog } from "@/components/work/calendar/event-dialog";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { PageHeader } from "@/components/work/ui/misc";
import { EVENT_TYPE, REPORT_STATUS, TASK_STATUS, workHref, type Tone } from "@/lib/work/constants";
import {
  addDays, addMonths, dayOfWeek, eachDay, endOfMonth, formatDate, formatShortDate, isDateString, startOfMonth, startOfWeek, today,
} from "@/lib/work/dates";
import { requireProject } from "@/lib/work/session";
import type { DailyReport, ScheduleEvent, Task } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "캘린더" };

const DOT: Record<Tone, string> = {
  gray: "bg-muted-foreground", green: "bg-emerald-500", blue: "bg-sky-500", amber: "bg-amber-500", red: "bg-red-500", purple: "bg-violet-500",
};
const CHIP: Record<Tone, string> = {
  gray: "dw-tone-gray", green: "dw-tone-green", blue: "dw-tone-blue",
  amber: "dw-tone-amber", red: "dw-tone-red", purple: "dw-tone-purple",
};
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; day?: string }>;
}) {
  const session = await requireProject();
  const { supabase, project, userId, isManager, isInternal } = session;
  const params = await searchParams;
  const now = today();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : now.slice(0, 7);
  const first = startOfMonth(`${month}-01`);
  const last = endOfMonth(first);
  // 협력업체는 전체 일정을 볼 수 없으므로 내 일정만 제공한다
  const view = isInternal && params.view !== "mine" ? "all" : "mine";
  const day = isDateString(params.day) && params.day.startsWith(month) ? params.day : now.startsWith(month) ? now : first;

  const gridStart = startOfWeek(first);
  const gridEnd = addDays(startOfWeek(last), 6);
  const days = eachDay(gridStart, gridEnd);

  let eventQuery = supabase
    .from("dw_schedule_events")
    .select("*")
    .eq("project_id", project.id)
    .lte("start_date", gridEnd)
    .gte("end_date", gridStart)
    .order("start_date");
  eventQuery = view === "mine" ? eventQuery.eq("owner_id", userId) : eventQuery.or(`owner_id.is.null,owner_id.eq.${userId}`);
  let taskQuery = supabase
    .from("dw_tasks")
    .select("*")
    .eq("project_id", project.id)
    .gte("due_date", gridStart)
    .lte("due_date", gridEnd)
    .order("due_date");
  if (view === "mine") taskQuery = taskQuery.eq("assignee_id", userId);

  const [events, tasks, reports, processes] = await Promise.all([
    eventQuery.returns<ScheduleEvent[]>(),
    taskQuery.returns<Task[]>(),
    supabase
      .from("dw_daily_reports")
      .select("id, work_date, status")
      .eq("project_id", project.id)
      .eq("author_id", userId)
      .gte("work_date", gridStart)
      .lte("work_date", gridEnd)
      .returns<Pick<DailyReport, "id" | "work_date" | "status">[]>(),
    supabase.from("dw_processes").select("id, name").eq("project_id", project.id).order("sort_order"),
  ]);
  const eventList = events.data ?? [];
  const taskList = tasks.data ?? [];
  const reportByDay = new Map((reports.data ?? []).map((r) => [r.work_date, r]));
  const processList = (processes.data ?? []) as { id: string; name: string }[];

  const assigneeIds = [...new Set(taskList.map((t) => t.assignee_id))];
  const { data: people } = assigneeIds.length
    ? await supabase.from("dw_profiles").select("id, full_name").in("id", assigneeIds)
    : { data: [] };
  const personName = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));

  const eventsOn = (d: string) => eventList.filter((e) => e.start_date <= d && e.end_date >= d);
  const tasksOn = (d: string) => taskList.filter((t) => t.due_date === d);

  const link = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string | undefined> = { month, view, day, ...patch };
    if (patch.month && !patch.day) next.day = undefined;
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${workHref("/calendar")}?${qs}`;
  };
  const chip = (active: boolean) =>
    cn(
      "flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium",
      active ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground",
    );

  const dayEvents = eventsOn(day);
  const dayTasks = tasksOn(day);
  const dayReport = reportByDay.get(day);
  const canEdit = (e: ScheduleEvent) => isManager || e.owner_id === userId;

  return (
    <>
      <PageHeader
        title="캘린더"
        description={view === "all" ? "사업장 전체 일정" : "내 일정 · 내 업무 · 내 작업일보"}
        action={<EventDialog defaultDate={day} isManager={isManager} processes={processList} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isInternal && (
          <>
            <Link href={link({ view: "all" })} className={chip(view === "all")}>전체 일정</Link>
            <Link href={link({ view: "mine" })} className={chip(view === "mine")}>내 일정</Link>
            <span className="mx-1 hidden h-5 w-px bg-muted-foreground/40 sm:block" />
          </>
        )}
        <div className="flex items-center gap-2">
          <Link href={link({ month: addMonths(first, -1).slice(0, 7) })} className={chip(false)} aria-label="이전 달">‹</Link>
          <span className="text-[15px] font-bold text-foreground" data-testid="calendar-month">{month.replace("-", "년 ")}월</span>
          <Link href={link({ month: addMonths(first, 1).slice(0, 7) })} className={chip(false)} aria-label="다음 달">›</Link>
          {month !== now.slice(0, 7) && (
            <Link href={link({ month: now.slice(0, 7), day: now })} className={chip(false)}>오늘</Link>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-muted text-center text-xs font-semibold text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={cn("py-2", i === 5 && "dw-fg-blue", i === 6 && "dw-fg-red")}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const inMonth = d.startsWith(month);
            const es = eventsOn(d);
            const ts = tasksOn(d);
            const report = reportByDay.get(d);
            const entries = [
              ...es.map((e) => ({ key: e.id, label: e.title, tone: EVENT_TYPE[e.event_type].tone })),
              ...ts.map((t) => ({ key: t.id, label: `마감 · ${t.title}`, tone: (t.status === "done" ? "gray" : d < now ? "red" : "amber") as Tone })),
            ];
            const dow = dayOfWeek(d);
            return (
              <Link
                key={d}
                href={link({ day: d, month: d.slice(0, 7) })}
                scroll={false}
                aria-label={`${formatDate(d)} 일정 ${entries.length}건`}
                aria-current={d === day ? "date" : undefined}
                data-date={d}
                className={cn(
                  "relative flex min-h-16 min-w-0 flex-col border-b border-r border-border p-1 md:min-h-28 md:p-1.5 [&:nth-child(7n)]:border-r-0",
                  !inMonth && "bg-muted/50",
                  d === day && "bg-brand-a10 ring-2 ring-inset ring-brand",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                      d === now ? "bg-brand text-white" : !inMonth ? "text-muted-foreground/60" : dow === 0 ? "dw-fg-red" : dow === 6 ? "dw-fg-blue" : "text-foreground",
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {report && (
                    <span
                      className={cn("size-2.5 rounded-full ring-2 ring-card", DOT[REPORT_STATUS[report.status].tone])}
                      title={`내 작업일보: ${REPORT_STATUS[report.status].label}`}
                    />
                  )}
                </div>
                {/* 모바일: 점으로 표시 */}
                <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                  {entries.slice(0, 4).map((e) => (
                    <span key={e.key} className={cn("size-1.5 rounded-full", DOT[e.tone])} />
                  ))}
                  {entries.length > 4 && <span className="text-[9px] leading-none text-muted-foreground">+{entries.length - 4}</span>}
                </div>
                {/* PC: 제목 표시 */}
                <div className="mt-1 hidden space-y-0.5 md:block">
                  {entries.slice(0, 3).map((e) => (
                    <span key={e.key} className={cn("block truncate rounded px-1 py-0.5 text-[11px] font-medium", CHIP[e.tone])}>
                      {e.label}
                    </span>
                  ))}
                  {entries.length > 3 && <span className="block px-1 text-[11px] text-muted-foreground">+{entries.length - 3}건</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>내 작업일보:</span>
        {(Object.keys(REPORT_STATUS) as (keyof typeof REPORT_STATUS)[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={cn("size-2 rounded-full", DOT[REPORT_STATUS[s].tone])} />
            {REPORT_STATUS[s].label}
          </span>
        ))}
      </p>

      <Card className="mt-4" data-testid="agenda">
        <CardHeader
          title={formatDate(day)}
          description={`일정 ${dayEvents.length}건 · 업무 마감 ${dayTasks.length}건`}
          action={
            dayReport ? (
              <Link href={workHref(`/reports/${dayReport.id}`)} className="flex items-center gap-1.5 text-sm font-medium text-brand-fg">
                내 작업일보 <StatusBadge map={REPORT_STATUS} value={dayReport.status} />
              </Link>
            ) : day <= now ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href={workHref(`/reports/new?date=${day}`)}>이 날짜 작업일보 작성</Link>
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-2">
          {dayEvents.length === 0 && dayTasks.length === 0 && <p className="text-sm text-muted-foreground">등록된 일정이 없습니다.</p>}
          {dayEvents.map((e) => (
            <div key={e.id} data-testid="agenda-event" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge map={EVENT_TYPE} value={e.event_type} />
                  {e.owner_id && <Badge tone="gray">{e.owner_id === userId ? "개인" : "구성원 개인 일정"}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {e.start_date === e.end_date ? formatShortDate(e.start_date) : `${formatShortDate(e.start_date)} ~ ${formatShortDate(e.end_date)}`}
                  </span>
                </div>
                <p className="mt-1 break-words text-[15px] font-semibold text-foreground">{e.title}</p>
                {e.description && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{e.description}</p>}
              </div>
              {canEdit(e) && <EventDialog event={e} defaultDate={day} isManager={isManager} processes={processList} />}
            </div>
          ))}
          {dayTasks.map((t) => (
            <Link key={t.id} href={workHref("/tasks")} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-accent">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={t.status !== "done" && day < now ? "red" : "amber"}>업무 마감</Badge>
                  <StatusBadge map={TASK_STATUS} value={t.status} />
                </div>
                <p className="mt-1 break-words text-[15px] font-semibold text-foreground">{t.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{personName.get(t.assignee_id) ?? "-"} · 진행률 {t.progress}%</p>
              </div>
            </Link>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
