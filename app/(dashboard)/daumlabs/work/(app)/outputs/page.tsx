import type { Metadata } from "next";
import Link from "next/link";
import { aggregateReports, type AggItem, type AggReport, type OutputType } from "@/components/work/outputs/aggregate";
import { Doc, DocSection, DocTable, DocTitle, NoteList, StatGrid, Td } from "@/components/work/outputs/doc";
import { PrintButton } from "@/components/work/outputs/print-button";
import { DateNav } from "@/components/work/reviews/date-nav";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { PageHeader, formatPercent } from "@/components/work/ui/misc";
import { ITEM_STATUS, workHref } from "@/lib/work/constants";
import {
  addDays, addMonths, endOfMonth, formatDate, formatMinutes, formatShortDate, isDateString, startOfMonth, startOfWeek, today,
} from "@/lib/work/dates";
import { requireInternal } from "@/lib/work/session";
import type { ConsolidatedReport, ProcessStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "보고서" };

const TYPES: Record<OutputType, { tab: string; title: string }> = {
  daily: { tab: "일간", title: "일간 작업 보고서" },
  weekly: { tab: "주간", title: "주간 공정 보고서" },
  monthly: { tab: "월간", title: "월간 공정 보고서" },
};

function rangeOf(type: OutputType, date: string) {
  if (type === "weekly") {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6), prev: addDays(from, -7), next: addDays(from, 7) };
  }
  if (type === "monthly") {
    const from = startOfMonth(date);
    return { from, to: endOfMonth(date), prev: addMonths(from, -1), next: addMonths(from, 1) };
  }
  return { from: date, to: date, prev: addDays(date, -1), next: addDays(date, 1) };
}

type ReportRow = Omit<AggReport, "author_name" | "company"> & { report_items: Omit<AggItem, "report_id">[] };
type Progress = { actual: number; planned: number };

const signed = (n: number) => `${n > 0 ? "+" : ""}${Number(n.toFixed(1))}%p`;
const quantity = (q: number | null, unit: string | null) => (q == null ? "-" : `${q}${unit ?? ""}`);

export default async function OutputsPage({ searchParams }: { searchParams: Promise<{ type?: string; date?: string }> }) {
  const session = await requireInternal();
  const { supabase, project } = session;
  const params = await searchParams;
  const now = today();
  const type: OutputType = params.type === "weekly" || params.type === "monthly" ? params.type : "daily";
  const date = isDateString(params.date) ? params.date : now;
  const { from, to, prev, next } = rangeOf(type, date);
  // 진행 중인 기간은 오늘까지의 공정률로 본다
  const progressEnd = to > now ? now : to;

  const [reportRes, processRes, statusRes, startRes, endRes, consolidatedRes] = await Promise.all([
    supabase
      .from("dw_daily_reports")
      .select(
        "id, author_id, work_date, work_minutes, notes, support_request, next_day_plan, report_items(process_id, sort_order, content, result, quantity, unit, status)",
      )
      .eq("project_id", project.id)
      .eq("status", "approved")
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .limit(5000)
      .returns<ReportRow[]>(),
    supabase.from("dw_processes").select("id, name, sort_order").eq("project_id", project.id).order("sort_order"),
    supabase.from("dw_process_status").select("*").eq("project_id", project.id).order("sort_order").returns<ProcessStatus[]>(),
    supabase.rpc("dw_project_progress", { p_project: project.id, p_as_of: addDays(from, -1) }),
    supabase.rpc("dw_project_progress", { p_project: project.id, p_as_of: progressEnd }),
    type === "daily"
      ? supabase.from("dw_consolidated_reports").select("*").eq("project_id", project.id).eq("report_date", date).maybeSingle<ConsolidatedReport>()
      : null,
  ]);
  const rows = reportRes.data ?? [];
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const { data: authors } = authorIds.length
    ? await supabase.from("dw_profiles").select("id, full_name, company").in("id", authorIds)
    : { data: [] };
  const author = new Map((authors ?? []).map((a) => [a.id as string, a as { full_name: string; company: string | null }]));

  const agg = aggregateReports({
    from,
    to,
    reports: rows.map(({ report_items: _items, ...r }) => ({
      ...r,
      author_name: author.get(r.author_id)?.full_name ?? "-",
      company: author.get(r.author_id)?.company ?? null,
    })),
    items: rows.flatMap((r) => r.report_items.map((i) => ({ ...i, report_id: r.id }))),
    processes: (processRes.data ?? []) as { id: string; name: string; sort_order: number }[],
  });

  const first = (res: { data: unknown }): Progress | null => {
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as Progress | undefined;
    return row ? { actual: Number(row.actual), planned: Number(row.planned) } : null;
  };
  const startProgress = first(startRes);
  const endProgress = first(endRes);
  const processes = statusRes.data ?? [];
  const consolidated = consolidatedRes?.data ?? null;
  const period = type === "daily" ? formatDate(from) : `${formatDate(from)} ~ ${formatDate(to)}`;
  const navLabel =
    type === "daily" ? formatDate(date) : type === "weekly" ? `${formatShortDate(from)} ~ ${formatShortDate(to)}` : `${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월`;
  const note = (n: { date: string; author_name: string; text: string }, i: number) => ({
    key: `${n.date}-${i}`,
    head: type === "daily" ? n.author_name : `${formatShortDate(n.date)} ${n.author_name}`,
    text: n.text,
  });

  return (
    <>
      <div className="no-print"><PageHeader title="보고서" description="승인된 작업일보를 기간별로 자동 취합합니다." action={<PrintButton />} /></div>
      <div className="space-y-4">
        <div className="no-print flex gap-2" role="tablist" aria-label="보고서 종류">
          {(Object.keys(TYPES) as OutputType[]).map((t) => (
            <Link
              key={t}
              href={`${workHref("/outputs")}?type=${t}&date=${date}`}
              role="tab"
              aria-selected={type === t}
              className={cn(
                "flex h-10 flex-1 items-center justify-center rounded-lg border text-sm font-semibold md:flex-none md:px-6",
                type === t ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground",
              )}
            >
              {TYPES[t].tab}
            </Link>
          ))}
        </div>
        <DateNav basePath={workHref("/outputs")} query={{ type }} date={date} prev={prev} next={next} label={navLabel} />

        <Doc>
          <DocTitle
            title={TYPES[type].title}
            meta={[
              { label: "사업장", value: project.name },
              { label: "보고 기간", value: <span data-testid="period">{period}</span> },
              { label: "작성일", value: formatDate(now) },
              { label: "작성자", value: session.profile.full_name },
              ...(type === "daily" ? [{ label: "날씨", value: consolidated?.weather || "-" }] : []),
            ]}
          />

          <DocSection title="기간 요약">
            <StatGrid
              stats={[
                { label: "작업일수", value: <span data-testid="work-days">{agg.workDays}일</span> },
                { label: "연인원", value: <span data-testid="person-days">{agg.personDays}명</span> },
                { label: "총 작업시간", value: <span data-testid="total-minutes" data-minutes={agg.totalMinutes}>{formatMinutes(agg.totalMinutes)}</span> },
                {
                  label: "전체 공정률",
                  value: formatPercent(endProgress?.actual),
                  sub: startProgress && endProgress ? `기간 중 ${signed(endProgress.actual - startProgress.actual)}` : undefined,
                },
              ]}
            />
            {type !== "daily" && (
              <div className="mt-3">
                <DocTable head={["일자", "작업인원", "작업시간"]} minWidth={280}>
                  {agg.daily.map((d) => (
                    <tr key={d.date} className={d.workers === 0 ? "text-muted-foreground" : undefined}>
                      <Td className={d.workers === 0 ? "text-muted-foreground" : undefined}>{formatDate(d.date)}</Td>
                      <Td className={cn("text-right", d.workers === 0 && "text-muted-foreground")}>{d.workers}명</Td>
                      <Td className={cn("text-right", d.workers === 0 && "text-muted-foreground")}>{d.minutes ? formatMinutes(d.minutes) : "-"}</Td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <Td className="bg-muted">합계</Td>
                    <Td className="bg-muted text-right">{agg.personDays}명</Td>
                    <Td className="bg-muted text-right">{formatMinutes(agg.totalMinutes)}</Td>
                  </tr>
                </DocTable>
              </div>
            )}
          </DocSection>

          <DocSection title="공정률">
            <DocTable head={["구분", `기간 시작 전 (${formatShortDate(addDays(from, -1))})`, `기간 종료 (${formatShortDate(progressEnd)})`, "증감"]} minWidth={420}>
              <tr>
                <Td className="font-semibold">실적</Td>
                <Td className="text-right">{formatPercent(startProgress?.actual)}</Td>
                <Td className="text-right" data-testid="progress-actual">{formatPercent(endProgress?.actual)}</Td>
                <Td className="text-right">{startProgress && endProgress ? signed(endProgress.actual - startProgress.actual) : "-"}</Td>
              </tr>
              <tr>
                <Td className="font-semibold">계획</Td>
                <Td className="text-right">{formatPercent(startProgress?.planned)}</Td>
                <Td className="text-right">{formatPercent(endProgress?.planned)}</Td>
                <Td className="text-right">{startProgress && endProgress ? signed(endProgress.planned - startProgress.planned) : "-"}</Td>
              </tr>
              <tr>
                <Td className="font-semibold">계획 대비</Td>
                <Td className="text-right">{startProgress ? signed(startProgress.actual - startProgress.planned) : "-"}</Td>
                <Td className="text-right">{endProgress ? signed(endProgress.actual - endProgress.planned) : "-"}</Td>
                <Td />
              </tr>
            </DocTable>
            {processes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-muted-foreground">공정별 현황 (작성일 {formatShortDate(now)} 기준)</p>
                <DocTable head={["공정", "가중치", "계획 기간", "계획", "실적", "상태"]} minWidth={560}>
                  {processes.map((p) => (
                    <tr key={p.id}>
                      <Td className="font-medium">{p.name}</Td>
                      <Td className="text-right">{Number(p.weight)}</Td>
                      <Td className="whitespace-nowrap">
                        {formatShortDate(p.planned_start)} ~ {formatShortDate(p.planned_end)}
                      </Td>
                      <Td className="text-right">{formatPercent(p.planned_progress)}</Td>
                      <Td className="text-right">{formatPercent(p.progress)}</Td>
                      <Td>
                        {Number(p.progress) >= 100 ? (
                          <Badge tone="green">완료</Badge>
                        ) : p.is_delayed ? (
                          <Badge tone="red">지연</Badge>
                        ) : Number(p.progress) > 0 ? (
                          <Badge tone="blue">진행중</Badge>
                        ) : (
                          <Badge>대기</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </DocTable>
              </div>
            )}
          </DocSection>

          <DocSection title="공정별 작업 실적">
            {agg.byProcess.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="no-approved">이 기간에 승인된 작업일보가 없습니다.</p>
            ) : (
              <div className="space-y-4">
                {agg.byProcess.map((group) => (
                  <div key={group.process_id ?? "none"} className="avoid-break">
                    <p className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm font-semibold text-foreground">
                      {group.process_name}
                      <span className="text-xs font-normal text-muted-foreground">{group.rows.length}건</span>
                      {group.totals.length > 0 && (
                        <span className="text-xs font-normal text-brand-fg">
                          수량 합계: {group.totals.map((t) => `${t.quantity}${t.unit}`).join(", ")}
                        </span>
                      )}
                    </p>
                    <DocTable head={[...(type === "daily" ? [] : ["일자"]), "작업자", "작업내용", "작업실적", "수량", "상태"]} minWidth={600}>
                      {group.rows.map((row, index) => (
                        <tr key={index}>
                          {type !== "daily" && <Td className="w-14 whitespace-nowrap">{formatShortDate(row.date)}</Td>}
                          <Td className="w-20 whitespace-nowrap">{row.author_name}</Td>
                          <Td className="whitespace-pre-wrap">{row.content}</Td>
                          <Td className="whitespace-pre-wrap">{row.result || "-"}</Td>
                          <Td className="w-20 whitespace-nowrap text-right">{quantity(row.quantity, row.unit)}</Td>
                          <Td className="w-20">
                            <StatusBadge map={ITEM_STATUS} value={row.status} />
                          </Td>
                        </tr>
                      ))}
                    </DocTable>
                  </div>
                ))}
              </div>
            )}
          </DocSection>

          <DocSection title="작업자별 집계" className="avoid-break">
            {agg.byWorker.length === 0 ? (
              <p className="text-sm text-muted-foreground">집계할 작업자가 없습니다.</p>
            ) : (
              <DocTable head={["작업자", "소속", "작업일수", "총 작업시간"]} minWidth={360}>
                {agg.byWorker.map((w) => (
                  <tr key={w.author_id}>
                    <Td className="font-medium">{w.author_name}</Td>
                    <Td>{w.company ?? "-"}</Td>
                    <Td className="text-right">{w.days}일</Td>
                    <Td className="text-right">{formatMinutes(w.minutes)}</Td>
                  </tr>
                ))}
              </DocTable>
            )}
          </DocSection>

          <DocSection title="지연 작업내역">
            {agg.delayed.length === 0 ? (
              <p className="text-sm text-muted-foreground">지연으로 보고된 작업내역이 없습니다.</p>
            ) : (
              <DocTable head={["일자", "공정", "작업자", "작업내용", "작업실적"]} minWidth={520}>
                {agg.delayed.map((row, index) => (
                  <tr key={index}>
                    <Td className="w-14 whitespace-nowrap">{formatShortDate(row.date)}</Td>
                    <Td className="whitespace-nowrap">{row.process_name}</Td>
                    <Td className="whitespace-nowrap">{row.author_name}</Td>
                    <Td className="whitespace-pre-wrap">{row.content}</Td>
                    <Td className="whitespace-pre-wrap">{row.result || "-"}</Td>
                  </tr>
                ))}
              </DocTable>
            )}
          </DocSection>

          <DocSection title="특이사항">
            <NoteList rows={agg.issues.map(note)} empty="특이사항 없음" />
          </DocSection>
          <DocSection title="지원 요청사항">
            <NoteList rows={agg.supportRequests.map(note)} empty="지원 요청 없음" />
          </DocSection>
          {type === "daily" && (
            <>
              <DocSection title="익일 작업계획">
                <NoteList rows={agg.nextDayPlans.map(note)} empty="등록된 계획 없음" />
              </DocSection>
              <DocSection title="관리자 종합 의견">
                <p className="whitespace-pre-wrap text-sm text-foreground">{consolidated?.summary || "-"}</p>
              </DocSection>
            </>
          )}
        </Doc>
      </div>
    </>
  );
}
