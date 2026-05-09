import { NextRequest, NextResponse } from "next/server"
import DodoPayments from "dodopayments"
import { createAdminClient } from "@/lib/supabase-server"

const DODO_ENV = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode"

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
        "webhook-id": req.headers.get("webhook-id") ?? "",
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
    // ── 구독 활성화 (첫 결제 완료) ───────────────────────────────────────
    case "subscription.active": {
      const userId = (data.metadata as Record<string, string> | null)?.user_id
      if (!userId) break

      const productId = data.product_id as string
      const targetPlan: "basic" | "pro" =
        productId === process.env.DODO_BASIC_PRODUCT_ID ? "basic" : "pro"

      const { error } = await supabaseAdmin.from("profiles").update({
        plan: targetPlan,
        billing_customer_id: data.customer?.customer_id as string,
        billing_subscription_id: data.subscription_id as string,
        subscription_status: "active",
        plan_expires_at: null,
      }).eq("id", userId)

      if (error) console.error("[dodo/webhook] subscription.active DB error:", error)
      break
    }

    // ── 구독 갱신 ──────────────────────────────────────────────────────────
    case "subscription.renewed": {
      const subscriptionId = data.subscription_id as string

      const { error } = await supabaseAdmin.from("profiles").update({
        subscription_status: "active",
        plan_expires_at: null,
      }).eq("billing_subscription_id", subscriptionId)

      if (error) console.error("[dodo/webhook] subscription.renewed DB error:", error)
      break
    }

    // ── 플랜 변경 ──────────────────────────────────────────────────────────
    case "subscription.plan_changed":
    case "subscription.updated": {
      const subscriptionId = data.subscription_id as string
      const status = data.status as string
      const productId = data.product_id as string

      const activePlan: "basic" | "pro" =
        productId === process.env.DODO_BASIC_PRODUCT_ID ? "basic" : "pro"

      const { error } = await supabaseAdmin.from("profiles").update({
        subscription_status: status,
        plan: status === "active" ? activePlan : "free",
        plan_expires_at: null,
      }).eq("billing_subscription_id", subscriptionId)

      if (error) console.error("[dodo/webhook] subscription.updated DB error:", error)
      break
    }

    // ── 구독 취소 ──────────────────────────────────────────────────────────
    case "subscription.cancelled":
    case "subscription.expired": {
      const subscriptionId = data.subscription_id as string
      const nextBillingDate = data.next_billing_date as string | null

      const { error } = await supabaseAdmin.from("profiles").update({
        plan: "free",
        subscription_status: "canceled",
        billing_subscription_id: null,
        plan_expires_at: nextBillingDate ?? null,
      }).eq("billing_subscription_id", subscriptionId)

      if (error) console.error("[dodo/webhook] subscription.cancelled DB error:", error)
      break
    }

    // ── 결제 보류·실패 ────────────────────────────────────────────────────
    case "subscription.on_hold":
    case "subscription.failed": {
      const subscriptionId = data.subscription_id as string

      const { error } = await supabaseAdmin.from("profiles").update({
        subscription_status: "past_due",
      }).eq("billing_subscription_id", subscriptionId)

      if (error) console.error("[dodo/webhook] subscription.on_hold DB error:", error)
      break
    }
  }

  return NextResponse.json({ received: true })
}
