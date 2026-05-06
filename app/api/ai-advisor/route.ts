import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

const client = new Anthropic()

export async function POST(req: NextRequest) {
  try {
    const { question, context } = await req.json()
    if (!question?.trim()) {
      return NextResponse.json({ error: "질문이 없습니다." }, { status: 400 })
    }

    const systemPrompt = `당신은 흰다리새우(Litopenaeus vannamei) 양식 전문 AI 어드바이저입니다.
사용자의 양식장 데이터를 기반으로 구체적이고 실용적인 조언을 제공합니다.

현재 양식장 상황:
${context || "데이터 없음"}

답변 규칙:
- 한국어로 답변하세요
- 마크다운을 사용해 구조화하세요 (**굵게**, 줄바꿈, 불릿 포인트)
- 수치 기반의 구체적 조치를 제안하세요
- 답변은 500자 이내로 간결하게 유지하세요
- 불필요한 인사말은 생략하세요`

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    })

    const text = response.content[0].type === "text" ? response.content[0].text : ""
    return NextResponse.json({ answer: text })
  } catch (err) {
    console.error("AI advisor error:", err)
    return NextResponse.json({ error: "AI 응답 생성에 실패했습니다." }, { status: 500 })
  }
}
