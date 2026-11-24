import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReportForm } from "@/components/work/reports/report-form";
import { PageHeader } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { formatDate, isDateString, today } from "@/lib/work/dates";
import { loadFormOptions } from "@/lib/work/reports";
import { requireProject } from "@/lib/work/session";

export const metadata: Metadata = { title: "작업일보 작성" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireProject();
  const params = await searchParams;
  const now = today();
  const date = isDateString(params.date) && params.date <= now ? params.date : now;

  // 하루 1건: 이미 작성한 작업일보가 있으면 그 작업일보로 이동한다
  const { data: existing } = await session.supabase
    .from("dw_daily_reports")
    .select("id, status")
    .eq("project_id", session.project.id)
    .eq("author_id", session.userId)
    .eq("work_date", date)
    .maybeSingle();
  if (existing) {
    const editable = existing.status === "draft" || existing.status === "revision_requested";
    redirect(workHref(editable ? `/reports/${existing.id}/edit` : `/reports/${existing.id}`));
  }

  return (
    <>
      <PageHeader title="작업일보 작성" description={`${formatDate(date)} · ${session.profile.full_name}`} />
      <ReportForm
        projectId={session.project.id}
        today={now}
        options={await loadFormOptions(session)}
        initialPhotos={[]}
        initial={{
          id: null, work_date: date, start_time: "08:00", end_time: "17:00", break_minutes: 60,
          notes: "", support_request: "", next_day_plan: "", items: [],
        }}
      />
    </>
  );
}
