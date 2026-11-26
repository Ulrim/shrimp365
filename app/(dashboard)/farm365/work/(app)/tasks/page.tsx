import type { Metadata } from "next";
import Link from "next/link";
import { TaskBoard, type TaskRow } from "@/components/work/tasks/task-board";
import { PageHeader } from "@/components/work/ui/misc";
import { GLOBAL_ROLE_LABEL, ROLE_LABEL, TASK_STATUS, workHref } from "@/lib/work/constants";
import { today } from "@/lib/work/dates";
import { requireProject } from "@/lib/work/session";
import type { GlobalRole, ProjectMember, Task, TaskStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "업무" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  const session = await requireProject();
  const { supabase, project, userId, isInternal, isManager } = session;
  const params = await searchParams;
  const scope = !isInternal ? "mine" : params.scope === "mine" || params.scope === "all" ? params.scope : isManager ? "all" : "mine";
  const status = (Object.keys(TASK_STATUS) as TaskStatus[]).find((s) => s === params.status);

  let query = supabase
    .from("dw_tasks")
    .select("*")
    .eq("project_id", project.id)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (scope === "mine") query = query.eq("assignee_id", userId);
  if (status) query = query.eq("status", status);

  const [tasks, processes, members, executives] = await Promise.all([
    query.returns<Task[]>(),
    supabase.from("dw_processes").select("id, name").eq("project_id", project.id).order("sort_order"),
    supabase.from("dw_project_members").select("project_id, user_id, role").eq("project_id", project.id).returns<ProjectMember[]>(),
    isManager
      ? supabase.from("dw_profiles").select("id, full_name, global_role").not("global_role", "is", null).eq("is_active", true)
      : null,
  ]);
  const list = tasks.data ?? [];
  const ids = [...new Set([...(members.data ?? []).map((m) => m.user_id), ...list.map((t) => t.assignee_id)])];
  const { data: profiles } = ids.length
    ? await supabase.from("dw_profiles").select("id, full_name, is_active").in("id", ids)
    : { data: [] };
  const person = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const processName = new Map((processes.data ?? []).map((p) => [p.id as string, p.name as string]));

  const memberOptions = [
    ...(members.data ?? [])
      .filter((m) => person.get(m.user_id)?.is_active)
      .map((m) => ({ id: m.user_id, label: `${person.get(m.user_id)!.full_name} (${ROLE_LABEL[m.role]})` }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko")),
    ...(executives?.data ?? [])
      .filter((e) => !(members.data ?? []).some((m) => m.user_id === e.id))
      .map((e) => ({ id: e.id as string, label: `${e.full_name} (${GLOBAL_ROLE_LABEL[e.global_role as GlobalRole]})` })),
  ];

  const rows: TaskRow[] = list.map((t) => ({
    ...t,
    process_name: t.process_id ? (processName.get(t.process_id) ?? null) : null,
    assignee_name: (person.get(t.assignee_id)?.full_name as string | undefined) ?? "-",
  }));

  const link = (patch: Record<string, string | undefined>) => {
    const qs = Object.entries({ scope, status, ...patch })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${workHref("/tasks")}?${qs}`;
  };
  const chip = (active: boolean) =>
    cn(
      "flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium",
      active ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground",
    );

  return (
    <>
      <PageHeader title="업무" description={isInternal ? "배정된 업무와 진행상태를 관리합니다." : "배정받은 업무를 확인합니다."} />
      <div className="mb-3 space-y-2">
        {isInternal && (
          <div className="flex gap-2">
            <Link href={link({ scope: "mine" })} className={chip(scope === "mine")}>내 업무</Link>
            <Link href={link({ scope: "all" })} className={chip(scope === "all")}>전체</Link>
          </div>
        )}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Link href={link({ status: undefined })} className={chip(!status)}>전체 상태</Link>
          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
            <Link key={s} href={link({ status: s })} className={chip(status === s)}>
              {TASK_STATUS[s].label}
            </Link>
          ))}
        </div>
      </div>
      <TaskBoard
        tasks={rows}
        options={{ members: memberOptions, processes: (processes.data ?? []) as { id: string; name: string }[] }}
        isManager={isManager}
        userId={userId}
        today={today()}
      />
    </>
  );
}
