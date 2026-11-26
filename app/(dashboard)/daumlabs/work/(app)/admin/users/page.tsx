import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserManager, type InviteRow, type UserRow } from "@/components/work/admin/user-manager";
import { PageHeader } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { formatDateTime } from "@/lib/work/dates";
import { getSession } from "@/lib/work/session";
import type { Invite, Profile, ProjectMember } from "@/lib/work/types";

export const metadata: Metadata = { title: "계정 관리" };

export default async function UsersPage() {
  const session = await getSession();
  if (!session.isManager) redirect(workHref("/dashboard"));
  const { supabase, project, isExecutive } = session;

  const { data: members } = project
    ? await supabase.from("dw_project_members").select("project_id, user_id, role").eq("project_id", project.id).returns<ProjectMember[]>()
    : { data: [] as ProjectMember[] };
  const roleOf = new Map((members ?? []).map((m) => [m.user_id, m.role]));

  // 회장·대표이사는 전체 구성원, 현장관리자는 현재 사업장 구성원만 본다 (RLS 도 같은 범위로 제한한다)
  // 탈퇴해 익명화된 프로필(이메일 '')은 기록의 작성자 표시용으로만 남은 행이라 목록에서 뺀다.
  let query = supabase.from("dw_profiles").select("*").neq("email", "").order("full_name");
  if (!isExecutive) query = query.in("id", [...roleOf.keys()]);

  // 대기 중 초대: 현재 사업장 것 + 회장·대표이사에게는 전사 역할 초대도 (RLS 도 같은 범위로 제한한다)
  let inviteQuery = supabase.from("dw_invites").select("*").order("created_at", { ascending: false });
  if (project && isExecutive) inviteQuery = inviteQuery.or(`project_id.eq.${project.id},project_id.is.null`);
  else if (project) inviteQuery = inviteQuery.eq("project_id", project.id);
  else inviteQuery = inviteQuery.is("project_id", null);

  const [{ data: profiles }, { data: pending }] = await Promise.all([
    query.returns<Profile[]>(),
    project || isExecutive ? inviteQuery.returns<Invite[]>() : { data: [] as Invite[] },
  ]);

  const users: UserRow[] = (profiles ?? [])
    .filter((p) => isExecutive || roleOf.has(p.id))
    .map((p) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      phone: p.phone,
      company: p.company,
      position: p.position,
      global_role: p.global_role,
      is_active: p.is_active,
      project_role: roleOf.get(p.id) ?? null,
    }));

  const invites: InviteRow[] = (pending ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    full_name: i.full_name,
    phone: i.phone,
    company: i.company,
    position: i.position,
    role: i.role,
    global_role: i.global_role,
    invited_at: formatDateTime(i.created_at),
  }));

  return (
    <>
      <PageHeader
        title="계정 관리"
        description={
          project
            ? `${project.name} 기준 · ${isExecutive ? "전체 구성원" : "현장팀·협력업체 구성원"}을 관리합니다.`
            : "등록된 사업장이 없습니다. 사업장 관리에서 먼저 사업장을 등록해 주세요."
        }
        action={
          <Link href={workHref("/admin/account")} className="text-sm font-semibold text-brand-fg underline underline-offset-2">
            내 프로필
          </Link>
        }
      />
      <UserManager users={users} invites={invites} me={session.userId} isExecutive={isExecutive} hasProject={!!project} />
    </>
  );
}
