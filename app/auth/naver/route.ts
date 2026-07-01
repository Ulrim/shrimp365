import { NextRequest, NextResponse } from "next/server"

/**
 * 네이버 로그인 1단계 — 네이버 인가 페이지로 리다이렉트.
 *
 * 네이버는 Supabase 기본 OAuth 공급자가 아니므로 직접 구현한다.
 * CSRF 방지를 위해 무작위 state를 httpOnly 쿠키에 저장한 뒤 콜백에서 대조한다.
 *
 * 필요한 환경변수:
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
 *   NEXT_PUBLIC_SITE_URL (콜백 redirect_uri 구성용)
 * 네이버 개발자센터에 등록할 Callback URL: {SITE_URL}/auth/naver/callback
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.NAVER_CLIENT_ID
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin

  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=naver_not_configured", siteUrl))
  }

  const state = crypto.randomUUID()
  const redirectUri = `${siteUrl}/auth/naver/callback`

  const authorizeUrl = new URL("https://nid.naver.com/oauth2.0/authorize")
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", clientId)
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("state", state)

  const res = NextResponse.redirect(authorizeUrl)
  res.cookies.set("naver_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10분
  })
  return res
}
