// 관리자 콘솔(/admin/**) 화면 권한 판정 — 한 곳에서만 한다(설계서 admin-console.md 3장).
//
// 이 판정은 **메뉴 노출과 화면 가드용 편의**일 뿐이다. 실제 차단은 서버가 한다
// (lib/control-auth.ts, app/api/admin/* 의 이메일+role 검사). 브라우저의 role 값은
// 누구든 바꿀 수 있으므로 이 함수의 결과로 데이터를 내주지 않는다.
import { isMonitorAccount, isTestAccount } from "@/lib/mock-data"

/** 총관리자 이메일 — 기존 시스템 모니터링 화면과 같은 기준. */
const SUPER_ADMIN_EMAIL = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || "kjs100184@gmail.com").trim().toLowerCase()

export type AdminPageKey = "overview" | "users" | "control" | "managers" | "diagnostics"

export type AdminAccess = { console: boolean } & Record<AdminPageKey, boolean>

type AccessUser = { email?: string | null; role?: string | null } | null | undefined

/** 총관리자인가 — role 이 아니라 이메일로 판정한다(서버와 같은 방식). */
export function isSuperAdminEmail(email?: string | null): boolean {
  return (email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL
}

/** 3장 권한 매트릭스.
 *
 *  | 화면        | manager | admin | 총관리자 | 모니터·테스트(추가분) |
 *  | 개요        |   →관제  |  ✅   |   ✅    |   ✅(목데이터) |
 *  | 사용자      |    ✗    |  ✅   |   ✅    |   ✅(목데이터) |
 *  | 관제센터    |   ✅    |  ✅   |   ✅    |      ✗       |
 *  | 매니저 관리 |    ✗    |   ✗   |   ✅    |      ✗       |
 *  | 시스템 진단 |    ✗    |  ✅   |   ✅    |      ✗       |
 *
 *  모니터·테스트 계정 열은 **덧붙이는** 권한이다 — role 이 없어도 목데이터
 *  화면(개요·사용자)은 열어 준다. role 로 얻은 권한(관제센터·진단 등)은 빼지
 *  않는다: 실제 admin/manager 인 계정이 데모 이메일이라는 이유로 잠기면 안 된다.
 *  (그 화면들의 데이터는 어차피 서버가 role·이메일로 다시 거른다.) */
export function adminAccess(user: AccessUser): AdminAccess {
  if (!user) {
    return { console: false, overview: false, users: false, control: false, managers: false, diagnostics: false }
  }
  const isSuper = isSuperAdminEmail(user.email)
  const isMock = isMonitorAccount(user.email) || isTestAccount(user.email)
  const isAdmin = user.role === "admin" || isSuper
  const isManager = user.role === "manager"

  const overview = isAdmin || isMock
  const users = overview
  const control = isAdmin || isManager
  const managers = isSuper
  const diagnostics = isAdmin

  return {
    console: overview || users || control || managers || diagnostics,
    overview,
    users,
    control,
    managers,
    diagnostics,
  }
}

/** 콘솔 각 화면의 주소 — 메뉴 순서이자 "권한 있는 첫 페이지" 탐색 순서. */
export const ADMIN_PAGES: { key: AdminPageKey; href: string }[] = [
  { key: "overview", href: "/admin" },
  { key: "users", href: "/admin/users" },
  { key: "control", href: "/admin/control" },
  { key: "managers", href: "/admin/managers" },
  { key: "diagnostics", href: "/admin/diagnostics" },
]

/** 주소 → 화면 키. 콘솔 화면이 아니면(없는 하위 주소 등) null. */
export function adminPageOf(pathname: string): AdminPageKey | null {
  const path = pathname.replace(/\/+$/, "") || "/"
  return ADMIN_PAGES.find(p => p.href === path)?.key ?? null
}

/** 권한 있는 첫 페이지. 하나도 없으면 null(호출부가 서비스 홈으로 보낸다). */
export function firstAllowedAdminHref(access: AdminAccess): string | null {
  return ADMIN_PAGES.find(p => access[p.key])?.href ?? null
}
