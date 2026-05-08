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

  const body = await req.json().catch(() => ({}))
  const targetPlan: "basic" | "pro" = body.plan === "basic" ? "basic" : "pro"

  const priceId = targetPlan === "basic"
    ? process.env.STRIPE_BASIC_PRICE_ID
    : process.env.STRIPE_PRO_PRICE_ID

  if (!priceId) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, plan")
    .eq("id", user.id)
    .single()

  const planRank: Record<string, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 }
  if ((planRank[profile?.plan ?? "free"] ?? 0) >= planRank[targetPlan]) {
    return NextResponse.json({ error: "이미 해당 플랜 이상을 구독 중입니다." }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  const allowedOrigins = [siteUrl, "http://localhost:3000"].filter(Boolean)
  const requestOrigin = req.headers.get("origin") ?? ""
  const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : siteUrl

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}&plan=${targetPlan}`,
    cancel_url: `${origin}/pricing`,
    locale: "ko",
    metadata: { user_id: user.id, target_plan: targetPlan },
    subscription_data: { metadata: { user_id: user.id, target_plan: targetPlan } },
  }

  if (profile?.stripe_customer_id) {
    sessionParams.customer = profile.stripe_customer_id
  } else {
    sessionParams.customer_email = user.email
  }

  const session = await stripe.checkout.sessions.create(sessionParams)
  return NextResponse.json({ url: session.url })
}
