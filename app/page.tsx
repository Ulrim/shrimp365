"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import {
  Droplets, BrainCircuit, BookOpen, Package, FlaskConical,
  BarChart3, Building2, CheckCircle2, ArrowRight, ChevronDown,
  Smartphone, Shield, Zap, Star, Play, Bell, Fish,
  ThermometerSun, Wind, AlertTriangle, TrendingUp, Clock, Menu, X
} from "lucide-react"

// ─── Static data ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Droplets className="w-6 h-6" />,
    color: "from-ocean-500 to-ocean-600",
    glow: "bg-ocean-500/10 border-ocean-500/20",
    iconColor: "text-ocean-400",
    title: "실시간 수질 모니터링",
    desc: "수온·pH·DO(용존산소)·암모니아 등 9가지 수질 지표를 한눈에 확인하고, 기준 초과 시 즉시 알림을 받으세요.",
    tags: ["수온", "pH", "DO", "암모니아", "탁도"],
  },
  {
    icon: <BrainCircuit className="w-6 h-6" />,
    color: "from-purple-500 to-purple-600",
    glow: "bg-purple-500/10 border-purple-500/20",
    iconColor: "text-purple-400",
    title: "AI 어드바이저",
    desc: "수질 이상이 감지되면 AI가 원인 분석과 구체적인 대처 방법을 즉시 알려드립니다. 경험 없어도 걱정 없어요.",
    tags: ["자동 분석", "대처 가이드", "질병 예방"],
  },
  {
    icon: <FlaskConical className="w-6 h-6" />,
    color: "from-rose-500 to-rose-600",
    glow: "bg-rose-500/10 border-rose-500/20",
    iconColor: "text-rose-400",
    title: "질병 진단 & 관리",
    desc: "AHPND·EHP 등 주요 새우 질병을 현장 검사 결과와 함께 기록하고, 위험 수조를 빠르게 파악하세요.",
    tags: ["AHPND", "EHP", "비브리오", "위험도"],
  },
  {
    icon: <BookOpen className="w-6 h-6" />,
    color: "from-teal-500 to-teal-600",
    glow: "bg-teal-500/10 border-teal-500/20",
    iconColor: "text-teal-400",
    title: "양식 일지",
    desc: "급이량·폐사량·환수·소독 내역을 매일 기록하세요. 지난 입력값이 자동 저장되어 반복 입력이 줄어듭니다.",
    tags: ["급이 기록", "폐사 관리", "환수 이력"],
  },
  {
    icon: <Package className="w-6 h-6" />,
    color: "from-amber-500 to-amber-600",
    glow: "bg-amber-500/10 border-amber-500/20",
    iconColor: "text-amber-400",
    title: "재고 관리",
    desc: "사료·미생물제·소독약 재고를 실시간으로 추적하고, 재주문 기준량 이하로 내려가면 자동으로 알림을 받으세요.",
    tags: ["사료 재고", "미생물제", "자동 알림"],
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    color: "from-emerald-500 to-emerald-600",
    glow: "bg-emerald-500/10 border-emerald-500/20",
    iconColor: "text-emerald-400",
    title: "생산 관리 & 리포트",
    desc: "입식부터 수확까지 사이클별 원가·FCR·생존율을 자동 계산하고, 기간별 경영 리포트를 확인하세요.",
    tags: ["FCR 계산", "수익 분석", "성장 추적"],
  },
]

const STEPS = [
  {
    num: "01",
    icon: <Building2 className="w-8 h-8 text-ocean-400" />,
    title: "양식장·수조 등록",
    desc: "양식장 이름과 위치, 수조 개수를 입력하면 바로 시작할 수 있습니다. 5분이면 충분해요.",
    tip: "수조 종류(실내/노지)와 용량만 입력하면 됩니다",
  },
  {
    num: "02",
    icon: <Droplets className="w-8 h-8 text-teal-400" />,
    title: "수질 데이터 입력",
    desc: "측정한 수질 값을 스마트폰이나 PC에서 바로 입력하세요. IoT 센서를 연동하면 자동으로 기록됩니다.",
    tip: "수온과 DO만 입력해도 기본 관리가 가능합니다",
  },
  {
    num: "03",
    icon: <Bell className="w-8 h-8 text-amber-400" />,
    title: "이상 감지 알림 수신",
    desc: "기준치를 벗어나는 수질이 감지되면 즉시 알림이 표시됩니다. AI가 원인과 대처법을 함께 알려드립니다.",
    tip: "알림 기준은 흰다리새우 표준 수질 기준으로 자동 설정",
  },
  {
    num: "04",
    icon: <TrendingUp className="w-8 h-8 text-emerald-400" />,
    title: "데이터로 수익 개선",
    desc: "쌓인 데이터를 바탕으로 FCR, 생존율, 수익을 자동 분석합니다. 어느 수조가 잘 되고 있는지 한눈에 보여요.",
    tip: "월별·분기별 경영 리포트 자동 생성",
  },
]

const TESTIMONIALS = [
  { name: "김○○ 어가주", location: "전남 여수", text: "수질 측정값을 일일이 노트에 쓰다가 이걸 쓰기 시작했는데, 이상 알림이 오니까 폐사를 많이 줄였어요.", plan: "Pro" },
  { name: "이○○ 어가주", location: "경남 통영", text: "AI가 암모니아 높을 때 뭘 해야 하는지 바로 알려줘서 좋아요. 경험 없는 사람도 따라 할 수 있게 설명해줘요.", plan: "Basic" },
  { name: "박○○ 어가주", location: "충남 태안", text: "재고 관리가 특히 편해요. 사료가 떨어지기 전에 알림이 와서 수급 문제가 없어졌어요.", plan: "Basic" },
]

const FAQS = [
  { q: "스마트폰에서도 사용할 수 있나요?", a: "네, 모바일 최적화 웹앱입니다. 스마트폰 브라우저에서 바로 접속해 사용하실 수 있고, 홈 화면에 추가하면 앱처럼 쓸 수 있습니다." },
  { q: "수질 측정 장비가 없어도 되나요?", a: "네! 직접 측정한 값을 손으로 입력해도 모든 기능을 사용할 수 있습니다. IoT 센서 연동은 선택 사항입니다." },
  { q: "무료 플랜으로 어디까지 쓸 수 있나요?", a: "양식장 1개, 수조 5개까지 무료로 이용하실 수 있습니다. AI 어드바이저도 하루 5회 무료로 사용 가능합니다." },
  { q: "데이터 보안은 안전한가요?", a: "Supabase(AWS 기반) 서버에 암호화하여 저장됩니다. 내 데이터는 나만 볼 수 있고, 어디에도 공유되지 않습니다." },
  { q: "기존 데이터를 가져올 수 있나요?", a: "현재는 직접 입력 방식만 지원합니다. 이전 엑셀·노트 데이터는 순차적으로 입력하시거나, 오늘부터 새로 시작하셔도 됩니다." },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavBar({ onDemoClick }: { onDemoClick: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-lg flex items-center justify-center text-base leading-none">
            🦐
          </div>
          <span className="text-white font-bold text-lg">Shrimp365</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 text-sm text-slate-400">
          <a href="#features" className="hover:text-white transition-colors">기능 소개</a>
          <a href="#how-it-works" className="hover:text-white transition-colors">사용 방법</a>
          <a href="#pricing" className="hover:text-white transition-colors">요금제</a>
          <a href="#faq" className="hover:text-white transition-colors">자주 묻는 질문</a>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button onClick={onDemoClick} className="text-sm text-ocean-400 hover:text-ocean-300 transition-colors flex items-center gap-1">
            <Play className="w-3.5 h-3.5" /> 데모 체험
          </button>
          <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors px-4 py-1.5 rounded-lg border border-white/10 hover:bg-white/5">
            로그인
          </Link>
          <Link href="/signup" className="text-sm bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-400 hover:to-teal-400 text-white px-4 py-1.5 rounded-lg font-medium transition-all">
            무료 시작
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden text-slate-400" onClick={() => setMobileOpen(v => !v)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-slate-900 border-t border-white/5 px-4 py-4 space-y-3">
          {["#features:기능 소개", "#how-it-works:사용 방법", "#pricing:요금제", "#faq:자주 묻는 질문"].map(item => {
            const [href, label] = item.split(":")
            return <a key={href} href={href} onClick={() => setMobileOpen(false)} className="block text-slate-300 hover:text-white py-1.5">{label}</a>
          })}
          <div className="flex gap-3 pt-2">
            <Link href="/login" className="flex-1 text-center text-sm text-slate-300 px-4 py-2 rounded-lg border border-white/10">로그인</Link>
            <Link href="/signup" className="flex-1 text-center text-sm bg-gradient-to-r from-ocean-500 to-teal-500 text-white px-4 py-2 rounded-lg font-medium">무료 시작</Link>
          </div>
        </div>
      )}
    </nav>
  )
}

function WaterQualityCard() {
  return (
    <div className="bg-slate-800/80 backdrop-blur border border-white/10 rounded-2xl p-4 shadow-2xl w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white">A-1조 수질 현황</span>
        <span className="flex items-center gap-1 text-xs text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />정상
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "수온", value: "28.3", unit: "°C", ok: true, icon: <ThermometerSun className="w-3.5 h-3.5" /> },
          { label: "DO", value: "7.2", unit: "mg/L", ok: true, icon: <Wind className="w-3.5 h-3.5" /> },
          { label: "pH", value: "8.1", unit: "", ok: true, icon: <Droplets className="w-3.5 h-3.5" /> },
          { label: "암모니아", value: "0.08", unit: "mg/L", ok: true, icon: <AlertTriangle className="w-3.5 h-3.5" /> },
          { label: "탁도", value: "5.2", unit: "NTU", ok: true, icon: <Droplets className="w-3.5 h-3.5" /> },
          { label: "염도", value: "21.0", unit: "ppt", ok: true, icon: <Fish className="w-3.5 h-3.5" /> },
        ].map(item => (
          <div key={item.label} className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2">
            <div className="flex items-center gap-1 text-emerald-400 mb-1">{item.icon}<span className="text-[10px]">{item.label}</span></div>
            <p className="text-xs font-bold text-white">{item.value}<span className="text-slate-500 font-normal text-[10px]">{item.unit}</span></p>
          </div>
        ))}
      </div>
      <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-red-300">B-2조 알림</p>
          <p className="text-[10px] text-slate-400">DO 3.8 mg/L — 즉시 산소 공급 필요</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [faqOpen, setFaqOpen] = useState<number | null>(null)

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard")
  }, [user, loading, router])

  function handleDemo() {
    router.push("/login?demo=1")
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-10 h-10 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (user) return null

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">
      <NavBar onDemoClick={handleDemo} />

      {/* ─── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        {/* Background glows */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 -left-32 w-96 h-96 bg-ocean-500/15 rounded-full blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-80 h-80 bg-teal-500/15 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-ocean-500/30 to-transparent" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-20 grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: text */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-ocean-500/10 border border-ocean-500/20 rounded-full px-4 py-2">
              <Star className="w-3.5 h-3.5 text-ocean-400" />
              <span className="text-sm text-ocean-300 font-medium">흰다리새우 전문 양식 관리 플랫폼</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
              새우 양식,<br />
              <span className="bg-gradient-to-r from-ocean-300 via-teal-300 to-emerald-300 bg-clip-text text-transparent">
                이제 쉽게 관리하세요
              </span>
            </h1>

            <p className="text-lg text-slate-400 leading-relaxed max-w-lg">
              수질 모니터링부터 AI 질병 진단, 재고·생산 관리까지.<br />
              양식장 운영에 필요한 모든 것을 한 곳에서 해결하세요.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-400 hover:to-teal-400 text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all shadow-lg shadow-ocean-500/25 hover:shadow-ocean-500/40"
              >
                무료로 시작하기 <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                onClick={handleDemo}
                className="flex items-center justify-center gap-2 border border-white/15 hover:bg-white/5 text-slate-300 hover:text-white px-7 py-3.5 rounded-xl font-medium text-base transition-all"
              >
                <Play className="w-4 h-4 text-ocean-400" /> 데모 계정으로 체험
              </button>
            </div>

            <div className="flex items-center gap-6 text-sm text-slate-500">
              {["신용카드 불필요", "무료 플랜 영구 제공", "5분 만에 시작"].map(t => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />{t}
                </span>
              ))}
            </div>
          </div>

          {/* Right: preview card */}
          <div className="hidden lg:flex justify-center items-center relative">
            <div className="absolute inset-0 bg-gradient-to-r from-ocean-500/5 to-teal-500/5 rounded-3xl blur-2xl" />
            <div className="relative">
              <WaterQualityCard />
              {/* Floating notification */}
              <div className="absolute -top-6 -right-8 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg animate-bounce" style={{ animationDuration: "3s" }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-emerald-300 font-medium">AI 분석 완료</span>
              </div>
              {/* Floating badge */}
              <div className="absolute -bottom-5 -left-8 bg-ocean-500/10 border border-ocean-500/30 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg">
                <Bell className="w-4 h-4 text-ocean-400" />
                <span className="text-xs text-ocean-300">이상 즉시 알림</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-slate-600">
          <span className="text-xs">스크롤</span>
          <ChevronDown className="w-4 h-4 animate-bounce" />
        </div>
      </section>

      {/* ─── Stats bar ──────────────────────────────────────────────────────── */}
      <section className="border-y border-white/5 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "9가지", label: "수질 지표 모니터링" },
            { value: "24시간", label: "실시간 데이터 추적" },
            { value: "AI 즉시", label: "이상 원인 분석" },
            { value: "무료", label: "기본 플랜 영구 제공" },
          ].map(s => (
            <div key={s.label}>
              <p className="text-3xl font-bold bg-gradient-to-r from-ocean-300 to-teal-300 bg-clip-text text-transparent mb-1">{s.value}</p>
              <p className="text-sm text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/20 rounded-full px-4 py-1.5 mb-4">
              <Zap className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-sm text-teal-300">핵심 기능</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              양식장 운영의 모든 것,<br />하나로 해결
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              복잡한 수질 관리도, 재고 파악도, 경영 분석도 — Shrimp365 하나로 충분합니다
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div key={i} className={`group relative border ${f.glow} rounded-2xl p-6 hover:brightness-110 transition-all`}>
                <div className={`inline-flex w-12 h-12 rounded-xl items-center justify-center mb-4 bg-gradient-to-br ${f.color} shadow-lg`}>
                  <span className="text-white">{f.icon}</span>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed mb-4">{f.desc}</p>
                <div className="flex flex-wrap gap-1.5">
                  {f.tags.map(tag => (
                    <span key={tag} className="text-[11px] bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 text-slate-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-ocean-500/10 border border-ocean-500/20 rounded-full px-4 py-1.5 mb-4">
              <Clock className="w-3.5 h-3.5 text-ocean-400" />
              <span className="text-sm text-ocean-300">사용 방법</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              4단계로 바로 시작하세요
            </h2>
            <p className="text-slate-400">복잡한 설치나 설정 없이, 회원가입 후 바로 사용할 수 있습니다</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((step, i) => (
              <div key={i} className="relative">
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-12 left-[calc(100%+0px)] w-full h-px bg-gradient-to-r from-white/10 to-transparent z-10" />
                )}
                <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-4xl font-black text-white/5 leading-none">{step.num}</span>
                    <div className="w-12 h-12 bg-slate-700/50 rounded-xl flex items-center justify-center">
                      {step.icon}
                    </div>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">{step.desc}</p>
                  <div className="flex items-start gap-2 bg-white/3 border border-white/5 rounded-lg p-3">
                    <CheckCircle2 className="w-3.5 h-3.5 text-ocean-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-slate-500">{step.tip}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Testimonials ───────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">어가에서 직접 써봤습니다</h2>
            <p className="text-slate-400">실제 양식 어가의 경험을 들어보세요</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-slate-800/50 border border-white/5 rounded-2xl p-6">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-slate-300 text-sm leading-relaxed mb-5">"{t.text}"</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{t.name}</p>
                    <p className="text-slate-500 text-xs">{t.location}</p>
                  </div>
                  <span className="text-xs bg-ocean-500/20 text-ocean-300 border border-ocean-500/30 px-2.5 py-1 rounded-full">{t.plan} 플랜</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing preview ────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 bg-slate-900/30">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-4">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-sm text-emerald-300">요금제</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">규모에 맞는 플랜 선택</h2>
            <p className="text-slate-400">무료로 시작하고 필요할 때 업그레이드하세요</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {[
              {
                name: "Free", price: "₩0", sub: "영구 무료", highlight: false,
                features: ["양식장 1개", "수조 5개", "AI 어드바이저 하루 5회", "질병 진단 월 3회", "기본 수질 모니터링"],
              },
              {
                name: "Basic", price: "₩9,900", sub: "월 / 1인", highlight: true,
                features: ["양식장 2개", "수조 15개", "AI 어드바이저 하루 15회", "질병 진단 월 10회", "IoT 센서 1개", "자동 새로고침 (5분)", "CSV 내보내기"],
              },
              {
                name: "Pro", price: "₩19,900", sub: "월 / 1인", highlight: false,
                features: ["양식장 5개", "수조 50개", "AI 어드바이저 하루 30회", "질병 진단 무제한", "IoT 센서 5개", "자동 새로고침 (1분)", "90일 리포트"],
              },
            ].map(plan => (
              <div key={plan.name} className={`relative rounded-2xl p-6 flex flex-col ${
                plan.highlight
                  ? "bg-gradient-to-b from-ocean-600/30 to-teal-600/20 border-2 border-ocean-500/50 shadow-xl shadow-ocean-500/10"
                  : "bg-slate-800/50 border border-white/5"
              }`}>
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-ocean-500 to-teal-500 text-white text-xs font-bold px-4 py-1 rounded-full">
                    가장 인기
                  </div>
                )}
                <div className="mb-5">
                  <p className="text-base font-semibold text-white mb-2">{plan.name}</p>
                  <p className="text-3xl font-black text-white">{plan.price}</p>
                  <p className="text-xs text-slate-400 mt-1">{plan.sub}</p>
                </div>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`block text-center py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    plan.highlight
                      ? "bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-400 hover:to-teal-400 text-white shadow-md"
                      : "border border-white/15 hover:bg-white/5 text-slate-300 hover:text-white"
                  }`}
                >
                  {plan.price === "₩0" ? "무료로 시작" : "지금 시작하기"}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-slate-500 text-sm mt-6">
            더 많은 수조가 필요하신가요?{" "}
            <Link href="/pricing" className="text-ocean-400 hover:text-ocean-300 underline">전체 요금제 보기 →</Link>
          </p>
        </div>
      </section>

      {/* ─── FAQ ────────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">자주 묻는 질문</h2>
            <p className="text-slate-400">궁금한 점이 있으시면 확인해보세요</p>
          </div>

          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-slate-800/50 border border-white/5 rounded-xl overflow-hidden">
                <button
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-white/2 transition-colors"
                >
                  <span className="text-white font-medium pr-4">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${faqOpen === i ? "rotate-180" : ""}`} />
                </button>
                {faqOpen === i && (
                  <div className="px-5 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/5 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-ocean-900/40 via-slate-900 to-teal-900/40" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-ocean-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-3xl mx-auto px-4 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-6 text-4xl leading-none">
            🦐
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold mb-5">
            오늘부터 시작하세요
          </h2>
          <p className="text-lg text-slate-400 mb-8">
            신용카드 없이 무료로 시작할 수 있습니다.<br />
            5분이면 양식장 등록부터 수질 기록까지 끝납니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-400 hover:to-teal-400 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all shadow-xl shadow-ocean-500/25"
            >
              무료로 시작하기 <ArrowRight className="w-5 h-5" />
            </Link>
            <button
              onClick={handleDemo}
              className="flex items-center justify-center gap-2 border border-white/15 hover:bg-white/5 text-slate-300 px-8 py-4 rounded-xl font-medium text-base transition-all"
            >
              <Play className="w-4 h-4 text-ocean-400" /> 데모 먼저 보기
            </button>
          </div>
          <p className="text-slate-600 text-sm mt-6">
            <Smartphone className="w-3.5 h-3.5 inline mr-1" />스마트폰에서도 사용 가능 &nbsp;·&nbsp;
            <Shield className="w-3.5 h-3.5 inline mr-1" />데이터 암호화 보안
          </p>
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-lg flex items-center justify-center text-sm leading-none">
                🦐
              </div>
              <span className="text-white font-bold">Shrimp365</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-slate-500">
              <Link href="/pricing" className="hover:text-slate-300 transition-colors">요금제</Link>
              <Link href="/terms" className="hover:text-slate-300 transition-colors">이용약관</Link>
              <Link href="/privacy" className="hover:text-slate-300 transition-colors">개인정보처리방침</Link>
              <Link href="/login" className="hover:text-slate-300 transition-colors">로그인</Link>
            </div>
          </div>
          <div className="border-t border-white/5 mt-8 pt-6 text-center text-xs text-slate-600">
            © 2025 Shrimp365. 흰다리새우 양식 어가를 위한 스마트 관리 플랫폼.
          </div>
        </div>
      </footer>
    </div>
  )
}
