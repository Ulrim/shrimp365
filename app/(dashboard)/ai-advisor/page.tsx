"use client"

import { useState, useRef, useEffect } from "react"
import { MOCK_TANKS, MOCK_WATER_QUALITY, MOCK_ALERTS, MOCK_DIAGNOSES, WATER_QUALITY_STANDARDS, isTestAccount } from "@/lib/mock-data"
import { getAllTanks, getAlerts, getDiagnoses } from "@/lib/db"
import { useAuth } from "@/lib/auth-context"
import type { Tank, Alert, DiagnosisResult } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BrainCircuit, Send, AlertTriangle, Lightbulb, TrendingUp, Activity, Sparkles, User, Bot, ChevronRight, Download } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { UpgradeModal } from "@/components/ui/upgrade-modal"
import type { Plan } from "@/lib/plans"
import { useT } from "@/lib/i18n-context"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

const QUICK_QUESTIONS = [
  "DO(용존산소)가 낮을 때 어떻게 대처하나요?",
  "암모니아 수치가 높아졌을 때 조치는?",
  "새우가 갑자기 폐사하면 어떻게 해야 하나요?",
  "환수는 얼마나 자주, 얼마나 해야 하나요?",
  "급이량은 어떻게 결정하나요?",
  "흰다리새우 최적 수질 기준이 궁금해요",
]

const AI_RESPONSES: Record<string, string> = {
  "DO(용존산소)가 낮을 때 어떻게 대처하나요?": `**DO(용존산소) 저하 대처 가이드**

📊 **흰다리새우 DO 기준**
- 정상: 7.0 mg/L 이상
- 주의: 5.0~7.0 mg/L
- 위험: 5.0 mg/L 미만 → 즉시 조치 필요

🔍 **주요 원인**
1. 수온 상승 (수온 1°C 상승 시 DO 포화량 약 2% 감소)
2. 유기물 과다 → 분해 과정에서 산소 소모
3. 에어스톤·블로워 노화 또는 막힘
4. 사육 밀도 과도

✅ **즉시 조치**
1. 폭기량 20~30% 즉시 증가
2. 급이량 20% 감소 (잔사 추가 산소 소모 방지)
3. 10~20% 환수 실시 (신선한 해수 투입)
4. 에어스톤 상태 점검 및 청소

💡 **예방 관리**
- DO 6.0 mg/L 미만 알림 설정
- 고수온 시기(여름) 야간 폭기 강화
- 재식 밀도 기준(80~100마리/㎡) 준수`,

  "암모니아 수치가 높아졌을 때 조치는?": `**암모니아(NH₃) 상승 대처 가이드**

📊 **기준치**
- 정상: 0.3 mg/L 미만
- 주의: 0.3~0.5 mg/L
- 위험: 0.5 mg/L 초과 → 즉시 조치

🔍 **주요 원인**
1. 급이 과잉으로 미섭이 사료 잔류
2. 유기물(분변, 탈피각) 분해
3. 생물 여과 시스템 기능 저하
4. 환수 부족으로 질소 누적

✅ **즉시 조치 (0.5 mg/L 초과)**
1. 급이량 20~30% 즉시 감소
2. 10~15% 환수 실시
3. 바실러스균 미생물제 투입 (유기물 분해 촉진)
4. 폭기 강화 (암모니아→아질산염 산화 촉진)

💡 **중기 관리 (24~48시간)**
- 생물 여과조 점검 및 바이오미디어 세척
- 섭이율 점검 후 적정 급이량 재조정
- pH 8.0 이하 유지 (알칼리성일수록 독성 NH₃ 증가)`,

  "새우가 갑자기 폐사하면 어떻게 해야 하나요?": `**급성 폐사 긴급 대응 SOP**

🚨 **1단계: 즉각 확인 (0~1시간)**
1. 폐사 규모 확인 (몇 마리인지, 어느 수조인지)
2. 폐사 새우 외관 관찰 (빈 위장, 백화, 붉은 변색 여부)
3. 수질 긴급 측정 (DO, 수온, pH, 암모니아)

🔍 **원인별 구분**

| 증상 | 의심 원인 |
|------|-----------|
| 위장 비어있음, 간췌장 위축 | AHPND (급성간췌장괴사병) |
| 근육 백화, 전신 마비 | WSD (흰반점증후군) |
| DO 급락과 동시 폐사 | 산소 결핍 |
| 몸 표면 붉게 변색 | 암모니아·아질산염 중독 |
| 특정 수조만 폐사 | 수질 국소 문제 |

✅ **2단계: 즉각 조치**
1. 해당 수조 격리 (공유 배관 차단)
2. 폭기 최대 가동 + 20~30% 긴급 환수
3. 급이량 50% 이상 감소 또는 중단
4. 폐사체 즉시 제거 (2차 오염 방지)

📞 **3단계: 전문 진단 (24시간 이내)**
- 시료(폐사 새우 5~10마리) 냉장 보관 후 검사 기관 의뢰
- 지자체 수산과 신고 (전염성 질병 의심 시 의무)`,

  "환수는 얼마나 자주, 얼마나 해야 하나요?": `**환수 관리 가이드**

💧 **기본 환수 원칙 (흰다리새우)**

| 사육 시기 | 환수량 | 주기 |
|-----------|--------|------|
| 초기 (1~30일) | 5~10% | 3~5일마다 |
| 중기 (31~60일) | 10~20% | 2~3일마다 |
| 후기 (61일 이후) | 20~30% | 1~2일마다 |

🚨 **긴급 환수가 필요한 경우**
- DO 5.0 mg/L 미만 → 즉시 20% 환수
- 암모니아 0.5 mg/L 초과 → 10~15% 환수
- 탁도 20 NTU 초과 → 20~30% 환수
- 폐사 다수 발생 → 30% 이상 긴급 환수

💡 **환수 시 주의사항**
1. 투입 해수 수온 차 ±2°C 이내 유지
2. 염도 차 ±2 ppt 이내 유지 (급격한 변화 금지)
3. 환수 전 신규 해수 수질 확인 필수
4. 야간(수온 하강 시) 환수 피하기`,

  "급이량은 어떻게 결정하나요?": `**급이량 결정 가이드**

📏 **기본 급이량 계산법**
> 급이량(kg) = 수조 새우 총 중량 × 급이율(%)

**사육 시기별 급이율**
| 시기 | 평균 체중 | 급이율 |
|------|-----------|--------|
| 초기 (1~30일) | 0.1~1g | 8~10% |
| 중기 (31~60일) | 1~10g | 4~6% |
| 후기 (61일~) | 10g 이상 | 2~4% |

✅ **섭이 반응 확인 (급이 트레이 기준)**
- 1.5~2시간 후 사료가 20~30% 남음 → 적정
- 모두 먹음 → 5~10% 증량
- 절반 이상 남음 → 10~20% 감량

🚨 **급이량 감량 기준**
| 상황 | 감량 |
|------|------|
| DO 5.0~6.0 mg/L | -20% |
| DO 5.0 mg/L 미만 | -30~50% |
| 암모니아 0.3 mg/L 초과 | -20% |
| 탁도 20 NTU 초과 | -50% |
| 수온 30°C 초과 | -20% |
| 폭우·저기압 | -30% |`,

  "흰다리새우 최적 수질 기준이 궁금해요": `**흰다리새우 최적 수질 기준표**

| 항목 | 최적 범위 | 위험 기준 |
|------|-----------|-----------|
| 수온 | 26~28°C | <22°C 또는 >32°C |
| DO | 7.0 mg/L 이상 | 5.0 mg/L 미만 |
| pH | 7.8~8.5 | <7.5 또는 >8.8 |
| 염도 | 15~25 ppt | <10 또는 >35 ppt |
| 암모니아 (NH₃) | 0.1 mg/L 미만 | 0.5 mg/L 초과 |
| 아질산염 (NO₂) | 0.1 mg/L 미만 | 0.5 mg/L 초과 |
| 질산염 (NO₃) | 20 mg/L 미만 | 50 mg/L 초과 |
| 알칼리도 | 100~150 mg/L | <80 mg/L |
| 탁도 | 10 NTU 미만 | 20 NTU 초과 |

📋 **측정 권장 주기**
- DO·수온: 하루 2~3회 (새벽 5시, 오전 10시, 오후 5시)
- pH·암모니아·아질산염: 주 2~3회
- 탁도·알칼리도: 주 1~2회

💡 **핵심 관리 포인트**
DO와 암모니아가 가장 즉각적인 폐사 원인.
이 두 항목은 알림 기준을 가장 엄격하게 설정하세요.`,
}

function generateDefaultResponse(question: string, tankCount: number, alertCount: number): string {
  return `**"${question}"에 대한 답변**

현재 AI 분석 시스템이 해당 질문을 처리하고 있습니다.

📊 **현재 모니터링 데이터 기반 분석**
- 운영 중인 수조: ${tankCount}개
- 활성 알림: ${alertCount}건

💡 **일반 권고사항**
1. 이상 수조 우선 점검 및 환수 실시
2. 급이량 조정 (이상 수조 -20~50%)
3. 폭기 시스템 점검
4. 24시간 이내 재측정 및 모니터링 강화

더 구체적인 질문을 입력하시면 상세 분석을 제공해드립니다.`
}

export default function AIAdvisorPage() {
  const { user } = useAuth()
  const { t } = useT()
  const [tanks, setTanks] = useState<Tank[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [aiRemaining, setAiRemaining] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadData() {
      const mock = isTestAccount(user?.email)
      let finalTanks = MOCK_TANKS
      let finalAlerts = MOCK_ALERTS.filter(x => !x.resolved)
      let finalDiagnoses = MOCK_DIAGNOSES
      if (!mock) {
        try {
          const [tankData, a, d] = await Promise.all([getAllTanks(), getAlerts(true), getDiagnoses()])
          finalTanks = tankData
          finalAlerts = a.filter(x => !x.resolved)
          finalDiagnoses = d
        } catch { }
      }
      setTanks(finalTanks)
      setAlerts(finalAlerts)
      setDiagnoses(finalDiagnoses)
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: `${t.aiAdvisor.welcomeTitle}\n\n${t.aiAdvisor.welcomeMsg}\n\n현재 **${finalTanks.length}개 수조** 운영 현황을 실시간으로 분석하고 있습니다.\n\n${finalAlerts.length > 0 ? `**활성 알림 ${finalAlerts.length}건**이 감지되었습니다.` : "현재 활성 알림이 없습니다."} 아래 빠른 질문 버튼을 눌러 시작하거나, 직접 질문을 입력하세요.`,
        timestamp: new Date(),
      }])
      setDataLoaded(true)
    }
    loadData()
  }, [user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const buildContext = () => {
    const lines: string[] = []
    lines.push(`${t.aiAdvisor.contextTank}: ${tanks.length}개`)
    if (tanks.length > 0) {
      const statusSummary = tanks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1
        return acc
      }, {})
      lines.push(`수조 상태: 정상 ${statusSummary.active ?? 0}개, 주의 ${statusSummary.warning ?? 0}개, 위험 ${statusSummary.danger ?? 0}개`)
    }
    if (alerts.length > 0) {
      lines.push(`${t.aiAdvisor.contextAlert} ${alerts.length}건:`)
      alerts.slice(0, 3).forEach(a => lines.push(`  - [${a.type}] ${a.tank_name}: ${a.message}`))
    }
    if (diagnoses.length > 0) {
      const positive = diagnoses.filter(d => d.result === "양성")
      if (positive.length > 0) {
        lines.push(`${t.aiAdvisor.contextDiagnosis} ${positive.length}건:`)
        positive.slice(0, 2).forEach(d => lines.push(`  - ${d.tank_name}: ${d.test_type} ${d.result} (위험도: ${d.risk_level})`))
      }
    }
    return lines.join("\n")
  }

  const downloadChatAsPDF = () => {
    if (messages.length === 0) return
    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    const dateStr = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
    const timeStr = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })

    const rows = messages.map(msg => {
      const isAI = msg.role === "assistant"
      const ts = msg.timestamp.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
      const escaped = msg.content
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>")
      return `
        <div class="msg ${isAI ? "ai" : "user"}">
          <div class="avatar">${isAI ? "🤖" : "👤"}</div>
          <div class="bubble">
            <div class="name">${isAI ? "AI 어드바이저" : "나"}</div>
            <div class="text">${escaped}</div>
            <div class="time">${ts}</div>
          </div>
        </div>`
    }).join("")

    printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>AI 어드바이저 대화 — ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; background: #fff; color: #0f172a; padding: 32px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 24px; border-bottom: 2px solid #0ea5e9; padding-bottom: 12px; }
  .messages { display: flex; flex-direction: column; gap: 16px; }
  .msg { display: flex; gap: 12px; align-items: flex-start; }
  .msg.user { flex-direction: row-reverse; }
  .avatar { width: 32px; height: 32px; font-size: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .bubble { max-width: 75%; background: #f1f5f9; border-radius: 12px; padding: 12px 14px; border: 1px solid #e2e8f0; }
  .msg.user .bubble { background: #e0f2fe; border-color: #bae6fd; }
  .name { font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px; }
  .text { font-size: 13px; line-height: 1.7; color: #1e293b; }
  .text strong { font-weight: 700; color: #0f172a; }
  .time { font-size: 10px; color: #94a3b8; margin-top: 6px; text-align: right; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  @media print {
    body { padding: 16px; }
    @page { margin: 16mm; size: A4; }
  }
</style>
</head>
<body>
<h1>🦐 AI 어드바이저 대화 기록</h1>
<div class="meta">${dateStr} ${timeStr} 기준 저장 · 수조 ${tanks.length}개 운영 중 · 활성 알림 ${alerts.length}건</div>
<div class="messages">${rows}</div>
<div class="footer">© 2026 CULIVER INC. · Shrimp365 AI 어드바이저 · 본 내용은 참고용이며 전문가 의견을 대체하지 않습니다.</div>
</body>
</html>`)
    printWindow.document.close()
    printWindow.addEventListener("load", () => {
      printWindow.focus()
      printWindow.print()
    })
  }

  const sendMessage = async (question: string) => {
    question = question.trim().slice(0, 500)
    if (!question) return
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: question, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)

    // Use local API route (no external SDK required)
    try {
      const res = await fetch("/api/ai-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: buildContext() }),
      })

      if (res.status === 429) {
        setUpgradeOpen(true)
        return
      }

      const json = await res.json()
      if (json.remaining !== undefined && json.remaining !== null) setAiRemaining(json.remaining)
      const response = json.answer || generateDefaultResponse(question, tanks.length, alerts.length)
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: response, timestamp: new Date() }])
    } catch {
      // Network error fallback
      const fallback = AI_RESPONSES[question] || generateDefaultResponse(question, tanks.length, alerts.length)
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: fallback, timestamp: new Date() }])
    } finally {
      setLoading(false)
    }
  }

  const renderMarkdown = (text: string) => {
    const lines = text.split("\n")
    const elements: React.ReactNode[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // Table block: collect consecutive | lines
      if (line.includes("|") && !line.match(/^[-|:\s]+$/)) {
        const tableLines: string[] = []
        while (i < lines.length && (lines[i].includes("|") || lines[i].match(/^[-|:\s]+$/))) {
          if (!lines[i].match(/^[-|:\s]+$/)) tableLines.push(lines[i])
          i++
        }
        if (tableLines.length > 0) {
          const [headerRow, ...bodyRows] = tableLines
          const headers = headerRow.split("|").map(c => c.trim()).filter(Boolean)
          elements.push(
            <div key={`table-${i}`} className="overflow-x-auto my-2 rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>{headers.map((h, hi) => <th key={hi} className="px-3 py-2 text-left text-foreground font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => {
                    const cells = row.split("|").map(c => c.trim()).filter(Boolean)
                    return (
                      <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/40"}>
                        {cells.map((cell, ci) => <td key={ci} className="px-3 py-2 text-foreground/80 whitespace-nowrap">{cell}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }
        continue
      }

      // Section heading (full-line bold)
      if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
        elements.push(<p key={i} className="font-bold text-foreground text-sm mt-3 mb-1">{line.replace(/\*\*/g, "")}</p>)
        i++; continue
      }

      // Numbered list
      if (/^\d+\.\s/.test(line)) {
        const listItems: string[] = []
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          listItems.push(lines[i].replace(/^\d+\.\s/, ""))
          i++
        }
        elements.push(
          <ol key={`ol-${i}`} className="space-y-1 my-1 pl-1">
            {listItems.map((item, li) => {
              const parts = item.split(/\*\*(.*?)\*\*/g)
              return (
                <li key={li} className="flex gap-2 text-sm text-foreground/80 leading-relaxed">
                  <span className="w-5 h-5 rounded-full bg-ocean-100 text-ocean-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{li + 1}</span>
                  <span>{parts.map((p, pi) => pi % 2 === 1 ? <strong key={pi} className="text-foreground">{p}</strong> : p)}</span>
                </li>
              )
            })}
          </ol>
        )
        continue
      }

      // Bullet list
      if (line.startsWith("- ") || line.startsWith("• ")) {
        const listItems: string[] = []
        while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("• "))) {
          listItems.push(lines[i].replace(/^[-•]\s/, ""))
          i++
        }
        elements.push(
          <ul key={`ul-${i}`} className="space-y-1 my-1 pl-1">
            {listItems.map((item, li) => {
              const parts = item.split(/\*\*(.*?)\*\*/g)
              return (
                <li key={li} className="flex gap-2 text-sm text-foreground/80 leading-relaxed">
                  <span className="text-ocean-500 shrink-0 mt-1">•</span>
                  <span>{parts.map((p, pi) => pi % 2 === 1 ? <strong key={pi} className="text-foreground">{p}</strong> : p)}</span>
                </li>
              )
            })}
          </ul>
        )
        continue
      }

      // Heading (#)
      if (line.startsWith("#")) {
        elements.push(<p key={i} className="font-semibold text-ocean-600 mt-3 text-sm">{line.replace(/^#+\s/, "")}</p>)
        i++; continue
      }

      // Empty line
      if (!line.trim()) {
        elements.push(<div key={i} className="h-1" />)
        i++; continue
      }

      // Normal line with optional inline bold
      const parts = line.split(/\*\*(.*?)\*\*/g)
      elements.push(
        <p key={i} className="text-sm text-foreground/80 leading-relaxed">
          {parts.map((p, pi) => pi % 2 === 1 ? <strong key={pi} className="text-foreground">{p}</strong> : p)}
        </p>
      )
      i++
    }

    return elements
  }

  if (!dataLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
    <UpgradeModal
      open={upgradeOpen}
      onClose={() => setUpgradeOpen(false)}
      currentPlan={(user?.plan ?? "free") as Plan}
      limitType="ai"
    />
    <div className="flex flex-col gap-3 animate-fade-in lg:h-[calc(100vh-8rem)]">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 bg-gradient-to-br from-ocean-500 to-teal-500 rounded-xl flex items-center justify-center shrink-0">
          <BrainCircuit className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-bold text-foreground leading-tight truncate">{t.aiAdvisor.title}</h2>
          <p className="text-xs text-muted-foreground truncate">{t.aiAdvisor.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {aiRemaining !== null && (
            <span className={`hidden sm:block text-xs px-2 py-1 rounded-lg border ${
              aiRemaining <= 2
                ? "bg-red-50 border-red-200 text-red-600"
                : aiRemaining <= 5
                ? "bg-amber-50 border-amber-200 text-amber-600"
                : "bg-muted border-border text-muted-foreground"
            }`}>
              이번 시간 {aiRemaining}회 남음
            </span>
          )}
          <button
            onClick={downloadChatAsPDF}
            disabled={messages.length <= 1}
            title="대화 내용 PDF로 저장"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:bg-accent rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">PDF</span>
          </button>
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[11px] text-emerald-700 font-medium">온라인</span>
          </div>
        </div>
      </div>

      {/* ── Mobile quick questions (horizontal scroll) ── */}
      <div className="xl:hidden shrink-0">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {QUICK_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              disabled={loading}
              className="flex-none text-xs bg-ocean-500 hover:bg-ocean-600 text-white rounded-full px-3 py-2 transition-all whitespace-nowrap disabled:opacity-50 shadow-sm"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex flex-col xl:flex-row gap-3 flex-1 min-h-0">

        {/* Chat */}
        <div className="flex-1 flex flex-col bg-card border border-border rounded-2xl overflow-hidden min-h-[420px] lg:min-h-0">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white ${
                  msg.role === "assistant"
                    ? "bg-gradient-to-br from-ocean-500 to-teal-500"
                    : "bg-gradient-to-br from-ocean-400 to-blue-500"
                }`}>
                  {msg.role === "assistant" ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                <div className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-ocean-500 text-white"
                    : "bg-muted border border-border"
                }`}>
                  <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
                  <p className={`text-xs mt-2 text-right ${msg.role === "user" ? "text-ocean-100" : "text-muted-foreground"}`}>{msg.timestamp.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ocean-500 to-teal-500 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-muted border border-border rounded-2xl px-4 py-3">
                  <div className="flex gap-1.5 items-center h-5">
                    <span className="w-2 h-2 bg-ocean-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-ocean-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-ocean-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 sm:p-4 border-t border-border bg-card">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value.slice(0, 500))}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && !loading && sendMessage(input)}
                  placeholder={t.aiAdvisor.inputPlaceholder}
                  maxLength={500}
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500 pr-12"
                  disabled={loading}
                />
                {input.length > 400 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                    {input.length}/500
                  </span>
                )}
              </div>
              <Button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white px-4 shrink-0 gap-2"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">전송</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 px-1">Enter 키로 전송 · AI 답변은 참고용입니다</p>
          </div>
        </div>

        {/* Desktop side panel */}
        <div className="hidden xl:flex w-60 shrink-0 flex-col gap-3">

          {/* Quick questions */}
          <Card className="bg-card border-border flex-1 overflow-hidden flex flex-col">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-ocean-500" />빠른 질문
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 overflow-y-auto">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="w-full text-left text-xs text-foreground/80 hover:text-foreground hover:bg-accent transition-all p-2.5 rounded-lg border border-border flex items-start gap-2 disabled:opacity-50"
                >
                  <ChevronRight className="w-3 h-3 text-ocean-500 shrink-0 mt-0.5" />
                  {q}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Context */}
          <Card className="bg-card border-border shrink-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-500" />{t.aiAdvisor.contextTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                { label: t.aiAdvisor.contextTank, value: `${tanks.length}개`, color: "text-foreground" },
                { label: "활성 알림", value: `${alerts.length}건`, color: alerts.length > 0 ? "text-amber-500" : "text-foreground" },
                { label: "양성 진단", value: `${diagnoses.filter(d => d.result === "양성").length}건`, color: diagnoses.filter(d => d.result === "양성").length > 0 ? "text-red-500" : "text-foreground" },
                { label: "위험 수조", value: `${tanks.filter(t => t.status === "danger").length}개`, color: tanks.filter(t => t.status === "danger").length > 0 ? "text-red-500" : "text-foreground" },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={`font-semibold ${row.color}`}>{row.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
    </>
  )
}
