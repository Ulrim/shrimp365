// 모든 날짜는 Asia/Seoul 기준의 'YYYY-MM-DD' 문자열로 다룬다.
export const TIME_ZONE = "Asia/Seoul";

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function today(): string {
  return ymd.format(new Date());
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);
}

/** 0(일) ~ 6(토) */
export function dayOfWeek(date: string): number {
  return toUtc(date).getUTCDay();
}

/** 해당 날짜가 속한 주의 월요일 */
export function startOfWeek(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const d = toUtc(startOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromUtc(d);
}

export function addMonths(date: string, months: number): string {
  const d = toUtc(startOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUtc(d);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 2026-11-24 → 2026.11.24 (화) */
export function formatDate(date: string | null | undefined, withWeekday = true): string {
  if (!date) return "-";
  const base = date.slice(0, 10).replaceAll("-", ".");
  return withWeekday ? `${base} (${WEEKDAYS[dayOfWeek(date.slice(0, 10))]})` : base;
}

/** 11.24 */
export function formatShortDate(date: string | null | undefined): string {
  if (!date) return "-";
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
}

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return dateTime.format(new Date(value));
}

/** '08:00:00' → '08:00' */
export function formatTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : "-";
}

/** 510 → '8시간 30분' */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 실제 작업시간(분) = 종료 - 시작 - 휴게. 시간 형식이 잘못되면 null. */
export function workMinutes(start: string, end: string, breakMinutes: number): number | null {
  const parse = (t: string) => {
    const m = /^(\d{2}):(\d{2})/.exec(t);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h > 23 || min > 59 ? null : h * 60 + min;
  };
  const s = parse(start);
  const e = parse(end);
  if (s == null || e == null) return null;
  return e - s - breakMinutes;
}
