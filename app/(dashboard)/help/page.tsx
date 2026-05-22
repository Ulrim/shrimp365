"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, Download } from "lucide-react"

const SECTIONS = [
  {
    id: "daily",
    icon: "🗓️",
    title: "매일 사용 루틴",
    desc: "하루 5분으로 양식장을 관리하는 기본 흐름입니다.",
    content: [
      { step: "① 홈 화면", detail: "로그인 후 나타나는 홈에서 '오늘 기록하기' 또는 '현황 보기' 중 선택합니다." },
      { step: "② 수질 기록", detail: "홈 → 오늘 기록하기 → 수질 기록. 수조 선택 후 수온·pH·DO 등을 화면마다 하나씩 입력합니다." },
      { step: "③ 양식 일지", detail: "홈 → 오늘 기록하기 → 양식 일지. 급이량·폐사·환수·소독 등을 단계별로 입력합니다. 이전 값이 자동으로 채워집니다." },
      { step: "④ 알림 확인", detail: "우측 상단 종(🔔) 아이콘을 눌러 수질 이상·재고 부족 알림을 확인하고 해결 처리합니다." },
      { step: "⑤ 대시보드", detail: "홈 → 현황 보기. 모든 수조의 상태를 한눈에 확인하고 이상 수조를 클릭해 상세를 봅니다." },
    ],
    tip: "기록은 아침에, 확인은 오후에 하는 루틴을 권장합니다. 이전 값 자동 채움 덕분에 일지는 2분이면 완료됩니다.",
  },
  {
    id: "record",
    icon: "📝",
    title: "기록 입력 방법",
    desc: "수질 기록과 양식 일지를 단계별 마법사로 입력합니다.",
    content: [
      { step: "수질 기록 순서", detail: "수조 선택 → 날짜 → 수온 → pH → DO → 염도 → 암모니아 → 아질산 → 질산 → 알칼리도 → 탁도 → 저장" },
      { step: "양식 일지 순서", detail: "수조 → 날짜 → 사료종류 → 급이량 → 급이횟수 → 폐사수 → 환수율 → 소독 → 미생물제 → 설비점검 → 메모 → 저장" },
      { step: "선택 항목 건너뛰기", detail: "측정하지 않은 항목은 '건너뛰기' 버튼을 누르면 됩니다. 수온·pH·DO·염도는 핵심 항목으로 매일 입력을 권장합니다." },
      { step: "이전 기록 수정", detail: "수질 모니터링 → 이력 탭, 또는 양식 일지 페이지에서 연필(✏️) 아이콘을 클릭하면 수정 가능합니다." },
    ],
    tip: "수온 28~32℃ / pH 7.5~8.5 / DO 5mg/L 이상이 흰다리새우 적정 범위입니다. 이 범위를 벗어나면 즉시 알림을 보내드립니다.",
  },
  {
    id: "monitor",
    icon: "📊",
    title: "모니터링 & 분석",
    desc: "대시보드, 수질 모니터링, 리포트로 현황을 파악합니다.",
    content: [
      { step: "대시보드", detail: "전체 수조 상태 카드, 최근 수질 이력, 재고 현황을 한 화면에서 볼 수 있습니다. 빨간 카드 = 즉시 확인 필요." },
      { step: "수질 모니터링", detail: "수조별 수질 차트와 이력을 날짜 범위로 조회합니다. 이상값은 빨간 점으로 표시됩니다." },
      { step: "양식 일지 이력", detail: "일지 페이지에서 날짜별 기록 목록을 확인하고 수정·삭제할 수 있습니다." },
      { step: "리포트", detail: "기간·수조를 선택해 수질 통계·급이 현황·생산 실적 리포트를 PDF로 저장할 수 있습니다." },
    ],
    tip: "차트에서 특정 날짜 점을 클릭하면 그날의 상세 수치를 확인할 수 있습니다.",
  },
  {
    id: "ai",
    icon: "🤖",
    title: "AI 어드바이저 사용법",
    desc: "수질 이상이나 궁금한 점을 한국어로 자유롭게 물어보세요.",
    content: [
      { step: "접근 방법", detail: "좌측 메뉴(또는 하단 더 보기) → AI 어드바이저" },
      { step: "질문 예시", detail: "\"pH가 갑자기 내려갔는데 어떻게 해야 하나요?\", \"오늘 폐사가 많이 나왔어요\", \"사료량을 조절해야 할까요?\"" },
      { step: "데이터 연동", detail: "AI는 내 수조 데이터를 참고해 맞춤 답변을 드립니다. 수질·일지 기록이 많을수록 더 정확한 조언이 가능합니다." },
      { step: "주의사항", detail: "AI 답변은 참고용입니다. 심각한 질병 의심 상황에서는 반드시 전문가에게 문의하세요." },
    ],
    tip: "빠른 질문 버튼으로 자주 묻는 질문을 바로 선택할 수도 있습니다.",
  },
  {
    id: "farm",
    icon: "🏠",
    title: "양식장 & 수조 관리",
    desc: "양식장과 수조를 추가·수정하고 센서 장치를 등록합니다.",
    content: [
      { step: "양식장 추가", detail: "양식장·수조 관리 → '+ 양식장 추가' → 이름·지역 입력 후 저장" },
      { step: "수조 추가", detail: "양식장 카드 하단 '+ 수조 추가' → 이름·면적·목표 수량 입력" },
      { step: "수조 상태 변경", detail: "수조 카드 우측 상단 메뉴에서 상태(정상/주의/위험/비가동)를 수동으로 변경할 수 있습니다." },
      { step: "센서 장치 연결", detail: "수조 상세에서 '장치 등록' → 장치 ID를 입력하면 실시간 수질 데이터가 자동 입력됩니다." },
    ],
    tip: "수조 이름은 나중에 언제든 수정할 수 있습니다. 비가동 상태로 설정하면 해당 수조는 알림 대상에서 제외됩니다.",
  },
  {
    id: "inventory",
    icon: "📦",
    title: "재고 관리",
    desc: "사료·약품 재고를 관리하고 부족 알림을 받습니다.",
    content: [
      { step: "품목 등록", detail: "재고 관리 → '+ 품목 추가' → 품목명·단위·현재 수량·재주문 기준량 입력" },
      { step: "재고 추가", detail: "품목 행 우측 '+ 추가' 버튼 → 입고 수량 입력. 구매 일자와 메모를 함께 기록할 수 있습니다." },
      { step: "자동 차감", detail: "일지에서 미생물제·소독제를 사용하면 연결된 재고 수량이 자동으로 차감됩니다." },
      { step: "부족 알림", detail: "현재 수량이 재주문 기준량 이하로 떨어지면 대시보드와 알림 패널에 경고가 표시됩니다." },
    ],
    tip: "사료는 '급이량(kg) × 일수'를 계산해 재주문 기준량을 설정하면 재고 부족 없이 운영할 수 있습니다.",
  },
]

const SHORTCUTS = [
  { key: "⌘K / Ctrl+K", desc: "전체 검색 열기" },
  { key: "ESC", desc: "검색·알림 패널 닫기" },
  { key: "↑↓ + Enter", desc: "검색 결과 이동·선택" },
]

export default function InAppGuidePage() {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<string>("daily")
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">사용 가이드</h1>
        <p className="text-sm text-muted-foreground">Shrimp365 주요 기능 사용 방법을 확인하세요.</p>
      </div>

      {/* Daily routine summary */}
      <div className="bg-gradient-to-br from-ocean-50 to-teal-50 dark:from-ocean-950/30 dark:to-teal-950/30 border border-ocean-200 dark:border-ocean-800 rounded-2xl p-5 mb-6">
        <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <span>🗓️</span> 매일 이렇게 사용하세요
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { step: "① 아침", icon: "📝", title: "기록하기", desc: "수질 + 양식 일지 (약 5분)", href: "/record" },
            { step: "② 수시", icon: "🔔", title: "알림 확인", desc: "우측 상단 종 아이콘", href: null },
            { step: "③ 분석", icon: "📊", title: "현황 보기", desc: "대시보드 & 수질 모니터링", href: "/dashboard" },
          ].map((item) => (
            <button
              key={item.step}
              onClick={() => item.href && router.push(item.href)}
              aria-label={item.href ? `${item.title}으로 이동: ${item.desc}` : item.title}
              className={`bg-card rounded-xl border border-border p-4 text-left shadow-sm min-h-[44px] ${item.href ? "hover:border-ocean-300 hover:shadow-md transition-all cursor-pointer" : "cursor-default"}`}
            >
              <div className="text-2xl mb-1">{item.icon}</div>
              <div className="text-xs text-ocean-600 font-semibold">{item.step}</div>
              <div className="font-semibold text-foreground text-sm">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3 mb-8">
        {SECTIONS.map((s) => {
          const isOpen = activeSection === s.id
          return (
            <div key={s.id} className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              <button
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors min-h-[44px]"
                onClick={() => setActiveSection(isOpen ? "" : s.id)}
                aria-expanded={isOpen}
                aria-controls={`section-content-${s.id}`}
              >
                <span className="text-2xl shrink-0">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.desc}</p>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {isOpen && (
                <div id={`section-content-${s.id}`} className="border-t border-border px-4 pb-4 pt-3">
                  <div className="space-y-3 mb-4">
                    {s.content.map((item, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="w-5 h-5 rounded-full bg-ocean-100 text-ocean-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-0.5">{item.step}</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-ocean-50 dark:bg-ocean-950/30 border border-ocean-200 dark:border-ocean-800 rounded-xl p-3 flex gap-2">
                    <span className="text-base shrink-0" aria-hidden="true">💡</span>
                    <p className="text-xs text-ocean-700 dark:text-ocean-300 leading-relaxed">{s.tip}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Keyboard shortcuts */}
      <div className="bg-card border border-border rounded-2xl p-4 mb-6 shadow-sm">
        <h2 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2">
          ⌨️ 키보드 단축키
        </h2>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <kbd className="text-xs bg-muted border border-border rounded px-2 py-1 font-mono shrink-0">{s.key}</kbd>
              <span className="text-xs text-muted-foreground">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="space-y-3">
        <a
          href="/guide"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="전체 사용 가이드 보기 (새 탭에서 열림)"
          className="flex items-center justify-between gap-3 bg-gradient-to-r from-ocean-50 to-teal-50 dark:from-ocean-950/30 dark:to-teal-950/30 border border-ocean-200 dark:border-ocean-800 rounded-2xl p-4 min-h-[44px] hover:from-ocean-100 hover:to-teal-100 transition-all group"
        >
          <div>
            <p className="font-semibold text-ocean-700 text-sm">전체 사용 가이드 보기</p>
            <p className="text-xs text-ocean-600 mt-0.5">시작부터 고급 활용법까지 상세 설명서를 확인하세요.</p>
          </div>
          <ExternalLink className="w-4 h-4 text-ocean-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </a>
        <a
          href="/api/guide"
          download="Shrimp365_사용설명서.pdf"
          aria-label="사용설명서 PDF 다운로드 (7페이지)"
          className="flex items-center justify-between gap-3 bg-card border border-border rounded-2xl p-4 min-h-[44px] hover:bg-muted transition-all group"
        >
          <div>
            <p className="font-semibold text-foreground text-sm">사용설명서 PDF 다운로드</p>
            <p className="text-xs text-muted-foreground mt-0.5">오프라인에서도 볼 수 있도록 PDF로 저장하세요. (7페이지)</p>
          </div>
          <Download className="w-4 h-4 text-muted-foreground shrink-0" />
        </a>
      </div>
    </div>
  )
}
