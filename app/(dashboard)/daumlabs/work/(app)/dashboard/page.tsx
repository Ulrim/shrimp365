import { AlertTriangle, ChevronRight, PencilLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatCard } from "@/components/work/dashboard/stat-card";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { EmptyState, formatPercent, PageHeader, ProgressBar } from "@/components/work/ui/misc";
import { EVENT_TYPE, REPORT_STATUS, ROLE_LABEL, TASK_PRIORITY, TASK_STATUS, workHref } from "@/lib/work/constants";
import { addDays, diffDays, formatDate, formatShortDate, today as kstToday } from "@/lib/work/dates";
import { requireProject } from "@/lib/work/session";
import type { DailyReport, ProcessStatus, ReportStatus, ScheduleEvent, Task } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "대시보드" };

interface SubmissionRow {
  user_id: string;
  full_name: string;
  company: string | null;
  role: "site_manager" | "site_worker";
  report_id: string | null;
  status: ReportStatus | null;
}
type IssueReport = Pick<DailyReport, "id" | "author_id" | "work_date" | "notes" | "support_request">;
interface DelayedItem {
  id: string;
  content: string;
  report_id: string;
  daily_reports: { work_date: string; author_id: string };
}
interface Issue {
  key: string;
  kind: "특이사항" | "지원 요청" | "작업 지연";
  tone: "amber" | "blue" | "red";
  text: string;
  reportId: string;
  date: string;
  authorId: string;
}

const MoreLink = ({ href, label = "전체 보기" }: { href: string; label?: string }) => (
  <Link href={href} className="flex items-center text-xs font-medium text-brand-fg hover:underline">
    {label}
    <ChevronRight className="size-3.5" aria-hidden />
  </Link>
);

export default async function DashboardPage() {
  const session = await requireProject();
  const { supabase, project, userId, isManager, isInternal, profile } = session;
  const today = kstToday();
  const weekAgo = addDays(today, -6);

  const [myReport, myTasks, events, todayReports, issueReports, delayedItems, overallRows, processRows, submissionRows, overdue, pendingReports, pendingChanges] =
    await Promise.all([
      supabase.from("dw_daily_reports").select("id, status").eq("project_id", project.id).eq("author_id", userId).eq("work_date", today).maybeSingle<Pick<DailyReport, "id" | "status">>(),
      supabase.from("dw_tasks").select("*").eq("project_id", project.id).eq("assignee_id", userId).neq("status", "done").order("due_date", { nullsFirst: false }).limit(6).returns<Task[]>(),
      supabase.from("dw_schedule_events").select("*").eq("project_id", project.id).lte("start_date", addDays(today, 7)).gte("end_date", today).order("start_date").limit(6).returns<ScheduleEvent[]>(),
      supabase.from("dw_daily_reports").select("author_id, status").eq("project_id", project.id).eq("work_date", today).in("status", ["submitted", "approved"]).returns<Pick<DailyReport, "author_id" | "status">[]>(),
      supabase.from("dw_daily_reports").select("id, author_id, work_date, notes, support_request").eq("project_id", project.id).gte("work_date", weekAgo).neq("status", "draft").or("notes.not.is.null,support_request.not.is.null").order("work_date", { ascending: false }).limit(20).returns<IssueReport[]>(),
      supabase.from("dw_report_items").select("id, content, report_id, daily_reports:dw_daily_reports!inner(work_date, author_id, status)").eq("project_id", project.id).eq("status", "delayed").gte("daily_reports.work_date", weekAgo).neq("daily_reports.status", "draft").limit(20).returns<DelayedItem[]>(),
      // 아래는 내부 구성원 전용 (협력업체는 조회하지 않는다)
      isInternal ? supabase.rpc("dw_project_progress", { p_project: project.id }) : null,
      isInternal ? supabase.from("dw_process_status").select("*").eq("project_id", project.id).order("sort_order").returns<ProcessStatus[]>() : null,
      isInternal ? supabase.rpc("dw_submission_status", { p_project: project.id, p_date: today }) : null,
      isInternal ? supabase.from("dw_tasks").select("*").eq("project_id", project.id).neq("status", "done").lt("due_date", today).order("due_date").limit(10).returns<Task[]>() : null,
      isManager ? supabase.from("dw_daily_reports").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "submitted") : null,
      isManager ? supabase.from("dw_change_requests").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "pending") : null,
    ]);

  // 주요 이슈: 최근 7일 특이사항·지원 요청·지연으로 보고된 작업내역
  const issues: Issue[] = [];
  for (const r of issueReports.data ?? []) {
    if (r.notes?.trim()) issues.push({ key: `n-${r.id}`, kind: "특이사항", tone: "amber", text: r.notes, reportId: r.id, date: r.work_date, authorId: r.author_id });
    if (r.support_request?.trim()) issues.push({ key: `s-${r.id}`, kind: "지원 요청", tone: "blue", text: r.support_request, reportId: r.id, date: r.work_date, authorId: r.author_id });
  }
  for (const item of delayedItems.data ?? []) {
    issues.push({ key: `d-${item.id}`, kind: "작업 지연", tone: "red", text: item.content, reportId: item.report_id, date: item.daily_reports.work_date, authorId: item.daily_reports.author_id });
  }
  issues.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const shownIssues = issues.slice(0, 8);

  const overdueTasks = overdue?.data ?? [];
  const personIds = [...new Set([...shownIssues.map((i) => i.authorId), ...overdueTasks.map((t) => t.assignee_id)])];
  const { data: people } = personIds.length ? await supabase.from("dw_profiles").select("id, full_name").in("id", personIds) : { data: [] };
  const personName = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));

  const overall = (overallRows?.data as { actual: number; planned: number }[] | null | undefined)?.[0];
  const actual = Number(overall?.actual ?? 0);
  const planned = Number(overall?.planned ?? 0);
  const gap = actual - planned;
  const processes = processRows?.data ?? [];
  const delayedProcesses = processes.filter((p) => p.is_delayed);
  const submissions = (submissionRows?.data as SubmissionRow[] | null | undefined) ?? [];
  const missing = submissions.filter((s) => !s.status || s.status === "draft" || s.status === "revision_requested");
  const workerCount = new Set((todayReports.data ?? []).map((r) => r.author_id)).size;
  const reviewCount = (pendingReports?.count ?? 0) + (pendingChanges?.count ?? 0);
  const delayCount = delayedProcesses.length + overdueTasks.length;

  const report = myReport.data;
  const canContinue = !report || report.status === "draft" || report.status === "revision_requested";
  const reportHref = workHref(!report ? "/reports/new" : canContinue ? `/reports/${report.id}/edit` : `/reports/${report.id}`);
  const reportLabel = !report ? "오늘 작업일보 작성" : report.status === "draft" ? "작업일보 이어쓰기" : report.status === "revision_requested" ? "작업일보 보완하기" : "오늘 작업일보 보기";

  return (
    <>
      <PageHeader title="대시보드" description={`${formatDate(today)} · ${project.name}`} />

      {/* 오늘 작업일보 */}
      <Card className={cn("mb-4 border-brand-a25", canContinue ? "bg-brand-a10" : "bg-card")} data-testid="my-report-card">
        <div className="flex flex-wrap items-center gap-3 p-4 md:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-brand-fg">{profile.full_name}님의 오늘 작업일보</p>
            <div className="mt-1 flex items-center gap-2">
              {report ? <StatusBadge map={REPORT_STATUS} value={report.status} /> : <Badge tone="red">미작성</Badge>}
              <span className="text-sm text-foreground">
                {!report ? "아직 작성하지 않았습니다." : report.status === "draft" ? "임시저장 상태입니다. 제출해 주세요." : report.status === "revision_requested" ? "관리자가 보완을 요청했습니다." : report.status === "submitted" ? "관리자 검토를 기다리고 있습니다." : "승인이 완료되었습니다."}
              </span>
            </div>
          </div>
          <Button asChild size="lg" variant={canContinue ? "primary" : "outline"} className="w-full sm:w-auto">
            <Link href={reportHref}>
              {canContinue && <PencilLine />}
              {reportLabel}
            </Link>
          </Button>
        </div>
      </Card>

      {isInternal ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="전체 공정률" value={formatPercent(actual)} sub={`계획 ${formatPercent(planned)}`} href={workHref("/progress")} tone="good" testId="stat-progress" />
            <StatCard
              label="금일 작업인원"
              value={workerCount}
              unit="명"
              sub={isManager ? "제출·승인된 작업일보 기준" : "승인된 작업일보 기준"}
              href={workHref(isManager ? "/reviews" : "/reports?scope=all")}
              testId="stat-workers"
            />
            <StatCard label="작업일보 미제출" value={missing.length} unit="명" sub={`대상 ${submissions.length}명`} tone={missing.length > 0 ? "warn" : "default"} testId="stat-missing" />
            {isManager ? (
              <StatCard label="검토 대기" value={reviewCount} unit="건" sub="제출된 일보·수정 요청" href={workHref("/reviews")} tone={reviewCount > 0 ? "warn" : "default"} testId="stat-review" />
            ) : (
              <StatCard label="지연 일정" value={delayCount} unit="건" sub="공정·업무 합계" tone={delayCount > 0 ? "alert" : "default"} />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 공정률 */}
            <Card className="lg:col-span-2">
              <CardHeader title="공정률" description="공정별 가중치 기준 · 세로선은 계획" action={<MoreLink href={workHref("/progress")} label="공정 관리" />} />
              <CardBody>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">실적</p>
                    <p className="font-mono text-4xl font-bold tracking-tight text-brand-fg">{formatPercent(actual)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">계획</p>
                    <p className="text-xl font-semibold text-foreground">{formatPercent(planned)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">차이</p>
                    <p className={cn("flex items-center gap-1 text-xl font-semibold", gap < 0 ? "dw-fg-red" : "text-foreground")}>
                      {gap < 0 && <AlertTriangle className="size-4" aria-hidden />}
                      {gap > 0 ? "+" : ""}{Number(gap.toFixed(1))}%p
                    </p>
                  </div>
                </div>
                <ProgressBar value={actual} planned={planned} className="mt-3 h-3" />
                {processes.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">등록된 공정이 없습니다.</p>
                ) : (
                  <ul className="mt-5 space-y-2.5">
                    {processes.map((p) => (
                      <li key={p.id} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-sm sm:grid-cols-[10rem_1fr_3rem_3.5rem]">
                        <span className="truncate text-foreground" title={p.name}>{p.name}</span>
                        <ProgressBar value={Number(p.progress)} planned={Number(p.planned_progress)} tone={p.is_delayed ? "red" : "brand"} />
                        <span className="text-right font-semibold tabular-nums text-foreground">{formatPercent(p.progress)}</span>
                        <span className="hidden text-right sm:block">
                          {p.is_delayed ? <Badge tone="red">지연</Badge> : Number(p.progress) >= 100 ? <Badge tone="green">완료</Badge> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            {/* 미제출 현황 */}
            <Card>
              <CardHeader title="작업일보 미제출 현황" description={`오늘 · ${missing.length}/${submissions.length}명 미제출`} />
              {missing.length === 0 ? (
                <EmptyState title={submissions.length ? "모두 제출했습니다" : "제출 대상 인원이 없습니다"} />
              ) : (
                <ul className="divide-y divide-border" data-testid="missing-list">
                  {missing.map((s) => (
                    <li key={s.user_id} className="flex items-center gap-2 px-4 py-2.5 md:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{s.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[s.role]}{s.company ? ` · ${s.company}` : ""}</p>
                      </div>
                      {s.status ? <StatusBadge map={REPORT_STATUS} value={s.status} /> : <Badge tone="red">미작성</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* 지연 일정 */}
            <Card>
              <CardHeader title="지연 일정" description={`공정 ${delayedProcesses.length}건 · 업무 ${overdueTasks.length}건`} />
              {delayCount === 0 ? (
                <EmptyState title="지연된 일정이 없습니다" />
              ) : (
                <ul className="divide-y divide-border" data-testid="delay-list">
                  {delayedProcesses.map((p) => (
                    <li key={p.id}>
                      <Link href={workHref("/progress")} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent md:px-5">
                        <Badge tone="red">공정</Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            실적 {formatPercent(p.progress)} / 계획 {formatPercent(p.planned_progress)}
                            {p.planned_end < today && ` · 종료 예정일 ${diffDays(p.planned_end, today)}일 경과`}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {overdueTasks.map((t) => (
                    <li key={t.id}>
                      <Link href={workHref("/tasks")} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent md:px-5">
                        <Badge tone="amber">업무</Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{t.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {personName.get(t.assignee_id) ?? "-"} · 기한 {formatShortDate(t.due_date)} ({diffDays(t.due_date!, today)}일 경과) · {t.progress}%
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <IssuesCard issues={shownIssues} personName={personName} className="lg:col-span-2" />
            <TasksCard tasks={myTasks.data ?? []} today={today} />
            <EventsCard events={events.data ?? []} today={today} className="lg:col-span-2" />
          </div>
        </>
      ) : (
        // 협력업체: 본인 업무와 본인 작업일보 중심의 화면
        <div className="grid gap-4 lg:grid-cols-2">
          <TasksCard tasks={myTasks.data ?? []} today={today} />
          <IssuesCard issues={shownIssues} personName={personName} title="내 작업일보의 특이사항" />
          <EventsCard events={events.data ?? []} today={today} title="내 일정" />
        </div>
      )}
    </>
  );
}

function IssuesCard({ issues, personName, className, title = "주요 이슈" }: { issues: Issue[]; personName: Map<string, string>; className?: string; title?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description="최근 7일 작업일보의 특이사항·지원 요청·지연 보고" />
      {issues.length === 0 ? (
        <EmptyState title="보고된 이슈가 없습니다" />
      ) : (
        <ul className="divide-y divide-border" data-testid="issue-list">
          {issues.map((issue) => (
            <li key={issue.key}>
              <Link href={workHref(`/reports/${issue.reportId}`)} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent md:px-5">
                <Badge tone={issue.tone} className="mt-0.5 shrink-0">{issue.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-foreground">{issue.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatShortDate(issue.date)} · {personName.get(issue.authorId) ?? "-"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TasksCard({ tasks, today, className }: { tasks: Task[]; today: string; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title="내 업무" description="진행 중인 배정 업무" action={<MoreLink href={workHref("/tasks")} />} />
      {tasks.length === 0 ? (
        <EmptyState title="진행 중인 업무가 없습니다" />
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((t) => {
            const late = !!t.due_date && t.due_date < today;
            return (
              <li key={t.id}>
                <Link href={workHref("/tasks")} className="block px-4 py-2.5 hover:bg-accent md:px-5">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t.title}</p>
                    {(t.priority === "high" || t.priority === "urgent") && <StatusBadge map={TASK_PRIORITY} value={t.priority} />}
                    {late ? <Badge tone="red">기한 경과</Badge> : <StatusBadge map={TASK_STATUS} value={t.status} />}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <ProgressBar value={t.progress} tone={late ? "red" : "brand"} />
                    <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{t.progress}%</span>
                    <span className={cn("w-16 shrink-0 text-right text-xs", late ? "font-semibold dw-fg-red" : "text-muted-foreground")}>
                      {t.due_date ? `~${formatShortDate(t.due_date)}` : "기한 없음"}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function EventsCard({ events, today, className, title = "다가오는 일정" }: { events: ScheduleEvent[]; today: string; className?: string; title?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description="오늘부터 7일" action={<MoreLink href={workHref("/calendar")} label="캘린더" />} />
      {events.length === 0 ? (
        <EmptyState title="예정된 일정이 없습니다" />
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 md:px-5">
              <span className={cn("w-28 shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums", e.start_date <= today ? "text-brand-fg" : "text-foreground")}>
                {e.start_date <= today ? "오늘" : formatShortDate(e.start_date)}
                {e.end_date > e.start_date && e.end_date > today && <span className="font-normal text-muted-foreground">~{formatShortDate(e.end_date)}</span>}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">{e.title}</p>
              <StatusBadge map={EVENT_TYPE} value={e.event_type} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
