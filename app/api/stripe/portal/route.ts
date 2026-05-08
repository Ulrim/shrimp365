import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createServerClient } from "@supabase/ssr"

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: "구독 정보가 없습니다." }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const origin = req.headers.get("origin") || "http://localhost:3000"

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  })

  return NextResponse.json({ url: portalSession.url })
}
