"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, ChevronDown, ChevronUp, Download } from "lucide-react"

// ─── Section data ─────────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "start",
    step: "01",
    icon: "🔑",
    color: "from-ocean-500 to-teal-500",
    border: "border-ocean-500/30",
    bg: "bg-ocean-500/10",
    title: "계정 만들기 & 로그인",
    desc: "Shrimp365는 이메일로 바로 가입할 수 있습니다. 가입 후 이메일 인증만 마치면 즉시 사용할 수 있어요.",
    items: [
      { icon: "📧", text: "shrimp365.com 에서 '무료로 시작하기' 클릭" },
      { icon: "✉️", text: "이메일 주소와 비밀번호 입력 후 가입" },
      { icon: "✅", text: "발송된 인증 메일의 링크 클릭 (스팸함 확인)" },
      { icon: "🚀", text: "로그인 후 대시보드로 자동 이동" },
    ],
    tip: "처음 사용해 보고 싶다면 로그인 화면의 '테스트 계정' 버튼을 눌러 체험하세요. 가입 없이도 모든 기능을 미리 볼 수 있습니다.",
  },
  {
    id: "farm",
    step: "02",
    icon: "🏠",
    color: "from-teal-500 to-emerald-500",
    border: "border-teal-500/30",
    bg: "bg-teal-500/10",
    title: "양식장 & 수조 등록",
    desc: "가장 먼저 내 양식장과 수조를 등록하세요. 이후 모든 기록은 수조 단위로 관리됩니다.",
    items: [
      { icon: "🏗️", text: "좌측 메뉴 → '양식장 관리' 클릭" },
      { icon: "➕", text: "양식장 이름, 지역 입력 후 저장" },
      { icon: "🔵", text: "생성된 양식장 아래 '+ 수조 추가' 클릭" },
      { icon: "📝", text: "수조 이름, 면적(㎡), 목표 수량 입력" },
    ],
    tip: "수조를 여러 개 등록하면 각 수조별로 수질, 일지, 재고를 따로 관리할 수 있습니다. 수조 이름은 나중에 언제든 수정 가능합니다.",
  },
  {
    id: "water",
    step: "03",
    icon: "💧",
    color: "from-blue-500 to-ocean-500",
    border: "border-blue-500/30",
    bg: "bg-blue-500/10",
    title: "수질 기록하기",
    desc: "매일 수온·pH·DO(용존산소) 등의 수질 수치를 입력하면, 이상이 감지될 때 자동으로 알림을 드립니다.",
    items: [
      { icon: "📊", text: "좌측 메뉴 → '수질 모니터링' 클릭" },
      { icon: "🔄", text: "상단에서 수조 선택 (수조가 여러 개인 경우)" },
      { icon: "✏️", text: "'수질 기록 추가' 버튼 클릭 후 수치 입력" },
      { icon: "📈", text: "차트에서 수질 추이 확인, 경고값은 빨간색 표시" },
    ],
    tip: "수온 28~32℃, pH 7.5~8.5, DO 5mg/L 이상이 흰다리새우의 적정 범위입니다. 기준값을 벗어나면 알림 배너와 종 소리로 즉시 알려드립니다.",
  },
  {
    id: "journal",
    step: "04",
    icon: "📔",
    color: "from-emerald-500 to-teal-500",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    title: "양식 일지 작성",
    desc: "급이량, 폐사량, 환수, 소독 등 일상적인 작업 내역을 매일 기록하세요. 다음 번엔 이전 값이 자동으로 채워집니다.",
    items: [
      { icon: "📖", text: "좌측 메뉴 → '양식 일지' 클릭" },
      { icon: "➕", text: "우측 상단 '+ 일지 작성' 버튼 클릭" },
      { icon: "🐟", text: "급이량(kg), 폐사 수, 환수율 입력" },
      { icon: "💊", text: "미생물제·소독 여부 체크 후 저장" },
    ],
    tip: "사료 종류, 급이 횟수 등 반복 입력 항목은 마지막으로 저장한 값이 다음 번에 자동으로 채워집니다. 매일 바뀌는 수치만 수정하면 돼요.",
  },
  {
    id: "ai",
    step: "05",
    icon: "🤖",
    color: "from-purple-500 to-violet-500",
    border: "border-purple-500/30",
    bg: "bg-purple-500/10",
    title: "AI 어드바이저 활용",
    desc: "수질 이상이나 알림이 발생하면 AI에게 물어보세요. 원인 분석부터 대처 방법까지 구체적으로 안내해 드립니다.",
    items: [
      { icon: "🧠", text: "좌측 메뉴 → 'AI 어드바이저' 클릭" },
      { icon: "💬", text: "현재 상황을 자유롭게 입력 (한국어 OK)" },
      { icon: "📋", text: "AI가 수조 데이터를 참고해 맞춤 답변 제공" },
      { icon: "🔁", text: "추가 질문으로 대화를 이어 나갈 수 있음" },
    ],
    tip: "\"pH가 내려갔는데 어떻게 해야 하나요?\", \"오늘 폐사가 갑자기 늘었어요\" 처럼 일반 대화체로 물어봐도 됩니다.",
  },
  {
    id: "alert",
    step: "06",
    icon: "🔔",
    color: "from-amber-500 to-orange-500",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    title: "알림 & 경고 확인",
    desc: "수질 기준 초과, 재고 부족 등 중요한 상황이 생기면 우측 상단 종 아이콘에 빨간 숫자로 표시됩니다.",
    items: [
      { icon: "🔴", text: "화면 우측 상단 종(🔔) 아이콘의 숫자 확인" },
      { icon: "📋", text: "클릭 시 알림 목록 표시 (수조, 항목, 시각 포함)" },
      { icon: "➡️", text: "알림 클릭 → 해당 수조의 수질 페이지로 바로 이동" },
      { icon: "✅", text: "조치 완료 후 '해결됨' 처리하면 목록에서 사라짐" },
    ],
    tip: "알림은 최신 순으로 표시됩니다. 해결되지 않은 알림은 빨간색, 오래된 알림은 노란색으로 구분됩니다.",
  },
  {
    id: "inventory",
    step: "07",
    icon: "📦",
    color: "from-amber-500 to-yellow-500",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    title: "재고 관리",
    desc: "사료, 미생물제, 소독약 등의 재고를 등록해 두면 부족할 때 자동으로 알림을 드립니다.",
    items: [
      { icon: "📦", text: "좌측 메뉴 → '재고 관리' 클릭" },
      { icon: "➕", text: "'+ 품목 추가'로 사료, 약품 등록" },
      { icon: "📉", text: "재주문 기준량(최소 보유 수량) 설정" },
      { icon: "🚨", text: "재고가 기준량 이하로 떨어지면 대시보드에 경고 표시" },
    ],
    tip: "일지 작성 시 사용한 미생물제·소독제를 재고에 연결하면 사용할 때마다 재고가 자동으로 차감됩니다.",
  },
  {
    id: "report",
    step: "08",
    icon: "📊",
    color: "from-rose-500 to-pink-500",
    border: "border-rose-500/30",
    bg: "bg-rose-500/10",
    title: "리포트 & 분석",
    desc: "기간별 수질 통계, 급이 현황, 생산 실적 등을 한눈에 볼 수 있는 리포트를 확인하거나 다운로드할 수 있습니다.",
    items: [
      { icon: "📈", text: "좌측 메뉴 → '리포트' 클릭" },
      { icon: "📅", text: "조회 기간, 수조 선택 후 리포트 생성" },
      { icon: "📑", text: "수질 추이, 급이량, 폐사율 그래프 확인" },
      { icon: "⬇️", text: "PDF 또는 엑셀로 내보내기 가능" },
    ],
    tip: "월별 리포트를 정기적으로 확인하면 수익성 분석과 다음 사육 계획 수립에 도움이 됩니다.",
  },
]

const FAQS = [
  {
    q: "스마트폰에서도 사용할 수 있나요?",
    a: "네, Shrimp365는 모바일 브라우저에서 그대로 사용할 수 있습니다. Chrome, Safari 등 최신 브라우저를 사용하세요. 별도 앱 설치 없이도 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.",
  },
  {
    q: "데이터를 백업할 수 있나요?",
    a: "리포트 메뉴에서 기간을 선택해 엑셀(CSV) 또는 PDF로 내보낼 수 있습니다. 서버에 저장된 데이터는 삭제하지 않는 한 영구 보관됩니다.",
  },
  {
    q: "수조가 여러 개인 경우 한 번에 확인할 수 있나요?",
    a: "대시보드에서 모든 수조의 현재 상태를 한눈에 볼 수 있습니다. 수질 모니터링 페이지 상단의 드롭다운으로 수조를 바꾸며 상세 내역을 확인하세요.",
  },
  {
    q: "AI 어드바이저가 항상 정확한 답변을 주나요?",
    a: "AI는 입력된 수질 데이터와 일반적인 새우 양식 지식을 바탕으로 조언을 드리지만, 현장 상황에 따라 다를 수 있습니다. 심각한 질병 의심 시에는 반드시 전문가에게 문의하세요.",
  },
  {
    q: "무료 플랜에서 사용할 수 있는 기능은?",
    a: "무료 플랜은 양식장 1개, 수조 최대 3개까지 등록할 수 있으며, 수질 기록·일지·AI 어드바이저 기본 기능을 모두 사용할 수 있습니다. 수조가 더 필요하거나 고급 리포트가 필요하면 유료 플랜을 검토해보세요.",
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function GuidePage() {
  const [activeStep, setActiveStep] = useState<string | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 text-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white font-bold">
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

      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-ocean-500/10 border border-ocean-500/20 text-ocean-300 text-sm px-4 py-1.5 rounded-full mb-5">
            📖 사용 가이드
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold mb-4">
            처음 사용하시나요?<br />
            <span className="bg-gradient-to-r from-ocean-300 to-teal-300 bg-clip-text text-transparent">
              5분이면 시작할 수 있습니다
            </span>
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            아래 단계를 순서대로 따라하면 양식장 등록부터 수질 모니터링까지 바로 시작할 수 있습니다.
          </p>
        </div>

        {/* Quick nav pills */}
        <div className="flex flex-wrap gap-2 justify-center mb-12">
          {STEPS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 text-slate-400 hover:text-white transition-all"
            >
              <span>{s.icon}</span>
              <span>{s.title}</span>
            </a>
          ))}
        </div>

        {/* Steps */}
        <div className="space-y-6 mb-16">
          {STEPS.map((s, idx) => (
            <div
              key={s.id}
              id={s.id}
              className={`rounded-2xl border ${s.border} ${s.bg} overflow-hidden scroll-mt-20`}
            >
              {/* Header */}
              <button
                className="w-full flex items-center gap-4 p-5 text-left"
                onClick={() => setActiveStep(activeStep === s.id ? null : s.id)}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-2xl shrink-0`}>
                  {s.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold text-slate-500">STEP {s.step}</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">{s.title}</h2>
                  <p className="text-sm text-slate-400 line-clamp-1">{s.desc}</p>
                </div>
                <div className="shrink-0 text-slate-500">
                  {activeStep === s.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              {/* Body */}
              {(activeStep === s.id || idx === 0) && (
                <div className="px-5 pb-5 border-t border-white/5 pt-4">
                  <p className="text-slate-300 text-sm mb-4">{s.desc}</p>

                  <ol className="space-y-3 mb-5">
                    {s.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-200">
                          <span className="mr-1.5">{item.icon}</span>
                          {item.text}
                        </span>
                      </li>
                    ))}
                  </ol>

                  <div className="bg-ocean-500/10 border border-ocean-500/20 rounded-xl p-3 flex gap-3">
                    <span className="text-xl shrink-0">💡</span>
                    <p className="text-sm text-ocean-200">{s.tip}</p>
                  </div>

                  {idx < STEPS.length - 1 && (
                    <button
                      onClick={() => setActiveStep(STEPS[idx + 1].id)}
                      className="mt-4 flex items-center gap-1.5 text-sm text-ocean-400 hover:text-ocean-300 transition-colors"
                    >
                      다음 단계: {STEPS[idx + 1].title}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">자주 묻는 질문</h2>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="font-medium text-white">{faq.q}</span>
                  {openFaq === i
                    ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm text-slate-400 border-t border-white/5 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-gradient-to-br from-ocean-500/20 to-teal-500/20 border border-ocean-500/30 rounded-2xl p-10">
          <div className="text-5xl mb-4">🦐</div>
          <h2 className="text-2xl font-bold mb-3">준비 되셨나요?</h2>
          <p className="text-slate-400 mb-6">
            무료로 시작하고, 언제든지 업그레이드할 수 있습니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold px-8 py-3 rounded-xl transition-all"
            >
              무료로 시작하기 <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="/api/catalog"
              download="Shrimp365_catalog.pdf"
              className="inline-flex items-center justify-center gap-2 border border-white/20 hover:bg-white/5 text-white px-8 py-3 rounded-xl transition-all"
            >
              <Download className="w-4 h-4" /> 카탈로그 다운로드 (PDF)
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 text-slate-600 text-sm">
          <Link href="/" className="hover:text-slate-400 transition-colors">홈으로</Link>
          {" · "}
          <Link href="/pricing" className="hover:text-slate-400 transition-colors">요금제</Link>
          {" · "}
          <Link href="/login" className="hover:text-slate-400 transition-colors">로그인</Link>
        </div>
      </div>
    </div>
  )
}
