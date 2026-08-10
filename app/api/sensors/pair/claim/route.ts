import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"

// 로그인한 계정 주인이 코드를 입력해 기기를 자기 수조에 붙이는 경로.
// 이 승인이 있어야만 장비가 기기 키를 받을 수 있다.

// 코드는 6자리(100만 가지)라 무차별 대입을 반드시 막아야 한다.
// 사용자당 제한만으로는 계정 여러 개로 병렬 추측이 가능하므로,
// 전역(프로세스 전체) 제한을 한 겹 더 둔다.
const CLAIM_WINDOW_MS = 10 * 60_000
const CLAIM_MAX_ATTEMPTS = 10   // 사용자당 10분에 10회
const CLAIM_GLOBAL_MAX = 60     // 전체 합산 10분에 60회 — 정상 사용엔 넉넉, 병렬 대입엔 벽
const attempts = new Map<string, { count: number; windowStart: number }>()
let globalWindow = { count: 0, windowStart: 0 }

function tooManyAttempts(userId: string): boolean {
  const now = Date.now()
  if (now - globalWindow.windowStart > CLAIM_WINDOW_MS) {
    globalWindow = { count: 0, windowStart: now }
  }
  globalWindow.count++
  if (globalWindow.count > CLAIM_GLOBAL_MAX) return true

  const entry = attempts.get(userId)
  if (!entry || now - entry.windowStart > CLAIM_WINDOW_MS) {
    attempts.set(userId, { count: 1, windowStart: now })
    return false
  }
  if (entry.count >= CLAIM_MAX_ATTEMPTS) return true
  entry.count++
  return false
}

export async function POST(req: NextRequest) {
  // 1. 로그인 확인
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 })

  if (tooManyAttempts(user.id)) {
    return NextResponse.json(
      { error: "시도가 너무 많습니다. 10분 후 다시 시도하세요." },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "").slice(0, 6) : ""
  const tankId = typeof body.tank_id === "string" ? body.tank_id : ""
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : ""

  if (code.length !== 6) return NextResponse.json({ error: "6자리 코드를 입력하세요." }, { status: 400 })
  if (!tankId) return NextResponse.json({ error: "수조를 선택하세요." }, { status: 400 })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }
  const admin = createAdminClient()

  // 2. 이 수조가 정말 내 것인지 확인한다.
  //    service-role 은 RLS 를 우회하므로 소유권을 직접 확인해야 한다.
  const { data: tank } = await admin
    .from("tanks")
    .select("id, name, farms!tanks_farm_id_fkey(user_id)")
    .eq("id", tankId)
    .maybeSingle()

  const farm = tank?.farms as unknown as { user_id?: string } | { user_id?: string }[] | null
  const ownerId = Array.isArray(farm) ? farm[0]?.user_id : farm?.user_id
  if (!tank || ownerId !== user.id) {
    return NextResponse.json({ error: "수조를 찾을 수 없습니다." }, { status: 404 })
  }

  // 3. 아직 승인되지 않은 코드를 찾는다.
  const { data: pairing } = await admin
    .from("sensor_pairings")
    .select("id, serial, firmware, expires_at, claimed_at")
    .eq("code", code)
    .is("claimed_at", null)
    .maybeSingle()

  if (!pairing) {
    return NextResponse.json({ error: "코드를 찾을 수 없습니다. 기기 화면의 코드를 다시 확인하세요." }, { status: 404 })
  }
  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "코드가 만료되었습니다. 기기에서 새 코드를 받아 주세요." }, { status: 410 })
  }

  // 4. 기기를 만든다. api_key 는 테이블 기본값으로 자동 생성된다.
  const { data: device, error: deviceError } = await admin
    .from("sensor_devices")
    .insert({
      tank_id: tankId,
      name: name || `${tank.name} 센서`,
      device_type: "multi",
      serial: pairing.serial,
      firmware: pairing.firmware,
    })
    .select("id, name")
    .single()

  if (deviceError || !device) {
    console.error("[sensors/pair/claim] device insert", deviceError)
    return NextResponse.json({ error: "기기 등록에 실패했습니다." }, { status: 500 })
  }

  // 5. 페어링을 승인 처리한다.
  //    claimed_at 이 비어 있는 행만 갱신해, 두 사람이 동시에 같은 코드를
  //    입력해도 한 명만 성공하게 한다.
  const { data: claimed, error: claimError } = await admin
    .from("sensor_pairings")
    .update({
      device_id: device.id,
      claimed_by: user.id,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", pairing.id)
    .is("claimed_at", null)
    .select("id")
    .maybeSingle()

  if (claimError || !claimed) {
    // 경합에서 졌다면 방금 만든 기기를 되돌린다.
    await admin.from("sensor_devices").delete().eq("id", device.id)
    return NextResponse.json({ error: "이미 처리된 코드입니다." }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    device_id: device.id,
    device_name: device.name,
    tank_name: tank.name,
    serial: pairing.serial,
  })
}
