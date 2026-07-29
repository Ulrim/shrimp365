import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { countryToLocale, headerToLocale, type Locale, LOCALES } from "@/lib/i18n"

const LANG_COOKIE = "shrimp365_lang"

const PROTECTED_PATHS = [
  "/home",
  "/record",
  "/dashboard",
  "/water-quality",
  "/journal",
  "/farms",
  "/diagnosis",
  "/ai-advisor",
  "/production",
  "/inventory",
  "/reports",
  "/onboarding",
  "/help",
]
// 참고: /board 는 비로그인 열람 허용(공개) — 보호 목록에서 제외.
//       글쓰기/댓글/수정은 페이지 단에서 로그인으로 유도한다.

function detectLocale(request: NextRequest): Locale | null {
  // 1. Respect existing user preference cookie
  const existing = request.cookies.get(LANG_COOKIE)?.value
  if (existing && LOCALES.includes(existing as Locale)) return existing as Locale

  // 2. Vercel geo (edge network) → country code
  const country = (request as unknown as { geo?: { country?: string } }).geo?.country
  if (country) return countryToLocale(country)

  // 3. Accept-Language header fallback
  return headerToLocale(request.headers.get("accept-language"))
}

// Public marketing routes served per-language under a URL prefix (Korean = root).
const MARKETING_LOCALE_PREFIXES = ["en", "vi", "id"]

// 접두사 없는 한국어판 공개 페이지. 각각 /en·/vi·/id 짝이 있다.
const KOREAN_PUBLIC_PATHS = ["/cardnews", "/board", "/guide", "/pricing", "/terms", "/privacy"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Localized marketing URLs (/en, /vi, /id …) — expose the locale to the root
  // layout via the x-locale request header so it can server-render the correct
  // <html lang> and content. These pages are public, so no auth check needed.
  const seg = pathname.split("/")[1]
  if (MARKETING_LOCALE_PREFIXES.includes(seg)) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-locale", seg)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // 접두사가 없는 공개 콘텐츠 경로는 항상 한국어다.
  // 이 주소들은 hreflang에서 ko-KR로 광고되고 서버 캐시가 URL 기준으로 재사용되므로,
  // 쿠키에 따라 내용이 달라지면 영어 방문자가 만든 캐시가 한국어 주소로 노출된다.
  if (KOREAN_PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-locale", "ko")
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const isProtected = PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))
  const isAuthPage = pathname === "/login" || pathname === "/signup" || pathname === "/verify-email" || pathname === "/forgot-password" || pathname === "/reset-password"

  if (!isProtected && !isAuthPage) return NextResponse.next()

  let response = NextResponse.next({ request })

  // Set language cookie if not already set (IP-based default)
  const locale = detectLocale(request)
  if (locale && !request.cookies.get(LANG_COOKIE)?.value) {
    response.cookies.set(LANG_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          if (locale && !request.cookies.get(LANG_COOKIE)?.value) {
            response.cookies.set(LANG_COOKIE, locale, {
              path: "/",
              maxAge: 60 * 60 * 24 * 365,
              sameSite: "lax",
            })
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // 로그인 상태면 인증 페이지는 홈으로 보낸다.
  // 단 /reset-password 는 예외 — 세션이 있는 상태(복구 링크 재방문 등)에서도
  // 비밀번호 변경 폼에 접근할 수 있어야 하므로 튕기지 않는다.
  if (isAuthPage && user && pathname !== "/reset-password") {
    const url = request.nextUrl.clone()
    url.pathname = "/home"
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
}

