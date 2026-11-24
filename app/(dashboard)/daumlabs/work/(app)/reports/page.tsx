import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card } from "@/components/work/ui/card";
import { EmptyState, PageHeader } from "@/components/work/ui/misc";
import { REPORT_STATUS, workHref } from "@/lib/work/constants";
import { addMonths, endOfMonth, formatDate, formatMinutes, startOfMonth, today } from "@/lib/work/dates";
import { requireProject } from "@/lib/work/session";
import type { DailyReport, ReportStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "작업일보" };

type Row = DailyReport & { report_items: { content: string }[] };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; month?: string; status?: string }>;
}) {
  const session = await requireProject();
  const { supabase, project, userId, isInternal } = session;
  const params = await searchParams;
  const scope = params.scope === "all" && isInternal ? "all" : "mine";
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : today().slice(0, 7);
  const status = (Object.keys(REPORT_STATUS) as ReportStatus[]).find((s) => s === params.status);
  const first = startOfMonth(`${month}-01`);

  let query = supabase
    .from("dw_daily_reports")
    .select("*, report_items:dw_report_items(content)")
    .eq("project_id", project.id)
    .gte("work_date", first)
    .lte("work_date", endOfMonth(first))
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (scope === "mine") query = query.eq("author_id", userId);
  if (status) query = query.eq("status", status);
  const { data: rows } = await query.returns<Row[]>();
  const reports = rows ?? [];

  const authorIds = [...new Set(reports.map((r) => r.author_id))];
  const { data: authors } = authorIds.length
    ? await supabase.from("dw_profiles").select("id, full_name").in("id", authorIds)
    : { data: [] };
  const name = new Map((authors ?? []).map((a) => [a.id, a.full_name as string]));

  const link = (patch: Record<string, string | undefined>) => {
    const next = { scope, month, status, ...patch };
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return workHref(`/reports?${qs}`);
  };
  const chip = (active: boolean) =>
    cn("flex h-9 items-center rounded-full border px-3.5 text-sm font-medium", active ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground");

  return (
    <>
      <PageHeader
        title="작업일보"
        action={
          <Button asChild>
            <Link href={workHref("/reports/new")}>
              <Plus /> 오늘 작업일보
            </Link>
          </Button>
        }
      />

      <div className="mb-3 space-y-2">
        {isInternal && (
          <div className="flex gap-2">
            <Link href={link({ scope: "mine" })} className={chip(scope === "mine")}>내 작업일보</Link>
            <Link href={link({ scope: "all" })} className={chip(scope === "all")}>전체</Link>
          </div>
        )}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Link href={link({ month: addMonths(first, -1).slice(0, 7) })} className={chip(false)} aria-label="이전 달">‹</Link>
          <span className="shrink-0 text-sm font-semibold text-foreground">{month.replace("-", "년 ")}월</span>
          <Link href={link({ month: addMonths(first, 1).slice(0, 7) })} className={chip(false)} aria-label="다음 달">›</Link>
          <span className="mx-1 h-5 w-px shrink-0 bg-muted-foreground/40" />
          <Link href={link({ status: undefined })} className={cn(chip(!status), "shrink-0")}>전체 상태</Link>
          {(Object.keys(REPORT_STATUS) as ReportStatus[]).map((s) => (
            <Link key={s} href={link({ status: s })} className={cn(chip(status === s), "shrink-0")}>
              {REPORT_STATUS[s].label}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        {reports.length === 0 ? (
          <EmptyState title="작업일보가 없습니다" description="조건에 맞는 작업일보가 없습니다." />
        ) : (
          <ul className="divide-y divide-border">
            {reports.map((report) => (
              <li key={report.id}>
                <Link href={workHref(`/reports/${report.id}`)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent active:bg-accent">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-foreground">{formatDate(report.work_date)}</span>
                      <StatusBadge map={REPORT_STATUS} value={report.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {report.report_items.length > 0
                        ? `${report.report_items[0].content}${report.report_items.length > 1 ? ` 외 ${report.report_items.length - 1}건` : ""}`
                        : "작업내역 없음"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {scope === "all" && `${name.get(report.author_id) ?? "-"} · `}
                      {formatMinutes(report.work_minutes)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
