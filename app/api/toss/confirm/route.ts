import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"

// orderId 형식: toss_{plan}_{timestamp}  예) toss_basic_1715000000000
function parsePlan(orderId: string): "basic" | "pro" | null {
  const match = orderId.match(/^toss_(basic|pro)_\d+$/)
  return match ? (match[1] as "basic" | "pro") : null
}

export async function POST(req: NextRequest) {
  // 1. 인증
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })

  if (!process.env.TOSS_SECRET_KEY) {
    return NextResponse.json({ error: "결제 서비스가 설정되지 않았습니다." }, { status: 503 })
  }

  const { paymentKey, orderId, amount } = await req.json()
  if (!paymentKey || !orderId || !amount) {
    return NextResponse.json({ error: "파라미터 누락" }, { status: 400 })
  }

  const plan = parsePlan(orderId)
  if (!plan) return NextResponse.json({ error: "유효하지 않은 주문 ID" }, { status: 400 })

  // 2. Toss Payments 서버 확인 요청
  const basicAuth = Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString("base64")
  const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  })

  if (!tossRes.ok) {
    const err = await tossRes.json().catch(() => ({}))
    console.error("[toss confirm] failed:", err)
    return NextResponse.json({ error: "결제 확인 실패", detail: err }, { status: 400 })
  }

  // 3. 플랜 업데이트
  const admin = createAdminClient()
  const { error: updateErr } = await admin
    .from("profiles")
    .update({ plan })
    .eq("id", user.id)

  if (updateErr) {
    console.error("[toss confirm] profile update failed:", updateErr)
    return NextResponse.json({ error: "플랜 업데이트 실패" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, plan })
}
