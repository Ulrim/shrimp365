import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { createServerClient } from "@supabase/ssr"

const DODO_ENV = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode"

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })

  if (!process.env.DODO_PAYMENTS_API_KEY) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("billing_customer_id")
    .eq("id", user.id)
    .single()

  if (!profile?.billing_customer_id) {
    return NextResponse.json({ error: "구독 정보가 없습니다." }, { status: 400 })
  }

  const client = new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY, environment: DODO_ENV })
  const session = await client.customers.customerPortal.create(profile.billing_customer_id, {
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard`,
  })

  return NextResponse.json({ url: session.link })
}
