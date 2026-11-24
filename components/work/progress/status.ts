import type { Tone } from "@/lib/work/constants";
import type { ProcessStatus } from "@/lib/work/types";

export type ProcessState = "done" | "delayed" | "active" | "upcoming";

export const PROCESS_STATE: Record<ProcessState, { label: string; tone: Tone }> = {
  done: { label: "완료", tone: "green" },
  delayed: { label: "지연", tone: "red" },
  active: { label: "진행", tone: "blue" },
  upcoming: { label: "예정", tone: "gray" },
};

export function processState(p: ProcessStatus, today: string): ProcessState {
  if (Number(p.progress) >= 100) return "done";
  if (p.is_delayed) return "delayed";
  if (Number(p.progress) > 0 || p.actual_start || p.planned_start <= today) return "active";
  return "upcoming";
}
