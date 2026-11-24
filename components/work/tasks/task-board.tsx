"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTask, saveTask, updateMyTask } from "@/app/(app)/tasks/actions";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card } from "@/components/work/ui/card";
import { Dialog, DialogContent } from "@/components/work/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/work/ui/form";
import { EmptyState, ProgressBar } from "@/components/work/ui/misc";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/work/constants";
import { formatDate } from "@/lib/work/dates";
import type { ActionResult, Task, TaskPriority, TaskStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";

export interface TaskRow extends Task {
  process_name: string | null;
  assignee_name: string;
}

interface Options {
  members: { id: string; label: string }[];
  processes: { id: string; name: string }[];
}

const emptyForm = (assignee: string) => ({
  title: "", description: "", assignee_id: assignee, process_id: "", start_date: "", due_date: "",
  priority: "normal" as TaskPriority, status: "todo" as TaskStatus, progress: "0",
});

export function TaskBoard({
  tasks,
  options,
  isManager,
  userId,
  today,
}: {
  tasks: TaskRow[];
  options: Options;
  isManager: boolean;
  userId: string;
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<TaskRow | "new" | null>(null);
  const [form, setForm] = useState(emptyForm(options.members[0]?.id ?? ""));
  const [progressOf, setProgressOf] = useState<TaskRow | null>(null);
  const [progress, setProgress] = useState({ status: "todo" as TaskStatus, progress: "0" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      setError(null);
      setEditing(null);
      setProgressOf(null);
      router.refresh();
    });
  }

  function openEdit(task: TaskRow | "new") {
    setError(null);
    setForm(
      task === "new"
        ? emptyForm(options.members[0]?.id ?? "")
        : {
            title: task.title, description: task.description ?? "", assignee_id: task.assignee_id,
            process_id: task.process_id ?? "", start_date: task.start_date ?? "", due_date: task.due_date ?? "",
            priority: task.priority, status: task.status, progress: String(task.progress),
          },
    );
    setEditing(task);
  }

  function openProgress(task: TaskRow) {
    setError(null);
    setProgress({ status: task.status, progress: String(task.progress) });
    setProgressOf(task);
  }

  return (
    <>
      {isManager && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => openEdit("new")}>
            <Plus /> 업무 배정
          </Button>
        </div>
      )}
      {!editing && !progressOf && <div className="mb-3"><FormError message={error} /></div>}

      <Card>
        {tasks.length === 0 ? (
          <EmptyState title="업무가 없습니다" description="조건에 맞는 업무가 없습니다." />
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((task) => {
              const overdue = !!task.due_date && task.due_date < today && task.status !== "done";
              const mine = task.assignee_id === userId;
              return (
                <li key={task.id} data-testid="task-row" className={cn("px-4 py-3.5", overdue && "bg-red-500/10")}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge map={TASK_STATUS} value={task.status} />
                        <StatusBadge map={TASK_PRIORITY} value={task.priority} />
                        {overdue && <Badge tone="red">기한 경과</Badge>}
                      </div>
                      <p className="mt-1.5 break-words text-[15px] font-semibold text-foreground">{task.title}</p>
                      {task.description && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.description}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.assignee_name}
                        {task.process_name ? ` · ${task.process_name}` : ""}
                        {task.due_date ? (
                          <span className={cn(overdue && "font-semibold dw-fg-red")}> · 기한 {formatDate(task.due_date)}</span>
                        ) : null}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={task.progress} tone={overdue ? "red" : "brand"} className="max-w-64" />
                        <span className="w-10 shrink-0 text-right text-xs font-semibold text-foreground">{task.progress}%</span>
                      </div>
                    </div>
                    {isManager && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" aria-label="업무 수정" onClick={() => openEdit(task)}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="dw-fg-red"
                          aria-label="업무 삭제"
                          disabled={pending}
                          onClick={() => confirm(`'${task.title}' 업무를 삭제할까요?`) && run(() => deleteTask(task.id))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </div>
                  {mine && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
                      <Button variant="secondary" size="sm" className="h-10" onClick={() => openProgress(task)}>
                        진행상태 변경
                      </Button>
                      <Button variant="outline" size="sm" className="h-10" asChild>
                        <Link href={workHref("/reports/new")}>작업일보에 기록</Link>
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        {editing && (
          <DialogContent title={editing === "new" ? "업무 배정" : "업무 수정"}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveTask(editing === "new" ? null : editing.id, form));
              }}
            >
              <Field label="업무명" htmlFor="task-title" required>
                <Input id="task-title" maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="내용" htmlFor="task-description">
                <Textarea id="task-description" rows={2} maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="담당자" htmlFor="task-assignee" required>
                  <Select id="task-assignee" value={form.assignee_id} onChange={(e) => set({ assignee_id: e.target.value })}>
                    {options.members.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="공정" htmlFor="task-process">
                  <Select id="task-process" value={form.process_id} onChange={(e) => set({ process_id: e.target.value })}>
                    <option value="">선택 안 함</option>
                    {options.processes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="시작일" htmlFor="task-start">
                  <Input id="task-start" type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
                </Field>
                <Field label="기한" htmlFor="task-due">
                  <Input id="task-due" type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
                </Field>
                <Field label="우선순위" htmlFor="task-priority">
                  <Select id="task-priority" value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })}>
                    {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>{TASK_PRIORITY[p].label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="상태" htmlFor="task-status">
                  <Select id="task-status" value={form.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
                    {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
                      <option key={s} value={s}>{TASK_STATUS[s].label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="진행률(%)" htmlFor="task-progress">
                  <Input id="task-progress" type="number" inputMode="numeric" min={0} max={100} value={form.progress} onChange={(e) => set({ progress: e.target.value })} />
                </Field>
              </div>
              <FormError message={error} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" size="lg" onClick={() => setEditing(null)}>취소</Button>
                <Button type="submit" size="lg" disabled={pending}>{pending ? "저장 중…" : "저장"}</Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={progressOf !== null} onOpenChange={(v) => !v && setProgressOf(null)}>
        {progressOf && (
          <DialogContent title="진행상태 변경" description={progressOf.title}>
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-foreground">상태</span>
                <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="상태">
                  {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={progress.status === s}
                      onClick={() => setProgress((p) => ({ status: s, progress: s === "done" ? "100" : p.progress }))}
                      className={cn(
                        "h-11 rounded-lg border text-sm font-semibold",
                        progress.status === s ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground",
                      )}
                    >
                      {TASK_STATUS[s].label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label={`진행률 ${progress.progress || 0}%`} htmlFor="my-progress-range">
                <input
                  id="my-progress-range"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Number(progress.progress) || 0}
                  onChange={(e) => setProgress((p) => ({ ...p, progress: e.target.value }))}
                  className="h-10 w-full accent-brand"
                />
                <Input
                  aria-label="진행률(%)"
                  id="my-progress"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  className="mt-2"
                  value={progress.progress}
                  onChange={(e) => setProgress((p) => ({ ...p, progress: e.target.value }))}
                />
              </Field>
              <FormError message={error} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" onClick={() => setProgressOf(null)}>취소</Button>
                <Button size="lg" disabled={pending} onClick={() => run(() => updateMyTask(progressOf.id, progress.status, progress.progress === "" ? 0 : progress.progress))}>
                  {pending ? "저장 중…" : "저장"}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
