import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { createServerClient } from "@supabase/ssr"

const DODO_ENV = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode"

export async function POST(req: NextRequest) {
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })

  const { plan } = await req.json() as { plan: "basic" | "pro" }
  const productId = plan === "basic"
    ? process.env.DODO_BASIC_PRODUCT_ID
    : process.env.DODO_PRO_PRODUCT_ID

  if (!productId) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const client = new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY, environment: DODO_ENV })

  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    metadata: { user_id: user.id, target_plan: plan },
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/payment/success?plan=${plan}`,
  })

  return NextResponse.json({ url: session.checkout_url })
}
