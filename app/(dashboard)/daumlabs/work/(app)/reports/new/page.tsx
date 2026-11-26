import type { Metadata } from "next";
import { headers } from "next/headers";
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
    // Next.js 16.2 는 서버 액션이 revalidatePath 를 부르면 그 응답에 지금 보고 있는 화면도 다시 그려 싣는다.
    // 이 화면에서 임시저장(또는 사진 첨부에 따른 자동 임시저장)을 하면 방금 생긴 작업일보 때문에 아래
    // redirect 가 걸려, 쓰던 폼이 통째로 새로 마운트되고 진행 중이던 사진 등록이 끊긴다.
    // 폼은 "주소는 바꾸지 않는다"(report-form.tsx persist)를 전제로 하므로, 서버 액션에 딸린 재렌더
    // (요청에 next-action 헤더가 있다)에서는 수정 화면으로 보내지 않고 같은 폼을 그대로 둔다.
    // 새로 고치거나 다시 들어오면 평소대로 수정 화면으로 이동한다.
    const duringAction = (await headers()).has("next-action");
    if (!(editable && duringAction)) {
      redirect(workHref(editable ? `/reports/${existing.id}/edit` : `/reports/${existing.id}`));
    }
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
