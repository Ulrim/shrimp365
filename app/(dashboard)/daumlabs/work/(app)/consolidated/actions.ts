"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workHref } from "@/lib/work/constants";
import { toMessage } from "@/lib/work/errors";
import { requireManager } from "@/lib/work/session";
import type { ActionResult } from "@/lib/work/types";
import { dateSchema, firstIssue } from "@/lib/work/validation";

const schema = z.object({
  date: dateSchema,
  weather: z.string().trim().max(50, "날씨는 50자 이내로 입력해 주세요."),
  summary: z.string().trim().max(2000, "종합 의견은 2000자 이내로 입력해 주세요."),
  finalize: z.boolean(),
});

/** 통합 작업일보의 날씨·종합 의견을 저장하고 확정/확정 해제한다. 확정 전이면 최신 승인 내용으로 다시 취합된다. */
export async function saveConsolidated(input: z.input<typeof schema>): Promise<ActionResult> {
  const { supabase, project } = await requireManager();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { error } = await supabase.rpc("dw_save_consolidated_report", {
    p_project: project.id,
    p_date: parsed.data.date,
    p_weather: parsed.data.weather,
    p_summary: parsed.data.summary,
    p_finalize: parsed.data.finalize,
  });
  if (error) return { ok: false, error: toMessage(error) };
  revalidatePath(workHref("/consolidated"));
  revalidatePath(workHref("/outputs"));
  return { ok: true };
}
