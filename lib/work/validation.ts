import { z } from "zod";
import { isDateString, today, workMinutes } from "./dates";

const text = (max: number) => z.string().trim().max(max, `${max}자 이내로 입력해 주세요.`);
const optionalText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));
const date = z.string().refine(isDateString, "날짜 형식이 올바르지 않습니다.");
const optionalDate = z
  .union([date, z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시간 형식이 올바르지 않습니다.");
const uuid = z.string().uuid("잘못된 식별자입니다.");
const optionalUuid = z
  .union([uuid, z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));
const percent = z.coerce.number().min(0, "0 이상이어야 합니다.").max(100, "100 이하여야 합니다.");
const optionalPercent = z
  .union([z.literal(""), percent])
  .nullish()
  .transform((v) => (v === "" || v == null ? null : v));

export const reportItemSchema = z.object({
  process_id: optionalUuid,
  task_id: optionalUuid,
  content: text(2000).min(1, "작업내용을 입력해 주세요."),
  result: optionalText(2000),
  quantity: z
    .union([z.literal(""), z.coerce.number().min(0, "수량은 0 이상이어야 합니다.").max(9999999999)])
    .nullish()
    .transform((v) => (v === "" || v == null ? null : v)),
  unit: optionalText(20),
  status: z.enum(["in_progress", "completed", "delayed", "on_hold"]),
  task_progress: optionalPercent.transform((v) => (v == null ? null : Math.round(v))),
  process_progress: optionalPercent,
});

export const reportSchema = z
  .object({
    work_date: date,
    start_time: time,
    end_time: time,
    break_minutes: z.coerce.number().int("분 단위 정수로 입력해 주세요.").min(0, "휴게시간은 0분 이상이어야 합니다.").max(600),
    notes: optionalText(2000),
    support_request: optionalText(2000),
    next_day_plan: optionalText(2000),
    items: z.array(reportItemSchema).max(30, "작업내역은 30건까지 등록할 수 있습니다."),
  })
  .superRefine((v, ctx) => {
    if (v.work_date > today()) {
      ctx.addIssue({ code: "custom", path: ["work_date"], message: "미래 날짜의 작업일보는 작성할 수 없습니다." });
    }
    const minutes = workMinutes(v.start_time, v.end_time, v.break_minutes);
    if (v.end_time <= v.start_time) {
      ctx.addIssue({ code: "custom", path: ["end_time"], message: "종료시간은 시작시간보다 늦어야 합니다." });
    } else if (minutes == null || minutes <= 0) {
      ctx.addIssue({ code: "custom", path: ["break_minutes"], message: "휴게시간이 근무시간보다 길 수 없습니다." });
    }
  });
export type ReportInput = z.input<typeof reportSchema>;

export const taskSchema = z
  .object({
    title: text(200).min(1, "업무명을 입력해 주세요."),
    description: optionalText(2000),
    assignee_id: uuid,
    process_id: optionalUuid,
    start_date: optionalDate,
    due_date: optionalDate,
    priority: z.enum(["low", "normal", "high", "urgent"]),
    status: z.enum(["todo", "in_progress", "done", "on_hold"]).default("todo"),
    progress: z.coerce.number().int().min(0).max(100).default(0),
  })
  .refine((v) => !v.start_date || !v.due_date || v.due_date >= v.start_date, {
    path: ["due_date"],
    message: "기한은 시작일 이후여야 합니다.",
  });
export type TaskInput = z.input<typeof taskSchema>;

export const taskProgressSchema = z.object({
  status: z.enum(["todo", "in_progress", "done", "on_hold"]),
  progress: z.coerce.number().int().min(0, "0 이상이어야 합니다.").max(100, "100 이하여야 합니다."),
});

export const processSchema = z
  .object({
    name: text(100).min(1, "공정명을 입력해 주세요."),
    description: optionalText(1000),
    sort_order: z.coerce.number().int().min(0).max(9999).default(0),
    weight: z.coerce.number().min(0, "가중치는 0 이상이어야 합니다.").max(9999),
    planned_start: date,
    planned_end: date,
    actual_start: optionalDate,
    actual_end: optionalDate,
    progress: percent,
  })
  .superRefine((v, ctx) => {
    if (v.planned_end < v.planned_start) {
      ctx.addIssue({ code: "custom", path: ["planned_end"], message: "계획 종료일은 시작일 이후여야 합니다." });
    }
    if (v.actual_start && v.actual_end && v.actual_end < v.actual_start) {
      ctx.addIssue({ code: "custom", path: ["actual_end"], message: "실제 종료일은 시작일 이후여야 합니다." });
    }
  });
export type ProcessInput = z.input<typeof processSchema>;

export const eventSchema = z
  .object({
    title: text(200).min(1, "일정명을 입력해 주세요."),
    description: optionalText(1000),
    start_date: date,
    end_date: date,
    event_type: z.enum(["construction", "meeting", "inspection", "delivery", "personal", "other"]),
    personal: z.boolean().default(false),
    process_id: optionalUuid,
  })
  .refine((v) => v.end_date >= v.start_date, { path: ["end_date"], message: "종료일은 시작일 이후여야 합니다." });
export type EventInput = z.input<typeof eventSchema>;

export const projectSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,20}$/, "코드는 영문 대문자·숫자·하이픈 2~20자로 입력해 주세요."),
    name: text(100).min(1, "사업장명을 입력해 주세요."),
    location: optionalText(200),
    description: optionalText(1000),
    start_date: optionalDate,
    end_date: optionalDate,
    status: z.enum(["planning", "active", "completed", "suspended"]),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, {
    path: ["end_date"],
    message: "종료일은 시작일 이후여야 합니다.",
  });
export type ProjectInput = z.input<typeof projectSchema>;

/** 구성원 초대. 계정은 shrimp365 가입으로 만들어지므로 비밀번호를 받지 않는다. */
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다."),
  role: z.enum(["chairman", "ceo", "site_manager", "site_worker", "partner"]),
  full_name: optionalText(50),
  phone: optionalText(30),
  company: optionalText(100),
  position: optionalText(50),
});
export type InviteInput = z.input<typeof inviteSchema>;

export const userUpdateSchema = z.object({
  full_name: text(50).min(1, "이름을 입력해 주세요."),
  phone: optionalText(30),
  company: optionalText(100),
  position: optionalText(50),
});

export const commentSchema = text(1000);
export const requiredCommentSchema = text(1000).min(1, "사유를 입력해 주세요.");
export { date as dateSchema, uuid as uuidSchema };

/** zod 오류의 첫 메시지를 꺼낸다. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "입력값을 확인해 주세요.";
}
