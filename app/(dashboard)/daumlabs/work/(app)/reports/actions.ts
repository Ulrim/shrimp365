"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PHOTO_BUCKET } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { requireProject } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import {
  commentSchema, firstIssue, reportItemSchema, reportSchema, requiredCommentSchema, uuidSchema,
} from "@/lib/work/validation";

const saveSchema = reportSchema.and(
  z.object({ items: z.array(reportItemSchema.and(z.object({ id: uuidSchema.nullish() }))) }),
);
export type SaveReportInput = z.input<typeof saveSchema>;

function refresh(reportId?: string) {
  revalidatePath(workHref("/reports"));
  revalidatePath(workHref("/reviews"));
  revalidatePath(workHref("/dashboard"));
  if (reportId) revalidatePath(workHref(`/reports/${reportId}`));
}

/** 작업일보 저장(임시저장). submit 이 true 이면 저장 후 바로 제출한다. */
export async function saveReport(
  reportId: string | null,
  input: SaveReportInput,
  submit: boolean,
): Promise<ActionResult<{ id: string; itemIds: string[]; submitted: boolean }>> {
  const { supabase, project } = await requireProject();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (reportId && !uuidSchema.safeParse(reportId).success) return { ok: false, error: "잘못된 요청입니다." };
  if (submit && parsed.data.items.length === 0) {
    return { ok: false, error: "작업내역을 1건 이상 입력해야 제출할 수 있습니다." };
  }

  const { data: id, error } = await supabase.rpc("dw_save_report", {
    p_project: project.id,
    p_report: reportId,
    p_data: parsed.data,
  });
  if (error) return { ok: false, error: toMessage(error) };

  const { data: items } = await supabase.from("dw_report_items").select("id").eq("report_id", id).order("sort_order");
  const result = { id: id as string, itemIds: (items ?? []).map((i) => i.id as string), submitted: false };

  if (submit) {
    const { error: submitError } = await supabase.rpc("dw_submit_report", { p_report: id });
    if (submitError) {
      refresh(result.id);
      return { ok: false, error: `임시저장은 되었지만 제출하지 못했습니다. ${toMessage(submitError)}` };
    }
    result.submitted = true;
  }
  refresh(result.id);
  return { ok: true, data: result };
}

export async function submitReport(reportId: string): Promise<ActionResult> {
  const { supabase } = await requireProject();
  if (!uuidSchema.safeParse(reportId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { error } = await supabase.rpc("dw_submit_report", { p_report: reportId });
  if (error) return { ok: false, error: toMessage(error) };
  refresh(reportId);
  return { ok: true };
}

export async function deleteReport(reportId: string): Promise<ActionResult> {
  const { supabase } = await requireProject();
  if (!uuidSchema.safeParse(reportId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { data: photos } = await supabase.from("dw_report_photos").select("storage_path").eq("report_id", reportId);
  if (photos?.length) {
    await supabase.storage.from(PHOTO_BUCKET).remove(photos.map((p) => p.storage_path as string));
  }
  const { data, error } = await supabase.from("dw_daily_reports").delete().eq("id", reportId).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "작성중인 본인 작업일보만 삭제할 수 있습니다." };
  refresh();
  return { ok: true };
}

export async function reviewReport(
  reportId: string,
  decision: "approved" | "revision_requested",
  comment: string,
): Promise<ActionResult> {
  const { supabase } = await requireProject();
  const parsed = z
    .object({ id: uuidSchema, decision: z.enum(["approved", "revision_requested"]), comment: commentSchema })
    .safeParse({ id: reportId, decision, comment });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (decision === "revision_requested" && !parsed.data.comment) {
    return { ok: false, error: "보완 요청 사유를 입력해 주세요." };
  }
  const { error } = await supabase.rpc("dw_review_report", {
    p_report: reportId,
    p_decision: decision,
    p_comment: parsed.data.comment || null,
  });
  if (error) return { ok: false, error: toMessage(error) };
  refresh(reportId);
  revalidatePath(workHref("/consolidated"));
  revalidatePath(workHref("/progress"));
  return { ok: true };
}

export async function requestReportChange(reportId: string, reason: string): Promise<ActionResult> {
  const { supabase } = await requireProject();
  const parsed = z.object({ id: uuidSchema, reason: requiredCommentSchema }).safeParse({ id: reportId, reason });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await supabase.rpc("dw_request_report_change", { p_report: reportId, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: toMessage(error) };
  refresh(reportId);
  return { ok: true };
}

export async function reviewChangeRequest(
  requestId: string,
  reportId: string,
  approve: boolean,
  comment: string,
): Promise<ActionResult> {
  const { supabase } = await requireProject();
  const parsed = z.object({ id: uuidSchema, comment: commentSchema }).safeParse({ id: requestId, comment });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await supabase.rpc("dw_review_change_request", {
    p_request: requestId,
    p_approve: approve,
    p_comment: parsed.data.comment || null,
  });
  if (error) return { ok: false, error: toMessage(error) };
  refresh(reportId);
  revalidatePath(workHref("/consolidated"));
  return { ok: true };
}

/** 브라우저에서 저장소에 올린 사진을 작업일보에 연결한다. */
export async function addPhoto(
  reportId: string,
  storagePath: string,
  caption: string,
): Promise<ActionResult<{ id: string; url: string; caption: string | null; storage_path: string }>> {
  const { supabase, project } = await requireProject();
  const parsed = z
    .object({ id: uuidSchema, path: z.string().max(300), caption: z.string().trim().max(200) })
    .safeParse({ id: reportId, path: storagePath, caption });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  if (!storagePath.startsWith(`${project.id}/${reportId}/`)) return { ok: false, error: "사진 경로가 올바르지 않습니다." };

  const { data, error } = await supabase
    .from("dw_report_photos")
    .insert({ report_id: reportId, project_id: project.id, storage_path: storagePath, caption: parsed.data.caption || null })
    .select("id, caption, storage_path")
    .single();
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
    return { ok: false, error: toMessage(error) };
  }
  const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(storagePath, 3600);
  revalidatePath(workHref(`/reports/${reportId}`));
  return { ok: true, data: { ...data, url: signed?.signedUrl ?? "" } };
}

export async function deletePhoto(photoId: string): Promise<ActionResult> {
  const { supabase } = await requireProject();
  if (!uuidSchema.safeParse(photoId).success) return { ok: false, error: "잘못된 요청입니다." };
  const { data, error } = await supabase.from("dw_report_photos").delete().eq("id", photoId).select("storage_path, report_id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "사진을 삭제할 수 없습니다. 제출된 작업일보의 사진은 삭제할 수 없습니다." };
  await supabase.storage.from(PHOTO_BUCKET).remove([data[0].storage_path as string]);
  revalidatePath(workHref(`/reports/${data[0].report_id}`));
  return { ok: true };
}
