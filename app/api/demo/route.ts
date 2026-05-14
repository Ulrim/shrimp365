import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"

const DEMO_EMAIL = "admin@shrimp365.com"

export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin

  // SERVICE_ROLE_KEY 없으면 로그인 페이지로 fallback
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.redirect(new URL("/login", siteUrl))
  }

  try {
    const admin = createAdminClient()

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: DEMO_EMAIL,
      options: { redirectTo: `${siteUrl}/dashboard` },
    })

    if (error || !data?.properties?.action_link) {
      console.error("[demo] generateLink failed:", error)
      return NextResponse.redirect(new URL("/login", siteUrl))
    }

    // Supabase verification URL → 방문하면 세션 생성 후 /dashboard로 이동
    return NextResponse.redirect(data.properties.action_link)
  } catch (err) {
    console.error("[demo] error:", err)
    return NextResponse.redirect(new URL("/login", siteUrl))
  }
}
