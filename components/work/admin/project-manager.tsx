"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProject, deleteProject, updateProject } from "@/app/(dashboard)/daumlabs/work/(app)/admin/projects/actions";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card } from "@/components/work/ui/card";
import { Dialog, DialogContent } from "@/components/work/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/work/ui/form";
import { EmptyState } from "@/components/work/ui/misc";
import { PROJECT_STATUS } from "@/lib/work/constants";
import { formatDate } from "@/lib/work/dates";
import type { Project } from "@/lib/work/types";

export function ProjectManager({
  projects,
  memberCounts,
  currentId,
}: {
  projects: Project[];
  memberCounts: Record<string, number>;
  currentId: string | null;
}) {
  const [editing, setEditing] = useState<Project | "new" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          구성원은 상단에서 사업장을 선택한 뒤 <strong className="text-foreground">계정 관리</strong>에서 초대·배정합니다.
        </p>
        <Button onClick={() => setEditing("new")}>
          <Plus /> 사업장 등록
        </Button>
      </div>

      <Card>
        {projects.length === 0 ? (
          <EmptyState title="등록된 사업장이 없습니다" description="사업장 등록으로 첫 사업장을 만들어 주세요." />
        ) : (
          <ul className="divide-y divide-border" data-testid="project-list">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-3 px-4 py-3.5" data-code={project.code}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[15px] font-semibold text-foreground">{project.name}</span>
                    <StatusBadge map={PROJECT_STATUS} value={project.status} />
                    {project.id === currentId && <Badge tone="green">현재 선택</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {project.code}
                    {project.location ? ` · ${project.location}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {project.start_date || project.end_date
                      ? `${formatDate(project.start_date, false)} ~ ${formatDate(project.end_date, false)}`
                      : "기간 미정"}
                    {" · "}구성원 {memberCounts[project.id] ?? 0}명
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing(project)} aria-label={`${project.name} 수정`}>
                  수정
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        {editing && (
          <ProjectDialog key={editing === "new" ? "new" : editing.id} project={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

function ProjectDialog({ project, onDone }: { project: Project | null; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: project?.code ?? "",
    name: project?.name ?? "",
    location: project?.location ?? "",
    description: project?.description ?? "",
    start_date: project?.start_date ?? "",
    end_date: project?.end_date ?? "",
    status: project?.status ?? "active",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function finish(action: () => ReturnType<typeof createProject>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      onDone();
      router.refresh();
    });
  }

  return (
    <DialogContent title={project ? "사업장 수정" : "사업장 등록"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          finish(() => (project ? updateProject(project.id, form) : createProject(form)));
        }}
      >
        <Field label="사업장 코드" htmlFor="project-code" required hint={project ? "코드는 등록 후 변경할 수 없습니다." : "영문 대문자·숫자·하이픈 2~20자 (예: GH-SF-01)"}>
          <Input id="project-code" value={form.code} onChange={set("code")} disabled={!!project} maxLength={20} autoCapitalize="characters" required />
        </Field>
        <Field label="사업장명" htmlFor="project-name" required>
          <Input id="project-name" value={form.name} onChange={set("name")} maxLength={100} required />
        </Field>
        <Field label="위치" htmlFor="project-location">
          <Input id="project-location" value={form.location} onChange={set("location")} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일" htmlFor="project-start">
            <Input id="project-start" type="date" value={form.start_date} onChange={set("start_date")} />
          </Field>
          <Field label="종료일" htmlFor="project-end">
            <Input id="project-end" type="date" value={form.end_date} onChange={set("end_date")} />
          </Field>
        </div>
        <Field label="상태" htmlFor="project-status" required>
          <Select id="project-status" value={form.status} onChange={set("status")}>
            {Object.entries(PROJECT_STATUS).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="설명" htmlFor="project-description">
          <Textarea id="project-description" rows={2} value={form.description} onChange={set("description")} maxLength={1000} />
        </Field>
        <FormError message={error} />
        <div className="flex gap-2">
          {project && (
            <Button
              variant="dangerOutline"
              size="lg"
              disabled={pending}
              onClick={() => confirm(`'${project.name}' 사업장을 삭제할까요? 공정·업무·일정도 함께 삭제됩니다.`) && finish(() => deleteProject(project.id))}
            >
              삭제
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" disabled={pending}>
            {pending ? "저장 중…" : project ? "저장" : "등록"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
