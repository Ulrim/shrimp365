import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { PROJECT_COOKIE, workHref } from "./constants";
import { createClient } from "./supabase/server";
import type { AppRole, Profile, Project, ProjectMember } from "./types";

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  profile: Profile;
  projects: Project[];
  /** 현재 선택된 사업장. 소속 사업장이 없으면 null. */
  project: Project | null;
  role: AppRole | null;
  isExecutive: boolean;
  /** 회장·대표이사·현장관리자 */
  isManager: boolean;
  /** 협력업체를 제외한 내부 구성원 */
  isInternal: boolean;
}

type Client = SessionContext["supabase"];

/** 내 이메일로 온 초대를 수락한다. 수락한 건수(실패·미인증이면 0). */
async function acceptInvites(supabase: Client): Promise<number> {
  const { data, error } = await supabase.rpc("dw_accept_invites");
  if (error) {
    console.error("[현장관리 초대 수락 오류]", error.code, error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/**
 * 조회마다 새 AbortSignal 을 붙인다. Next.js 는 한 번의 서버 렌더 안에서 주소·옵션이 같은 GET fetch 를
 * 한 번만 실행하고 결과를 돌려쓴다(요청 메모이제이션). 그대로 두면 초대를 수락한 뒤의 재조회가
 * 수락 전 응답(빈 결과)을 그대로 받아 방금 구성원이 된 사용자를 안내 화면으로 보낸다.
 * signal 을 넘긴 fetch 는 메모이제이션 대상에서 빠진다.
 */
const fresh = () => new AbortController().signal;

const loadProfile = async (supabase: Client, userId: string) =>
  (await supabase.from("dw_profiles").select("*").eq("id", userId).abortSignal(fresh()).maybeSingle<Profile>()).data;

const loadProjects = (supabase: Client, userId: string) =>
  Promise.all([
    supabase.from("dw_projects").select("*").order("name").abortSignal(fresh()).returns<Project[]>(),
    supabase.from("dw_project_members").select("project_id, user_id, role").eq("user_id", userId).abortSignal(fresh()).returns<ProjectMember[]>(),
  ]);

/**
 * 로그인 사용자와 현재 사업장·역할을 구한다. 요청당 한 번만 조회한다.
 * 여기서 구한 역할은 화면 구성용이며, 데이터 접근은 DB(RLS)가 다시 검증한다.
 *
 * 계정은 shrimp365 계정이고, 현장관리 구성원(dw_profiles)은 초대를 수락해야 생긴다.
 * 구성원이 아니거나 비활성이면 안내 화면으로 보낸다 — shrimp365 세션은 건드리지 않는다.
 */
export const getSession = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let profile = await loadProfile(supabase, user.id);
  if (!profile) {
    // 가입만으로는 구성원이 되지 않는다. 내 이메일로 온 초대가 있으면 여기서 수락된다.
    await acceptInvites(supabase);
    profile = await loadProfile(supabase, user.id);
  }
  if (!profile) redirect(workHref("/not-invited"));
  if (!profile.is_active) redirect(`${workHref("/not-invited")}?reason=inactive`);

  let [{ data: projects }, { data: memberships }] = await loadProjects(supabase, user.id);
  const isExecutive = profile.global_role !== null;
  if (!isExecutive && (projects ?? []).length === 0) {
    // 이미 구성원이어도 다른 사업장의 초대가 새로 와 있을 수 있다.
    if ((await acceptInvites(supabase)) > 0) {
      [{ data: projects }, { data: memberships }] = await loadProjects(supabase, user.id);
    }
  }
  const list = projects ?? [];
  const selected = (await cookies()).get(PROJECT_COOKIE)?.value;
  const project = list.find((p) => p.id === selected) ?? list[0] ?? null;
  const role: AppRole | null = isExecutive
    ? "executive"
    : (memberships?.find((m) => m.project_id === project?.id)?.role ?? null);

  return {
    supabase,
    userId: user.id,
    profile,
    projects: list,
    project,
    role,
    isExecutive,
    isManager: role === "executive" || role === "site_manager",
    isInternal: role !== null && role !== "partner",
  };
});

/** 사업장이 반드시 필요한 화면에서 사용한다. */
export async function requireProject() {
  const session = await getSession();
  if (!session.project || !session.role) redirect(workHref("/no-project"));
  return session as SessionContext & { project: Project; role: AppRole };
}

export async function requireManager() {
  const session = await requireProject();
  if (!session.isManager) redirect(workHref("/dashboard"));
  return session;
}

export async function requireInternal() {
  const session = await requireProject();
  if (!session.isInternal) redirect(workHref("/dashboard"));
  return session;
}
