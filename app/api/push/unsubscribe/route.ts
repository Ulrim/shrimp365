import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

// POST /api/push/unsubscribe
// 이 기기의 구독을 지운다. body 는 { endpoint } 또는 PushSubscription.toJSON().
//
// 삭제는 사용자 세션(RLS)으로 한다. 남의 구독 주소를 알아내 지우려 해도
// 정책이 막고, 그 경우 응답은 성공이지만 아무 줄도 지워지지 않는다.
// 반대로 정말 남의 계정에 남은 낡은 구독은 발송 때 410 을 받아 서버가 지운다.

const MAX_ENDPOINT = 1000

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 유효한 JSON이 아닙니다." }, { status: 400 })
  }

  const endpoint = body.endpoint
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > MAX_ENDPOINT) {
    return NextResponse.json({ error: "구독 주소가 올바르지 않습니다." }, { status: 400 })
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id)

  if (error) {
    console.error("[push/unsubscribe] 삭제 실패:", error.message)
    return NextResponse.json({ error: "구독을 해제하지 못했습니다." }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
