import { workHref } from "./constants";
import type { AppRole } from "./types";

export interface NavItem {
  /** `/daumlabs/work/...` 전체 경로 */
  href: string;
  label: string;
  icon: "dashboard" | "report" | "review" | "task" | "calendar" | "progress" | "consolidated" | "output" | "bell" | "history" | "users" | "building" | "user";
  /** 접근 가능한 역할. 생략하면 모든 역할. */
  roles?: AppRole[];
  group: "업무" | "공정·보고" | "관리";
}

const MANAGERS: AppRole[] = ["executive", "site_manager"];
const INTERNAL: AppRole[] = ["executive", "site_manager", "site_worker"];

export const NAV_ITEMS: NavItem[] = [
  { href: workHref("/dashboard"), label: "대시보드", icon: "dashboard", group: "업무" },
  { href: workHref("/reports"), label: "작업일보", icon: "report", group: "업무" },
  { href: workHref("/reviews"), label: "검토함", icon: "review", roles: MANAGERS, group: "업무" },
  { href: workHref("/tasks"), label: "업무", icon: "task", group: "업무" },
  { href: workHref("/calendar"), label: "캘린더", icon: "calendar", group: "업무" },
  { href: workHref("/progress"), label: "공정 관리", icon: "progress", roles: INTERNAL, group: "공정·보고" },
  { href: workHref("/consolidated"), label: "통합 작업일보", icon: "consolidated", roles: INTERNAL, group: "공정·보고" },
  { href: workHref("/outputs"), label: "보고서", icon: "output", roles: INTERNAL, group: "공정·보고" },
  { href: workHref("/notifications"), label: "알림", icon: "bell", group: "관리" },
  { href: workHref("/history"), label: "변경 이력", icon: "history", roles: MANAGERS, group: "관리" },
  { href: workHref("/admin/users"), label: "계정 관리", icon: "users", roles: MANAGERS, group: "관리" },
  { href: workHref("/admin/projects"), label: "사업장 관리", icon: "building", roles: ["executive"], group: "관리" },
  { href: workHref("/admin/account"), label: "내 프로필", icon: "user", group: "관리" },
];

export function navFor(role: AppRole | null): NavItem[] {
  if (!role) return NAV_ITEMS.filter((item) => item.href === workHref("/notifications") || item.href === workHref("/admin/account"));
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
