import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, diffDays, eachDay, endOfMonth, formatDate, formatMinutes, isDateString, startOfMonth,
  startOfWeek, workMinutes,
} from "@/lib/work/dates";

describe("날짜 계산", () => {
  it("날짜 형식을 검증한다", () => {
    expect(isDateString("2026-11-24")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-1-1")).toBe(false);
    expect(isDateString(undefined)).toBe(false);
  });

  it("월말·연말을 넘어 날짜를 더한다", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(diffDays("2026-11-01", "2026-11-24")).toBe(23);
  });

  it("주의 시작은 월요일이다", () => {
    expect(startOfWeek("2026-11-24")).toBe("2026-11-23"); // 화요일 → 월요일
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23"); // 일요일 → 그 주 월요일
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23");
  });

  it("월의 시작과 끝, 월 이동", () => {
    expect(startOfMonth("2026-11-24")).toBe("2026-11-01");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });

  it("기간의 모든 날짜를 나열한다", () => {
    expect(eachDay("2026-11-29", "2026-12-01")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
    expect(eachDay("2026-12-02", "2026-12-01")).toEqual([]);
  });

  it("표시 형식", () => {
    expect(formatDate("2026-11-24")).toBe("2026.11.24 (화)");
    expect(formatDate(null)).toBe("-");
    expect(formatMinutes(510)).toBe("8시간 30분");
    expect(formatMinutes(480)).toBe("8시간");
    expect(formatMinutes(45)).toBe("45분");
  });
});

describe("실제 작업시간 계산", () => {
  it("종료 - 시작 - 휴게", () => {
    expect(workMinutes("08:00", "17:30", 60)).toBe(510);
    expect(workMinutes("08:00:00", "17:00:00", 0)).toBe(540);
  });
  it("휴게가 더 길면 0 이하가 된다", () => {
    expect(workMinutes("08:00", "09:00", 60)).toBe(0);
    expect(workMinutes("08:00", "09:00", 90)).toBe(-30);
  });
  it("형식이 잘못되면 null", () => {
    expect(workMinutes("", "17:00", 60)).toBeNull();
    expect(workMinutes("25:00", "17:00", 60)).toBeNull();
  });
});
