"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { useState, useCallback } from "react"
import { CheckCircle2, X, Zap, Building2, ArrowLeft, Star, BadgeCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TossPayments?: (clientKey: string) => any
  }
}

// ─── 프로모션 플래그 — true이면 결제 비활성화, 신규 가입 Pro 3개월 무료 ──────
const PROMO_ACTIVE = true

const TOSS_PRICES: Record<"basic" | "pro", number> = { basic: 19900, pro: 39900 }
const PLAN_RANK: Record<string, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 }

function makeOrderId(plan: "basic" | "pro"): string {
  return `toss_${plan}_${Date.now()}`
}

export default function PricingPage() {
  const { user } = useAuth()
  const router   = useRouter()
  const { t }    = useT()

  const [paying, setPaying] = useState<"basic" | "pro" | null>(null)

  const FEATURES = {
    free: [
      { ok: true,  label: `양식장 1개` },
      { ok: true,  label: `수조 최대 5개` },
      { ok: true,  label: `AI 어드바이저 시간당 3회` },
      { ok: true,  label: `질병 진단 월 3회` },
      { ok: false, label: `IoT 센서 연동` },
      { ok: false, label: `자동 새로고침` },
      { ok: false, label: `CSV 내보내기` },
      { ok: false, label: `30/90일 리포트` },
      { ok: false, label: `우선 지원` },
    ],
    basic: [
      { ok: true,  label: `양식장 2개` },
      { ok: true,  label: `수조 최대 15개` },
      { ok: true,  label: `AI 어드바이저 시간당 10회` },
      { ok: true,  label: `질병 진단 월 10회` },
      { ok: true,  label: `IoT 센서 1개` },
      { ok: true,  label: `자동 새로고침 (5분)` },
      { ok: true,  label: `30일 리포트` },
      { ok: true,  label: `이메일 지원` },
      { ok: false, label: `CSV 내보내기` },
      { ok: false, label: `90일 리포트` },
    ],
    pro: [
      { ok: true, label: `양식장 5개` },
      { ok: true, label: `수조 최대 50개` },
      { ok: true, label: `자동 새로고침 (1분)` },
      { ok: true, label: `AI 어드바이저 시간당 30회` },
      { ok: true, label: `질병 진단 무제한` },
      { ok: true, label: `IoT 센서 5개` },
      { ok: true, label: `CSV 내보내기` },
      { ok: true, label: `7 / 30 / 90일 리포트` },
      { ok: true, label: `우선 지원` },
      { ok: false, label: `전담 지원` },
    ],
    enterprise: [
      { ok: true, label: `양식장 무제한` },
      { ok: true, label: `수조 무제한` },
      { ok: true, label: `자동 새로고침 (1분)` },
      { ok: true, label: `AI 어드바이저 무제한` },
      { ok: true, label: `질병 진단 무제한` },
      { ok: true, label: `IoT 센서 무제한` },
      { ok: true, label: `CSV 내보내기` },
      { ok: true, label: `전체 기간 리포트` },
      { ok: true, label: `이메일 지원` },
      { ok: true, label: `전담 지원` },
    ],
  }

  const handleUpgrade = useCallback(async (plan: "basic" | "pro") => {
    if (!user) { router.push("/login?redirect=/pricing"); return }
    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY
    if (!clientKey) { alert("결제 서비스가 준비 중입니다."); return }
    setPaying(plan)
    try {
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
        alert("결제 중 오류가 발생했습니다. 다시 시도해 주세요.")
      }
    } finally {
      setPaying(null)
    }
  }, [user, router])

  const currentPlan = user?.plan ?? "free"
  const currentRank = PLAN_RANK[currentPlan] ?? 0

  // 플랜 카드별 상태 계산 헬퍼
  function planState(plan: "free" | "basic" | "pro" | "enterprise") {
    if (currentPlan === plan) return "current"
    if (currentRank > PLAN_RANK[plan]) return "downgrade"
    return "upgrade"
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link
            href={user ? "/home" : "/"}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">{t.common.back}</span>
          </Link>
          <Link href={user ? "/home" : "/"} className="flex items-center gap-2 font-bold text-foreground">
            <span>🦐</span> Shrimp365
          </Link>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:block">{user.name}</span>
              <Badge className="text-xs bg-ocean-50 text-ocean-700 border-ocean-200">
                {currentPlan.toUpperCase()}
              </Badge>
            </div>
          ) : (
            <Link href="/login">
              <Button variant="outline" size="sm" className="min-h-[44px]">{t.common.login}</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="text-center py-14 px-4 bg-gradient-to-b from-ocean-50 to-background">
        <div className="inline-flex items-center gap-2 bg-ocean-100 text-ocean-700 text-sm px-4 py-1.5 rounded-full mb-4 font-medium">
          <Zap className="w-3.5 h-3.5" /> {t.pricing.title}
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-foreground">
          {t.pricing.subtitle}
        </h1>
        {user && (
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2 rounded-full mt-2">
            <BadgeCheck className="w-4 h-4" />
            현재 <strong>{currentPlan.toUpperCase()}</strong> 플랜 이용 중
          </div>
        )}
        {PROMO_ACTIVE && !user && (
          <div className="inline-flex items-center gap-2 mt-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-5 py-2.5 rounded-full">
            🎉 지금 가입하면 <strong>Pro 플랜 3개월 무료</strong> — 결제 없이 바로 시작!
          </div>
        )}
        {!PROMO_ACTIVE && (
          <p className="text-muted-foreground text-sm mt-3">
            <span className="text-[#0064FF] font-semibold">토스페이먼츠</span>로 국내·해외 간편하게 결제할 수 있습니다.
          </p>
        )}
      </div>

      {/* Pricing Cards */}
      <div className="max-w-7xl mx-auto px-4 pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

        {/* Free */}
        {(() => {
          const state = planState("free")
          return (
            <div
              className={`bg-card border rounded-2xl p-7 flex flex-col transition-shadow hover:shadow-md ${
                state === "current" ? "border-emerald-300 ring-2 ring-emerald-100" : "border-border"
              }`}
              aria-label={`Free 플랜${state === "current" ? " (현재 구독 중)" : ""}`}
            >
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-muted-foreground text-sm font-medium">Free</p>
                  {state === "current" && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" /> 구독 중
                    </span>
                  )}
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold text-foreground">₩0</span>
                  <span className="text-muted-foreground text-sm mb-1">{t.pricing.perMonth}</span>
                </div>
                <p className="text-muted-foreground text-sm mt-2">{t.pricing.starter}</p>
              </div>
              <ul className="space-y-2.5 flex-1 mb-7">
                {FEATURES.free.map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    {item.ok
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : <X className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    <span className={item.ok ? "text-foreground" : "text-muted-foreground/50"}>{item.label}</span>
                  </li>
                ))}
              </ul>
              {state === "current" ? (
                <Button disabled className="w-full min-h-[44px] bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-not-allowed hover:bg-emerald-50" aria-disabled="true">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> 현재 구독 중
                </Button>
              ) : (
                <Link href="/dashboard">
                  <Button variant="outline" className="w-full min-h-[44px]" aria-label="Free 플랜 선택하기">{t.pricing.selectPlan}</Button>
                </Link>
              )}
            </div>
          )
        })()}

        {/* Basic */}
        {(() => {
          const state = planState("basic")
          return (
            <div
              className={`bg-card border rounded-2xl p-7 flex flex-col transition-shadow hover:shadow-md ${
                state === "current" ? "border-sky-300 ring-2 ring-sky-100" : "border-sky-200"
              }`}
              aria-label={`Basic 플랜 — ₩19,900/월${state === "current" ? " (현재 구독 중)" : ""}`}
            >
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sky-600 text-sm font-medium flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" /> Basic
                  </p>
                  {state === "current" && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" /> 구독 중
                    </span>
                  )}
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold text-foreground">₩19,900</span>
                  <span className="text-muted-foreground text-sm mb-1">{t.pricing.perMonth}</span>
                </div>
              </div>
              <ul className="space-y-2.5 flex-1 mb-7">
                {FEATURES.basic.map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    {item.ok
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : <X className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    <span className={item.ok ? "text-foreground" : "text-muted-foreground/50"}>{item.label}</span>
                  </li>
                ))}
              </ul>
              {state === "current" ? (
                <Button disabled className="w-full min-h-[44px] bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-not-allowed hover:bg-emerald-50" aria-disabled="true">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> 현재 구독 중
                </Button>
              ) : state === "downgrade" ? (
                <Button disabled className="w-full min-h-[44px] bg-muted text-muted-foreground cursor-not-allowed" aria-disabled="true">
                  현재 플랜보다 낮음
                </Button>
              ) : PROMO_ACTIVE && !user ? (
                <div className="space-y-2">
                  <Link href="/signup">
                    <Button className="w-full min-h-[44px] bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-medium" aria-label="Basic 플랜 — 무료로 시작하기 (Pro 3개월 무료 포함)">
                      무료로 시작하기
                    </Button>
                  </Link>
                  <p className="text-center text-xs text-emerald-600 font-medium">Pro 3개월 무료 포함</p>
                </div>
              ) : PROMO_ACTIVE && user ? (
                <Button disabled className="w-full min-h-[44px] bg-muted text-muted-foreground cursor-not-allowed" aria-disabled="true">
                  프로모션 기간 중 비활성
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button
                    onClick={() => handleUpgrade("basic")}
                    disabled={!!paying}
                    className="w-full min-h-[44px] bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-medium"
                    aria-label="Basic 플랜 구독하기 — ₩19,900/월"
                  >
                    {paying === "basic" ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        처리 중…
                      </span>
                    ) : `Basic ${t.pricing.selectPlan}`}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    <span className="flex items-center justify-center gap-1 text-[#0064FF] font-semibold">토스페이먼츠</span>
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {/* Pro */}
        {(() => {
          const state = planState("pro")
          return (
            <div
              className={`relative bg-card border rounded-2xl p-7 flex flex-col transition-shadow hover:shadow-lg ${
                state === "current"
                  ? "border-ocean-300 ring-2 ring-ocean-100"
                  : "border-ocean-300 shadow-md shadow-ocean-100"
              }`}
              aria-label={`Pro 플랜 — ₩39,900/월${state === "current" ? " (현재 구독 중)" : " (인기 플랜)"}`}
            >
              {state !== "current" && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-gradient-to-r from-ocean-500 to-teal-500 text-white border-0 px-4 py-1">
                    <Zap className="w-3 h-3 mr-1" />{t.pricing.popular}
                  </Badge>
                </div>
              )}
              {state === "current" && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0 px-4 py-1">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> 현재 구독 중
                  </Badge>
                </div>
              )}
              <div className="mb-6 mt-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-ocean-600 text-sm font-medium">Pro</p>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold text-foreground">₩39,900</span>
                  <span className="text-muted-foreground text-sm mb-1">{t.pricing.perMonth}</span>
                </div>
              </div>
              <ul className="space-y-2.5 flex-1 mb-7">
                {FEATURES.pro.map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    {item.ok
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : <X className="w-4 h-4 text-muted-foreground/40 shrink-0" />}
                    <span className={item.ok ? "text-foreground" : "text-muted-foreground/50"}>{item.label}</span>
                  </li>
                ))}
              </ul>
              {state === "current" ? (
                <Button disabled className="w-full min-h-[44px] bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-not-allowed hover:bg-emerald-50" aria-disabled="true">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> 현재 구독 중
                </Button>
              ) : state === "downgrade" ? (
                <Button disabled className="w-full min-h-[44px] bg-muted text-muted-foreground cursor-not-allowed" aria-disabled="true">
                  현재 플랜보다 낮음
                </Button>
              ) : PROMO_ACTIVE && !user ? (
                <div className="space-y-2">
                  <Link href="/signup">
                    <Button className="w-full min-h-[44px] bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold" aria-label="Pro 플랜 — 무료로 시작하기 (Pro 3개월 무료 포함)">
                      무료로 시작하기
                    </Button>
                  </Link>
                  <p className="text-center text-xs text-emerald-600 font-medium">Pro 3개월 무료 포함</p>
                </div>
              ) : PROMO_ACTIVE && user ? (
                <Button disabled className="w-full min-h-[44px] bg-muted text-muted-foreground cursor-not-allowed" aria-disabled="true">
                  프로모션 기간 중 비활성
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button
                    onClick={() => handleUpgrade("pro")}
                    disabled={!!paying}
                    className="w-full min-h-[44px] bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold"
                    aria-label="Pro 플랜 구독하기 — ₩39,900/월"
                  >
                    {paying === "pro" ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        처리 중…
                      </span>
                    ) : `Pro ${t.pricing.selectPlan}`}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    <span className="flex items-center justify-center gap-1 text-[#0064FF] font-semibold">토스페이먼츠</span>
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {/* Enterprise */}
        {(() => {
          const state = planState("enterprise")
          return (
            <div
              className={`bg-card border rounded-2xl p-7 flex flex-col transition-shadow hover:shadow-md ${
                state === "current" ? "border-purple-300 ring-2 ring-purple-100" : "border-purple-200"
              }`}
              aria-label={`Enterprise 플랜${state === "current" ? " (현재 구독 중)" : " — 문의 요청"}`}
            >
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-purple-600 text-sm font-medium">Enterprise</p>
                  {state === "current" && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" /> 구독 중
                    </span>
                  )}
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-2xl font-bold text-foreground">{t.pricing.contactUs}</span>
                </div>
              </div>
              <ul className="space-y-2.5 flex-1 mb-7">
                {FEATURES.enterprise.map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-foreground">{item.label}</span>
                  </li>
                ))}
              </ul>
              {state === "current" ? (
                <Button disabled className="w-full min-h-[44px] bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-not-allowed hover:bg-emerald-50" aria-disabled="true">
                  <CheckCircle2 className="w-4 h-4 mr-2" /> 현재 구독 중
                </Button>
              ) : (
                <a href="mailto:contact@culiver.ai" aria-label="Enterprise 플랜 문의 이메일 보내기">
                  <Button variant="outline" className="w-full min-h-[44px] border-purple-300 text-purple-600 hover:bg-purple-50">
                    <Building2 className="w-4 h-4 mr-2" />{t.pricing.contactUs}
                  </Button>
                </a>
              )}
            </div>
          )
        })()}
      </div>

      {/* 결제 안내 / FAQ */}
      <div className="max-w-3xl mx-auto px-4 pb-16 space-y-8">
        {/* 결제 수단 */}
        <div className="text-center">
          <p className="text-muted-foreground text-sm">
            토스페이먼츠 · 카드 · 계좌이체 · 해외 카드 등 다양한 결제 수단을 지원합니다.
          </p>
        </div>

        {/* 자주 묻는 질문 */}
        <div className="bg-muted/50 border border-border rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-foreground text-sm">자주 묻는 질문</h3>
          {[
            { q: "구독을 취소하면 데이터는 어떻게 되나요?", a: "취소 후 Free 플랜으로 전환되며 기존 데이터는 모두 유지됩니다. 초과 데이터는 조회만 가능합니다." },
            { q: "플랜을 업그레이드하면 바로 적용되나요?", a: "결제 완료 즉시 플랜이 업그레이드되어 추가 기능을 사용할 수 있습니다." },
            { q: "환불 정책은 어떻게 되나요?", a: "결제일로부터 7일 이내 미사용 시 전액 환불이 가능합니다. 자세한 내용은 환불 정책을 확인해 주세요." },
          ].map((item, i) => (
            <div key={i} className="border-t border-border pt-4 first:border-0 first:pt-0" role="region" aria-label={item.q}>
              <p className="text-sm font-medium text-foreground mb-1">{item.q}</p>
              <p className="text-sm text-muted-foreground">{item.a}</p>
            </div>
          ))}
          <div className="pt-2">
            <Link href="/refund" className="text-xs text-ocean-600 hover:text-ocean-700 underline">환불 정책 전체 보기</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
