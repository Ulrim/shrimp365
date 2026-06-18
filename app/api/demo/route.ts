import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"

const DEMO_EMAIL = "admin@shrimp365.com"

export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.redirect(new URL("/login", siteUrl))
  }

  try {
    const admin = createAdminClient()

    // Generate a magic link token via admin (no email sent, we consume it server-side)
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: DEMO_EMAIL,
      // redirectTo is irrelevant — we verify server-side and never follow the link
      options: { redirectTo: `${siteUrl}/dashboard` },
    })

    if (error || !data?.properties?.hashed_token) {
      console.error("[demo] generateLink failed:", error)
      return NextResponse.redirect(new URL("/login", siteUrl))
    }

    // Build a redirect response with session cookies baked in
    const redirectResponse = NextResponse.redirect(new URL("/dashboard", siteUrl))

    // Create a regular SSR client that writes cookies into the redirect response
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              redirectResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // Exchange the hashed token for a real session — sets cookies via setAll above
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
    })

    if (verifyError) {
      console.error("[demo] verifyOtp failed:", verifyError)
      return NextResponse.redirect(new URL("/login", siteUrl))
    }

    // Session cookies are set; browser goes straight to /dashboard
    return redirectResponse
  } catch (err) {
    console.error("[demo] error:", err)
    return NextResponse.redirect(new URL("/login", siteUrl))
  }
}
