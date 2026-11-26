import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProjectManager } from "@/components/work/admin/project-manager";
import { PageHeader } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { getSession } from "@/lib/work/session";

export const metadata: Metadata = { title: "사업장 관리" };

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session.isExecutive) redirect(workHref("/dashboard"));
  const { data: members } = await session.supabase.from("dw_project_members").select("project_id");
  const counts: Record<string, number> = {};
  for (const m of members ?? []) counts[m.project_id as string] = (counts[m.project_id as string] ?? 0) + 1;

  return (
    <>
      <PageHeader title="사업장 관리" description="사업장을 등록하고 기간·상태를 관리합니다." />
      <ProjectManager projects={session.projects} memberCounts={counts} currentId={session.project?.id ?? null} />
    </>
  );
}
