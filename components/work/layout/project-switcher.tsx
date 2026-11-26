"use client";

import { useTransition } from "react";
import { selectProject } from "@/app/(dashboard)/farm365/work/(app)/actions";

/** 사업장 선택. 2곳 이상이면 셀렉트, 1곳이면 이름만 보여 준다. */
export function ProjectSwitcher({ projects, current }: { projects: { id: string; name: string }[]; current: string }) {
  const [pending, start] = useTransition();
  if (projects.length === 0) return <span className="text-sm text-muted-foreground">소속 사업장 없음</span>;
  if (projects.length === 1) {
    return <p className="truncate text-[15px] font-semibold text-foreground">{projects[0].name}</p>;
  }
  return (
    <select
      aria-label="사업장 선택"
      value={current}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(() => selectProject(next));
      }}
      className="h-11 min-w-0 max-w-full truncate rounded-lg border border-input bg-card pl-3 pr-8 text-[15px] font-semibold text-foreground disabled:opacity-60 lg:h-10 lg:text-sm"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
