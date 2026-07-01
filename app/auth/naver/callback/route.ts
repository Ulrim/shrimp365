import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"

/**
 * 네이버 로그인 2단계 — 인가 코드를 받아 세션을 발급한다.
 *
 * 흐름:
 *  1. state 쿠키 대조 (CSRF 방지)
 *  2. code → 네이버 access token 교환
 *  3. 네이버 프로필 조회 (email, name)
 *  4. Supabase admin으로 사용자 생성/조회 (이메일 기준)
 *  5. magiclink 해시 토큰 생성 → 기존 /auth/callback 으로 넘겨 세션 쿠키 설정
 */
export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, siteUrl))

  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail("naver_not_configured")

  const { searchParams } = req.nextUrl
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const cookieState = req.cookies.get("naver_oauth_state")?.value

  if (!code || !state) return fail("naver_missing_code")
  if (!cookieState || cookieState !== state) return fail("naver_state_mismatch")

  try {
    // 2. access token 교환
    const tokenRes = await fetch(
      `https://nid.naver.com/oauth2.0/token?grant_type=authorization_code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}` +
        `&code=${encodeURIComponent(code)}` +
        `&state=${encodeURIComponent(state)}`,
      { method: "GET" }
    )
    const tokenJson = await tokenRes.json()
    const accessToken = tokenJson.access_token
    if (!accessToken) {
      console.error("[naver] token exchange failed:", tokenJson)
      return fail("naver_token_failed")
    }

    // 3. 프로필 조회
    const profileRes = await fetch("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profileJson = await profileRes.json()
    const profile = profileJson?.response
    const email: string | undefined = profile?.email
    const name: string = profile?.name || profile?.nickname || (email ? email.split("@")[0] : "네이버 사용자")

    if (!email) {
      // 네이버 앱에서 이메일 제공 항목을 필수로 설정해야 한다.
      return fail("naver_no_email")
    }

    // 4. admin으로 사용자 생성/조회
    const admin = createAdminClient()
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name, provider: "naver" },
    })
    // 이미 존재하는 사용자면 무시하고 진행
    if (createErr && !/already been registered|already exists|duplicate/i.test(createErr.message)) {
      console.error("[naver] createUser failed:", createErr.message)
      return fail("naver_user_failed")
    }

    // 5. magiclink 해시 토큰 생성 → /auth/callback 이 verifyOtp 로 세션 설정
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    })
    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("[naver] generateLink failed:", linkErr?.message)
      return fail("naver_link_failed")
    }

    const callback = new URL("/auth/callback", siteUrl)
    callback.searchParams.set("token_hash", linkData.properties.hashed_token)
    callback.searchParams.set("type", "magiclink")
    callback.searchParams.set("next", "/home")

    const res = NextResponse.redirect(callback)
    res.cookies.delete("naver_oauth_state")
    return res
  } catch (err) {
    console.error("[naver] callback error:", err)
    return fail("naver_callback")
  }
}
