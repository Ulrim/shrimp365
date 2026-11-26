"use server";

import { revalidatePath } from "next/cache";
import { WORK_LAYOUT_PATH } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { getSession } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { firstIssue, projectSchema, uuidSchema } from "@/lib/work/validation";

const DENIED = "사업장은 회장·대표이사만 관리할 수 있습니다.";

export async function createProject(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!session.isExecutive) return { ok: false, error: DENIED };
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await session.supabase.from("dw_projects").insert(parsed.data);
  if (error) return { ok: false, error: toMessage(error) };
  revalidatePath(WORK_LAYOUT_PATH, "layout");
  return { ok: true };
}

/** 사업장 코드는 등록 후 바꾸지 않는다. */
export async function updateProject(projectId: string, input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!session.isExecutive) return { ok: false, error: DENIED };
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: "잘못된 요청입니다." };
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { code: _code, ...fields } = parsed.data;
  const { data, error } = await session.supabase.from("dw_projects").update(fields).eq("id", projectId).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "사업장을 찾을 수 없습니다." };
  revalidatePath(WORK_LAYOUT_PATH, "layout");
  return { ok: true };
}

/** 작업일보가 하나라도 있는 사업장은 기록 보존을 위해 삭제하지 않는다. */
export async function deleteProject(projectId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session.isExecutive) return { ok: false, error: DENIED };
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { count, error: countError } = await session.supabase
    .from("dw_daily_reports")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (countError) return { ok: false, error: toMessage(countError) };
  if ((count ?? 0) > 0) {
    return { ok: false, error: "작업일보가 등록된 사업장은 삭제할 수 없습니다. 상태를 '완료' 또는 '중단'으로 변경해 주세요." };
  }
  const { data, error } = await session.supabase.from("dw_projects").delete().eq("id", projectId).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "사업장을 찾을 수 없습니다." };
  revalidatePath(WORK_LAYOUT_PATH, "layout");
  return { ok: true };
}
