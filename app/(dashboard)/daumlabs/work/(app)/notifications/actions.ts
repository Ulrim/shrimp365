"use server";

import { revalidatePath } from "next/cache";
import { WORK_LAYOUT_PATH } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { getSession } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { uuidSchema } from "@/lib/work/validation";

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const { supabase, userId } = await getSession();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "잘못된 요청입니다." };
  const { error } = await supabase.from("dw_notifications").update({ is_read: true }).eq("id", id).eq("user_id", userId);
  if (error) return { ok: false, error: toMessage(error) };
  revalidatePath(WORK_LAYOUT_PATH, "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const { supabase, userId } = await getSession();
  const { error } = await supabase.from("dw_notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
  if (error) return { ok: false, error: toMessage(error) };
  revalidatePath(WORK_LAYOUT_PATH, "layout");
  return { ok: true };
}
