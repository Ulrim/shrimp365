import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportForm } from "@/components/work/reports/report-form";
import { PageHeader } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { formatDate, formatTime, today } from "@/lib/work/dates";
import { loadFormOptions, signPhotos } from "@/lib/work/reports";
import { requireProject } from "@/lib/work/session";
import type { DailyReport, ReportItem, ReportPhoto, ReportReview } from "@/lib/work/types";

export const metadata: Metadata = { title: "작업일보 수정" };

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireProject();
  const { supabase } = session;
  const { data: report } = await supabase.from("dw_daily_reports").select("*").eq("id", id).maybeSingle<DailyReport>();
  if (!report || report.project_id !== session.project.id) notFound();
  if (report.author_id !== session.userId || !["draft", "revision_requested"].includes(report.status)) {
    redirect(workHref(`/reports/${id}`));
  }

  const [items, photos, reviews, options] = await Promise.all([
    supabase.from("dw_report_items").select("*").eq("report_id", id).order("sort_order").returns<ReportItem[]>(),
    supabase.from("dw_report_photos").select("id, storage_path, caption").eq("report_id", id).order("created_at").returns<ReportPhoto[]>(),
    supabase.from("dw_report_reviews").select("*").eq("report_id", id).order("created_at", { ascending: false }).limit(1).returns<ReportReview[]>(),
    loadFormOptions(session),
  ]);
  // 이미 연결된 업무가 완료 상태여도 선택 항목에 남겨 둔다
  const linkedIds = (items.data ?? []).map((i) => i.task_id).filter((t): t is string => !!t && !options.tasks.some((o) => o.id === t));
  if (linkedIds.length) {
    const { data: linked } = await supabase.from("dw_tasks").select("id, title, process_id, progress").in("id", linkedIds);
    options.tasks.push(...(linked ?? []));
  }
  const last = reviews.data?.[0];
  const text = (v: string | number | null) => (v == null ? "" : String(v));

  return (
    <>
      <PageHeader title="작업일보 수정" description={`${formatDate(report.work_date)} · ${session.profile.full_name}`} />
      <ReportForm
        projectId={session.project.id}
        today={today()}
        options={options}
        initialPhotos={await signPhotos(supabase, photos.data ?? [])}
        revisionComment={report.status === "revision_requested" ? (last?.comment ?? "관리자가 수정을 허용했습니다. 수정 후 다시 제출해 주세요.") : null}
        initial={{
          id: report.id,
          work_date: report.work_date,
          start_time: formatTime(report.start_time),
          end_time: formatTime(report.end_time),
          break_minutes: report.break_minutes,
          notes: report.notes ?? "",
          support_request: report.support_request ?? "",
          next_day_plan: report.next_day_plan ?? "",
          items: (items.data ?? []).map((i) => ({
            id: i.id,
            process_id: i.process_id ?? "",
            task_id: i.task_id ?? "",
            content: i.content,
            result: i.result ?? "",
            quantity: text(i.quantity),
            unit: i.unit ?? "",
            status: i.status,
            task_progress: text(i.task_progress),
            process_progress: text(i.process_progress),
          })),
        }}
      />
    </>
  );
}
