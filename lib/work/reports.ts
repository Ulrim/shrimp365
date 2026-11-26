import "server-only";
import { PHOTO_BUCKET } from "./constants";
import type { SessionContext } from "./session";
import type { ReportPhoto } from "./types";

export interface PhotoView {
  id: string;
  storage_path: string;
  caption: string | null;
  url: string;
}

/** 비공개 버킷의 사진을 볼 수 있는 임시(1시간) 주소를 만든다. */
export async function signPhotos(
  supabase: SessionContext["supabase"],
  photos: Pick<ReportPhoto, "id" | "storage_path" | "caption">[],
): Promise<PhotoView[]> {
  if (photos.length === 0) return [];
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(
    photos.map((p) => p.storage_path),
    3600,
  );
  const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return photos.map((p) => ({ ...p, url: urls.get(p.storage_path) ?? "" })).filter((p) => p.url);
}

export interface FormOptions {
  processes: { id: string; name: string }[];
  tasks: { id: string; title: string; process_id: string | null; progress: number }[];
}

/** 작업일보 작성 화면의 선택 항목(공정, 본인에게 배정된 미완료 업무) */
export async function loadFormOptions(session: SessionContext & { project: { id: string } }): Promise<FormOptions> {
  const { supabase, project, userId } = session;
  const [processes, tasks] = await Promise.all([
    supabase.from("dw_processes").select("id, name").eq("project_id", project.id).order("sort_order"),
    supabase
      .from("dw_tasks")
      .select("id, title, process_id, progress")
      .eq("project_id", project.id)
      .eq("assignee_id", userId)
      .neq("status", "done")
      .order("due_date", { nullsFirst: false }),
  ]);
  return { processes: processes.data ?? [], tasks: tasks.data ?? [] };
}
