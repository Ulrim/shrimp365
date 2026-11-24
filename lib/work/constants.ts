import type { AppRole, EventType, GlobalRole, ItemStatus, ReportStatus, TaskPriority, TaskStatus } from "./types";

export const ROLE_LABEL: Record<AppRole, string> = {
  executive: "경영진",
  site_manager: "현장관리자",
  site_worker: "현장팀",
  partner: "협력업체",
};

export const GLOBAL_ROLE_LABEL: Record<GlobalRole, string> = { chairman: "회장", ceo: "대표이사" };

export type Tone = "gray" | "green" | "blue" | "amber" | "red" | "purple";

export const REPORT_STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  draft: { label: "작성중", tone: "gray" },
  submitted: { label: "제출", tone: "blue" },
  approved: { label: "승인", tone: "green" },
  revision_requested: { label: "보완 요청", tone: "amber" },
};

export const ITEM_STATUS: Record<ItemStatus, { label: string; tone: Tone }> = {
  in_progress: { label: "진행중", tone: "blue" },
  completed: { label: "완료", tone: "green" },
  delayed: { label: "지연", tone: "red" },
  on_hold: { label: "보류", tone: "gray" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "대기", tone: "gray" },
  in_progress: { label: "진행중", tone: "blue" },
  done: { label: "완료", tone: "green" },
  on_hold: { label: "보류", tone: "amber" },
};

export const TASK_PRIORITY: Record<TaskPriority, { label: string; tone: Tone }> = {
  low: { label: "낮음", tone: "gray" },
  normal: { label: "보통", tone: "blue" },
  high: { label: "높음", tone: "amber" },
  urgent: { label: "긴급", tone: "red" },
};

export const EVENT_TYPE: Record<EventType, { label: string; tone: Tone }> = {
  construction: { label: "공사", tone: "green" },
  meeting: { label: "회의", tone: "blue" },
  inspection: { label: "검측·검사", tone: "purple" },
  delivery: { label: "자재 반입", tone: "amber" },
  personal: { label: "개인", tone: "gray" },
  other: { label: "기타", tone: "gray" },
};

export const PROJECT_STATUS: Record<string, { label: string; tone: Tone }> = {
  planning: { label: "준비", tone: "gray" },
  active: { label: "진행", tone: "green" },
  completed: { label: "완료", tone: "blue" },
  suspended: { label: "중단", tone: "red" },
};

export const REVIEW_ACTION_LABEL: Record<string, string> = {
  submitted: "제출",
  resubmitted: "재제출",
  approved: "승인",
  revision_requested: "보완 요청",
  change_requested: "수정 요청",
  change_approved: "수정 요청 승인",
  change_rejected: "수정 요청 반려",
};

export const PHOTO_BUCKET = "dw-report-photos";
/** 현재 사업장 선택 쿠키. shrimp365 의 다른 쿠키와 겹치지 않게 dw_ 접두사를 쓴다. */
export const PROJECT_COOKIE = "dw_project";

/** 현장관리 화면의 URL 접두사. 화면 안의 링크·redirect·revalidatePath 는 모두 이 아래다. */
export const WORK_BASE = "/daumlabs/work";

/**
 * revalidatePath(…, "layout") 전용 경로. 형식을 지정해 무효화할 때는 URL 이 아니라
 * 라우트 파일 구조(라우트 그룹 포함)를 넘겨야 한다.
 */
export const WORK_LAYOUT_PATH = "/(dashboard)/daumlabs/work";

/** 원본의 앱 내부 경로("/reports/new")를 현장관리 URL("/daumlabs/work/reports/new")로 바꾼다. */
export function workHref(path: string = ""): string {
  if (!path || path === "/") return WORK_BASE;
  if (path === WORK_BASE || path.startsWith(`${WORK_BASE}/`)) return path;
  return `${WORK_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
