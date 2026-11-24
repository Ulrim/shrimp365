export type GlobalRole = "chairman" | "ceo";
export type ProjectRole = "site_manager" | "site_worker" | "partner";
/** 현재 사업장에서의 유효 역할. 회장·대표이사는 executive. */
export type AppRole = "executive" | ProjectRole;

export type ReportStatus = "draft" | "submitted" | "approved" | "revision_requested";
export type ItemStatus = "in_progress" | "completed" | "delayed" | "on_hold";
export type TaskStatus = "todo" | "in_progress" | "done" | "on_hold";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type EventType = "construction" | "meeting" | "inspection" | "delivery" | "personal" | "other";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company: string | null;
  position: string | null;
  global_role: GlobalRole | null;
  is_active: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  location: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "planning" | "active" | "completed" | "suspended";
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
}

export interface Process {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  weight: number;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  progress: number;
}

export interface ProcessStatus extends Process {
  planned_progress: number;
  is_delayed: boolean;
}

export interface Task {
  id: string;
  project_id: string;
  process_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string;
  assigned_by: string | null;
  start_date: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  completed_at: string | null;
  created_at: string;
}

export interface ScheduleEvent {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  event_type: EventType;
  owner_id: string | null;
  process_id: string | null;
  created_by: string | null;
}

export interface DailyReport {
  id: string;
  project_id: string;
  author_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  work_minutes: number;
  notes: string | null;
  support_request: string | null;
  next_day_plan: string | null;
  status: ReportStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportItem {
  id: string;
  report_id: string;
  process_id: string | null;
  task_id: string | null;
  sort_order: number;
  content: string;
  result: string | null;
  quantity: number | null;
  unit: string | null;
  status: ItemStatus;
  task_progress: number | null;
  process_progress: number | null;
}

export interface ReportPhoto {
  id: string;
  report_id: string;
  item_id: string | null;
  storage_path: string;
  caption: string | null;
  created_at: string;
}

export interface ReportReview {
  id: string;
  report_id: string;
  actor_id: string | null;
  action:
    | "submitted"
    | "resubmitted"
    | "approved"
    | "revision_requested"
    | "change_requested"
    | "change_approved"
    | "change_rejected";
  comment: string | null;
  created_at: string;
}

export interface ChangeRequest {
  id: string;
  report_id: string;
  project_id: string;
  requester_id: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewer_id: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface SnapshotItem {
  process_name: string | null;
  task_title: string | null;
  content: string;
  result: string | null;
  quantity: number | null;
  unit: string | null;
  status: ItemStatus;
  process_progress: number | null;
}

export interface SnapshotReport {
  report_id: string;
  author_id: string;
  author_name: string;
  company: string | null;
  role: AppRole | null;
  start_time: string;
  end_time: string;
  break_minutes: number;
  work_minutes: number;
  notes: string | null;
  support_request: string | null;
  next_day_plan: string | null;
  photo_count: number;
  items: SnapshotItem[];
}

export interface ConsolidatedSnapshot {
  report_date: string;
  worker_count: number;
  total_work_minutes: number;
  progress: { actual: number; planned: number } | null;
  reports: SnapshotReport[];
  by_process: {
    process_id: string | null;
    process_name: string;
    worker_count: number;
    items: { author_name: string; content: string; result: string | null; quantity: number | null; unit: string | null; status: ItemStatus }[];
  }[];
  issues: { author_name: string; text: string }[];
  support_requests: { author_name: string; text: string }[];
  next_day_plans: { author_name: string; text: string }[];
}

export interface ConsolidatedReport {
  id: string;
  project_id: string;
  report_date: string;
  weather: string | null;
  summary: string | null;
  snapshot: ConsolidatedSnapshot;
  is_finalized: boolean;
  finalized_at: string | null;
  generated_at: string;
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** 대기 중인 초대(dw_invites). 전사 역할 초대는 global_role 만, 사업장 초대는 project_id·role 만 채워진다. */
export interface Invite {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  project_id: string | null;
  role: ProjectRole | null;
  global_role: GlobalRole | null;
  invited_by: string | null;
  created_at: string;
}
