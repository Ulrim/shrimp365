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

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRO_PRICE_ID) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const origin = req.headers.get("origin") || "http://localhost:3000"

  // 기존 stripe_customer_id 조회
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, plan")
    .eq("id", user.id)
    .single()

  if (profile?.plan === "pro" || profile?.plan === "enterprise") {
    return NextResponse.json({ error: "이미 유료 플랜을 구독 중입니다." }, { status: 400 })
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
    locale: "ko",
    metadata: { user_id: user.id },
    subscription_data: { metadata: { user_id: user.id } },
  }

  // 기존 customer가 있으면 연결
  if (profile?.stripe_customer_id) {
    sessionParams.customer = profile.stripe_customer_id
  } else {
    sessionParams.customer_email = user.email
  }

  const session = await stripe.checkout.sessions.create(sessionParams)
  return NextResponse.json({ url: session.url })
}
