"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { PROJECT_COOKIE, WORK_LAYOUT_PATH } from "@/lib/work/constants";
import { getSession } from "@/lib/work/session";

/** 현재 사업장을 바꾼다. 접근 권한이 있는 사업장만 선택할 수 있다. */
export async function selectProject(projectId: string) {
  const session = await getSession();
  if (!session.projects.some((p) => p.id === projectId)) return;
  (await cookies()).set(PROJECT_COOKIE, projectId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath(WORK_LAYOUT_PATH, "layout");
}
