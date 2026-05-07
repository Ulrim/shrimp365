import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"
import { checkThresholds } from "@/lib/thresholds"

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

  // 2. 측정값 파싱
  const FIELDS = ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"] as const
  type FieldKey = typeof FIELDS[number]

  const values: Partial<Record<FieldKey, number>> = {}
  for (const field of FIELDS) {
    const raw = body[field]
    if (raw !== undefined && raw !== null) {
      const n = Number(raw)
      if (!Number.isNaN(n)) values[field] = n
    }
  }

  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: "측정값이 하나도 없습니다." }, { status: 422 })
  }

  const recordedAt = typeof body.recorded_at === "string"
    ? body.recorded_at
    : new Date().toISOString()

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
    } catch { /* non-fatal */ }
  }

  const newStatus = thresholdAlerts.some(a => a.type === "danger") ? "danger"
    : thresholdAlerts.some(a => a.type === "warning") ? "warning"
    : "active"

  try {
    await supabaseAdmin
      .from("tanks")
      .update({ status: newStatus })
      .eq("id", device.tank_id)
  } catch { /* non-fatal */ }

  // 5. last_seen_at 갱신
  try {
    await supabaseAdmin
      .from("sensor_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id)
  } catch { /* non-fatal */ }

  return NextResponse.json({
    success: true,
    reading_id: reading.id,
    tank_id: device.tank_id,
    alerts_triggered: thresholdAlerts.length,
  })
}
