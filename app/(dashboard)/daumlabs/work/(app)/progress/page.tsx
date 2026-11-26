import type { Metadata } from "next";
import Link from "next/link";
import { Gantt } from "@/components/work/progress/gantt";
import { ProcessDialog } from "@/components/work/progress/process-dialog";
import { PROCESS_STATE, processState } from "@/components/work/progress/status";
import { StatusBadge } from "@/components/work/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { EmptyState, formatPercent, PageHeader, ProgressBar } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { formatDate, formatShortDate, today as kstToday } from "@/lib/work/dates";
import { requireInternal } from "@/lib/work/session";
import type { ProcessStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "공정 관리" };

interface LogRow {
  id: string;
  process_id: string;
  log_date: string;
  progress: number;
  source_report_id: string | null;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${Number(n.toFixed(1))}%p`;
const compact = (date: string) => date.slice(2).replaceAll("-", ".");
const period = (from: string | null, to: string | null) => (from ? `${compact(from)} ~ ${to ? compact(to) : "진행 중"}` : "-");

export default async function ProgressPage() {
  const { supabase, project, isManager } = await requireInternal();
  const today = kstToday();

  const [{ data: rows }, { data: overallRows }, { data: logRows }] = await Promise.all([
    supabase.from("dw_process_status").select("*").eq("project_id", project.id).order("sort_order").order("planned_start").returns<ProcessStatus[]>(),
    supabase.rpc("dw_project_progress", { p_project: project.id }),
    supabase
      .from("dw_process_progress_logs")
      .select("id, process_id, log_date, progress, source_report_id")
      .eq("project_id", project.id)
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<LogRow[]>(),
  ]);
  const processes = rows ?? [];
  const overall = (overallRows as { actual: number; planned: number; total_weight: number }[] | null)?.[0];
  const actual = Number(overall?.actual ?? 0);
  const planned = Number(overall?.planned ?? 0);
  const totalWeight = Number(overall?.total_weight ?? 0);
  const gap = actual - planned;
  const delayed = processes.filter((p) => processState(p, today) === "delayed");
  const name = new Map(processes.map((p) => [p.id, p.name]));
  const nextOrder = processes.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;

  const kpis = [
    { label: "전체 공정률(실적)", value: formatPercent(actual), sub: `계획 ${formatPercent(planned)}`, testId: "kpi-actual" },
    { label: "계획 대비", value: signed(gap), sub: gap < 0 ? "계획보다 늦음" : "계획 이상", alert: gap <= -5 },
    { label: "지연 공정", value: `${delayed.length}건`, sub: `전체 ${processes.length}개 공정`, alert: delayed.length > 0 },
    { label: "가중치 합계", value: String(Number(totalWeight.toFixed(2))), sub: totalWeight === 100 ? "기준 100" : "100이 아님 · 비율로 환산", testId: "kpi-weight" },
  ];

  return (
    <>
      <PageHeader
        title="공정 관리"
        description="공정별 가중치 기준 계획 대비 실적"
        action={isManager ? <ProcessDialog today={today} nextOrder={nextOrder} /> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
            <p data-testid={kpi.testId} className={cn("mt-1 font-mono text-2xl font-bold tracking-tight", kpi.alert ? "dw-fg-red" : "text-foreground")}>
              {kpi.value}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</p>
          </Card>
        ))}
      </div>

      {totalWeight !== 100 && processes.length > 0 && (
        <p className="mb-4 rounded-lg border dw-tone-amber dw-line px-3 py-2.5 text-sm">
          가중치 합계가 {Number(totalWeight.toFixed(2))}입니다. 전체 공정률은 Σ(가중치 × 공정률) ÷ Σ가중치로 환산해 계산하지만, 합계를 100으로 맞추면 기여도를 읽기 쉽습니다.
        </p>
      )}

      {processes.length === 0 ? (
        <Card>
          <EmptyState title="등록된 공정이 없습니다" description={isManager ? "공정을 등록하면 간트차트와 공정률이 표시됩니다." : "현장관리자가 공정을 등록하면 표시됩니다."} />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="공정별 간트차트" description="계획 기간과 실적 진행을 함께 표시합니다." />
            <CardBody>
              <Gantt processes={processes} today={today} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="계획 대비 실적" description="기여도 = 가중치 × 실적률 ÷ 가중치 합계" />
            {/* PC: 표 */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm" data-testid="process-table">
                <thead>
                  <tr className="border-b border-border bg-muted text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-2.5">공정</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">가중치</th>
                    <th className="px-3 py-2.5">계획 기간</th>
                    <th className="px-3 py-2.5">실제 기간</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">계획</th>
                    <th className="min-w-36 px-3 py-2.5">실적</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">차이</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">기여도</th>
                    <th className="px-3 py-2.5">상태</th>
                    {isManager && <th className="px-3 py-2.5"><span className="sr-only">관리</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {processes.map((p) => {
                    const state = processState(p, today);
                    const diff = Number(p.progress) - Number(p.planned_progress);
                    return (
                      <tr key={p.id} data-testid="process-row" data-weight={Number(p.weight)} data-progress={Number(p.progress)}>
                        <td className="min-w-32 px-4 py-3 font-semibold text-foreground">{p.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{Number(p.weight)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-foreground">{period(p.planned_start, p.planned_end)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-foreground">{period(p.actual_start, p.actual_end)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">{formatPercent(p.planned_progress)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <ProgressBar value={Number(p.progress)} planned={Number(p.planned_progress)} tone={state === "delayed" ? "red" : "brand"} />
                            <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-foreground">{formatPercent(p.progress)}</span>
                          </div>
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums", diff < 0 ? "font-semibold dw-fg-red" : "text-foreground")}>{signed(diff)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">
                          {totalWeight > 0 ? formatPercent((Number(p.weight) * Number(p.progress)) / totalWeight) : "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3"><StatusBadge map={PROCESS_STATE} value={state} /></td>
                        {isManager && (
                          <td className="whitespace-nowrap px-2 py-2 text-right"><ProcessDialog process={p} today={today} /></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* 모바일: 카드 */}
            <ul className="divide-y divide-border md:hidden">
              {processes.map((p) => {
                const state = processState(p, today);
                const diff = Number(p.progress) - Number(p.planned_progress);
                return (
                  <li key={p.id} className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{p.name}</span>
                      <StatusBadge map={PROCESS_STATE} value={state} />
                      {isManager && <ProcessDialog process={p} today={today} />}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={Number(p.progress)} planned={Number(p.planned_progress)} tone={state === "delayed" ? "red" : "brand"} />
                      <span className="w-12 shrink-0 text-right text-sm font-bold tabular-nums text-foreground">{formatPercent(p.progress)}</span>
                    </div>
                    <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>계획 {formatPercent(p.planned_progress)}</span>
                      <span className={diff < 0 ? "font-semibold dw-fg-red" : undefined}>차이 {signed(diff)}</span>
                      <span>가중치 {Number(p.weight)}</span>
                      <span>기여도 {totalWeight > 0 ? formatPercent((Number(p.weight) * Number(p.progress)) / totalWeight) : "-"}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      계획 {formatShortDate(p.planned_start)}~{formatShortDate(p.planned_end)}
                      {p.actual_start && ` · 실제 ${formatShortDate(p.actual_start)}~${p.actual_end ? formatShortDate(p.actual_end) : ""}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="최근 실적 반영 기록" description="승인된 작업일보 또는 관리자 직접 수정으로 기록됩니다." />
            {(logRows ?? []).length === 0 ? (
              <EmptyState title="실적 기록이 없습니다" />
            ) : (
              <ul className="divide-y divide-border">
                {(logRows ?? []).map((log) => (
                  <li key={log.id} className="flex items-center gap-3 px-4 py-2.5 text-sm md:px-5">
                    <span className="w-24 shrink-0 text-muted-foreground">{formatDate(log.log_date, false)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name.get(log.process_id) ?? "삭제된 공정"}</span>
                    <span className="font-semibold tabular-nums text-foreground">{formatPercent(log.progress)}</span>
                    {log.source_report_id ? (
                      <Link href={workHref(`/reports/${log.source_report_id}`)} className="shrink-0 text-xs font-medium text-brand-fg underline">
                        작업일보
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">직접 수정</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
