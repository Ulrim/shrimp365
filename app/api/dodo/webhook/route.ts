import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { createAdminClient } from "@/lib/supabase-server"

const DODO_ENV = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode"

// Product IDs from DODO Payments dashboard
const PRODUCT_BASIC = "pdt_0NeSxAfIU3XSj9De2jD17"
const PRODUCT_PRO   = "pdt_0NeSxKEAfcZCqonCVq1Qc"

function resolvePlan(productId: string): "basic" | "pro" | null {
  if (productId === PRODUCT_BASIC) return "basic"
  if (productId === PRODUCT_PRO)   return "pro"
  return null
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    }
  )
  if (!res.ok) return null
  const body = await res.json()
  return body?.users?.[0]?.id ?? null
}

export async function POST(req: NextRequest) {
  if (!process.env.DODO_PAYMENTS_API_KEY || !process.env.DODO_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "DODO 설정이 누락되었습니다." }, { status: 503 })
  }

  const client = new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY, environment: DODO_ENV })

  const rawBody = await req.text()
  let event
  try {
    event = client.webhooks.unwrap(rawBody, {
      headers: {
        "webhook-id":        req.headers.get("webhook-id") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
      },
      key: process.env.DODO_WEBHOOK_SECRET,
    })
  } catch {
    return NextResponse.json({ error: "Webhook 서명 검증 실패" }, { status: 400 })
  }

  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = event.data as any

  switch (event.type) {
    // ── 구독 활성화 ───────────────────────────────────────────────────────────
    case "subscription.active": {
      const email      = data.customer?.email as string | undefined
      const customerId = data.customer?.customer_id as string
      const subId      = data.subscription_id as string
      const plan       = resolvePlan(data.product_id as string)

      if (!plan) break

      // metadata에 user_id가 있으면 우선 사용 (동적 체크아웃 경로)
      let userId: string | null = (data.metadata as Record<string, string> | null)?.user_id ?? null

      // 없으면 이메일로 조회 (정적 링크 경로)
      if (!userId && email) userId = await findUserIdByEmail(email)
      if (!userId) break

      await supabaseAdmin.from("profiles").update({
        plan,
        billing_customer_id:     customerId,
        billing_subscription_id: subId,
        subscription_status:     "active",
        plan_expires_at:         null,
      }).eq("id", userId)
      break
    }

    // ── 구독 갱신 ────────────────────────────────────────────────────────────
    case "subscription.renewed": {
      await supabaseAdmin.from("profiles").update({
        subscription_status: "active",
        plan_expires_at:     null,
      }).eq("billing_subscription_id", data.subscription_id as string)
      break
    }

    // ── 플랜 변경 ────────────────────────────────────────────────────────────
    case "subscription.plan_changed":
    case "subscription.updated": {
      const status = data.status as string
      const plan   = resolvePlan(data.product_id as string)
      await supabaseAdmin.from("profiles").update({
        subscription_status: status,
        plan:                status === "active" && plan ? plan : "free",
        plan_expires_at:     null,
      }).eq("billing_subscription_id", data.subscription_id as string)
      break
    }

    // ── 구독 취소·만료 ───────────────────────────────────────────────────────
    case "subscription.cancelled":
    case "subscription.expired": {
      await supabaseAdmin.from("profiles").update({
        plan:                    "free",
        subscription_status:     "canceled",
        billing_subscription_id: null,
        plan_expires_at:         (data.next_billing_date as string | null) ?? null,
      }).eq("billing_subscription_id", data.subscription_id as string)
      break
    }

    // ── 결제 보류·실패 ───────────────────────────────────────────────────────
    case "subscription.on_hold":
    case "subscription.failed": {
      await supabaseAdmin.from("profiles").update({
        subscription_status: "past_due",
      }).eq("billing_subscription_id", data.subscription_id as string)
      break
    }
  }

  return NextResponse.json({ received: true })
}
