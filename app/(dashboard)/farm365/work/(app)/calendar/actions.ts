"use server";

import { revalidatePath } from "next/cache";
import { workHref } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { requireProject } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { eventSchema, firstIssue, uuidSchema, type EventInput } from "@/lib/work/validation";

function refresh() {
  revalidatePath(workHref("/calendar"));
  revalidatePath(workHref("/dashboard"));
}

/**
 * 일정 등록·수정. 관리자는 전체 일정과 개인 일정을, 그 외 사용자는 본인 개인 일정만 다룬다.
 * 최종 권한은 DB(RLS)가 검증한다.
 */
export async function saveEvent(eventId: string | null, input: EventInput): Promise<ActionResult> {
  const { supabase, project, userId, isManager } = await requireProject();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (eventId && !uuidSchema.safeParse(eventId).success) return { ok: false, error: "잘못된 요청입니다." };

  const { personal, ...fields } = parsed.data;
  const isPersonal = personal || !isManager;
  const row = {
    ...fields,
    event_type: isManager ? fields.event_type : ("personal" as const),
    process_id: isPersonal ? null : fields.process_id,
  };

  if (eventId) {
    // 개인 일정의 소유자는 바꾸지 않는다 (관리자가 타인의 개인 일정을 수정해도 소유자 유지)
    const { data: current } = await supabase.from("dw_schedule_events").select("owner_id").eq("id", eventId).maybeSingle();
    if (!current) return { ok: false, error: "일정을 찾을 수 없거나 접근 권한이 없습니다." };
    const owner_id = isPersonal ? (current.owner_id ?? userId) : null;
    const { data, error } = await supabase
      .from("dw_schedule_events")
      .update({ ...row, owner_id })
      .eq("id", eventId)
      .eq("project_id", project.id)
      .select("id");
    if (error) return { ok: false, error: toMessage(error) };
    if (!data?.length) return { ok: false, error: "이 일정을 수정할 권한이 없습니다." };
  } else {
    const { error } = await supabase
      .from("dw_schedule_events")
      .insert({ ...row, project_id: project.id, owner_id: isPersonal ? userId : null, created_by: userId });
    if (error) return { ok: false, error: toMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const { supabase, project } = await requireProject();
  if (!uuidSchema.safeParse(eventId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { data, error } = await supabase.from("dw_schedule_events").delete().eq("id", eventId).eq("project_id", project.id).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "이 일정을 삭제할 권한이 없습니다." };
  refresh();
  return { ok: true };
}
