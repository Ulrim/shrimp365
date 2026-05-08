import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/supabase-server"

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe 설정이 누락되었습니다." }, { status: 503 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const body = await req.text()
  const sig = req.headers.get("stripe-signature")
  if (!sig) {
    return NextResponse.json({ error: "Webhook 서명 검증 실패" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch {
    return NextResponse.json({ error: "Webhook 서명 검증 실패" }, { status: 400 })
  }

  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 })
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.user_id
      if (!userId) break
      // Determine plan from metadata (set at checkout creation) or price ID
      let targetPlan: "basic" | "pro" = "pro"
      if (session.metadata?.target_plan === "basic") {
        targetPlan = "basic"
      } else if (process.env.STRIPE_BASIC_PRICE_ID) {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
        if (lineItems.data[0]?.price?.id === process.env.STRIPE_BASIC_PRICE_ID) {
          targetPlan = "basic"
        }
      }
      const { error: upsertError } = await supabaseAdmin.from("profiles").update({
        plan: targetPlan,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        subscription_status: "active",
      }).eq("id", userId)
      if (upsertError) {
        console.error("[stripe/webhook] checkout.session.completed DB error:", upsertError)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const status = sub.status
      // Determine which paid plan this subscription is for
      let activePlan: "basic" | "pro" = "pro"
      if (process.env.STRIPE_BASIC_PRICE_ID) {
        const priceId = sub.items.data[0]?.price?.id
        if (priceId === process.env.STRIPE_BASIC_PRICE_ID) activePlan = "basic"
      }
      const { error: updateError } = await supabaseAdmin.from("profiles").update({
        subscription_status: status,
        plan: status === "active" ? activePlan : "free",
        plan_expires_at: status !== "active" && sub.cancel_at
          ? new Date(sub.cancel_at * 1000).toISOString()
          : null,
      }).eq("stripe_customer_id", customerId)
      if (updateError) {
        console.error("[stripe/webhook] subscription.updated DB error:", updateError)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const { error: deleteError } = await supabaseAdmin.from("profiles").update({
        plan: "free",
        subscription_status: "canceled",
        stripe_subscription_id: null,
        plan_expires_at: null,
      }).eq("stripe_customer_id", customerId)
      if (deleteError) {
        console.error("[stripe/webhook] subscription.deleted DB error:", deleteError)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      const { error: pastDueError } = await supabaseAdmin.from("profiles").update({
        subscription_status: "past_due",
      }).eq("stripe_customer_id", customerId)
      if (pastDueError) {
        console.error("[stripe/webhook] invoice.payment_failed DB error:", pastDueError)
        return NextResponse.json({ error: "DB 업데이트 실패" }, { status: 500 })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
