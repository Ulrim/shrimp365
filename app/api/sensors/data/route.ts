import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"
import { checkThresholds } from "@/lib/thresholds"

// In-memory rate limit: max 60 requests per device per minute
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
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

/** 기기가 보내는 짧은 식별 문자열만 통과시킨다(로그·화면 오염 방지). */
function readShortString(v: unknown, max = 64): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim().slice(0, max)
  return trimmed || null
}

/** 기기가 보낸 원본을 그대로 저장하되, 크기와 형태를 제한한다.
 *  중첩 객체·거대한 배열이 들어와 DB가 커지는 것을 막는다. */
function sanitizePayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(body)) {
    if (count >= 32) break
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v
    else if (typeof v === "boolean") out[k] = v
    else if (typeof v === "string") out[k] = v.slice(0, 120)
    else continue
    count++
  }
  return out
}


/** 계정 이메일을 화면에 띄울 만큼만 가린다.
 *  장비 화면은 창고·수조 옆에 놓여 아무나 볼 수 있으므로 전체 주소를 그대로
 *  노출하지 않는다. 본인이 자기 계정임을 알아볼 정도면 충분하다. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return email
  const head = local.slice(0, 2)
  const tail = local.length > 3 ? local.slice(-1) : ""
  return `${head}${"*".repeat(Math.max(1, local.length - head.length - tail.length))}${tail}@${domain}`
}

// GET /api/sensors/data
// 기기가 "나는 지금 어느 계정·수조에 붙어 있나"를 확인하는 경로.
// 재부팅 후에도 화면에 연결 정보를 띄울 수 있어야 한다.
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("X-Device-Key")?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 })
  }
  if (!checkRateLimit(`info:${apiKey}`)) {
    return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data: device } = await admin
    .from("sensor_devices")
    .select("name, active, tank_id, tanks!sensor_devices_tank_id_fkey(name, farms!tanks_farm_id_fkey(name, user_id))")
    .eq("api_key", apiKey)
    .maybeSingle()

  if (!device) {
    return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
  }

  const tank = (Array.isArray(device.tanks) ? device.tanks[0] : device.tanks) as
    | { name?: string; farms?: { name?: string; user_id?: string } | { name?: string; user_id?: string }[] }
    | undefined
  const farm = (Array.isArray(tank?.farms) ? tank?.farms[0] : tank?.farms) as
    | { name?: string; user_id?: string }
    | undefined

  let account: string | null = null
  if (farm?.user_id) {
    const { data: owner } = await admin.auth.admin.getUserById(farm.user_id)
    if (owner?.user?.email) account = maskEmail(owner.user.email)
  }

  return NextResponse.json({
    device_name: device.name,
    active: device.active,
    tank_name: tank?.name ?? null,
    farm_name: farm?.name ?? null,
    account,
  })
}

// POST /api/sensors/data
// 기기 인증: X-Device-Key 헤더
// RLS 없이 service-role 클라이언트 사용
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Device-Key")?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 유효한 JSON이 아닙니다." }, { status: 400 })
  }

  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 })
  }

  // 1. API 키로 기기 조회
  const { data: device, error: deviceError } = await supabaseAdmin
    .from("sensor_devices")
    .select("id, tank_id, active")
    .eq("api_key", apiKey)
    .single()

  if (deviceError || !device) {
    return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
  }
  if (!device.active) {
    return NextResponse.json({ error: "비활성화된 기기입니다." }, { status: 401 })
  }

  // Rate limit per device key
  if (!checkRateLimit(apiKey)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 })
  }

  // 2. 측정값 파싱 + 유효 범위 검증 (DB 오염·오버플로 방지)
  const FIELDS = ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"] as const
  type FieldKey = typeof FIELDS[number]

  const VALID_RANGE: Record<FieldKey, [number, number]> = {
    temperature: [-5,   60],
    ph:          [ 0,   14],
    do_level:    [ 0,   30],
    salinity:    [ 0,   50],   // ppt — 바닷물이 약 35
    ammonia:     [ 0,  100],
    nitrite:     [ 0,  100],
    nitrate:     [ 0,  500],
    alkalinity:  [ 0, 1000],
    turbidity:   [ 0, 1000],
  }

  const values: Partial<Record<FieldKey, number>> = {}
  for (const field of FIELDS) {
    const raw = body[field]
    if (raw !== undefined && raw !== null) {
      const n = Number(raw)
      const [min, max] = VALID_RANGE[field]
      if (!Number.isNaN(n) && Number.isFinite(n) && n >= min && n <= max) {
        values[field] = n
      }
    }
  }

  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: "측정값이 하나도 없습니다." }, { status: 422 })
  }

  // recorded_at: ISO8601 형식만 허용, 미래 시각 차단
  let recordedAt = new Date().toISOString()
  if (typeof body.recorded_at === "string") {
    const parsed = new Date(body.recorded_at)
    if (!isNaN(parsed.getTime()) && parsed.getTime() <= Date.now()) {
      recordedAt = parsed.toISOString()
    }
  }

  // 3. water_quality_readings 삽입
  const { data: reading, error: insertError } = await supabaseAdmin
    .from("water_quality_readings")
    .insert({
      tank_id: device.tank_id,
      ...values,
      recorded_at: recordedAt,
    })
    .select()
    .single()

  if (insertError) {
    console.error("[sensors/data] insert error:", insertError)
    return NextResponse.json({ error: "데이터 저장에 실패했습니다." }, { status: 500 })
  }

  // 4. 임계값 체크 → 알림 생성 + 수조 상태 갱신
  const thresholdAlerts = checkThresholds(values as Parameters<typeof checkThresholds>[0])

  // 같은 항목이 계속 범위 밖이면 알림을 새로 만들지 않는다.
  //
  // 1분마다 측정하므로, 밤새 산소가 낮으면 알림이 480건 쌓인다. 그러면 정작
  // 봐야 할 다른 알림이 묻히고, 농가는 알림 자체를 무시하게 된다. 아직 해결되지
  // 않은 같은 알림이 있으면 그 값만 갱신하고 새 줄은 만들지 않는다.
  for (const alert of thresholdAlerts) {
    try {
      const { data: open } = await supabaseAdmin
        .from("alerts")
        .select("id")
        .eq("tank_id", device.tank_id)
        .eq("parameter", alert.parameter)
        .eq("resolved", false)
        .limit(1)
        .maybeSingle()

      if (open) {
        // 이미 알린 상태다. 최신 값과 심각도만 반영한다.
        await supabaseAdmin
          .from("alerts")
          .update({ type: alert.type, value: alert.value, message: alert.message })
          .eq("id", open.id)
      } else {
        await supabaseAdmin.from("alerts").insert({
          tank_id: device.tank_id,
          type: alert.type,
          parameter: alert.parameter,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
          resolved: false,
        })
      }
    } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }
  }

  // 범위 안으로 돌아온 항목은 알림을 닫는다. 안 닫으면 위 중복 방지 때문에
  // 다음에 정말 문제가 생겨도 옛 알림만 갱신되고 새로 알리지 않는다.
  const stillBad = new Set(thresholdAlerts.map(a => a.parameter))
  const recovered = Object.keys(values).filter(p => !stillBad.has(p))
  if (recovered.length > 0) {
    try {
      await supabaseAdmin
        .from("alerts")
        .update({ resolved: true })
        .eq("tank_id", device.tank_id)
        .eq("resolved", false)
        .in("parameter", recovered)
    } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }
  }

  const newStatus = thresholdAlerts.some(a => a.type === "danger") ? "danger"
    : thresholdAlerts.some(a => a.type === "warning") ? "warning"
    : "active"

  try {
    await supabaseAdmin
      .from("tanks")
      .update({ status: newStatus })
      .eq("id", device.tank_id)
  } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }

  // 5. 기기 상태 갱신 — 마지막 수신 시각과 자기소개(시리얼·버전), 원본 측정값.
  //    원본을 통째로 남겨 두면 수질 기록에 저장하지 않는 값(전도도·TDS 등)도
  //    화면에서 확인할 수 있어 현장에서 기기 상태를 파악하기 쉽다.
  try {
    const deviceUpdate: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      last_payload: sanitizePayload(body),
    }
    const serial = readShortString(body.serial)
    const firmware = readShortString(body.firmware)
    if (serial) deviceUpdate.serial = serial
    if (firmware) deviceUpdate.firmware = firmware

    await supabaseAdmin.from("sensor_devices").update(deviceUpdate).eq("id", device.id)
  } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }

  return NextResponse.json({
    success: true,
    reading_id: reading.id,
    tank_id: device.tank_id,
    alerts_triggered: thresholdAlerts.length,
  })
}
