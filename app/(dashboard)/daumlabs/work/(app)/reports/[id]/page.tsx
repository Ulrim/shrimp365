import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportActions } from "@/components/work/reports/report-actions";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { DefinitionList, formatPercent } from "@/components/work/ui/misc";
import { ITEM_STATUS, REPORT_STATUS, REVIEW_ACTION_LABEL } from "@/lib/work/constants";
import { formatDate, formatDateTime, formatMinutes, formatTime } from "@/lib/work/dates";
import { signPhotos } from "@/lib/work/reports";
import { requireProject } from "@/lib/work/session";
import type { ChangeRequest, DailyReport, ReportItem, ReportPhoto, ReportReview } from "@/lib/work/types";

export const metadata: Metadata = { title: "작업일보" };

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireProject();
  const { supabase, userId, isManager } = session;

  const { data: report } = await supabase.from("dw_daily_reports").select("*").eq("id", id).maybeSingle<DailyReport>();
  if (!report || report.project_id !== session.project.id) notFound();

  const [items, photos, reviews, changes, processes] = await Promise.all([
    supabase.from("dw_report_items").select("*").eq("report_id", id).order("sort_order").returns<ReportItem[]>(),
    supabase.from("dw_report_photos").select("id, storage_path, caption").eq("report_id", id).order("created_at").returns<ReportPhoto[]>(),
    supabase.from("dw_report_reviews").select("*").eq("report_id", id).order("created_at").returns<ReportReview[]>(),
    supabase.from("dw_change_requests").select("*").eq("report_id", id).eq("status", "pending").returns<ChangeRequest[]>(),
    supabase.from("dw_processes").select("id, name").eq("project_id", report.project_id),
  ]);
  const taskIds = [...new Set((items.data ?? []).map((i) => i.task_id).filter(Boolean))] as string[];
  const personIds = [...new Set([report.author_id, ...(reviews.data ?? []).map((r) => r.actor_id)].filter(Boolean))] as string[];
  const [tasks, people, photoViews] = await Promise.all([
    taskIds.length ? supabase.from("dw_tasks").select("id, title").in("id", taskIds) : null,
    supabase.from("dw_profiles").select("id, full_name, company").in("id", personIds),
    signPhotos(supabase, photos.data ?? []),
  ]);
  const processName = new Map((processes.data ?? []).map((p) => [p.id, p.name]));
  const taskTitle = new Map((tasks?.data ?? []).map((t) => [t.id, t.title]));
  const person = new Map((people.data ?? []).map((p) => [p.id, p]));
  const author = person.get(report.author_id);

  const isAuthor = report.author_id === userId;
  const editable = isAuthor && (report.status === "draft" || report.status === "revision_requested");
  const pendingChange = changes.data?.[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href={workHref("/reports")} aria-label="목록으로" className="no-print flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">{formatDate(report.work_date)} 작업일보</h1>
          <p className="text-sm text-muted-foreground">
            {author?.full_name ?? "-"}
            {author?.company ? ` · ${author.company}` : ""}
          </p>
        </div>
        <StatusBadge map={REPORT_STATUS} value={report.status} />
      </div>

      {pendingChange && (
        <div className="rounded-xl border px-4 py-3 text-sm dw-tone-amber dw-line">
          <p className="font-semibold">수정 요청 처리 대기 중</p>
          <p className="mt-1 whitespace-pre-wrap">{pendingChange.reason}</p>
        </div>
      )}

      <ReportActions
        reportId={report.id}
        canEdit={editable}
        canSubmit={editable && (items.data?.length ?? 0) > 0}
        canDelete={isAuthor && report.status === "draft"}
        canReview={isManager && !isAuthor && report.status === "submitted"}
        canRequestChange={isAuthor && report.status === "approved" && !pendingChange}
        pendingChangeId={pendingChange?.id ?? null}
        canReviewChange={isManager && pendingChange?.requester_id !== userId}
      />
      {isManager && isAuthor && report.status === "submitted" && (
        <p className="text-sm text-muted-foreground">본인이 작성한 작업일보는 다른 관리자가 검토합니다.</p>
      )}

      <Card>
        <CardHeader title="작업 시간" />
        <CardBody>
          <DefinitionList
            items={[
              { label: "작업시간", value: `${formatTime(report.start_time)} ~ ${formatTime(report.end_time)}` },
              { label: "휴게시간", value: `${report.break_minutes}분` },
              { label: "실제 작업", value: <strong>{formatMinutes(report.work_minutes)}</strong> },
              ...(report.submitted_at ? [{ label: "제출", value: formatDateTime(report.submitted_at) }] : []),
              ...(report.approved_at ? [{ label: "승인", value: formatDateTime(report.approved_at) }] : []),
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`작업내역 ${items.data?.length ?? 0}건`} />
        <CardBody className="space-y-3">
          {(items.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">등록된 작업내역이 없습니다.</p>}
          {(items.data ?? []).map((item) => (
            <div key={item.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {item.process_id && <Badge tone="green">{processName.get(item.process_id) ?? "공정"}</Badge>}
                <StatusBadge map={ITEM_STATUS} value={item.status} />
                {item.task_id && <span className="text-xs text-muted-foreground">업무: {taskTitle.get(item.task_id) ?? "-"}</span>}
              </div>
              <p className="whitespace-pre-wrap text-[15px] font-medium text-foreground">{item.content}</p>
              {item.result && <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">실적: {item.result}</p>}
              <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                {item.quantity != null && <span>수량 {Number(item.quantity)}{item.unit ?? ""}</span>}
                {item.task_progress != null && <span>업무 진행률 {item.task_progress}%</span>}
                {item.process_progress != null && <span>공정 누계 {formatPercent(item.process_progress)}</span>}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      {photoViews.length > 0 && (
        <Card>
          <CardHeader title={`현장 사진 ${photoViews.length}장`} />
          <CardBody>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {photoViews.map((photo) => (
                <li key={photo.id} className="aspect-square overflow-hidden rounded-lg bg-muted">
                  <a href={photo.url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={photo.caption ?? "현장 사진"} className="size-full object-cover" loading="lazy" />
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="특이사항 및 계획" />
        <CardBody>
          <DefinitionList
            items={[
              { label: "특이사항", value: report.notes || "-" },
              { label: "지원 요청", value: report.support_request || "-" },
              { label: "익일 계획", value: report.next_day_plan || "-" },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="제출·승인 이력" />
        <CardBody>
          {(reviews.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 제출하지 않았습니다.</p>
          ) : (
            <ol className="space-y-3">
              {(reviews.data ?? []).map((review) => (
                <li key={review.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-foreground">
                      <strong>{REVIEW_ACTION_LABEL[review.action] ?? review.action}</strong>
                      <span className="text-muted-foreground"> · {review.actor_id ? (person.get(review.actor_id)?.full_name ?? "-") : "-"}</span>
                    </p>
                    {review.comment && <p className="mt-0.5 whitespace-pre-wrap text-foreground">{review.comment}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(review.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
