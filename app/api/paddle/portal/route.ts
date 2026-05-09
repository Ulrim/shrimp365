import { NextRequest, NextResponse } from "next/server"
import { Paddle, Environment } from "@paddle/paddle-node-sdk"
import { createServerClient } from "@supabase/ssr"

const PADDLE_ENV = process.env.PADDLE_ENV === "production"
  ? Environment.production
  : Environment.sandbox

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })

  if (!process.env.PADDLE_API_KEY) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("paddle_customer_id")
    .eq("id", user.id)
    .single()

  if (!profile?.paddle_customer_id) {
    return NextResponse.json({ error: "구독 정보가 없습니다." }, { status: 400 })
  }

  const paddle = new Paddle(process.env.PADDLE_API_KEY, { environment: PADDLE_ENV })
  const session = await paddle.customerPortalSessions.create(profile.paddle_customer_id, [])

  return NextResponse.json({ url: session.urls.general.overview })
}
