import type { Metadata } from "next";
import { ConsolidatedManageForm } from "@/components/work/consolidated/manage-form";
import { Doc, DocSection, DocTable, DocTitle, NoteList, StatGrid, Td } from "@/components/work/outputs/doc";
import { PrintButton } from "@/components/work/outputs/print-button";
import { DateNav } from "@/components/work/reviews/date-nav";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { EmptyState, PageHeader, formatPercent } from "@/components/work/ui/misc";
import { ITEM_STATUS, ROLE_LABEL, workHref } from "@/lib/work/constants";
import { addDays, formatDate, formatDateTime, formatMinutes, isDateString, today } from "@/lib/work/dates";
import { signPhotos } from "@/lib/work/reports";
import { requireInternal } from "@/lib/work/session";
import type { ConsolidatedReport, ReportPhoto } from "@/lib/work/types";

export const metadata: Metadata = { title: "통합 작업일보" };

const quantity = (q: number | null, unit: string | null) => (q == null ? "-" : `${Number(q)}${unit ?? ""}`);

export default async function ConsolidatedPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireInternal();
  const { supabase, project, isManager } = session;
  const params = await searchParams;
  const now = today();
  const date = isDateString(params.date) ? params.date : now;

  const { data: row } = await supabase
    .from("dw_consolidated_reports")
    .select("*")
    .eq("project_id", project.id)
    .eq("report_date", date)
    .maybeSingle<ConsolidatedReport>();
  const snapshot = row?.snapshot;
  const reports = snapshot?.reports ?? [];

  const reportIds = reports.map((r) => r.report_id);
  const { data: photoRows } = reportIds.length
    ? await supabase
        .from("dw_report_photos")
        .select("id, storage_path, caption, report_id")
        .in("report_id", reportIds)
        .order("created_at")
        .returns<(ReportPhoto & { report_id: string })[]>()
    : { data: [] };
  const photos = await signPhotos(supabase, photoRows ?? []);
  const authorOf = new Map(reports.map((r) => [r.report_id, r.author_name]));
  const photoAuthor = new Map((photoRows ?? []).map((p) => [p.id, authorOf.get(p.report_id) ?? ""]));

  return (
    <>
      <div className="no-print"><PageHeader title="통합 작업일보" description="승인된 개인 작업일보를 작업일 단위로 취합합니다." action={row ? <PrintButton /> : undefined} /></div>
      <div className="space-y-4">
        <DateNav basePath={workHref("/consolidated")} date={date} prev={addDays(date, -1)} next={addDays(date, 1)} label={formatDate(date)} max={now} />

        {isManager && (
          <Card className="no-print">
            <CardHeader title="관리자 작성" description="날씨와 종합 의견을 입력하고 통합 작업일보를 확정합니다." />
            <CardBody>
              <ConsolidatedManageForm
                key={`${date}-${row?.is_finalized ?? false}-${row?.generated_at ?? ""}`}
                date={date}
                weather={row?.weather ?? ""}
                summary={row?.summary ?? ""}
                finalized={row?.is_finalized ?? false}
              />
            </CardBody>
          </Card>
        )}

        {!row || !snapshot ? (
          <Card>
            <EmptyState
              title="취합된 통합 작업일보가 없습니다"
              description="개인 작업일보가 승인되면 해당 작업일의 통합 작업일보에 자동으로 반영됩니다."
            />
          </Card>
        ) : (
          <Doc>
            <DocTitle
              title="통합 작업일보"
              meta={[
                { label: "사업장", value: project.name },
                { label: "작업일", value: formatDate(date) },
                { label: "날씨", value: row.weather || "-" },
                {
                  label: "상태",
                  value: row.is_finalized ? (
                    <span data-testid="finalized-state">
                      <Badge tone="green">확정</Badge> <span className="text-xs font-normal text-muted-foreground">{formatDateTime(row.finalized_at)}</span>
                    </span>
                  ) : (
                    <span data-testid="finalized-state">
                      <Badge tone="amber">미확정</Badge> <span className="text-xs font-normal text-muted-foreground">취합 {formatDateTime(row.generated_at)}</span>
                    </span>
                  ),
                },
              ]}
            />

            <DocSection title="요약">
              <StatGrid
                stats={[
                  { label: "작업인원", value: <span data-testid="worker-count">{snapshot.worker_count}명</span> },
                  { label: "총 작업시간", value: formatMinutes(snapshot.total_work_minutes) },
                  { label: "전체 공정률(실적)", value: formatPercent(snapshot.progress?.actual) },
                  { label: "전체 공정률(계획)", value: formatPercent(snapshot.progress?.planned) },
                ]}
              />
            </DocSection>

            {reports.length === 0 ? (
              <DocSection title="작업내역">
                <p className="text-sm text-muted-foreground">이 날짜에 승인된 작업일보가 없습니다.</p>
              </DocSection>
            ) : (
              <>
                <DocSection title="공정별 작업내역">
                  <DocTable head={["공정", "작업자", "작업내용", "작업실적", "수량", "상태"]} minWidth={640}>
                    {snapshot.by_process.map((group) =>
                      group.items.map((item, index) => (
                        <tr key={`${group.process_name}-${index}`} className="avoid-break">
                          {index === 0 && (
                            <Td rowSpan={group.items.length} className="w-28 font-semibold">
                              {group.process_name}
                              <span className="block text-xs font-normal text-muted-foreground">{group.worker_count}명</span>
                            </Td>
                          )}
                          <Td className="w-20 whitespace-nowrap">{item.author_name}</Td>
                          <Td className="whitespace-pre-wrap">{item.content}</Td>
                          <Td className="whitespace-pre-wrap">{item.result || "-"}</Td>
                          <Td className="w-20 whitespace-nowrap text-right">{quantity(item.quantity, item.unit)}</Td>
                          <Td className="w-20">
                            <StatusBadge map={ITEM_STATUS} value={item.status} />
                          </Td>
                        </tr>
                      )),
                    )}
                  </DocTable>
                </DocSection>

                <DocSection title="작업자별 작업내역">
                  <DocTable head={["작업자", "작업시간", "실제 작업", "작업내역"]} minWidth={600}>
                    {reports.map((report) => (
                      <tr key={report.report_id} className="avoid-break">
                        <Td className="w-28">
                          <span className="font-semibold">{report.author_name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[report.role ? ROLE_LABEL[report.role] : null, report.company].filter(Boolean).join(" · ")}
                          </span>
                        </Td>
                        <Td className="w-28 whitespace-nowrap">
                          {report.start_time} ~ {report.end_time}
                          <span className="block text-xs text-muted-foreground">휴게 {report.break_minutes}분</span>
                        </Td>
                        <Td className="w-20 whitespace-nowrap">{formatMinutes(report.work_minutes)}</Td>
                        <Td>
                          <ul className="space-y-1">
                            {report.items.map((item, index) => (
                              <li key={index}>
                                {item.process_name && <span className="text-muted-foreground">[{item.process_name}] </span>}
                                {item.content}
                                {item.result && <span className="text-muted-foreground"> — {item.result}</span>}
                                {item.quantity != null && <span className="text-muted-foreground"> ({quantity(item.quantity, item.unit)})</span>}
                              </li>
                            ))}
                          </ul>
                        </Td>
                      </tr>
                    ))}
                  </DocTable>
                </DocSection>
              </>
            )}

            <DocSection title="특이사항">
              <NoteList rows={snapshot.issues.map((n, i) => ({ key: `i${i}`, head: n.author_name, text: n.text }))} empty="특이사항 없음" />
            </DocSection>
            <DocSection title="지원 요청사항">
              <NoteList rows={snapshot.support_requests.map((n, i) => ({ key: `s${i}`, head: n.author_name, text: n.text }))} empty="지원 요청 없음" />
            </DocSection>
            <DocSection title="익일 작업계획">
              <NoteList rows={snapshot.next_day_plans.map((n, i) => ({ key: `n${i}`, head: n.author_name, text: n.text }))} empty="등록된 계획 없음" />
            </DocSection>
            <DocSection title="관리자 종합 의견">
              <p className="whitespace-pre-wrap text-sm text-foreground" data-testid="summary-text">{row.summary || "-"}</p>
            </DocSection>

            {photos.length > 0 && (
              <DocSection title={`현장 사진 ${photos.length}장`}>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 print:grid-cols-3">
                  {photos.map((photo) => (
                    <li key={photo.id} className="avoid-break">
                      <a href={photo.url} target="_blank" rel="noreferrer" className="block aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt={photo.caption ?? "현장 사진"} className="size-full object-cover" loading="lazy" />
                      </a>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{[photoAuthor.get(photo.id), photo.caption].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </DocSection>
            )}
          </Doc>
        )}
      </div>
    </>
  );
}
