"use client"

import Link from "next/link"
import {
  CheckCircle2, Droplets, BrainCircuit, BookOpen, Package,
  FlaskConical, BarChart3, Building2, Wifi, ArrowRight
} from "lucide-react"

const FEATURES = [
  { icon: Droplets, label: "수질 모니터링", desc: "수온·pH·DO·암모니아 등 9가지 항목, 기준 초과 즉시 알림" },
  { icon: BrainCircuit, label: "AI 어드바이저", desc: "수질 이상 원인 분석·대처법을 한국어/영어/베트남어/인도네시아어로 안내" },
  { icon: BookOpen, label: "양식 일지", desc: "급이·폐사·환수·소독·미생물 기록을 단계별로 간편 입력" },
  { icon: FlaskConical, label: "질병 진단", desc: "AHPND·EHP·WSSV·Vibrio 검사 결과 기록 및 추이 분석" },
  { icon: Package, label: "재고 관리", desc: "사료·미생물제·소독제 재고 추적, 소진 전 자동 알림" },
  { icon: BarChart3, label: "리포트", desc: "7일·30일·90일 수질·생산 트렌드 분석 및 CSV 내보내기" },
  { icon: Building2, label: "양식장·수조", desc: "복수 양식장·수조를 한 화면에서 통합 관리" },
  { icon: Wifi, label: "IoT 센서 연동", desc: "수질 센서 자동 수집으로 수기 입력 대체" },
]

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="max-w-3xl mx-auto px-4 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-ocean-50 border border-ocean-100 rounded-full px-4 py-1.5 mb-6">
          <CheckCircle2 className="w-4 h-4 text-ocean-600" />
          <span className="text-sm font-medium text-ocean-700">완전 무료 · 광고 기반 운영</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4 leading-tight">
          모든 기능,<br />
          <span className="bg-gradient-to-r from-ocean-500 to-teal-500 bg-clip-text text-transparent">
            영원히 무료
          </span>
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
          Shrimp365는 광고 수익으로 운영됩니다.<br />
          구독료 없이 모든 기능을 제한 없이 사용하세요.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors text-lg"
        >
          무료로 시작하기
          <ArrowRight className="w-5 h-5" />
        </Link>
        <p className="mt-3 text-sm text-muted-foreground">신용카드 불필요 · 즉시 사용 가능</p>
      </section>

      <section className="max-w-4xl mx-auto px-4 pb-16">
        <h2 className="text-center text-xl font-semibold text-foreground mb-8">포함된 기능 전부</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex gap-4 p-5 rounded-2xl border border-border bg-card">
              <div className="w-10 h-10 rounded-xl bg-ocean-50 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-ocean-600" />
              </div>
              <div>
                <div className="font-semibold text-foreground mb-0.5">{label}</div>
                <div className="text-sm text-muted-foreground">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-muted/40 border-y border-border py-12">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-xl font-semibold mb-3">왜 무료인가요?</h2>
          <p className="text-muted-foreground leading-relaxed">
            Shrimp365는 앱 내 광고 수익으로 운영 비용을 충당합니다.<br />
            사용자는 구독료 없이 전체 기능을 이용하고,<br />
            광고주는 양식업 종사자에게 관련 제품·서비스를 노출합니다.
          </p>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold mb-4">지금 바로 시작하세요</h2>
        <p className="text-muted-foreground mb-8">동남아·미국·유럽 어디서나 스마트폰 브라우저로 접속 가능</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors"
          >
            무료 가입
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/guide"
            className="inline-flex items-center justify-center gap-2 border border-border bg-background hover:bg-accent text-foreground font-semibold px-8 py-3.5 rounded-xl transition-colors"
          >
            사용 가이드 보기
          </Link>
        </div>
      </section>
    </main>
  )
}
