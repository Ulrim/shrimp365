"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { useEffect, useState, useCallback } from "react"
import { CheckCircle2, X, Zap, Building2, ArrowLeft, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"

// Toss Payments 순수 JS SDK — script 태그로 로드
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TossPayments?: (clientKey: string) => any
  }
}

// ─── 가격 설정 ────────────────────────────────────────────────────────────────
const TOSS_PRICES: Record<"basic" | "pro", number> = {
  basic: 19900,
  pro:   39900,
}
const DODO_URLS: Record<"basic" | "pro", string> = {
  basic: "https://checkout.dodopayments.com/buy/pdt_0NeSxAfIU3XSj9De2jD17?quantity=1&redirect_url=https://www.shrimp365.kr%2Fpayment%2Fsuccess%3Fplan%3Dbasic",
  pro:   "https://checkout.dodopayments.com/buy/pdt_0NeSxKEAfcZCqonCVq1Qc?quantity=1&redirect_url=https://www.shrimp365.kr%2Fpayment%2Fsuccess%3Fplan%3Dpro",
}

const PLAN_RANK: Record<string, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 }

function isKorean(): boolean {
  if (typeof navigator === "undefined") return false
  const lang = navigator.language || ""
  return lang.startsWith("ko")
}

function makeOrderId(plan: "basic" | "pro"): string {
  return `toss_${plan}_${Date.now()}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PricingPage() {
  const { user } = useAuth()
  const router   = useRouter()
  const { t }    = useT()
  const u = t.common.unit
  const f = t.pricing.features

  const [korean, setKorean]     = useState(false)
  const [paying, setPaying]     = useState<"basic" | "pro" | null>(null)

  useEffect(() => { setKorean(isKorean()) }, [])

  const FEATURES = {
    free: [
      { ok: true,  label: `${f.farms} 1` },
      { ok: true,  label: `${f.tanksPerFarm} 5` },
      { ok: true,  label: `${f.aiPerDay} 5${u.timesPerDay}` },
      { ok: true,  label: `${f.diagPerMonth} 3${u.timesPerMonth}` },
      { ok: false, label: f.sensors },
      { ok: false, label: f.autoRefresh },
      { ok: false, label: f.csvExport },
      { ok: false, label: `${f.reportPeriods} 30/90` },
      { ok: false, label: `${f.support}: ${f.supportEmail}` },
    ],
    basic: [
      { ok: true,  label: `${f.farms} 2` },
      { ok: true,  label: `${f.tanksPerFarm} 15` },
      { ok: true,  label: `${f.aiPerDay} 15${u.timesPerDay}` },
      { ok: true,  label: `${f.diagPerMonth} 10${u.timesPerMonth}` },
      { ok: true,  label: `${f.sensors} 1` },
      { ok: true,  label: `${f.autoRefresh} (5${u.minutes})` },
      { ok: true,  label: `${f.reportPeriods} 30` },
      { ok: true,  label: `${f.support}: ${f.supportEmail}` },
      { ok: false, label: f.csvExport },
      { ok: false, label: `${f.reportPeriods} 90` },
    ],
    pro: [
      { ok: true, label: `${f.farms} 5` },
      { ok: true, label: `${f.tanksPerFarm} 50` },
      { ok: true, label: `${f.autoRefresh} (1${u.minutes})` },
      { ok: true, label: `${f.aiPerDay} 30${u.timesPerDay}` },
      { ok: true, label: `${f.diagPerMonth} ${u.unlimited}` },
      { ok: true, label: `${f.sensors} 5` },
      { ok: true, label: f.csvExport },
      { ok: true, label: `${f.reportPeriods} 7/30/90` },
      { ok: true, label: `${f.support}: ${f.supportPriority}` },
      { ok: false, label: `${f.support}: ${f.supportDedicated}` },
    ],
    enterprise: [
      { ok: true, label: `${f.farms} ${u.unlimited}` },
      { ok: true, label: `${f.tanksPerFarm} ${u.unlimited}` },
      { ok: true, label: `${f.autoRefresh} (1${u.minutes})` },
      { ok: true, label: `${f.aiPerDay} ${u.unlimited}` },
      { ok: true, label: `${f.diagPerMonth} ${u.unlimited}` },
      { ok: true, label: `${f.sensors} ${u.unlimited}` },
      { ok: true, label: f.csvExport },
      { ok: true, label: f.reportPeriods },
      { ok: true, label: `${f.support}: ${f.supportEmail}` },
      { ok: true, label: `${f.support}: ${f.supportDedicated}` },
    ],
  }

  // ── Toss Payments (순수 JS SDK 동적 로드) ─────────────────────────────────
  const handleTossPay = useCallback(async (plan: "basic" | "pro") => {
    if (!user) { router.push("/login?redirect=/pricing"); return }

    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
    if (!clientKey) {
      alert("결제 서비스가 준비 중입니다.")
      return
    }

    setPaying(plan)
    try {
      // SDK 스크립트가 아직 없으면 동적 로드
      if (!window.TossPayments) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script")
          s.src = "https://js.tosspayments.com/v1/payment"
          s.onload  = () => resolve()
          s.onerror = () => reject(new Error("Toss SDK 로드 실패"))
          document.head.appendChild(s)
        })
      }

      const tossPayments = window.TossPayments!(clientKey)
      const origin = window.location.origin

      await tossPayments.requestPayment("카드", {
        amount:        TOSS_PRICES[plan],
        orderId:       makeOrderId(plan),
        orderName:     plan === "basic" ? "Shrimp365 Basic 플랜" : "Shrimp365 Pro 플랜",
        customerName:  user.name  ?? user.email ?? "고객",
        customerEmail: user.email ?? "",
        successUrl: `${origin}/payment/toss/success`,
        failUrl:    `${origin}/payment/toss/fail`,
      })
    } catch (err: unknown) {
      const code = (err as Record<string, string>)?.code
      if (code !== "PAY_PROCESS_CANCELED" && code !== "USER_CANCEL") {
        console.error("[toss pay]", err)
        alert("결제 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }
    } finally {
      setPaying(null)
    }
  }, [user, router])

  // ── 국제 결제 (Dodo) ──────────────────────────────────────────────────────
  const handleDodoPay = useCallback((plan: "basic" | "pro") => {
    if (!user) { router.push("/login?redirect=/pricing"); return }
    window.location.href = DODO_URLS[plan]
  }, [user, router])

  const handleUpgrade = useCallback((plan: "basic" | "pro") => {
    if (korean) handleTossPay(plan)
    else        handleDodoPay(plan)
  }, [korean, handleTossPay, handleDodoPay])

  const currentPlan = user?.plan ?? "free"
  const currentRank = PLAN_RANK[currentPlan] ?? 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">{t.common.back}</span>
        </Link>
        <div className="flex items-center gap-2 text-lg font-bold">
          🦐 Shrimp365
        </div>
        {!user && (
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white">{t.common.login}</Button>
          </Link>
        )}
      </div>

      {/* Hero */}
      <div className="text-center py-12 px-4">
        <Badge className="mb-4 bg-ocean-500/20 text-ocean-300 border-ocean-500/30">{t.pricing.title}</Badge>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
          {t.pricing.subtitle}
        </h1>
        {korean && (
          <p className="text-slate-500 text-sm mt-2">
            한국 사용자는 <span className="text-[#0064FF] font-semibold">토스페이</span>로 간편하게 결제할 수 있습니다.
          </p>
        )}
      </div>

      {/* Pricing Cards */}
      <div className="max-w-7xl mx-auto px-4 pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

        {/* Free */}
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-7 flex flex-col">
          <div className="mb-6">
            <p className="text-slate-400 text-sm font-medium mb-1">Free</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-white">₩0</span>
              <span className="text-slate-400 text-sm mb-1">{t.pricing.perMonth}</span>
            </div>
            <p className="text-slate-500 text-sm mt-2">{t.pricing.starter}</p>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.free.map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                {item.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className={item.ok ? "text-slate-200" : "text-slate-600"}>{item.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "free" ? (
            <Button disabled className="w-full bg-slate-700 text-slate-400">{t.pricing.currentPlan}</Button>
          ) : (
            <Link href="/dashboard">
              <Button variant="outline" className="w-full border-white/10 text-slate-300 hover:bg-white/5">{t.pricing.selectPlan}</Button>
            </Link>
          )}
        </div>

        {/* Basic */}
        <div className="bg-slate-800/50 border border-sky-500/30 rounded-2xl p-7 flex flex-col">
          <div className="mb-6">
            <p className="text-sky-300 text-sm font-medium mb-1 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5" />Basic
            </p>
            <div className="flex items-end gap-1">
              {korean ? (
                <>
                  <span className="text-4xl font-bold text-white">₩19,900</span>
                  <span className="text-slate-400 text-sm mb-1">{t.pricing.perMonth}</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-bold text-white">$7.99</span>
                  <span className="text-slate-400 text-sm mb-1">{t.pricing.perMonth}</span>
                </>
              )}
            </div>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.basic.map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                {item.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className={item.ok ? "text-slate-200" : "text-slate-600"}>{item.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "basic" ? (
            <Button disabled className="w-full bg-sky-800 text-white">{t.pricing.currentPlan}</Button>
          ) : currentRank > PLAN_RANK["basic"] ? (
            <Button disabled className="w-full bg-slate-700 text-slate-500">{t.pricing.downgrade}</Button>
          ) : (
            <div className="space-y-2">
              <Button
                onClick={() => handleUpgrade("basic")}
                disabled={!!paying}
                className="w-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-medium"
              >
                {paying === "basic" ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    처리 중…
                  </span>
                ) : `Basic ${t.pricing.selectPlan}`}
              </Button>
              <p className="text-center text-xs text-slate-600">
                {korean
                  ? <span className="flex items-center justify-center gap-1"><span className="text-[#0064FF] font-semibold">토스페이</span>로 결제</span>
                  : "Credit card / PayPal"}
              </p>
            </div>
          )}
        </div>

        {/* Pro */}
        <div className="relative bg-gradient-to-b from-ocean-900/40 to-slate-800/50 border border-ocean-500/40 rounded-2xl p-7 flex flex-col shadow-xl shadow-ocean-900/20">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge className="bg-gradient-to-r from-ocean-500 to-teal-500 text-white border-0 px-4 py-1">
              <Zap className="w-3 h-3 mr-1" />{t.pricing.popular}
            </Badge>
          </div>
          <div className="mb-6">
            <p className="text-ocean-300 text-sm font-medium mb-1">Pro</p>
            <div className="flex items-end gap-1">
              {korean ? (
                <>
                  <span className="text-4xl font-bold text-white">₩39,900</span>
                  <span className="text-slate-400 text-sm mb-1">{t.pricing.perMonth}</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-bold text-white">$12.99</span>
                  <span className="text-slate-400 text-sm mb-1">{t.pricing.perMonth}</span>
                </>
              )}
            </div>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.pro.map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                {item.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className={item.ok ? "text-slate-200" : "text-slate-600"}>{item.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "pro" ? (
            <Button disabled className="w-full bg-ocean-700 text-white">{t.pricing.currentPlan}</Button>
          ) : currentPlan === "enterprise" ? (
            <Button disabled className="w-full bg-slate-700 text-slate-500">{t.pricing.downgrade}</Button>
          ) : (
            <div className="space-y-2">
              <Button
                onClick={() => handleUpgrade("pro")}
                disabled={!!paying}
                className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-medium"
              >
                {paying === "pro" ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    처리 중…
                  </span>
                ) : `Pro ${t.pricing.selectPlan}`}
              </Button>
              <p className="text-center text-xs text-slate-600">
                {korean
                  ? <span className="flex items-center justify-center gap-1"><span className="text-[#0064FF] font-semibold">토스페이</span>로 결제</span>
                  : "Credit card / PayPal"}
              </p>
            </div>
          )}
        </div>

        {/* Enterprise */}
        <div className="bg-slate-800/50 border border-purple-500/20 rounded-2xl p-7 flex flex-col">
          <div className="mb-6">
            <p className="text-purple-300 text-sm font-medium mb-1">Enterprise</p>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-bold text-white">{t.pricing.contactUs}</span>
            </div>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.enterprise.map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">{item.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "enterprise" ? (
            <Button disabled className="w-full bg-purple-800 text-white">{t.pricing.currentPlan}</Button>
          ) : (
            <a href="mailto:contact@culiver.ai">
              <Button variant="outline" className="w-full border-purple-500/30 text-purple-300 hover:bg-purple-500/10">
                <Building2 className="w-4 h-4 mr-2" />{t.pricing.contactUs}
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* 결제 수단 안내 */}
      <div className="max-w-7xl mx-auto px-4 pb-12 text-center">
        <p className="text-slate-600 text-xs">
          {korean
            ? "토스페이 · 카드 · 계좌이체 등 다양한 결제 수단을 지원합니다."
            : "Secured by Dodo Payments · Credit / Debit card · PayPal"}
        </p>
      </div>
    </div>
  )
}
