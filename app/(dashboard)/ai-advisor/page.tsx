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

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

const QUICK_QUESTIONS = [
  "현재 수질 이상 상태를 요약해주세요",
  "B-2조 DO 저하 원인은 무엇인가요?",
  "C-2조 탁도가 높은데 어떻게 조치해야 하나요?",
  "AHPND 양성 진단 시 긴급 조치 절차는?",
  "오늘 급이량을 어떻게 조정해야 하나요?",
  "이번 주 리포트를 요약해주세요",
]

const AI_RESPONSES: Record<string, string> = {
  "현재 수질 이상 상태를 요약해주세요": `**현재 수질 이상 현황 요약** (${new Date().toLocaleDateString("ko-KR")} 기준)

🔴 **긴급 (즉시 조치)**
• **C-2조**: 탁도 32.5 NTU (임계치 20 NTU 초과)
  → 원인: 유기물 축적 및 여과 시스템 부하 과다
  → 권장 조치: 즉시 20-30% 환수, 여과 시스템 점검, 생물 여과조 청소

🟡 **주의 (24시간 내 조치)**
• **B-2조**: DO 4.2 mg/L (기준 5.0 mg/L 미달)
  → 원인: 고밀도 사육 + 유기물 분해에 의한 산소 소모
  → 권장 조치: 폭기량 즉시 증대, 급이량 20% 감소, 정기 환수 실시
• **B-1조**: 암모니아 0.62 mg/L (기준 0.5 mg/L 초과)
  → 원인: 유기물 분해 과다, 생물 여과 불충분
  → 권장 조치: 바실러스균 투입, 환수 10% 실시, 급이량 조절

✅ **정상 운영 중**: A-1조, A-2조, C-1조, D-1조, D-2조 (5개 수조)`,

  "B-2조 DO 저하 원인은 무엇인가요?": `**B-2조 용존산소(DO) 저하 분석**

📊 **현재 상태**
• DO: 4.2 mg/L (정상 범위: 5.0~9.0 mg/L)
• 수온: 29.8°C (높은 수온 → 산소 용해도 감소)
• 재식 밀도: 110마리/㎥
• 사육 60일차

🔍 **추정 원인 (우선순위)**

1️⃣ **유기물 누적에 의한 산소 소모** (가능성 높음)
   - 60일차로 유기물 축적 상당
   - 생물학적 산화 과정에서 DO 소모 증가

2️⃣ **폭기 시스템 효율 저하** (점검 필요)
   - 에어스톤 막힘 또는 노화 가능성
   - 블로워 출력 점검 필요

3️⃣ **수온 상승** (계절 요인)
   - 수온 29.8°C → 최대 산소 용해량 감소
   - 새우 대사율 증가로 산소 소비 증가

✅ **즉시 권장 조치**
1. 폭기량 20-30% 증가
2. 급이량 현재의 80%로 감소
3. 15-20% 환수 실시
4. 에어스톤 상태 점검 및 청소`,

  "C-2조 탁도가 높은데 어떻게 조치해야 하나요?": `**C-2조 탁도 이상 대응 지침**

⚠️ **현재 상태**: 탁도 32.5 NTU (위험 수준, 기준치 10 NTU의 3배 이상)

🚨 **위험 이유**
- 높은 탁도는 비전 관찰 불가능 → 폐사 조기 발견 어려움
- 용존산소 감소 촉진
- 새우 아가미 손상 위험
- 병원성 미생물 증식 환경 조성

📋 **단계별 조치 절차**

**즉시 (0~2시간)**
1. 급이량 50% 즉시 감소 (잔사 제거)
2. 스키머/슬러지 배출 밸브 개방
3. 순환 펌프 출력 최대화

**단기 (2~24시간)**
4. 30% 환수 실시 (신선한 해수 투입)
5. 여과 시스템 점검 및 역세척
6. 폭기 증가로 부유물 응집 촉진

**중기 (24~72시간)**
7. 생물 여과조 청소
8. 미생물제(바실러스균) 투입으로 유기물 분해 촉진
9. 탁도 측정 2시간마다 모니터링

✅ **목표**: 72시간 내 10 NTU 이하로 회복`,

  "AHPND 양성 진단 시 긴급 조치 절차는?": `**AHPND(급성간췌장괴사병) 양성 진단 긴급 대응 SOP**

🔴 **B-2조 AHPND 양성 확인** - 즉시 비상 프로토콜 가동

**Phase 1: 즉각 격리 (0~1시간)**
1. ✅ 해당 수조(B-2조) 격리 - 공용 수계 차단
2. ✅ 작업 도구 소독 (차아염소산나트륨 200ppm)
3. ✅ 담당자 보호 장비(장갑, 마스크) 착용
4. ✅ 인접 수조(B-1조) 모니터링 강화

**Phase 2: 긴급 수질 안정화 (1~6시간)**
5. 폭기량 최대로 증가
6. 급이량 80% 즉시 감소
7. OTC(옥시테트라사이클린) 투약 검토 (수의사 처방 후)
8. 비타민C 5g/kg 사료 혼합 투여

**Phase 3: 추가 진단 (6~24시간)**
9. 인접 수조 전수 검사
10. PCR 확진 검사 의뢰 (공인 검사기관)
11. 수질 이력 데이터 정밀 분석

⚠️ **폐사 기준**: 누적 폐사율 10% 초과 시 긴급 출하 또는 폐사 처리 검토

📞 **연락처 목록**
- 담당 수의사 즉시 연락
- 지자체 수산과 신고 (의무 사항)`,

  "오늘 급이량을 어떻게 조정해야 하나요?": `**오늘 급이량 조정 권고** (${new Date().toLocaleDateString("ko-KR")})

📊 **수조별 급이량 조정 권고**

| 수조 | 현재 상태 | 기준 급이량 | 조정 급이량 | 조정 사유 |
|------|----------|------------|------------|----------|
| A-1조 | 정상 | 15.5kg | **15.5kg** | 유지 |
| A-2조 | 정상 | 14.8kg | **14.8kg** | 유지 |
| B-1조 | 주의 | 16.0kg | **12.8kg (-20%)** | NH₃ 상승 |
| B-2조 | 경고 | 14.5kg | **9.7kg (-33%)** | DO 저하 + AHPND |
| C-1조 | 정상 | 13.0kg | **13.0kg** | 유지 |
| C-2조 | 위험 | 12.5kg | **6.3kg (-50%)** | 탁도 위험 |
| D-1조 | 정상 | 17.0kg | **17.0kg** | 유지 |
| D-2조 | 정상 | 16.2kg | **16.2kg** | 유지 |

💡 **급이 원칙**
- 수온 1°C 상승 시 급이량 3-5% 감소
- DO 5.0 mg/L 미만: 급이량 20-30% 감소
- 탁도 20 NTU 초과: 급이량 50% 감소
- 섭이반응 저하 확인 시 즉시 급이 중단`,

  "이번 주 리포트를 요약해주세요": `**이번 주 운영 현황 요약 리포트**
*기간: ${new Date(Date.now() - 7 * 86400000).toLocaleDateString("ko-KR")} ~ ${new Date().toLocaleDateString("ko-KR")}*

📈 **핵심 성과 지표 (KPI)**

| 지표 | 이번 주 | 지난 주 | 변화 |
|------|--------|--------|------|
| 평균 수온 | 28.5°C | 28.1°C | +0.4°C |
| 평균 DO | 6.2 mg/L | 6.5 mg/L | ▼ -0.3 |
| 총 폐사량 | 1,250마리 | 980마리 | ▲ +27.6% |
| 알림 발생 | 7건 | 3건 | ▲ +133% |
| 진단 건수 | 2건 | 1건 | ▲ +1건 |

⚠️ **이번 주 주요 이슈**

1. **B-2조 AHPND 양성** (위험도: 높음)
   - 즉각 대응 조치 진행 중
   - 인접 수조 격리 모니터링 필요

2. **C-2조 탁도 급등** (32.5 NTU)
   - 여과 시스템 점검 권장
   - 환수 및 슬러지 제거 조치 완료

3. **전체적 DO 하향 추세**
   - 수온 상승에 따른 계절적 요인
   - 폭기 시스템 용량 증대 검토 필요

✅ **다음 주 액션 플랜**
1. AHPND 확진 PCR 검사 결과 대기
2. 여과 시스템 전체 정비
3. 폭기 시스템 점검 및 에어스톤 교체`,
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
  const [tanks, setTanks] = useState<Tank[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadData() {
      const mock = isTestAccount(user?.email)
      try {
        const [t, a, d] = await Promise.all([getAllTanks(), getAlerts(true), getDiagnoses()])
        const finalTanks = t.length ? t : (mock ? MOCK_TANKS : [])
        const finalAlerts = a.length ? a : (mock ? MOCK_ALERTS.filter(x => !x.resolved) : [])
        const finalDiagnoses = d.length ? d : (mock ? MOCK_DIAGNOSES : [])
        setTanks(finalTanks)
        setAlerts(finalAlerts)
        setDiagnoses(finalDiagnoses)
        setMessages([{
          id: "welcome",
          role: "assistant",
          content: `안녕하세요! 저는 Shrimp365 AI 어드바이저입니다.\n\n현재 **${finalTanks.length}개 수조** 운영 현황을 실시간으로 분석하고 있습니다.\n\n${finalAlerts.length > 0 ? `**활성 알림 ${finalAlerts.length}건**이 감지되었습니다.` : "현재 활성 알림이 없습니다."} 아래 빠른 질문 버튼을 눌러 시작하거나, 직접 질문을 입력하세요.`,
          timestamp: new Date(),
        }])
      } catch {
        setMessages([{
          id: "welcome",
          role: "assistant",
          content: "안녕하세요! 저는 Shrimp365 AI 어드바이저입니다. 질문을 입력하세요.",
          timestamp: new Date(),
        }])
      } finally {
        setDataLoaded(true)
      }
    }
    loadData()
  }, [user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const buildContext = () => {
    const lines: string[] = []
    lines.push(`운영 수조: ${tanks.length}개`)
    if (tanks.length > 0) {
      const statusSummary = tanks.reduce<Record<string, number>>((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1
        return acc
      }, {})
      lines.push(`수조 상태: 정상 ${statusSummary.active ?? 0}개, 주의 ${statusSummary.warning ?? 0}개, 위험 ${statusSummary.danger ?? 0}개`)
    }
    if (alerts.length > 0) {
      lines.push(`활성 알림 ${alerts.length}건:`)
      alerts.slice(0, 3).forEach(a => lines.push(`  - [${a.type}] ${a.tank_name}: ${a.message}`))
    }
    if (diagnoses.length > 0) {
      const positive = diagnoses.filter(d => d.result === "양성")
      if (positive.length > 0) {
        lines.push(`양성 진단 ${positive.length}건:`)
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
      const json = await res.json()
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
          return <p key={i} className="font-bold text-white mt-2 mb-1">{line.replace(/\*\*/g, "")}</p>
        }
        if (line.includes("**")) {
          const parts = line.split(/\*\*(.*?)\*\*/g)
          return <p key={i} className="text-slate-200 leading-relaxed">{parts.map((p, j) => j % 2 === 1 ? <strong key={j} className="text-white">{p}</strong> : p)}</p>
        }
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return <p key={i} className="text-slate-200 leading-relaxed pl-2">{line}</p>
        }
        if (line.startsWith("#")) {
          return <p key={i} className="font-semibold text-ocean-300 mt-3">{line.replace(/^#+\s/, "")}</p>
        }
        if (line.includes("|") && line.includes("-")) return null
        if (line.includes("|")) {
          return <p key={i} className="text-xs text-slate-300 font-mono">{line}</p>
        }
        if (!line) return <br key={i} />
        return <p key={i} className="text-slate-200 leading-relaxed">{line}</p>
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
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 bg-gradient-to-br from-ocean-500 to-teal-500 rounded-xl flex items-center justify-center">
          <BrainCircuit className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">AI 어드바이저</h2>
          <p className="text-sm text-slate-400">수질·생육·진단 데이터 기반 운영 권고</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-xs text-emerald-400">온라인</span>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Chat area */}
        <div className="flex-1 flex flex-col bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "assistant"
                    ? "bg-gradient-to-br from-ocean-500 to-teal-500"
                    : "bg-slate-600"
                }`}>
                  {msg.role === "assistant" ? <Bot className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-white" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-ocean-500/20 border border-ocean-500/30 text-white"
                    : "bg-slate-700/70 border border-white/5"
                }`}>
                  <div className="text-sm space-y-0.5">{renderMarkdown(msg.content)}</div>
                  <p className="text-xs text-slate-500 mt-2">{msg.timestamp.toLocaleTimeString("ko-KR")}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ocean-500 to-teal-500 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-700/70 border border-white/5 rounded-2xl px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
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
          <div className="p-4 border-t border-white/5">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 500))}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
                placeholder="질문을 입력하세요... (최대 500자)"
                maxLength={500}
                className="bg-slate-700/50 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-400"
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
          <Card className="bg-slate-800/50 border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-ocean-400" />빠른 질문
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="w-full text-left text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all p-2.5 rounded-lg border border-white/5 hover:border-white/10 flex items-start gap-2"
                >
                  <ChevronRight className="w-3 h-3 text-ocean-400 shrink-0 mt-0.5" />
                  {q}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" />현황 요약
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>운영 수조</span><span className="text-white font-medium">{tanks.length}개</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>활성 알림</span><span className="text-amber-400 font-medium">{alerts.length}건</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>양성 진단</span><span className="text-red-400 font-medium">{diagnoses.filter(d => d.result === "양성").length}건</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>위험 수조</span><span className="text-red-400 font-medium">{tanks.filter(t => t.status === "danger").length}개</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
