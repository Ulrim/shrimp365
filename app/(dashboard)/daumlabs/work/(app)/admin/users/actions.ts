"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase-server";
import { workHref } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { getSession, type SessionContext } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { firstIssue, inviteSchema, userUpdateSchema, uuidSchema } from "@/lib/work/validation";

const DENIED = "이 작업을 수행할 권한이 없습니다.";
const GLOBAL_ROLES = ["chairman", "ceo"] as const;
const projectRoleSchema = z.enum(["site_manager", "site_worker", "partner"]);

/**
 * 초대 결과. added = 이미 구성원이라 바로 반영됨, invited = 대기 중 초대로 등록됨.
 * 이미 그 사업장 소속인 계정은 DB 함수가 한국어 예외로 거절한다(역할을 덮어쓰지 않는다).
 */
export type InviteOutcome = "added" | "invited";

/** 요청자가 관리자(회장·대표이사·현재 사업장의 현장관리자)인지 서버에서 다시 확인한다. */
async function requireCaller(): Promise<SessionContext | null> {
  const session = await getSession();
  return session.isManager ? session : null;
}

/**
 * 대상 구성원을 관리할 수 있는지 확인한다.
 * 회장·대표이사는 모든 구성원, 현장관리자는 현재 사업장의 현장팀·협력업체만 관리할 수 있다.
 */
async function canManage(session: SessionContext, targetId: string): Promise<boolean> {
  if (session.isExecutive) return true;
  if (!session.project || targetId === session.userId) return false;
  const [{ data: member }, { data: profile }] = await Promise.all([
    session.supabase
      .from("dw_project_members")
      .select("role")
      .eq("project_id", session.project.id)
      .eq("user_id", targetId)
      .maybeSingle(),
    session.supabase.from("dw_profiles").select("global_role").eq("id", targetId).maybeSingle(),
  ]);
  if (!member || !profile || profile.global_role) return false;
  if (member.role !== "site_worker" && member.role !== "partner") return false;
  // 다른 사업장에서 현장관리자인 구성원은 이 사업장의 현장관리자가 건드릴 수 없다
  // (사용 중지는 모든 사업장에 적용되므로 다른 사업장의 관리자를 막아 버릴 수 있다).
  // 요청자에게 보이지 않는 소속이라 DB 함수(security definer)가 권한을 확인한 뒤 알려 준다.
  // 권한이 없으면 false 가 아니라 예외가 나므로, 오류는 "관리 불가"로 본다.
  const { data: elsewhere, error } = await session.supabase.rpc("dw_is_site_manager_elsewhere", {
    p_user: targetId,
    p_project: session.project.id,
  });
  return !error && elsewhere === false;
}

/**
 * 현장관리자가 자기 사업장 구성원의 프로필을 고칠 때만 쓰는 서버 권한 수정.
 * 반드시 canManage 확인 뒤에 부른다. dw_profiles 만 다루며 shrimp365 계정(auth)은 건드리지 않는다.
 */
async function updateProfileAsServer(targetId: string, fields: Record<string, unknown>) {
  try {
    return await createAdminClient().from("dw_profiles").update(fields).eq("id", targetId).select("id");
  } catch (e) {
    console.error("[현장관리 프로필 수정 오류]", e instanceof Error ? e.message : e);
    return { data: null, error: { message: "서버 설정 문제로 처리하지 못했습니다. 관리자에게 문의해 주세요." } };
  }
}

function refresh() {
  revalidatePath(workHref("/admin/users"));
  revalidatePath(workHref("/history"));
}

/**
 * 구성원 초대. 계정은 당사자가 Shrimp365 에 가입해 만들고, 여기서는 현장관리 접근만 연다.
 * 권한·역할 제한은 DB 함수(dw_invite_member / dw_invite_executive)가 다시 검증한다.
 */
export async function inviteMember(input: unknown): Promise<ActionResult<InviteOutcome>> {
  const session = await requireCaller();
  if (!session) return { ok: false, error: DENIED };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { email, role, full_name, phone, company, position } = parsed.data;

  const isGlobal = role === "chairman" || role === "ceo";
  // 회장·대표이사·현장관리자는 회장/대표이사만 지정할 수 있다
  if ((isGlobal || role === "site_manager") && !session.isExecutive) {
    return { ok: false, error: "현장관리자는 현장팀·협력업체만 초대할 수 있습니다." };
  }
  if (!isGlobal && !session.project) return { ok: false, error: "먼저 사업장을 등록하고 선택해 주세요." };

  const { data, error } = isGlobal
    ? await session.supabase.rpc("dw_invite_executive", { p_email: email, p_global_role: role, p_full_name: full_name })
    : await session.supabase.rpc("dw_invite_member", {
        p_project: session.project!.id,
        p_email: email,
        p_role: role,
        p_full_name: full_name,
        p_phone: phone,
        p_company: company,
        p_position: position,
      });
  if (error) return { ok: false, error: toMessage(error) };
  if (data !== "added" && data !== "invited") return { ok: false, error: "초대를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  refresh();
  return { ok: true, data };
}

/** 대기 중인 초대 취소. 취소 권한은 DB(RLS)가 검증한다 — 현장관리자 초대는 회장·대표이사만 취소할 수 있다. */
export async function cancelInvite(inviteId: string): Promise<ActionResult> {
  const session = await requireCaller();
  if (!session || !uuidSchema.safeParse(inviteId).success) return { ok: false, error: DENIED };
  const { data, error } = await session.supabase.from("dw_invites").delete().eq("id", inviteId).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "초대를 찾을 수 없거나 취소할 권한이 없습니다." };
  refresh();
  return { ok: true };
}

export async function updateUser(targetId: string, input: unknown): Promise<ActionResult> {
  const session = await requireCaller();
  if (!session || !uuidSchema.safeParse(targetId).success) return { ok: false, error: DENIED };
  const parsed = userUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!(await canManage(session, targetId))) return { ok: false, error: DENIED };

  // 회장·대표이사는 RLS 로 허용된다. 현장관리자는 위에서 대상을 확인한 뒤 서버 권한으로 수정한다.
  const { data, error } = session.isExecutive
    ? await session.supabase.from("dw_profiles").update(parsed.data).eq("id", targetId).select("id")
    : await updateProfileAsServer(targetId, parsed.data);
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: DENIED };
  refresh();
  return { ok: true };
}

/** 현장관리 사용 중지/재개(dw_profiles.is_active). Shrimp365 계정 자체는 바뀌지 않는다. */
export async function setUserActive(targetId: string, active: boolean): Promise<ActionResult> {
  const session = await requireCaller();
  if (!session || !uuidSchema.safeParse(targetId).success || typeof active !== "boolean") return { ok: false, error: DENIED };
  if (targetId === session.userId) return { ok: false, error: "본인은 사용 중지할 수 없습니다." };
  if (!(await canManage(session, targetId))) return { ok: false, error: DENIED };

  const { data, error } = session.isExecutive
    ? await session.supabase.from("dw_profiles").update({ is_active: active }).eq("id", targetId).select("id")
    : await updateProfileAsServer(targetId, { is_active: active });
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: DENIED };
  refresh();
  return { ok: true };
}

/** 전사 역할(회장·대표이사) 지정/해제. 회장·대표이사만 가능하며 본인 역할은 바꿀 수 없다. */
export async function setGlobalRole(targetId: string, role: string | null): Promise<ActionResult> {
  const session = await requireCaller();
  if (!session?.isExecutive || !uuidSchema.safeParse(targetId).success) return { ok: false, error: DENIED };
  const parsed = z.enum(GLOBAL_ROLES).nullable().safeParse(role || null);
  if (!parsed.success) return { ok: false, error: "잘못된 역할입니다." };
  if (targetId === session.userId) return { ok: false, error: "본인의 전사 역할은 변경할 수 없습니다." };

  const { data, error } = await session.supabase.from("dw_profiles").update({ global_role: parsed.data }).eq("id", targetId).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: DENIED };
  refresh();
  return { ok: true };
}

/** 현재 사업장에서의 역할 지정. role 이 null 이면 사업장에서 제외한다. */
export async function setProjectRole(targetId: string, role: string | null): Promise<ActionResult> {
  const session = await requireCaller();
  if (!session || !uuidSchema.safeParse(targetId).success) return { ok: false, error: DENIED };
  if (!session.project) return { ok: false, error: "먼저 사업장을 등록하고 선택해 주세요." };
  const parsed = projectRoleSchema.nullable().safeParse(role || null);
  if (!parsed.success) return { ok: false, error: "잘못된 역할입니다." };
  if (targetId === session.userId) return { ok: false, error: "본인의 역할은 변경할 수 없습니다." };
  if (parsed.data === "site_manager" && !session.isExecutive) {
    return { ok: false, error: "현장관리자 지정은 회장·대표이사만 할 수 있습니다." };
  }

  const { supabase, project } = session;
  const { data: target } = await supabase.from("dw_profiles").select("global_role").eq("id", targetId).maybeSingle();
  if (!target) return { ok: false, error: DENIED };
  if (target.global_role && parsed.data) {
    return { ok: false, error: "회장·대표이사는 모든 사업장에 접근하므로 사업장 역할을 지정할 필요가 없습니다." };
  }
  const { data: existing } = await supabase
    .from("dw_project_members")
    .select("role")
    .eq("project_id", project.id)
    .eq("user_id", targetId)
    .maybeSingle();

  // 아래 쓰기는 요청자 세션으로 수행한다. 현장관리자 관련 변경은 RLS 가 회장·대표이사에게만 허용한다.
  if (parsed.data === null) {
    if (!existing) return { ok: true };
    const { data, error } = await supabase
      .from("dw_project_members").delete().eq("project_id", project.id).eq("user_id", targetId).select("user_id");
    if (error) return { ok: false, error: toMessage(error) };
    if (!data?.length) return { ok: false, error: DENIED };
  } else if (existing) {
    const { data, error } = await supabase
      .from("dw_project_members").update({ role: parsed.data }).eq("project_id", project.id).eq("user_id", targetId).select("user_id");
    if (error) return { ok: false, error: toMessage(error) };
    if (!data?.length) return { ok: false, error: DENIED };
  } else {
    const { error } = await supabase.from("dw_project_members").insert({ project_id: project.id, user_id: targetId, role: parsed.data });
    if (error) return { ok: false, error: toMessage(error) };
  }
  refresh();
  return { ok: true };
}
