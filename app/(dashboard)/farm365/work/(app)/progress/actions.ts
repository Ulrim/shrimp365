"use server";

import { revalidatePath } from "next/cache";
import { workHref } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { requireProject } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { firstIssue, processSchema, uuidSchema, type ProcessInput } from "@/lib/work/validation";

function refresh() {
  revalidatePath(workHref("/progress"));
  revalidatePath(workHref("/dashboard"));
}

/** 공정 등록·수정. 권한은 DB(RLS)에서 다시 검증한다. */
export async function saveProcess(processId: string | null, input: ProcessInput): Promise<ActionResult> {
  const { supabase, project, isManager } = await requireProject();
  if (!isManager) return { ok: false, error: "공정은 관리자만 등록·수정할 수 있습니다." };
  const parsed = processSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (processId && !uuidSchema.safeParse(processId).success) return { ok: false, error: "잘못된 요청입니다." };

  if (processId) {
    const { data, error } = await supabase
      .from("dw_processes")
      .update(parsed.data)
      .eq("id", processId)
      .eq("project_id", project.id)
      .select("id");
    if (error) return { ok: false, error: toMessage(error) };
    if (!data?.length) return { ok: false, error: "공정을 찾을 수 없거나 수정 권한이 없습니다." };
  } else {
    const { error } = await supabase.from("dw_processes").insert({ ...parsed.data, project_id: project.id });
    if (error) return { ok: false, error: toMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function deleteProcess(processId: string): Promise<ActionResult> {
  const { supabase, project, isManager } = await requireProject();
  if (!isManager) return { ok: false, error: "공정은 관리자만 삭제할 수 있습니다." };
  if (!uuidSchema.safeParse(processId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { data, error } = await supabase
    .from("dw_processes")
    .delete()
    .eq("id", processId)
    .eq("project_id", project.id)
    .select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "공정을 찾을 수 없거나 삭제 권한이 없습니다." };
  refresh();
  return { ok: true };
}
