import { NextRequest, NextResponse } from "next/server"

// Local response engine — no external AI API required.
// Returns rule-based answers derived from the context data sent by the client.

export async function POST(req: NextRequest) {
  try {
    const { question, context } = await req.json()
    if (!question?.trim()) {
      return NextResponse.json({ error: "질문이 없습니다." }, { status: 400 })
    }

    const answer = buildAnswer(question as string, context as string)
    return NextResponse.json({ answer })
  } catch {
    return NextResponse.json({ error: "응답 생성에 실패했습니다." }, { status: 500 })
  }
}

function buildAnswer(question: string, context: string): string {
  const ctx = context || ""

  // Parse basic counts from context string
  const tankMatch = ctx.match(/운영 수조:\s*(\d+)/)
  const alertMatch = ctx.match(/활성 알림\s*(\d+)건/)
  const tankCount = tankMatch ? parseInt(tankMatch[1]) : 0
  const alertCount = alertMatch ? parseInt(alertMatch[1]) : 0

  const q = question.toLowerCase()

  if (q.includes("수질 이상") || q.includes("요약")) {
    return buildSummaryResponse(ctx, tankCount, alertCount)
  }
  if (q.includes("do") || q.includes("용존산소")) {
    return buildDoResponse(ctx)
  }
  if (q.includes("탁도")) {
    return buildTurbidityResponse(ctx)
  }
  if (q.includes("ahpnd") || q.includes("진단") || q.includes("양성")) {
    return buildDiagnosisResponse(ctx)
  }
  if (q.includes("급이") || q.includes("먹이")) {
    return buildFeedingResponse(ctx, tankCount)
  }
  if (q.includes("리포트") || q.includes("주간")) {
    return buildReportResponse(ctx, tankCount, alertCount)
  }
  if (q.includes("암모니아") || q.includes("nh")) {
    return buildAmmoniaResponse(ctx)
  }
  if (q.includes("수온") || q.includes("온도")) {
    return buildTemperatureResponse(ctx)
  }
  if (q.includes("ph")) {
    return buildPhResponse(ctx)
  }

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

function buildDoResponse(ctx: string): string {
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

function buildTurbidityResponse(ctx: string): string {
  return `**탁도 이상 대응 지침**

🚨 **탁도 상승 위험**
- 새우 아가미 손상 위험
- DO 감소 촉진
- 병원성 미생물 증식 환경 조성
- 폐사 조기 발견 어려움

📋 **단계별 조치**

**즉시 (0~2시간)**
1. 급이량 50% 즉시 감소
2. 스키머·슬러지 배출 밸브 개방
3. 순환 펌프 출력 최대화

**단기 (2~24시간)**
4. 20~30% 환수 실시 (신선한 해수 투입)
5. 여과 시스템 점검 및 역세척
6. 폭기 증가로 부유물 응집 촉진

**중기 (24~72시간)**
7. 생물 여과조 청소
8. 미생물제(바실러스균) 투입
9. 2시간마다 탁도 재측정

✅ **목표**: 72시간 내 10 NTU 이하 회복`
}

function buildDiagnosisResponse(ctx: string): string {
  const hasPositive = ctx.includes("양성")
  return `**${hasPositive ? "AHPND 양성 진단" : "질병 진단"} 긴급 대응 SOP**

${hasPositive ? "🔴 **AHPND 양성 확인** — 즉시 비상 프로토콜 가동\n" : ""}
**Phase 1: 즉각 격리 (0~1시간)**
1. 해당 수조 격리 — 공용 수계 차단
2. 작업 도구 소독 (차아염소산나트륨 200ppm)
3. 담당자 보호 장비 착용 (장갑, 마스크)
4. 인접 수조 모니터링 강화

**Phase 2: 긴급 수질 안정화 (1~6시간)**
5. 폭기량 최대로 증가
6. 급이량 80% 즉시 감소
7. 비타민C 5g/kg 사료 혼합 투여
8. OTC 투약 검토 (수의사 처방 후)

**Phase 3: 추가 진단 (6~24시간)**
9. 인접 수조 전수 검사
10. PCR 확진 검사 의뢰 (공인 검사기관)
11. 수질 이력 데이터 정밀 분석

⚠️ **누적 폐사율 10% 초과 시** 긴급 출하 또는 폐기 처리 검토
📞 담당 수의사 즉시 연락 및 지자체 수산과 신고`
}

function buildFeedingResponse(ctx: string, tankCount: number): string {
  const date = new Date().toLocaleDateString("ko-KR")
  return `**오늘 급이량 조정 권고** (${date})

📊 **수질 상태별 조정 원칙**

| 수조 상태 | 급이 조정 | 사유 |
|----------|----------|------|
| 정상 | 100% 유지 | — |
| 주의 (DO↓ / NH₃↑) | -20% | 수질 부하 감소 |
| 위험 (탁도↑ / 질병) | -50% | 잔사 최소화 |
| AHPND 양성 | -80% | 긴급 대응 |

💡 **급이 핵심 원칙**
- 수온 1°C 상승 시 급이량 3~5% 감소
- DO 5.0 mg/L 미만: 급이량 20~30% 감소
- 탁도 20 NTU 초과: 급이량 50% 감소
- 섭이반응 저하 확인 시 즉시 급이 중단

⏰ **급이 타이밍**: 새벽 폭기 강화 후, 낮 시간대(DO 최고점) 집중 급이`
}

function buildReportResponse(ctx: string, tankCount: number, alertCount: number): string {
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  return `**이번 주 운영 현황 요약 리포트**
기간: ${weekAgo.toLocaleDateString("ko-KR")} ~ ${today.toLocaleDateString("ko-KR")}

📊 **핵심 현황**
- 운영 수조: ${tankCount}개
- 활성 알림: ${alertCount}건
- 이번 주 주요 이슈: ${alertCount > 0 ? "수질 이상 알림 발생" : "특이사항 없음"}

${alertCount > 0 ? `⚠️ **주의 사항**\n${ctx.match(/활성 알림.*?:([\s\S]*?)(?=양성|$)/)?.[1]?.trim().split("\n").slice(0, 3).map(l => `• ${l.trim().replace(/^-\s*/, "")}`).join("\n") || "• 수질 이상 알림 해결 필요"}` : "✅ 이번 주 특이 알림 없이 정상 운영됨"}

✅ **다음 주 액션 플랜**
1. 이상 수조 환수 및 여과 시스템 정비
2. 폭기 시스템 전체 점검
3. 수질 측정 주기 준수 (1일 2회 이상)`
}

function buildAmmoniaResponse(ctx: string): string {
  return `**암모니아(NH₃) 상승 분석 및 대응**

⚠️ **암모니아 상승 원인**
1. 유기물(잔사·폐사체) 과다 축적
2. 생물 여과 시스템 효율 저하
3. 급이 과잉으로 미섭이 사료 분해
4. 수온 상승 → 분해 속도 가속

✅ **즉시 조치 (NH₃ > 0.5 mg/L)**
- 급이량 20% 감소
- 10~15% 환수 실시
- 바실러스균 미생물제 투입
- 슬러지·잔사 즉시 제거

💡 **예방 관리**
- 급이 후 30분 섭이 확인, 잔사 제거
- 생물 여과조 주 1회 상태 점검
- NH₃ 0.3 mg/L 초과 시 선제 조치`
}

function buildTemperatureResponse(ctx: string): string {
  return `**수온 관리 가이드**

🌡️ **흰다리새우 최적 수온**: 23~30°C

**수온별 관리 기준**
- 23°C 미만: 성장 저하, 급이량 감소, 보온 조치
- 23~28°C: 최적 성장 구간, 정상 운영
- 28~30°C: DO 집중 모니터링, 폭기 강화
- 30°C 초과: 급이량 20% 감소, 환수로 수온 낮추기

💡 **수온 안정화 방법**
- 환수 시 수온 차 ±2°C 이내 유지
- 야간 급격한 수온 변화(>2°C) 주의
- 여름철 차광막 설치 검토`
}

function buildPhResponse(ctx: string): string {
  return `**pH 관리 가이드**

⚗️ **흰다리새우 최적 pH**: 7.8~8.5

**pH별 관리 기준**
- pH < 7.5: 산성화 위험, 석회 투입(소석회 0.5g/L), 환수
- pH 7.5~7.8: 주의 구간, 중탄산나트륨 투입 검토
- pH 7.8~8.5: 정상 범위, 유지 관리
- pH > 8.5: 알칼리화 주의, 환수 및 CO₂ 폭기

💡 **pH 안정화**
- 알칼리도(Alkalinity) 100~150 mg/L CaCO₃ 유지
- 광합성(낮)·호흡(밤)에 의한 일중 변동(±0.3) 정상
- 급격한 변화(>0.5/일) 시 즉시 원인 조사`
}

function buildGenericResponse(question: string, tankCount: number, alertCount: number, ctx: string): string {
  return `**"${question}"에 대한 분석**

📊 **현재 운영 현황 (데이터 기반)**
- 운영 중인 수조: ${tankCount}개
- 활성 알림: ${alertCount}건
${ctx.includes("양성") ? "- 양성 진단 수조 있음 → 격리 조치 확인 필요" : ""}

💡 **일반 권고사항**
1. 이상 수조 우선 점검 및 환수(20~30%) 실시
2. 급이량 조정 (이상 수조 -20~50%)
3. 폭기 시스템 점검 및 DO 모니터링 강화
4. 24시간 이내 재측정 및 추이 관찰

더 구체적인 질문(예: 특정 수조, 특정 수질 항목)을 입력하시면 상세 분석을 제공해드립니다.`
}
