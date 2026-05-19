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
import { BrainCircuit, Send, AlertTriangle, Lightbulb, TrendingUp, Activity, Sparkles, User, Bot, ChevronRight } from "lucide-react"
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
    return text
      .split("\n")
      .map((line, i) => {
        if (line.startsWith("**") && line.endsWith("**")) {
          return <p key={i} className="font-bold text-foreground mt-2 mb-1">{line.replace(/\*\*/g, "")}</p>
        }
        if (line.includes("**")) {
          const parts = line.split(/\*\*(.*?)\*\*/g)
          return <p key={i} className="text-foreground/80 leading-relaxed">{parts.map((p, j) => j % 2 === 1 ? <strong key={j} className="text-foreground">{p}</strong> : p)}</p>
        }
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return <p key={i} className="text-foreground/80 leading-relaxed pl-2">{line}</p>
        }
        if (line.startsWith("#")) {
          return <p key={i} className="font-semibold text-ocean-500 mt-3">{line.replace(/^#+\s/, "")}</p>
        }
        if (line.includes("|") && line.includes("-")) return null
        if (line.includes("|")) {
          return <p key={i} className="text-xs text-foreground/80 font-mono">{line}</p>
        }
        if (!line) return <br key={i} />
        return <p key={i} className="text-foreground/80 leading-relaxed">{line}</p>
      })
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
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 bg-gradient-to-br from-ocean-500 to-teal-500 rounded-xl flex items-center justify-center">
          <BrainCircuit className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">{t.aiAdvisor.title}</h2>
          <p className="text-sm text-muted-foreground">{t.aiAdvisor.subtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {aiRemaining !== null && (
            <span className={`text-xs px-2 py-1 rounded-lg border ${
              aiRemaining <= 2
                ? "bg-red-500/10 border-red-500/30 text-red-500"
                : aiRemaining <= 5
                ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                : "bg-muted border-border text-muted-foreground"
            }`}>
              {t.aiAdvisor.remaining} {aiRemaining}{t.aiAdvisor.remainingUnit}
            </span>
          )}
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs text-emerald-500">{t.aiAdvisor.online}</span>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chat area */}
        <div className="flex-1 flex flex-col bg-card border border-border rounded-2xl overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "assistant"
                    ? "bg-gradient-to-br from-ocean-500 to-teal-500"
                    : "bg-muted"
                }`}>
                  {msg.role === "assistant" ? <Bot className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-white" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-ocean-500/20 border border-ocean-500/30 text-foreground"
                    : "bg-muted border border-border"
                }`}>
                  <div className="text-sm space-y-0.5">{renderMarkdown(msg.content)}</div>
                  <p className="text-xs text-muted-foreground mt-2">{msg.timestamp.toLocaleTimeString("ko-KR")}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ocean-500 to-teal-500 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-muted border border-border rounded-2xl px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    <span className="w-2 h-2 bg-ocean-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-ocean-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-ocean-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 500))}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
                placeholder={t.aiAdvisor.inputPlaceholder}
                maxLength={500}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500"
                disabled={loading}
              />
              <Button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Quick questions panel */}
        <div className="w-64 shrink-0 space-y-3 hidden xl:block">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-ocean-500" />{t.aiAdvisor.suggestQ1.split(" ")[0]}…
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="w-full text-left text-xs text-foreground/80 hover:text-foreground hover:bg-accent transition-all p-2.5 rounded-lg border border-border hover:border-border/60 flex items-start gap-2"
                >
                  <ChevronRight className="w-3 h-3 text-ocean-500 shrink-0 mt-0.5" />
                  {q}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-500" />{t.aiAdvisor.contextTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{t.aiAdvisor.contextTank}</span><span className="text-foreground font-medium">{tanks.length}개</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t.aiAdvisor.contextAlert}</span><span className="text-amber-500 font-medium">{alerts.length}건</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t.aiAdvisor.contextDiagnosis}</span><span className="text-red-500 font-medium">{diagnoses.filter(d => d.result === "양성").length}건</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>위험 수조</span><span className="text-red-500 font-medium">{tanks.filter(t => t.status === "danger").length}개</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </>
  )
}
