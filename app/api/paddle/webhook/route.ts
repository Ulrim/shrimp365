import { NextRequest, NextResponse } from "next/server"
import { Paddle, Environment, type EventName } from "@paddle/paddle-node-sdk"
import { createAdminClient } from "@/lib/supabase-server"

const PADDLE_ENV = process.env.PADDLE_ENV === "production"
  ? Environment.production
  : Environment.sandbox

export async function POST(req: NextRequest) {
  if (!process.env.PADDLE_API_KEY || !process.env.PADDLE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Paddle 설정이 누락되었습니다." }, { status: 503 })
  }

  const paddle = new Paddle(process.env.PADDLE_API_KEY, { environment: PADDLE_ENV })

  const rawBody = await req.text()
  const signature = req.headers.get("paddle-signature") ?? ""

  let event
  try {
    event = await paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET, signature)
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

  switch (event.eventType as EventName) {
    // ── 구독 생성 (결제 완료 직후) ──────────────────────────────────────────
    case "subscription.created": {
      const userId = (data.customData as Record<string, string> | null)?.user_id
      if (!userId) break

      const priceId = data.items?.[0]?.price?.id as string | undefined
      const targetPlan: "basic" | "pro" =
        priceId === process.env.PADDLE_BASIC_PRICE_ID ? "basic" : "pro"

      const { error } = await supabaseAdmin.from("profiles").update({
        plan: targetPlan,
        paddle_customer_id: data.customerId as string,
        paddle_subscription_id: data.id as string,
        subscription_status: "active",
        plan_expires_at: null,
      }).eq("id", userId)

      if (error) {
        console.error("[paddle/webhook] subscription.created DB error:", error)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }

    // ── 구독 변경 (플랜 변경·갱신·일시정지 등) ────────────────────────────
    case "subscription.updated": {
      const subscriptionId = data.id as string
      const status = data.status as string
      const priceId = data.items?.[0]?.price?.id as string | undefined
      const scheduledChange = data.scheduledChange as { action: string; effectiveAt: string } | null

      const activePlan: "basic" | "pro" =
        priceId === process.env.PADDLE_BASIC_PRICE_ID ? "basic" : "pro"

      const { error } = await supabaseAdmin.from("profiles").update({
        subscription_status: status,
        plan: status === "active" ? activePlan : "free",
        plan_expires_at: scheduledChange?.action === "cancel" && scheduledChange.effectiveAt
          ? new Date(scheduledChange.effectiveAt).toISOString()
          : null,
      }).eq("paddle_subscription_id", subscriptionId)

      if (error) {
        console.error("[paddle/webhook] subscription.updated DB error:", error)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }

    // ── 구독 취소 ──────────────────────────────────────────────────────────
    case "subscription.canceled": {
      const subscriptionId = data.id as string

      const { error } = await supabaseAdmin.from("profiles").update({
        plan: "free",
        subscription_status: "canceled",
        paddle_subscription_id: null,
        plan_expires_at: null,
      }).eq("paddle_subscription_id", subscriptionId)

      if (error) {
        console.error("[paddle/webhook] subscription.canceled DB error:", error)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }

    // ── 결제 실패 ──────────────────────────────────────────────────────────
    case "transaction.payment_failed": {
      const customerId = data.customerId as string

      const { error } = await supabaseAdmin.from("profiles").update({
        subscription_status: "past_due",
      }).eq("paddle_customer_id", customerId)

      if (error) {
        console.error("[paddle/webhook] transaction.payment_failed DB error:", error)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
