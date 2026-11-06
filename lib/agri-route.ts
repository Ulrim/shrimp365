// 농업(수경재배) 화면 판정 — **URL이 화면을 결정한다**(설계서 3장).
//
//   /daumlabs/**  →  농업 화면
//   그 밖의 대시보드 URL  →  기존 새우 양식 화면
//
// 컨텍스트도 프로바이더도 DB 조회도 없다. 순수 함수 + pathname 훅 하나뿐이라
// 비동기가 없고, 따라서 첫 페인트가 항상 옳다.
//
// 3단계(새우 정리) 이후 공유 뷰가 없어져 `agriHref`·`useAgriRoute`·
// `belongsToAgriScreen`·`AGRI_HIDDEN_NAV` 는 지웠다. 농업 뷰는 `/daumlabs/...`
// 리터럴을 쓰고, 새우 뷰는 `farm_type !== "agriculture"` 필터를 각자 가진다.

"use client"

import { useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"

/** 농업 화면 URL 접두사. 법인명 다움랩스의 로마자 표기. */
export const AGRI_PREFIX = "/daumlabs"

/** `/daumlabs` 아래에 실제로 존재하는 경로(설계서 4-2).
 *  여기 없는 주소엔 접두사를 붙이지 않는다 — 붙이면 404가 되기 때문이다. */
export const AGRI_ROUTES = [
  "/home",
  "/record",
  "/record/water-quality",
  "/record/journal",
  "/dashboard",
  "/water-quality",
  "/journal",
  "/farms",
] as const

const AGRI_ROUTE_SET: ReadonlySet<string> = new Set(AGRI_ROUTES)

/** 쿼리스트링·해시를 뗀 경로 부분만 돌려준다. `/water-quality?tank=1` → `/water-quality` */
function pathOnly(href: string): string {
  const cut = href.search(/[?#]/)
  return cut === -1 ? href : href.slice(0, cut)
}

/** 지금 보고 있는 주소가 농업 화면인가. */
export function isAgriPath(pathname: string): boolean {
  const p = pathOnly(pathname)
  return p === AGRI_PREFIX || p.startsWith(AGRI_PREFIX + "/")
}

/** 접두사를 떼어 새우 쪽 기준 경로로 되돌린다(헤더 제목표 같은 경로 키 맵 조회용).
 *  `/daumlabs/water-quality` → `/water-quality`, `/daumlabs` → `/home`.
 *  농업 경로가 아니면 그대로 돌려준다. */
export function stripAgriPrefix(pathname: string): string {
  if (!isAgriPath(pathname)) return pathname
  const rest = pathname.slice(AGRI_PREFIX.length)
  return rest === "" || rest === "/" ? "/home" : rest
}

// ── 모드 두 축 — 계정 모드(ui_mode)와 화면 URL (설계서 mode-split.md 2장) ──────
//
//   profiles.ui_mode = 이 계정의 기본 모드 (전환 스위치가 저장, /home 착지 결정)
//   URL(/daumlabs/**) = 지금 보고 있는 화면 (렌더링 판정은 계속 URL)

export type UiMode = "shrimp" | "agriculture"

/** 셸(사이드바 로고 글자·헤더 기본 제목·설정 패널 정보 탭)에 쓰는 제품 이름 —
 *  설계서 mode-split.md 1장 결정 3(2026-10-15 변경). 공개 화면(랜딩·게시판·카드뉴스)과
 *  PWA 제목은 여기 없다 — 언제나 Shrimp365 다. 한 곳에만 둔다. */
export const BRAND_NAME: Record<UiMode, string> = { shrimp: "Shrimp365", agriculture: "Farm365" }

/** 지금 주소가 어느 모드의 화면인가. `isAgriPath` 의 UiMode 표현. */
export function modeOfPath(pathname: string): UiMode {
  return isAgriPath(pathname) ? "agriculture" : "shrimp"
}

/** 지금 화면의 상대 모드 주소.
 *  - `/dashboard` ↔ `/daumlabs/dashboard` — AGRI_ROUTES 에 있으면 1:1 로 맞물린다.
 *  - 상대편에 없는 화면(`/production`, `/vision` …)이면 그쪽 홈으로 간다.
 *  - 이미 같은 모드면 그대로 돌려준다(쿼리스트링은 떼지 않는다). */
export function counterpartHref(pathname: string, to: UiMode): string {
  const current = modeOfPath(pathname)
  if (current === to) return pathname
  const base = stripAgriPrefix(pathOnly(pathname))
  const known = AGRI_ROUTE_SET.has(base) ? base : "/home"
  return to === "agriculture" ? AGRI_PREFIX + known : known
}

/** 전환 스위치가 쓰는 훅.
 *  - `current` = URL 기준(지금 보는 화면) — 스위치의 활성 칸은 이것을 따른다.
 *  - `saved`   = `user.ui_mode`(계정 설정).
 *  - `switchTo` = 저장(updateUiMode) 뒤 상대 주소로 이동. 저장이 실패해도 이동은
 *    한다 — URL 이 화면을 결정하므로(updateUiMode 는 실패를 삼키고 경고만 남긴다). */
export function useUiMode(): { current: UiMode; saved: UiMode; switchTo: (mode: UiMode) => Promise<void> } {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const { user, updateUiMode } = useAuth()
  const current = modeOfPath(pathname)
  const saved: UiMode = user?.ui_mode ?? "shrimp"
  const switchTo = useCallback(async (mode: UiMode) => {
    await updateUiMode(mode)
    const next = counterpartHref(pathname, mode)
    if (next !== pathname) router.push(next)
  }, [pathname, router, updateUiMode])
  return { current, saved, switchTo }
}
