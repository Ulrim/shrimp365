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

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET)
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
      await supabaseAdmin.from("profiles").update({
        plan: "pro",
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        subscription_status: "active",
      }).eq("id", userId)
      break
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      const status = sub.status
      await supabaseAdmin.from("profiles").update({
        subscription_status: status,
        plan: status === "active" ? "pro" : "free",
        plan_expires_at: status !== "active"
          ? new Date((sub.items.data[0]?.current_period_end ?? 0) * 1000).toISOString()
          : null,
      }).eq("stripe_customer_id", customerId)
      break
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string
      await supabaseAdmin.from("profiles").update({
        plan: "free",
        subscription_status: "canceled",
        stripe_subscription_id: null,
        plan_expires_at: null,
      }).eq("stripe_customer_id", customerId)
      break
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      await supabaseAdmin.from("profiles").update({
        subscription_status: "past_due",
      }).eq("stripe_customer_id", customerId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
