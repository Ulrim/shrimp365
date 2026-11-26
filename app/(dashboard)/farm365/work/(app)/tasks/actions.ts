"use server";

import { revalidatePath } from "next/cache";
import { workHref } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { requireProject } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { firstIssue, taskProgressSchema, taskSchema, uuidSchema, type TaskInput } from "@/lib/work/validation";

function refresh() {
  revalidatePath(workHref("/tasks"));
  revalidatePath(workHref("/calendar"));
  revalidatePath(workHref("/dashboard"));
}

/** 업무 등록·수정 (관리자). 권한은 DB(RLS)가 최종 검증한다. */
export async function saveTask(taskId: string | null, input: TaskInput): Promise<ActionResult> {
  const { supabase, project, isManager } = await requireProject();
  if (!isManager) return { ok: false, error: "업무 배정은 관리자만 할 수 있습니다." };
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (taskId && !uuidSchema.safeParse(taskId).success) return { ok: false, error: "잘못된 요청입니다." };

  if (taskId) {
    const { data, error } = await supabase.from("dw_tasks").update(parsed.data).eq("id", taskId).eq("project_id", project.id).select("id");
    if (error) return { ok: false, error: toMessage(error) };
    if (!data?.length) return { ok: false, error: "업무를 수정할 수 없습니다. 권한을 확인해 주세요." };
  } else {
    const { error } = await supabase.from("dw_tasks").insert({ ...parsed.data, project_id: project.id });
    if (error) return { ok: false, error: toMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const { supabase, project } = await requireProject();
  if (!uuidSchema.safeParse(taskId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { data, error } = await supabase.from("dw_tasks").delete().eq("id", taskId).eq("project_id", project.id).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "업무를 삭제할 수 없습니다. 권한을 확인해 주세요." };
  refresh();
  return { ok: true };
}

/** 담당자가 본인 업무의 진행상태를 갱신한다. */
export async function updateMyTask(taskId: string, status: string, progress: number | string): Promise<ActionResult> {
  const { supabase } = await requireProject();
  if (!uuidSchema.safeParse(taskId).success) return { ok: false, error: "잘못된 요청입니다." };
  const parsed = taskProgressSchema.safeParse({ status, progress });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await supabase.rpc("dw_update_my_task", {
    p_task: taskId,
    p_status: parsed.data.status,
    p_progress: parsed.data.progress,
  });
  if (error) return { ok: false, error: toMessage(error) };
  refresh();
  return { ok: true };
}
