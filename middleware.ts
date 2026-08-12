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

/** 접속 국가. Vercel 엣지가 넣어 주는 헤더가 유일하게 신뢰할 수 있는 출처다.
 *  (NextRequest.geo는 최신 버전에서 제거됐다.) */
function requestCountry(request: NextRequest): string | null {
  return request.headers.get("x-vercel-ip-country")
}

function detectLocale(request: NextRequest): Locale | null {
  // 1. Respect existing user preference cookie
  const existing = request.cookies.get(LANG_COOKIE)?.value
  if (existing && LOCALES.includes(existing as Locale)) return existing as Locale

  // 2. 접속 국가(IP)
  const country = requestCountry(request)
  if (country) return countryToLocale(country)

  // 3. Accept-Language header fallback
  return headerToLocale(request.headers.get("accept-language"))
}

// 검색·SNS 크롤러는 국가로 리다이렉트하지 않는다.
// 구글봇은 대부분 미국 IP에서 오므로 리다이렉트하면 루트(한국어)가 영어로만
// 수집되어 한국어 색인이 사라진다. SNS 미리보기 봇도 마찬가지다.
const CRAWLER_UA = /bot|crawler|spider|crawling|yeti|slurp|facebookexternalhit|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkshare|w3c_validator|whatsapp|telegram|discord|preview/i

function isCrawler(request: NextRequest): boolean {
  return CRAWLER_UA.test(request.headers.get("user-agent") ?? "")
}

// Public marketing routes served per-language under a URL prefix (Korean = root).
const MARKETING_LOCALE_PREFIXES = ["en", "vi", "id"]

// 접두사 없는 한국어판 공개 페이지. 각각 /en·/vi·/id 짝이 있다.
// "/" 도 포함한다. 루트는 한국어판 랜딩이고 /en·/vi·/id 짝이 있다.
// (p === "/" 일 때 startsWith("//") 는 실질적으로 pathname === "/" 만 매칭한다.)
// /muan-3d 는 한국어판만 있는 공개 페이지다. 나머지는 /en·/vi·/id 짝이 있다.
// 짝이 있든 없든 여기 있으면 언어가 한국어로 고정되므로, 영어 쿠키를 가진
// 방문자가 와도 한국어 본문에 영어 껍데기가 씌워지는 일이 없다.
const KOREAN_PUBLIC_PATHS = ["/", "/cardnews", "/board", "/guide", "/pricing", "/terms", "/privacy", "/muan-3d"]

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

  // 첫 방문자를 접속 국가에 맞는 언어 주소로 보낸다.
  //   · 루트("/")에서만 동작한다. 다른 주소는 이미 언어가 정해져 있다.
  //   · 언어를 한 번이라도 고른 적 있으면(쿠키) 그 선택을 존중한다.
  //     이게 없으면 베트남 사용자가 한국어를 골라도 /로 갈 때마다 /vi로 되돌아간다.
  //   · 크롤러는 제외한다(위 isCrawler 주석 참고).
  //   · 임시 이동(307)이라 검색엔진이 주소를 옮겨 기록하지 않는다.
  if (pathname === "/" && !request.cookies.get(LANG_COOKIE)?.value && !isCrawler(request)) {
    const country = requestCountry(request)
    const target = country
      ? countryToLocale(country)
      : headerToLocale(request.headers.get("accept-language"))

    if (target !== "ko") {
      const url = request.nextUrl.clone()
      url.pathname = `/${target}`
      const redirect = NextResponse.redirect(url, 307)
      // 같은 주소라도 국가·언어·봇 여부에 따라 응답이 달라진다는 표시.
      redirect.headers.set("Vary", "Accept-Language, User-Agent")
      // 자동 이동은 첫 방문 한 번만. 쿠키를 여기서 남겨 두면 이후 사용자가
      // 한국어를 골라 "/"로 와도 다시 튕기지 않는다.
      redirect.cookies.set(LANG_COOKIE, target, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      })
      return redirect
    }
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

