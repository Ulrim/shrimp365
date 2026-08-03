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
    salinity:    [ 0,   50],
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

  for (const alert of thresholdAlerts) {
    try {
      await supabaseAdmin.from("alerts").insert({
        tank_id: device.tank_id,
        type: alert.type,
        parameter: alert.parameter,
        value: alert.value,
        threshold: alert.threshold,
        message: alert.message,
        resolved: false,
      })
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
