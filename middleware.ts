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
]

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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

  if (isAuthPage && user) {
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

