import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createServerClient } from "@supabase/ssr"
const openaiKey = process.env.OPENAI_API_KEY

const MAX_QUESTION_LENGTH = 500
const MAX_CONTEXT_LENGTH = 2000

// 사용자당 분당 호출 상한. AI 호출은 비용이 들어 무제한이면 한 계정이
// 스크립트로 요금을 태울 수 있다(가입자는 기본 farmer 라 누구나 호출 가능).
const AI_RATE_WINDOW_MS = 60_000
const AI_RATE_MAX = 20
const aiRateMap = new Map<string, { count: number; windowStart: number }>()
function aiRateOk(key: string): boolean {
  const now = Date.now()
  const e = aiRateMap.get(key)
  if (!e || now - e.windowStart > AI_RATE_WINDOW_MS) {
    aiRateMap.set(key, { count: 1, windowStart: now })
    return true
  }
  if (e.count >= AI_RATE_MAX) return false
  e.count++
  return true
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
  }
  if (!aiRateOk(user.id)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 })
  }

  try {
    const body = await req.json()
    const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_LENGTH) : ""
    const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT_LENGTH) : ""

    if (!question) {
      return NextResponse.json({ error: "질문이 없습니다." }, { status: 400 })
    }

    if (openaiKey) {
      const answer = await callGPT(question, context)
      return NextResponse.json({ answer, remaining: null })
    }

    const answer = buildAnswer(question, context)
    return NextResponse.json({ answer, remaining: null })
  } catch {
    return NextResponse.json({ error: "응답 생성에 실패했습니다." }, { status: 500 })
  }
}

async function callGPT(question: string, context: string): Promise<string> {
  const client = new OpenAI({ apiKey: openaiKey })

  const systemPrompt = `당신은 흰다리새우(Litopenaeus vannamei) 양식 전문가 AI 어시스턴트입니다.
수질 관리, 질병 예방, 급이 전략, 환수, 폭기 등 양식장 운영에 대한 전문적이고 실용적인 조언을 제공합니다.
답변은 반드시 한국어로 작성하고, 마크다운 형식을 사용하며, 구체적이고 실행 가능한 내용을 포함해야 합니다.

주요 수질 기준값 (흰다리새우):
- 수온: 23~30°C (최적 26~28°C)
- pH: 7.8~8.5
- DO: 5.0 mg/L 이상 (7.0+ 권장)
- 염도: 15~35‰ (ppt 와 같은 값)
- 암모니아(NH₃): 0.5 mg/L 미만
- 아질산염: 0.1 mg/L 미만
- 질산염: 20 mg/L 미만
- 알칼리도: 100~150 mg/L CaCO₃
- 탁도: 10 NTU 미만`

  const userMessage = context
    ? `[현재 양식장 데이터]\n${context}\n\n[질문]\n${question}`
    : question

  const message = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 800,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  })

  const content = message.choices[0].message.content
  if (content) return content
  return buildAnswer(question, context)
}

function buildAnswer(question: string, context: string): string {
  const ctx = context || ""
  const tankMatch = ctx.match(/운영 수조:\s*(\d+)/)
  const alertMatch = ctx.match(/활성 알림\s*(\d+)건/)
  const tankCount = tankMatch ? parseInt(tankMatch[1]) : 0
  const alertCount = alertMatch ? parseInt(alertMatch[1]) : 0
  const q = question.toLowerCase()

  if (q.includes("수질 이상") || q.includes("요약")) return buildSummaryResponse(ctx, tankCount, alertCount)
  if (q.includes("do") || q.includes("용존산소")) return buildDoResponse()
  if (q.includes("탁도")) return buildTurbidityResponse()
  if (q.includes("ahpnd") || q.includes("진단") || q.includes("양성")) return buildDiagnosisResponse(ctx)
  if (q.includes("급이") || q.includes("먹이")) return buildFeedingResponse(tankCount)
  if (q.includes("리포트") || q.includes("주간")) return buildReportResponse(tankCount, alertCount, ctx)
  if (q.includes("암모니아") || q.includes("nh")) return buildAmmoniaResponse()
  if (q.includes("수온") || q.includes("온도")) return buildTemperatureResponse()
  if (q.includes("ph")) return buildPhResponse()
  if (q.includes("폐사")) return buildMortalityResponse()
  if (q.includes("환수")) return buildWaterChangeResponse()
  if (q.includes("수질 기준") || q.includes("기준표") || q.includes("최적 수질")) return buildWaterQualityStandardResponse()
  return buildGenericResponse(question, tankCount, alertCount, ctx)
}

function buildSummaryResponse(ctx: string, tankCount: number, alertCount: number): string {
  const date = new Date().toLocaleDateString("ko-KR")
  const dangerMatch = ctx.match(/위험\s*(\d+)개/)
  const warningMatch = ctx.match(/주의\s*(\d+)개/)
  const dangerCount = dangerMatch ? parseInt(dangerMatch[1]) : 0
  const warningCount = warningMatch ? parseInt(warningMatch[1]) : 0
  const normalCount = tankCount - dangerCount - warningCount

  let alertLines = ""
  const alertSection = ctx.match(/활성 알림.*?:([\s\S]*?)(?=양성 진단|$)/)
  if (alertSection) {
    alertLines = alertSection[1].trim().split("\n").slice(0, 3).map(l => `• ${l.trim().replace(/^-\s*/, "")}`).join("\n")
  }

  return `**현재 수질 이상 현황 요약** (${date} 기준)

${dangerCount > 0 ? `🔴 **위험 수조 ${dangerCount}개** — 즉시 점검 필요` : ""}
${warningCount > 0 ? `🟡 **주의 수조 ${warningCount}개** — 24시간 내 조치 권장` : ""}
${normalCount > 0 ? `✅ **정상 수조 ${normalCount}개** — 정상 운영 중` : ""}

${alertCount > 0 ? `**활성 알림 ${alertCount}건:**\n${alertLines || "• 수질 이상 알림이 발생해 있습니다."}` : "현재 활성 알림이 없습니다."}

**권장 조치 우선순위**
1. 위험 수조 즉시 환수(20~30%) 및 폭기 증대
2. 주의 수조 급이량 20% 감소 및 집중 모니터링
3. 정상 수조 일상 점검 유지`
}

function buildDoResponse(): string {
  return `**용존산소(DO) 저하 분석 및 대응**

📊 **DO 저하 주요 원인**
1. **수온 상승** — 수온 1°C 상승 시 포화 DO 약 0.2 mg/L 감소
2. **유기물 축적** — 미분해 유기물의 생물학적 산화로 산소 소모
3. **고밀도 사육** — 새우 대사량 증가로 산소 소비 급증
4. **폭기 시스템 효율 저하** — 에어스톤 막힘, 블로워 노화

✅ **즉시 조치 (DO < 5.0 mg/L)**
- 폭기량 20~30% 즉시 증대
- 급이량 20~30% 감소
- 순환 펌프 출력 최대화
- 15~20% 환수 실시

💡 **예방 관리**
- DO 5.0 mg/L 이상 유지 목표
- 야간(02:00~06:00) 집중 모니터링
- 에어스톤 주 1회 상태 점검`
}

function buildTurbidityResponse(): string {
  return `**탁도 이상 대응 지침**

🚨 **탁도 상승 위험**
- 새우 아가미 손상 위험
- DO 감소 촉진
- 병원성 미생물 증식 환경 조성

📋 **단계별 조치**

**즉시 (0~2시간)**
1. 급이량 50% 즉시 감소
2. 스키머·슬러지 배출 밸브 개방
3. 순환 펌프 출력 최대화

**단기 (2~24시간)**
4. 20~30% 환수 실시
5. 여과 시스템 점검 및 역세척
6. 폭기 증가로 부유물 응집 촉진

✅ **목표**: 72시간 내 10 NTU 이하 회복`
}

function buildDiagnosisResponse(ctx: string): string {
  const hasPositive = ctx.includes("양성")
  return `**${hasPositive ? "AHPND 양성 진단" : "질병 진단"} 긴급 대응 SOP**

${hasPositive ? "🔴 **AHPND 양성 확인** — 즉시 비상 프로토콜 가동\n" : ""}
**Phase 1: 즉각 격리 (0~1시간)**
1. 해당 수조 격리 — 공용 수계 차단
2. 작업 도구 소독 (차아염소산나트륨 200ppm)

**Phase 2: 긴급 수질 안정화 (1~6시간)**
3. 폭기량 최대로 증가
4. 급이량 80% 즉시 감소

**Phase 3: 추가 진단 (6~24시간)**
5. 인접 수조 전수 검사
6. PCR 확진 검사 의뢰

⚠️ **누적 폐사율 10% 초과 시** 긴급 출하 또는 폐기 처리 검토`
}

function buildFeedingResponse(tankCount: number): string {
  const date = new Date().toLocaleDateString("ko-KR")
  return `**오늘 급이량 조정 권고** (${date})

| 수조 상태 | 급이 조정 | 사유 |
|----------|----------|------|
| 정상 | 100% 유지 | — |
| 주의 (DO↓ / NH₃↑) | -20% | 수질 부하 감소 |
| 위험 (탁도↑ / 질병) | -50% | 잔사 최소화 |
| AHPND 양성 | -80% | 긴급 대응 |

💡 **급이 핵심 원칙**
- DO 5.0 mg/L 미만: 급이량 20~30% 감소
- 탁도 20 NTU 초과: 급이량 50% 감소`
}

function buildReportResponse(tankCount: number, alertCount: number, ctx: string): string {
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  return `**이번 주 운영 현황 요약 리포트**
기간: ${weekAgo.toLocaleDateString("ko-KR")} ~ ${today.toLocaleDateString("ko-KR")}

📊 **핵심 현황**
- 운영 수조: ${tankCount}개
- 활성 알림: ${alertCount}건

${alertCount > 0 ? `⚠️ **주의 사항**\n수질 이상 알림 해결 필요` : "✅ 이번 주 특이 알림 없이 정상 운영됨"}

✅ **다음 주 액션 플랜**
1. 이상 수조 환수 및 여과 시스템 정비
2. 폭기 시스템 전체 점검`
}

function buildAmmoniaResponse(): string {
  return `**암모니아(NH₃) 상승 분석 및 대응**

⚠️ **암모니아 상승 원인**
1. 유기물(잔사·폐사체) 과다 축적
2. 생물 여과 시스템 효율 저하
3. 급이 과잉으로 미섭이 사료 분해

✅ **즉시 조치 (NH₃ > 0.5 mg/L)**
- 급이량 20% 감소
- 10~15% 환수 실시
- 바실러스균 미생물제 투입

💡 **예방 관리**
- NH₃ 0.3 mg/L 초과 시 선제 조치`
}

function buildTemperatureResponse(): string {
  return `**수온 관리 가이드**

🌡️ **흰다리새우 최적 수온**: 23~30°C

**수온별 관리 기준**
- 23°C 미만: 성장 저하, 급이량 감소, 보온 조치
- 23~28°C: 최적 성장 구간, 정상 운영
- 28~30°C: DO 집중 모니터링, 폭기 강화
- 30°C 초과: 급이량 20% 감소, 환수로 수온 낮추기`
}

function buildPhResponse(): string {
  return `**pH 관리 가이드**

⚗️ **흰다리새우 최적 pH**: 7.8~8.5

**pH별 관리 기준**
- pH < 7.5: 산성화 위험, 석회 투입(소석회 0.5g/L), 환수
- pH 7.5~7.8: 주의 구간, 중탄산나트륨 투입 검토
- pH 7.8~8.5: 정상 범위, 유지 관리
- pH > 8.5: 알칼리화 주의, 환수 및 CO₂ 폭기`
}

function buildMortalityResponse(): string {
  return `**급성 폐사 긴급 대응 SOP**

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

✅ **2단계: 즉각 조치**
1. 해당 수조 격리 (공유 배관 차단)
2. 폭기 최대 가동 + 20~30% 긴급 환수
3. 급이량 50% 이상 감소 또는 중단
4. 폐사체 즉시 제거 (2차 오염 방지)

📞 **3단계: 전문 진단 (24시간 이내)**
- 폐사 새우 5~10마리 냉장 보관 후 검사 기관 의뢰
- 전염성 질병 의심 시 지자체 수산과 신고 (의무)`
}

function buildWaterChangeResponse(): string {
  return `**환수 관리 가이드**

💧 **기본 환수 주기 및 환수량**

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
2. 염도 차 ±2‰ 이내 유지 (급격한 변화 금지)
3. 환수 전 신규 해수 수질 확인 필수
4. 야간(수온 하강 시) 환수 최소화`
}

function buildWaterQualityStandardResponse(): string {
  return `**흰다리새우 최적 수질 기준표**

| 항목 | 최적 범위 | 위험 기준 |
|------|-----------|-----------|
| 수온 | 26~28°C | <22°C 또는 >32°C |
| DO | 7.0 mg/L 이상 | 5.0 mg/L 미만 |
| pH | 7.8~8.5 | <7.5 또는 >8.8 |
| 염도 | 15~35‰ | <10 또는 >40‰ |
| 암모니아 (NH₃) | 0.1 mg/L 미만 | 0.5 mg/L 초과 |
| 아질산염 (NO₂) | 0.1 mg/L 미만 | 0.5 mg/L 초과 |
| 질산염 (NO₃) | 20 mg/L 미만 | 50 mg/L 초과 |
| 알칼리도 | 100~150 mg/L | <80 mg/L |
| 탁도 | 10 NTU 미만 | 20 NTU 초과 |

📋 **측정 권장 주기**
- DO·수온: 하루 2~3회 (새벽 5시, 오전 10시, 오후 5시)
- pH·암모니아·아질산염: 주 2~3회
- 탁도·알칼리도: 주 1~2회`
}

function buildGenericResponse(question: string, tankCount: number, alertCount: number, ctx: string): string {
  return `**"${question}"에 대한 분석**

📊 **현재 운영 현황**
- 운영 중인 수조: ${tankCount}개
- 활성 알림: ${alertCount}건
${ctx.includes("양성") ? "- 양성 진단 수조 있음 → 격리 조치 확인 필요" : ""}

💡 **일반 권고사항**
1. 이상 수조 우선 점검 및 환수(20~30%) 실시
2. 급이량 조정 (이상 수조 -20~50%)
3. 폭기 시스템 점검 및 DO 모니터링 강화

더 구체적인 질문을 입력하시면 상세 분석을 제공해드립니다.`
}
