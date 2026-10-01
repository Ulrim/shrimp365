// 농업(수경재배) 화면 판정 — **URL이 화면을 결정한다**(설계서 3장).
//
//   /daumlabs/**  →  농업 화면
//   그 밖의 대시보드 URL  →  기존 새우 양식 화면
//
// 컨텍스트도 프로바이더도 DB 조회도 없다. 순수 함수 + pathname 훅 하나뿐이라
// 비동기가 없고, 따라서 첫 페인트가 항상 옳다.

"use client"

import { usePathname } from "next/navigation"

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

/** 링크 주소에 농업 접두사를 먹인다.
 *  - `agri`가 false면 문자열이 그대로 나온다 — 새우 모드 회귀 0의 기계적 보증.
 *  - `AGRI_ROUTES`에 있는 경로만 붙인다. `/help`·`/board`·`/onboarding`·
 *    언어 접두사가 붙은 주소(`/en/cardnews`)는 손대지 않는다.
 *  - 쿼리스트링은 보존한다. 이미 접두사가 붙어 있으면 두 번 붙이지 않는다. */
export function agriHref(href: string, agri: boolean): string {
  if (!agri) return href
  if (!href.startsWith("/") || isAgriPath(href)) return href
  if (!AGRI_ROUTE_SET.has(pathOnly(href))) return href
  return AGRI_PREFIX + href
}

/** 이 농장(또는 그 농장에 속한 수조)이 지금 보고 있는 화면에 속하는가.
 *
 *  화면은 URL 이 정하고(`isAgri`) 데이터는 `farms.farm_type` 을 들고 있다.
 *  두 축이 어긋난 것을 한 목록에 섞으면 남의 기준으로 판정하게 된다 —
 *  새우 화면의 수경재배 베드는 염도 0·22 ℃ 때문에 통째로 빨개지고, 농업
 *  화면의 새우 수조는 pH 8.0 이 농업 기준(5.5~6.5)에 걸려 위험이 된다.
 *
 *  값이 없으면(마이그레이션 전 DB·목데이터) 언제나 새우로 본다. */
export function belongsToAgriScreen(
  farmType: "shrimp" | "agriculture" | null | undefined,
  isAgri: boolean,
): boolean {
  return ((farmType ?? "shrimp") === "agriculture") === isAgri
}

/** 화면에서 쓰는 훅. `const { isAgri, href } = useAgriRoute()` */
export function useAgriRoute(): { isAgri: boolean; href: (p: string) => string } {
  const pathname = usePathname()
  const isAgri = isAgriPath(pathname ?? "")
  return { isAgri, href: (p: string) => agriHref(p, isAgri) }
}
