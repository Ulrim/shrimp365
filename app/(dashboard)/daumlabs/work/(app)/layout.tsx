import { WorkNav } from "@/components/work/layout/work-nav";
import { workHref } from "@/lib/work/constants";
import { navFor } from "@/lib/work/nav";
import { getSession } from "@/lib/work/session";

/**
 * 현장관리 화면 공통 레이아웃. shrimp365 (dashboard) 셸의 <main> 안에 그려지므로
 * 사이드바·상단바는 두지 않고, 본문 맨 위에 서브 내비(사업장 선택·메뉴·건수 배지)만 둔다.
 */
export default async function WorkAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const { supabase, project, isManager } = session;

  const [unread, pendingReports, pendingChanges] = await Promise.all([
    supabase.from("dw_notifications").select("id", { count: "exact", head: true }).eq("is_read", false),
    project && isManager
      ? supabase.from("dw_daily_reports").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "submitted")
      : null,
    project && isManager
      ? supabase.from("dw_change_requests").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "pending")
      : null,
  ]);
  // 키는 NavItem.href 와 같은 전체 경로다.
  const counts: Record<string, number> = {
    [workHref("/notifications")]: unread.count ?? 0,
    [workHref("/reviews")]: (pendingReports?.count ?? 0) + (pendingChanges?.count ?? 0),
  };

  return (
    <div className="mx-auto w-full max-w-6xl print:max-w-none">
      <WorkNav
        items={navFor(session.role)}
        counts={counts}
        projects={session.projects.map((p) => ({ id: p.id, name: p.name }))}
        currentProjectId={project?.id ?? null}
        canWrite={!!session.role}
      />
      {children}
    </div>
  );
}
