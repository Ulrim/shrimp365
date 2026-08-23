import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"
import { SUPER_ADMIN_EMAIL } from "@/lib/control-auth"

// AI 어드바이저가 왜 규칙 기반 답변으로 떨어지는지 확정하는 진단 창구 (오너 전용).
//
// 배경: /api/ai-advisor 는 어떤 실패에도 500 을 내지 않고 내장 답변으로 폴백한다.
// 사용자 입장에서는 안전하지만, 그 대신 "왜 AI 가 안 붙었는지"가 화면에 안 남는다.
// 여기서는 설정된 백엔드를 **실제로 한 번 호출해** 제공자가 돌려준 오류를 그대로 보여 준다.
//
// 사용법: 오너 계정으로 로그인한 브라우저에서 /api/admin/ai-diag 를 연다.
//
// 키는 절대 돌려주지 않는다 — 설정 여부와 앞 4글자만 보여 주고, 제공자 오류 문구에
// 키가 섞여 오면 지운다.
export const maxDuration = 30

/** 키가 오류 문구에 섞여 나오는 경우를 대비해 지운다. */
function scrub(text: string, ...secrets: (string | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("***")
  }
  return out
}

/** 키 자체가 아니라 "무엇을 넣었는지" 만 알 수 있게. */
function hint(key: string | undefined): string {
  if (!key) return "미설정"
  return `설정됨 (${key.slice(0, 4)}…, ${key.length}자)`
}

function hostOf(url: string | undefined): string {
  if (!url) return "미설정"
  try { return new URL(url).host } catch { return `주소 형식 오류: ${url}` }
}

interface Probe {
  이름: string
  주소: string
  모델: string
  키: string
  결과: string
  걸린시간?: string
  /** 호출이 실패했을 때, 이 계정에서 실제로 쓸 수 있는 모델 목록. */
  이_계정에서_쓸_수_있는_모델?: string[] | string
  추천?: string
}

/** 한국어를 쓸 만한 대화형 모델을 목록에서 골라 앞에 세운다.
 *  음성(whisper)·안전필터(guard)·임베딩처럼 채팅에 못 쓰는 것은 뺀다. */
function rankModels(ids: string[]): string[] {
  const usable = ids.filter(id => !/whisper|tts|guard|embed|moderation|vision-only/i.test(id))
  const score = (id: string) => {
    const s = id.toLowerCase()
    let n = 0
    if (s.includes("kimi")) n += 50          // 한국어 평이 좋은 오픈웨이트
    if (s.includes("qwen")) n += 45
    if (s.includes("llama-3.3") || s.includes("llama3.3")) n += 40
    if (s.includes("gpt-oss")) n += 35
    if (s.includes("llama-4") || s.includes("maverick") || s.includes("scout")) n += 30
    if (s.includes("70b") || s.includes("120b")) n += 10
    if (s.includes("instruct") || s.includes("versatile")) n += 5
    if (s.includes("8b") || s.includes("1b") || s.includes("instant")) n -= 10
    if (s.includes("preview") || s.includes("deprecated")) n -= 15
    return n
  }
  return [...usable].sort((a, b) => score(b) - score(a) || a.localeCompare(b))
}

/** 백엔드를 실제로 한 번 호출해 본다. 토큰 1개만 요청해 비용·한도를 아낀다. */
async function probe(
  name: string,
  baseURL: string | undefined,
  model: string,
  apiKey: string | undefined,
): Promise<Probe> {
  const row: Probe = {
    이름: name,
    주소: baseURL ? hostOf(baseURL) : "OpenAI 기본",
    모델: model,
    키: hint(apiKey),
    결과: "",
  }
  if (!apiKey && !baseURL) { row.결과 = "미설정 — 건너뜀"; return row }

  const started = Date.now()
  try {
    const client = new OpenAI({
      ...(baseURL ? { baseURL } : {}),
      apiKey: apiKey || "missing",
      timeout: 15_000,
      maxRetries: 0,
    })
    const res = await client.chat.completions.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    })
    row.결과 = res.choices?.[0] ? "✅ 정상 — 이 백엔드로 답변이 나갑니다" : "⚠ 응답은 왔으나 내용이 비었습니다"
  } catch (e) {
    const err = e as { status?: number; message?: string; code?: string }
    const status = err.status ? `HTTP ${err.status}` : (err.code ?? "오류")
    row.결과 = `❌ ${status} — ${scrub(err.message ?? "알 수 없는 오류", apiKey)}`

    // 모델명이 틀렸을 때(404) 추측으로 고치게 두지 않는다 —
    // 이 계정에서 실제로 쓸 수 있는 목록을 그대로 뽑아 준다.
    try {
      const client = new OpenAI({
        ...(baseURL ? { baseURL } : {}),
        apiKey: apiKey || "missing",
        timeout: 10_000,
        maxRetries: 0,
      })
      const list = await client.models.list()
      const ids = (list.data ?? []).map(m => m.id).filter(Boolean)
      const ranked = rankModels(ids)
      row.이_계정에서_쓸_수_있는_모델 = ranked.length ? ranked : ids
      if (ranked[0]) row.추천 = `AI_MODEL 에 "${ranked[0]}" 를 넣고 재배포해 보세요.`
    } catch (le) {
      const lerr = le as { status?: number; message?: string }
      row.이_계정에서_쓸_수_있는_모델 = `목록 조회 실패 — ${scrub(lerr.message ?? "알 수 없는 오류", apiKey)}`
    }
  }
  row.걸린시간 = `${Date.now() - started}ms`
  return row
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }
  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single()
  const isOwner = (user.email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase()
  if (profile?.role !== "admin" && !isOwner) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 })
  }

  // /api/ai-advisor 와 **같은 이름**의 환경변수를 같은 순서로 읽는다.
  const aiBaseUrl = process.env.AI_BASE_URL
  const aiModel = process.env.AI_MODEL
  const aiApiKey = process.env.AI_API_KEY
  const fbBaseUrl = process.env.AI_FALLBACK_BASE_URL
  const fbModel = process.env.AI_FALLBACK_MODEL
  const fbApiKey = process.env.AI_FALLBACK_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  const DEFAULT_MODEL = "qwen3:4b-instruct-2507-q4_K_M"

  const 검사: Probe[] = []
  if (aiBaseUrl) 검사.push(await probe("1차 (AI_BASE_URL)", aiBaseUrl, aiModel || DEFAULT_MODEL, aiApiKey || "ollama"))
  if (fbBaseUrl) 검사.push(await probe("2차 (AI_FALLBACK_BASE_URL)", fbBaseUrl, fbModel || DEFAULT_MODEL, fbApiKey || "ollama"))
  if (openaiKey) 검사.push(await probe("3차 (OPENAI_API_KEY)", undefined, "gpt-4o-mini", openaiKey))

  // 사람이 바로 손댈 수 있는 형태로 진단을 붙인다.
  const 진단: string[] = []
  if (!aiBaseUrl && !openaiKey) {
    진단.push("AI_BASE_URL 이 비어 있습니다 — 이래서 내장 규칙 답변만 나갑니다. Vercel 환경변수에 넣고 재배포하세요.")
  }
  if (aiBaseUrl && !aiModel) {
    진단.push(`AI_MODEL 이 비어 있어 기본값 "${DEFAULT_MODEL}"(자체 설치용)로 호출됩니다. Groq 를 쓴다면 이 모델은 없으므로 실패합니다 — AI_MODEL 을 반드시 넣으세요.`)
  }
  if (aiBaseUrl && !/\/v\d+\/?$/.test(aiBaseUrl.trim())) {
    진단.push(`AI_BASE_URL 이 "/v1" 로 끝나지 않습니다(현재: ${hostOf(aiBaseUrl)}…). Groq 는 https://api.groq.com/openai/v1 이어야 합니다.`)
  }
  for (const r of 검사) {
    if (r.추천) 진단.push(`${r.이름}: 모델명이 맞지 않습니다. ${r.추천}`)
  }
  if (검사.some(r => r.결과.startsWith("✅"))) {
    진단.push("정상 응답한 백엔드가 있습니다. 그래도 화면에 규칙 답변이 나온다면 환경변수를 넣은 뒤 재배포하지 않았을 가능성이 큽니다(빌드 시점 환경이 굳습니다).")
  }
  if (검사.length === 0) 진단.push("호출해 볼 백엔드가 하나도 설정돼 있지 않습니다.")

  return NextResponse.json({
    설명: "AI 어드바이저 백엔드 진단입니다. 이 결과를 그대로 복사해 전달해 주세요. (키 값은 표시되지 않습니다)",
    환경변수: {
      AI_BASE_URL: aiBaseUrl ? hostOf(aiBaseUrl) : "미설정",
      AI_MODEL: aiModel ?? `미설정 → 기본값 "${DEFAULT_MODEL}" 사용`,
      AI_API_KEY: hint(aiApiKey),
      AI_FALLBACK_BASE_URL: fbBaseUrl ? hostOf(fbBaseUrl) : "미설정",
      AI_FALLBACK_MODEL: fbModel ?? "미설정",
      AI_FALLBACK_API_KEY: hint(fbApiKey),
      OPENAI_API_KEY: hint(openaiKey),
    },
    실제호출검사: 검사,
    진단,
  })
}
