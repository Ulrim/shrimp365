import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * Auth callback for email confirmation, magic links, and password recovery.
 *
 * Supabase (PKCE flow, the @supabase/ssr default) appends `?code=...` to the
 * email link's redirect target. We must exchange that code for a session here,
 * otherwise clicking the confirmation link never logs the user in.
 *
 * We also support the `?token_hash=...&type=...` style (verifyOtp), which works
 * across devices when the email template is customized to use it.
 *
 * Point emailRedirectTo / redirectTo at: `${SITE_URL}/auth/callback?next=/home`
 */
export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
  const { searchParams } = req.nextUrl

  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")
  const next = searchParams.get("next") || "/home"
  // Keep redirects same-origin only. Reject protocol-relative ("//evil.com")
  // and backslash-prefixed ("/\evil.com") URLs which resolve to external hosts.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
      ? next
      : "/home"

  const redirectTo = new URL(safeNext, siteUrl)
  const response = NextResponse.redirect(redirectTo)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        console.error("[auth/callback] exchangeCodeForSession failed:", error.message)
        return NextResponse.redirect(new URL("/login?error=auth_callback", siteUrl))
      }
      return response
    }

    if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: type as any,
        token_hash: tokenHash,
      })
      if (error) {
        console.error("[auth/callback] verifyOtp failed:", error.message)
        return NextResponse.redirect(new URL("/login?error=auth_callback", siteUrl))
      }
      return response
    }
  } catch (err) {
    console.error("[auth/callback] error:", err)
    return NextResponse.redirect(new URL("/login?error=auth_callback", siteUrl))
  }

  // No recognizable params — fall back to login
  return NextResponse.redirect(new URL("/login", siteUrl))
}
