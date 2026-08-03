import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"

// 기기가 하루 한 번 묻는 경로다. 넉넉히 잡아도 충분하다.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

/** 1.2.3 형태만 통과시킨다. 이 값이 기기가 내려받을 주소의 일부가 되므로
 *  DB 제약과 별개로 여기서도 막는다. */
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/

async function authenticate(req: NextRequest) {
  const apiKey = req.headers.get("X-Device-Key")?.trim()
  if (!apiKey) {
    return { error: NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 }) }
  }
  if (!checkRateLimit(apiKey)) {
    return { error: NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 }) }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 }) }
  }

  const admin = createAdminClient()
  const { data: device } = await admin
    .from("sensor_devices")
    .select("id, active, update_to")
    .eq("api_key", apiKey)
    .maybeSingle()

  if (!device) {
    return { error: NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 }) }
  }
  return { admin, device }
}

// GET /api/sensors/update?version=1.0.0
// 기기가 "내 버전은 이것인데, 승인된 업데이트가 있나" 를 묻는다.
//
// 서버는 **버전 번호만** 알려준다. 내려받을 파일의 해시와 서명은 기기가
// 정적 파일(/updates/manifest.json)에서 직접 읽어 확인한다. 그래서 이 서버가
// 뚫려도 기기에 임의의 코드를 심을 수 없다 — 서명은 오너의 개인키로만 만든다.
export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth.error) return auth.error
  const { admin, device } = auth

  const reported = req.nextUrl.searchParams.get("version")?.trim()
  if (reported && VERSION_RE.test(reported)) {
    const patch: Record<string, unknown> = {
      agent_version: reported,
      agent_version_at: new Date().toISOString(),
    }
    // 목표 버전에 도달했으면 승인을 소비한다. 안 그러면 기기가 매번
    // "이미 그 버전인데 또 받으라네" 하고 되돌아온다.
    if (device.update_to === reported) {
      patch.update_to = null
      patch.update_status = "applied"
      patch.update_status_at = new Date().toISOString()
    }
    await admin.from("sensor_devices").update(patch).eq("id", device.id)
  }

  return NextResponse.json({
    approved: device.update_to === reported ? null : device.update_to,
    active: device.active,
  })
}

// POST /api/sensors/update
// 기기가 업데이트 결과를 되보고한다. { version, status, message }
// 실패했더라도 기기는 이전 버전으로 되돌아가 계속 측정하고 있다.
export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth.error) return auth.error
  const { admin, device } = auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 유효한 JSON이 아닙니다." }, { status: 400 })
  }

  const status = typeof body.status === "string" ? body.status : ""
  if (!["downloading", "applied", "failed", "rolled_back"].includes(status)) {
    return NextResponse.json({ error: "status 값이 올바르지 않습니다." }, { status: 400 })
  }

  const version = typeof body.version === "string" ? body.version.trim() : ""
  const patch: Record<string, unknown> = {
    update_status: status,
    // 기기가 보낸 문자열이 화면에 뜨므로 길이를 자른다.
    update_message: typeof body.message === "string" ? body.message.slice(0, 300) : null,
    update_status_at: new Date().toISOString(),
  }

  if (status === "applied" && VERSION_RE.test(version)) {
    patch.agent_version = version
    patch.agent_version_at = new Date().toISOString()
    patch.update_to = null
  }
  // 실패하거나 되돌렸으면 승인을 거둬들인다. 같은 꾸러미로 계속 재시도하면
  // 장비가 하루에 한 번씩 무한정 재시작한다. 주인이 다시 눌러야 한다.
  if (status === "failed" || status === "rolled_back") {
    patch.update_to = null
  }

  await admin.from("sensor_devices").update(patch).eq("id", device.id)
  return NextResponse.json({ ok: true })
}
