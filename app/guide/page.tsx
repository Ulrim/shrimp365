"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react"

const STEPS = [
  {
    id: "start",
    step: "01",
    icon: "🔑",
    accent: "ocean",
    title: "계정 만들기 & 로그인",
    desc: "이메일로 바로 가입할 수 있습니다. 가입 후 이메일 인증만 마치면 즉시 사용 가능합니다.",
    items: [
      { icon: "📧", text: "shrimp365.com에서 '무료로 시작하기' 클릭" },
      { icon: "✉️", text: "이메일 주소와 비밀번호 입력 후 가입" },
      { icon: "✅", text: "발송된 인증 메일의 링크 클릭 (스팸함 확인)" },
      { icon: "🚀", text: "로그인 후 홈 화면으로 자동 이동" },
    ],
    tip: "처음 사용해 보고 싶다면 로그인 화면의 '테스트 계정' 버튼으로 체험하세요. 가입 없이도 모든 기능을 미리 볼 수 있습니다.",
  },
  {
    id: "farm",
    step: "02",
    icon: "🏠",
    accent: "teal",
    title: "양식장 & 수조 등록",
    desc: "가장 먼저 양식장과 수조를 등록하세요. 이후 모든 기록은 수조 단위로 관리됩니다.",
    items: [
      { icon: "📱", text: "하단 메뉴 또는 좌측 메뉴 → '양식장·수조 관리' 클릭" },
      { icon: "➕", text: "'+ 양식장 추가' → 양식장 이름·지역 입력 후 저장" },
      { icon: "🔵", text: "생성된 양식장 아래 '+ 수조 추가' 클릭" },
      { icon: "📝", text: "수조 이름, 면적(㎡), 목표 수량 입력 후 저장" },
    ],
    tip: "수조를 여러 개 등록하면 각 수조별로 수질·일지·재고를 따로 관리할 수 있습니다. 수조 이름은 언제든 수정 가능합니다.",
  },
  {
    id: "home",
    step: "03",
    icon: "🏡",
    accent: "ocean",
    title: "홈 화면 — 오늘 무엇을 할까요?",
    desc: "로그인 후 나타나는 홈 화면에서 '기록'과 '현황 보기' 두 가지 중 하나를 선택합니다.",
    items: [
      { icon: "📝", text: "'오늘 기록하기' — 수질·양식 일지를 입력할 때" },
      { icon: "📊", text: "'현황 보기' — 대시보드에서 지금 상태 확인할 때" },
      { icon: "🔔", text: "우측 상단 종 아이콘 — 알림·경고 확인" },
      { icon: "🔍", text: "검색(⌘K) — 페이지·양식장·수조 빠른 이동" },
    ],
    tip: "매일 아침 홈 화면에서 '오늘 기록하기'로 시작하고, 저장 후 '현황 보기'로 상태를 확인하는 루틴을 추천합니다.",
  },
  {
    id: "water",
    step: "04",
    icon: "💧",
    accent: "blue",
    title: "수질 기록 — 단계별 입력",
    desc: "수질 기록은 한 번에 한 항목씩 입력합니다. 처음 쓰는 분도 막히지 않도록 단계별로 안내합니다.",
    items: [
      { icon: "📱", text: "홈 → '오늘 기록하기' → '수질 기록' 선택" },
      { icon: "🔵", text: "수조 선택 → 날짜 확인 → 수온 입력 → 다음" },
      { icon: "📏", text: "pH → 용존산소(DO) → 염도 → 암모니아 … 순서대로" },
      { icon: "✅", text: "마지막 '저장' 버튼 → 대시보드로 자동 이동" },
    ],
    tip: "수온 28~32℃, pH 7.5~8.5, DO 5mg/L 이상이 흰다리새우의 적정 범위입니다. 기준값을 벗어나면 알림으로 즉시 알려드립니다.",
  },
  {
    id: "journal",
    step: "05",
    icon: "📔",
    accent: "emerald",
    title: "양식 일지 — 단계별 기록",
    desc: "급이량·폐사·환수·소독 등 일상 작업 내역을 화면마다 하나씩 입력합니다.",
    items: [
      { icon: "📱", text: "홈 → '오늘 기록하기' → '양식 일지' 선택" },
      { icon: "🐟", text: "수조 → 날짜 → 사료 종류 → 급이량(kg) → 급이 횟수" },
      { icon: "💧", text: "폐사 수 → 환수율 → 소독 여부 → 미생물제 사용" },
      { icon: "🔧", text: "설비 점검 항목 체크 → 메모 → 저장" },
    ],
    tip: "이전 입력값이 자동으로 채워집니다. 매일 달라지는 숫자만 수정하면 되므로 2분이면 완료됩니다.",
  },
  {
    id: "monitor",
    step: "06",
    icon: "📊",
    accent: "teal",
    title: "현황 보기 — 대시보드 & 수질 모니터링",
    desc: "기록을 마쳤다면 대시보드에서 전체 수조 상태를, 수질 모니터링에서 차트와 이력을 확인하세요.",
    items: [
      { icon: "🏠", text: "홈 → '현황 보기' 또는 좌측 메뉴 → '대시보드'" },
      { icon: "🔴", text: "빨간 수조 카드 = 즉시 확인 필요 / 초록 = 정상" },
      { icon: "📈", text: "좌측 메뉴 → '수질 모니터링' → 수조별 차트 확인" },
      { icon: "📅", text: "날짜 범위 선택으로 과거 추이 비교 가능" },
    ],
    tip: "차트에서 특정 날짜 점을 클릭하면 그날 입력된 값을 확인할 수 있습니다. 이상값이 있으면 해당 날짜가 빨간 점으로 표시됩니다.",
  },
  {
    id: "ai",
    step: "07",
    icon: "🤖",
    accent: "purple",
    title: "AI 어드바이저 활용",
    desc: "수질 이상이나 알림 발생 시 AI에게 물어보세요. 원인 분석부터 대처 방법까지 구체적으로 안내합니다.",
    items: [
      { icon: "🧠", text: "좌측 메뉴 → 'AI 어드바이저' 클릭" },
      { icon: "💬", text: "현재 상황을 한국어로 자유롭게 입력" },
      { icon: "📋", text: "AI가 내 수조 데이터를 참고해 맞춤 답변 제공" },
      { icon: "🔁", text: "추가 질문으로 대화를 이어 나갈 수 있음" },
    ],
    tip: "\"pH가 갑자기 내려갔는데 어떻게 해야 하나요?\", \"오늘 폐사가 늘었어요\" 같이 일반 대화체로 물어봐도 됩니다.",
  },
  {
    id: "alert",
    step: "08",
    icon: "🔔",
    accent: "amber",
    title: "알림 & 경고 확인",
    desc: "수질 기준 초과, 재고 부족 등 중요한 상황은 우측 상단 종 아이콘에 빨간 숫자로 표시됩니다.",
    items: [
      { icon: "🔴", text: "화면 우측 상단 종(🔔) 아이콘의 숫자 확인" },
      { icon: "📋", text: "클릭 시 알림 목록 표시 (수조·항목·시각 포함)" },
      { icon: "➡️", text: "알림 항목 클릭 → 해당 수조 수질 페이지로 바로 이동" },
      { icon: "✅", text: "조치 완료 후 '해결됨' 처리하면 목록에서 사라짐" },
    ],
    tip: "알림은 최신 순으로 표시됩니다. '모두 해결' 버튼으로 한 번에 처리할 수 있습니다.",
  },
  {
    id: "inventory",
    step: "09",
    icon: "📦",
    accent: "amber",
    title: "재고 관리",
    desc: "사료·미생물제·소독약 재고를 등록해 두면 부족할 때 자동으로 알림을 드립니다.",
    items: [
      { icon: "📦", text: "좌측 메뉴 → '재고 관리' 클릭" },
      { icon: "➕", text: "'+ 품목 추가'로 사료·약품 등록" },
      { icon: "📉", text: "재주문 기준량(최소 보유 수량) 설정" },
      { icon: "🚨", text: "재고가 기준량 이하로 떨어지면 대시보드에 경고 표시" },
    ],
    tip: "일지 작성 시 사용한 미생물제·소독제를 재고에 연결하면 사용할 때마다 수량이 자동으로 차감됩니다.",
  },
  {
    id: "report",
    step: "10",
    icon: "📊",
    accent: "rose",
    title: "리포트 & 분석",
    desc: "기간별 수질 통계, 급이 현황, 생산 실적 등을 확인하고 PDF로 저장할 수 있습니다.",
    items: [
      { icon: "📈", text: "좌측 메뉴 → '리포트' 클릭" },
      { icon: "📅", text: "조회 기간·수조 선택 후 리포트 생성" },
      { icon: "📑", text: "수질 추이·급이량·폐사율 그래프 확인" },
      { icon: "⬇️", text: "PDF로 내보내기 가능" },
    ],
    tip: "월별 리포트를 정기적으로 확인하면 수익성 분석과 다음 사육 계획 수립에 도움이 됩니다.",
  },
]

const ACCENT_CLASSES: Record<string, { badge: string; icon: string; tip: string; pill: string }> = {
  ocean:   { badge: "bg-ocean-50 border-ocean-200 text-ocean-700", icon: "bg-ocean-100 text-ocean-600", tip: "bg-ocean-50 border-ocean-200 text-ocean-700", pill: "bg-ocean-50 hover:bg-ocean-100 border-ocean-200 text-ocean-700" },
  teal:    { badge: "bg-teal-50 border-teal-200 text-teal-700", icon: "bg-teal-100 text-teal-600", tip: "bg-teal-50 border-teal-200 text-teal-700", pill: "bg-teal-50 hover:bg-teal-100 border-teal-200 text-teal-700" },
  blue:    { badge: "bg-blue-50 border-blue-200 text-blue-700", icon: "bg-blue-100 text-blue-600", tip: "bg-blue-50 border-blue-200 text-blue-700", pill: "bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700" },
  emerald: { badge: "bg-emerald-50 border-emerald-200 text-emerald-700", icon: "bg-emerald-100 text-emerald-600", tip: "bg-emerald-50 border-emerald-200 text-emerald-700", pill: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700" },
  purple:  { badge: "bg-purple-50 border-purple-200 text-purple-700", icon: "bg-purple-100 text-purple-600", tip: "bg-purple-50 border-purple-200 text-purple-700", pill: "bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700" },
  amber:   { badge: "bg-amber-50 border-amber-200 text-amber-700", icon: "bg-amber-100 text-amber-600", tip: "bg-amber-50 border-amber-200 text-amber-700", pill: "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700" },
  rose:    { badge: "bg-rose-50 border-rose-200 text-rose-700", icon: "bg-rose-100 text-rose-600", tip: "bg-rose-50 border-rose-200 text-rose-700", pill: "bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700" },
}

const FAQS = [
  {
    q: "스마트폰에서도 사용할 수 있나요?",
    a: "네, 별도 앱 설치 없이 스마트폰 브라우저(Chrome·Safari)에서 바로 사용할 수 있습니다. 브라우저에서 '홈 화면에 추가'하면 앱처럼 아이콘으로 실행할 수 있습니다.",
  },
  {
    q: "수질 기록은 꼭 모든 항목을 입력해야 하나요?",
    a: "수온, pH, DO(용존산소), 염도는 핵심 항목으로 매일 기록을 권장합니다. 암모니아·아질산 등 나머지 항목은 측정하지 않은 날에는 건너뛰기(선택 사항) 버튼을 누르면 됩니다.",
  },
  {
    q: "수조가 여러 개인 경우 한 번에 확인할 수 있나요?",
    a: "대시보드에서 모든 수조의 현재 상태를 한눈에 볼 수 있습니다. 각 수조 카드를 클릭하면 해당 수조의 상세 수질 이력으로 바로 이동합니다.",
  },
  {
    q: "이전에 입력한 값을 수정하거나 삭제할 수 있나요?",
    a: "수질 모니터링 페이지의 이력 탭과 양식 일지 페이지에서 이전 기록을 수정하거나 삭제할 수 있습니다. 수정 버튼(연필 아이콘)을 클릭하면 됩니다.",
  },
  {
    q: "AI 어드바이저는 항상 정확한 답변을 주나요?",
    a: "AI는 입력된 수질 데이터와 새우 양식 지식을 바탕으로 조언을 드리지만, 현장 상황에 따라 다를 수 있습니다. 심각한 질병 의심 시에는 반드시 전문가에게도 문의하세요.",
  },
  {
    q: "데이터를 백업하거나 내보낼 수 있나요?",
    a: "리포트 메뉴에서 기간을 선택해 PDF로 내보낼 수 있습니다. 서버에 저장된 데이터는 삭제하지 않는 한 영구 보관됩니다.",
  },
  {
    q: "무료 플랜에서 사용할 수 있는 기능은?",
    a: "무료 플랜은 양식장 1개·수조 최대 3개까지 등록할 수 있으며, 수질 기록·일지·AI 어드바이저 기본 기능을 모두 사용할 수 있습니다. 수조가 더 필요하거나 고급 리포트가 필요하면 유료 플랜을 검토해보세요.",
  },
]

export default function GuidePage() {
  const [activeStep, setActiveStep] = useState<string>("start")
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-white text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-foreground">
            <div className="w-7 h-7 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-lg flex items-center justify-center text-sm leading-none">
              🦐
            </div>
            Shrimp365
          </Link>
          <Link
            href="/login"
            className="text-sm bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold px-4 py-1.5 rounded-lg transition-all"
          >
            로그인
          </Link>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-10 sm:py-14">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-ocean-50 border border-ocean-200 text-ocean-600 text-sm px-4 py-1.5 rounded-full mb-5">
            📖 사용 가이드
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold mb-4 text-foreground leading-tight">
            처음 사용하시나요?<br />
            <span className="bg-gradient-to-r from-ocean-500 to-teal-500 bg-clip-text text-transparent">
              5분이면 시작할 수 있습니다
            </span>
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            아래 단계를 순서대로 따라하면 양식장 등록부터 수질 모니터링까지 바로 시작할 수 있습니다.
          </p>
        </div>

        {/* Quick nav pills */}
        <div className="flex flex-wrap gap-2 justify-center mb-10">
          {STEPS.map((s) => {
            const ac = ACCENT_CLASSES[s.accent]
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActiveStep(s.id)}
                className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1.5 transition-all ${ac.pill}`}
              >
                <span>{s.icon}</span>
                <span className="hidden sm:inline">{s.title}</span>
                <span className="sm:hidden font-semibold">{s.step}</span>
              </a>
            )
          })}
        </div>

        {/* Steps */}
        <div className="space-y-4 mb-16">
          {STEPS.map((s, idx) => {
            const ac = ACCENT_CLASSES[s.accent]
            const isOpen = activeStep === s.id
            return (
              <div
                key={s.id}
                id={s.id}
                className="rounded-2xl border border-border bg-card overflow-hidden scroll-mt-20 shadow-sm"
              >
                {/* Header */}
                <button
                  className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => setActiveStep(isOpen ? "" : s.id)}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${ac.icon}`}>
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ac.badge}`}>STEP {s.step}</span>
                    </div>
                    <h2 className="text-base font-bold text-foreground truncate">{s.title}</h2>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{s.desc}</p>
                  </div>
                  <div className="shrink-0 text-muted-foreground">
                    {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </button>

                {/* Body */}
                {isOpen && (
                  <div className="px-4 sm:px-5 pb-5 border-t border-border pt-4">
                    <p className="text-muted-foreground text-sm mb-4">{s.desc}</p>

                    <ol className="space-y-3 mb-5">
                      {s.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${ac.icon}`}>
                            {i + 1}
                          </span>
                          <span className="text-sm text-foreground leading-relaxed">
                            <span className="mr-1.5">{item.icon}</span>
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ol>

                    <div className={`rounded-xl p-3 flex gap-3 border ${ac.tip}`}>
                      <span className="text-lg shrink-0">💡</span>
                      <p className="text-sm leading-relaxed">{s.tip}</p>
                    </div>

                    {idx < STEPS.length - 1 && (
                      <button
                        onClick={() => setActiveStep(STEPS[idx + 1].id)}
                        className="mt-4 flex items-center gap-1.5 text-sm text-ocean-600 hover:text-ocean-700 font-medium transition-colors"
                      >
                        다음 단계: {STEPS[idx + 1].title}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Daily workflow summary */}
        <div className="mb-16 bg-gradient-to-br from-ocean-50 to-teal-50 border border-ocean-200 rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-foreground mb-2 text-center">매일 이렇게 사용하세요</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">로그인 → 기록 → 확인의 3단계 루틴</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step: "① 아침", icon: "📝", title: "오늘 기록하기", desc: "홈 → 수질 기록 + 양식 일지\n약 5분이면 완료" },
              { step: "② 확인", icon: "🔔", title: "알림 확인", desc: "우측 상단 종 아이콘\n이상 수치 즉시 파악" },
              { step: "③ 분석", icon: "📊", title: "현황 보기", desc: "대시보드·수질 모니터링\n이상 징후 조기 발견" },
            ].map((item) => (
              <div key={item.step} className="bg-white rounded-xl border border-border p-4 text-center shadow-sm">
                <div className="text-3xl mb-2">{item.icon}</div>
                <div className="text-xs text-ocean-600 font-semibold mb-1">{item.step}</div>
                <div className="font-bold text-foreground text-sm mb-1">{item.title}</div>
                <div className="text-xs text-muted-foreground whitespace-pre-line">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">자주 묻는 질문</h2>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="font-medium text-foreground text-sm leading-snug">{faq.q}</span>
                  {openFaq === i
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm text-muted-foreground border-t border-border pt-3 leading-relaxed">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-gradient-to-br from-ocean-50 to-teal-50 border border-ocean-200 rounded-2xl p-8 sm:p-12">
          <div className="text-5xl mb-4">🦐</div>
          <h2 className="text-2xl font-bold mb-3 text-foreground">준비 되셨나요?</h2>
          <p className="text-muted-foreground mb-6">
            무료로 시작하고, 언제든지 업그레이드할 수 있습니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold px-8 py-3 rounded-xl transition-all"
            >
              무료로 시작하기 <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 border border-border hover:bg-muted text-foreground px-8 py-3 rounded-xl transition-all text-sm font-medium"
            >
              로그인하기
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 text-muted-foreground text-sm space-x-3">
          <Link href="/" className="hover:text-foreground transition-colors">홈으로</Link>
          <span>·</span>
          <Link href="/login" className="hover:text-foreground transition-colors">로그인</Link>
          <span>·</span>
          <Link href="/signup" className="hover:text-foreground transition-colors">회원가입</Link>
        </div>
      </div>
    </div>
  )
}
