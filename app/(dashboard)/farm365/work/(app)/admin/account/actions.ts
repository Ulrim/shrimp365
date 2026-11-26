"use server";

import { revalidatePath } from "next/cache";
import { WORK_LAYOUT_PATH } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { getSession } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { firstIssue, userUpdateSchema } from "@/lib/work/validation";

/** 내 현장관리 프로필(이름·연락처·소속·직책) 수정. 비밀번호 등 계정 자체는 Shrimp365 가 관리한다. */
export async function updateMyProfile(input: unknown): Promise<ActionResult> {
  const { supabase, userId } = await getSession();
  const parsed = userUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { data, error } = await supabase.from("dw_profiles").update(parsed.data).eq("id", userId).select("id");
  if (error) return { ok: false, error: toMessage(error) };
  if (!data?.length) return { ok: false, error: "프로필을 저장하지 못했습니다." };
  revalidatePath(WORK_LAYOUT_PATH, "layout");
  return { ok: true };
}
