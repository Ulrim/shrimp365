import {
  EVENT_TYPE, GLOBAL_ROLE_LABEL, ITEM_STATUS, PROJECT_STATUS, REPORT_STATUS, ROLE_LABEL, TASK_PRIORITY, TASK_STATUS,
  type Tone,
} from "@/lib/work/constants";

export const TABLE_LABEL: Record<string, string> = {
  daily_reports: "작업일보",
  report_items: "작업내역",
  tasks: "업무",
  processes: "공정",
  schedule_events: "일정",
  project_members: "구성원",
  report_photos: "사진",
  change_requests: "수정 요청",
  consolidated_reports: "통합일보",
  projects: "사업장",
  profiles: "계정",
};

export const ACTION_LABEL: Record<string, { label: string; tone: Tone }> = {
  INSERT: { label: "등록", tone: "green" },
  UPDATE: { label: "수정", tone: "blue" },
  DELETE: { label: "삭제", tone: "red" },
};

export const FIELD_LABEL: Record<string, string> = {
  status: "상태",
  work_date: "작업일",
  start_time: "시작시간",
  end_time: "종료시간",
  break_minutes: "휴게시간(분)",
  work_minutes: "실제 작업시간(분)",
  notes: "특이사항",
  support_request: "지원 요청사항",
  next_day_plan: "익일 작업계획",
  submitted_at: "제출 시각",
  approved_at: "승인 시각",
  approved_by: "승인자",
  author_id: "작성자",
  content: "작업내용",
  result: "작업실적",
  quantity: "수량",
  unit: "단위",
  task_progress: "업무 진행률",
  process_progress: "공정 누계 실적률",
  process_id: "공정",
  task_id: "배정 업무",
  sort_order: "순서",
  title: "제목",
  description: "설명",
  assignee_id: "담당자",
  assigned_by: "배정자",
  start_date: "시작일",
  due_date: "기한",
  end_date: "종료일",
  priority: "우선순위",
  progress: "진행률",
  completed_at: "완료 시각",
  name: "이름",
  weight: "가중치",
  planned_start: "계획 시작일",
  planned_end: "계획 종료일",
  actual_start: "실제 시작일",
  actual_end: "실제 종료일",
  event_type: "일정 유형",
  owner_id: "일정 소유자",
  role: "역할",
  user_id: "사용자",
  reason: "요청 사유",
  reviewer_id: "처리자",
  requester_id: "요청자",
  review_comment: "처리 의견",
  reviewed_at: "처리 시각",
  weather: "날씨",
  summary: "종합 의견",
  is_finalized: "확정 여부",
  finalized_by: "확정자",
  finalized_at: "확정 시각",
  code: "코드",
  location: "위치",
  email: "이메일",
  full_name: "이름",
  phone: "연락처",
  company: "소속",
  position: "직책",
  global_role: "전사 역할",
  is_active: "활성 여부",
  storage_path: "사진 경로",
  caption: "사진 설명",
  item_id: "작업내역",
};

/** 화면에 보여 주지 않는 내부 필드 */
export const HIDDEN_FIELDS = new Set(["updated_at", "created_at", "id", "project_id", "report_id", "snapshot", "generated_at", "uploaded_by", "created_by"]);

export const PERSON_FIELDS = new Set([
  "approved_by", "author_id", "assignee_id", "assigned_by", "owner_id", "user_id", "reviewer_id", "requester_id", "finalized_by",
]);

const pick = (map: Record<string, { label: string }>) => (v: string) => map[v]?.label ?? v;

/** 테이블·필드별 코드값 → 한국어 */
export function enumLabel(table: string, field: string, value: string): string | null {
  if (field === "status") {
    if (table === "daily_reports") return pick(REPORT_STATUS)(value);
    if (table === "report_items") return pick(ITEM_STATUS)(value);
    if (table === "tasks") return pick(TASK_STATUS)(value);
    if (table === "projects") return pick(PROJECT_STATUS)(value);
    if (table === "change_requests") return { pending: "대기", approved: "승인", rejected: "반려" }[value] ?? value;
  }
  if (field === "priority") return pick(TASK_PRIORITY)(value);
  if (field === "event_type") return pick(EVENT_TYPE)(value);
  if (field === "role") return (ROLE_LABEL as Record<string, string>)[value] ?? value;
  if (field === "global_role") return (GLOBAL_ROLE_LABEL as Record<string, string>)[value] ?? value;
  return null;
}
