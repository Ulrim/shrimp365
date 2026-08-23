import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { isPushConfigured } from "@/lib/push-server"

// POST /api/push/subscribe
// 브라우저가 pushManager.subscribe() 로 받아 온 구독을 저장한다.
// body 는 PushSubscription.toJSON() 그대로 — { endpoint, keys: { p256dh, auth } }.
//
// 인증은 쿠키 세션으로만 한다. 클라이언트가 보낸 user_id 는 받지도 않는다.
// 저장은 save_push_subscription(security definer) 을 통해서만 한다 —
// 같은 기기를 두 사람이 번갈아 쓸 때 소유자를 넘겨받아야 하기 때문이다.
// (이유는 supabase/migrations/push_subscriptions.sql 주석 참고)

/** 푸시 서비스 주소. https 만 허용한다 — endpoint 는 서버가 직접 요청을 보내는
 *  주소라, 스킴을 안 막으면 내부망 http 주소로 요청을 유도당할 수 있다. */
const MAX_ENDPOINT = 1000
/** 키는 base64url 이라 길이가 정해져 있다. 넉넉히 잡되 상한은 둔다. */
const MAX_KEY = 300
const MAX_UA = 300

function isPushEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_ENDPOINT) return false
  try {
    return new URL(v).protocol === "https:"
  } catch {
    return false
  }
}

function key(v: unknown): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  // base64url 문자만. 여기 이상한 값이 들어오면 발송 때마다 암호화가 터진다.
  if (!trimmed || trimmed.length > MAX_KEY || !/^[A-Za-z0-9_-]+=*$/.test(trimmed)) return null
  return trimmed
}

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

  // 서버가 실제로 보낼 수 있을 때만 구독을 받는다.
  //
  // 클라이언트는 공개키 하나만 보고 구독을 시도하는데, 서버 발송에는 개인키와
  // subject 까지 필요하다. 공개키만 넣고 재배포한 상태에서 구독을 받아 주면
  // 화면은 "앱을 닫아도 받습니다"라고 하는데 서버는 한 건도 못 보내고,
  // 인탭 알림까지 꺼져서 알림이 전멸한다. 거절하면 클라이언트가 인탭으로 폴백한다.
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "서버에 푸시 설정(VAPID)이 완료되지 않았습니다." },
      { status: 503 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 유효한 JSON이 아닙니다." }, { status: 400 })
  }

  const endpoint = body.endpoint
  if (!isPushEndpoint(endpoint)) {
    return NextResponse.json({ error: "구독 주소가 올바르지 않습니다." }, { status: 400 })
  }

  const keys = (body.keys ?? {}) as Record<string, unknown>
  const p256dh = key(keys.p256dh)
  const auth = key(keys.auth)
  if (!p256dh || !auth) {
    return NextResponse.json({ error: "구독 키가 올바르지 않습니다." }, { status: 400 })
  }

  // 어느 기기인지 알아볼 단서. 사용자가 보낸 값이 아니라 브라우저가 붙인 헤더를 쓴다.
  const userAgent = req.headers.get("user-agent")?.slice(0, MAX_UA) ?? null

  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: userAgent,
  })

  if (error) {
    // 마이그레이션 전이면 함수가 없어 여기로 온다. 화면은 인탭 알림으로
    // 폴백하므로 사용자 경험은 지금까지와 같다 — 로그만 남긴다.
    console.error("[push/subscribe] 저장 실패:", error.message)
    return NextResponse.json({ error: "구독을 저장하지 못했습니다." }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
