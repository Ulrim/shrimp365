"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, X, Waves, Zap, Building2, ArrowLeft, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth-context"

const FEATURES = {
  free: [
    { ok: true,  label: "양식장 1개" },
    { ok: true,  label: "수조 5개/양식장" },
    { ok: true,  label: "수질 수동 입력" },
    { ok: true,  label: "AI 어드바이저 5회/일" },
    { ok: true,  label: "질병 진단 3회/월" },
    { ok: true,  label: "양식 일지" },
    { ok: false, label: "IoT 센서 기기 연동" },
    { ok: false, label: "수질 자동 새로고침" },
    { ok: false, label: "CSV/PDF 내보내기" },
    { ok: false, label: "30일·90일 리포트" },
    { ok: false, label: "이메일 지원" },
  ],
  basic: [
    { ok: true,  label: "양식장 2개" },
    { ok: true,  label: "수조 15개/양식장" },
    { ok: true,  label: "AI 어드바이저 15회/일" },
    { ok: true,  label: "질병 진단 10회/월" },
    { ok: true,  label: "양식 일지" },
    { ok: true,  label: "IoT 센서 기기 1개" },
    { ok: true,  label: "수질 자동 새로고침 (5분)" },
    { ok: true,  label: "30일 리포트" },
    { ok: true,  label: "이메일 지원" },
    { ok: false, label: "CSV/PDF 내보내기" },
    { ok: false, label: "90일 리포트" },
  ],
  pro: [
    { ok: true, label: "양식장 5개" },
    { ok: true, label: "수조 50개/양식장" },
    { ok: true, label: "수질 자동 새로고침 (1분)" },
    { ok: true, label: "AI 어드바이저 30회/일" },
    { ok: true, label: "질병 진단 무제한" },
    { ok: true, label: "양식 일지 무제한" },
    { ok: true, label: "IoT 센서 기기 5개" },
    { ok: true, label: "CSV/PDF 내보내기" },
    { ok: true, label: "7일·30일·90일 리포트" },
    { ok: true, label: "이메일 우선 지원" },
    { ok: false, label: "전담 매니저" },
  ],
  enterprise: [
    { ok: true, label: "양식장 무제한" },
    { ok: true, label: "수조 무제한" },
    { ok: true, label: "수질 자동 새로고침 (1분)" },
    { ok: true, label: "AI 어드바이저 무제한" },
    { ok: true, label: "질병 진단 무제한" },
    { ok: true, label: "양식 일지 무제한" },
    { ok: true, label: "IoT 센서 기기 무제한" },
    { ok: true, label: "CSV/PDF 내보내기" },
    { ok: true, label: "커스텀 기간 리포트" },
    { ok: true, label: "이메일 지원" },
    { ok: true, label: "전담 매니저" },
  ],
}

const PLAN_RANK: Record<string, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 }

export default function PricingPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState<"basic" | "pro" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpgrade(plan: "basic" | "pro") {
    if (!user) {
      router.push("/login?redirect=/pricing")
      return
    }
    setLoading(plan)
    setError(null)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "결제 세션 생성에 실패했습니다.")
      window.location.href = json.url
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.")
      setLoading(null)
    }
  }

  const currentPlan = user?.plan ?? "free"
  const currentRank = PLAN_RANK[currentPlan] ?? 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">{user ? "대시보드로" : "홈으로"}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Waves className="w-5 h-5 text-ocean-400" />
          <span className="font-bold text-white">Shrimp365</span>
        </div>
        {!user && (
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white">로그인</Button>
          </Link>
        )}
      </div>

      {/* Hero */}
      <div className="text-center py-12 px-4">
        <Badge className="mb-4 bg-ocean-500/20 text-ocean-300 border-ocean-500/30">요금제</Badge>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
          당신의 양식장에 맞는 플랜
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          무료로 시작하고, 비즈니스 성장에 맞춰 업그레이드하세요.
        </p>
      </div>

      {error && (
        <div className="max-w-sm mx-auto mb-6 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-center text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Pricing Cards */}
      <div className="max-w-7xl mx-auto px-4 pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

        {/* Free */}
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-7 flex flex-col">
          <div className="mb-6">
            <p className="text-slate-400 text-sm font-medium mb-1">Free</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-white">₩0</span>
              <span className="text-slate-400 text-sm mb-1">/월</span>
            </div>
            <p className="text-slate-500 text-sm mt-2">소규모 양식 입문자</p>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.free.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                {f.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className={f.ok ? "text-slate-200" : "text-slate-600"}>{f.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "free" ? (
            <Button disabled className="w-full bg-slate-700 text-slate-400">현재 플랜</Button>
          ) : (
            <Link href="/dashboard">
              <Button variant="outline" className="w-full border-white/10 text-slate-300 hover:bg-white/5">시작하기</Button>
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
              <span className="text-4xl font-bold text-white">₩9,900</span>
              <span className="text-slate-400 text-sm mb-1">/월</span>
            </div>
            <p className="text-slate-400 text-sm mt-2">소규모 상업 양식장</p>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.basic.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                {f.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className={f.ok ? "text-slate-200" : "text-slate-600"}>{f.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "basic" ? (
            <Button disabled className="w-full bg-sky-800 text-white">현재 플랜</Button>
          ) : currentRank > PLAN_RANK["basic"] ? (
            <Button disabled className="w-full bg-slate-700 text-slate-500">현재 플랜보다 낮음</Button>
          ) : (
            <Button
              onClick={() => handleUpgrade("basic")}
              disabled={loading !== null}
              className="w-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-medium"
            >
              {loading === "basic" ? "처리 중..." : "Basic 시작하기"}
            </Button>
          )}
        </div>

        {/* Pro */}
        <div className="relative bg-gradient-to-b from-ocean-900/40 to-slate-800/50 border border-ocean-500/40 rounded-2xl p-7 flex flex-col shadow-xl shadow-ocean-900/20">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge className="bg-gradient-to-r from-ocean-500 to-teal-500 text-white border-0 px-4 py-1">
              <Zap className="w-3 h-3 mr-1" />인기
            </Badge>
          </div>
          <div className="mb-6">
            <p className="text-ocean-300 text-sm font-medium mb-1">Pro</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-white">₩19,900</span>
              <span className="text-slate-400 text-sm mb-1">/월</span>
            </div>
            <p className="text-slate-400 text-sm mt-2">중소형 전문 양식장</p>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.pro.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                {f.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <X className="w-4 h-4 text-slate-600 shrink-0" />}
                <span className={f.ok ? "text-slate-200" : "text-slate-600"}>{f.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "pro" ? (
            <Button disabled className="w-full bg-ocean-700 text-white">현재 플랜</Button>
          ) : currentPlan === "enterprise" ? (
            <Button disabled className="w-full bg-slate-700 text-slate-500">현재 플랜보다 낮음</Button>
          ) : (
            <Button
              onClick={() => handleUpgrade("pro")}
              disabled={loading !== null}
              className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-medium"
            >
              {loading === "pro" ? "처리 중..." : "Pro 시작하기"}
            </Button>
          )}
        </div>

        {/* Enterprise */}
        <div className="bg-slate-800/50 border border-purple-500/20 rounded-2xl p-7 flex flex-col">
          <div className="mb-6">
            <p className="text-purple-300 text-sm font-medium mb-1">Enterprise</p>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-bold text-white">별도 문의</span>
            </div>
            <p className="text-slate-500 text-sm mt-2">대형 양식 법인·연구기관</p>
          </div>
          <ul className="space-y-2.5 flex-1 mb-7">
            {FEATURES.enterprise.map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-slate-200">{f.label}</span>
              </li>
            ))}
          </ul>
          {currentPlan === "enterprise" ? (
            <Button disabled className="w-full bg-purple-800 text-white">현재 플랜</Button>
          ) : (
            <a href="mailto:contact@shrimp365.com">
              <Button variant="outline" className="w-full border-purple-500/30 text-purple-300 hover:bg-purple-500/10">
                <Building2 className="w-4 h-4 mr-2" />문의하기
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-2xl mx-auto px-4 pb-20">
        <h2 className="text-xl font-bold text-white text-center mb-8">자주 묻는 질문</h2>
        <div className="space-y-4">
          {[
            { q: "언제든지 취소할 수 있나요?", a: "네, 언제든지 취소 가능합니다. 취소 후에도 결제 기간 만료일까지 유료 기능을 사용할 수 있습니다." },
            { q: "Basic에서 Pro로 업그레이드하면 차액만 청구되나요?", a: "네, Stripe가 잔여 기간을 일할 계산하여 차액만 청구합니다." },
            { q: "결제는 어떻게 이루어지나요?", a: "Stripe를 통해 안전하게 처리됩니다. 신용카드·체크카드 등 주요 카드를 지원합니다." },
            { q: "업그레이드해도 기존 데이터가 유지되나요?", a: "모든 기존 데이터(수조, 일지, 수질 기록)는 그대로 유지됩니다." },
            { q: "Free 플랜 한도 초과 시 어떻게 되나요?", a: "한도 초과 시 안내 팝업이 표시되며, 기존 데이터는 읽기 전용으로 유지됩니다. 추가 생성만 제한됩니다." },
          ].map((faq, i) => (
            <div key={i} className="bg-slate-800/50 border border-white/5 rounded-xl p-5">
              <p className="text-white font-medium mb-2">{faq.q}</p>
              <p className="text-slate-400 text-sm">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
