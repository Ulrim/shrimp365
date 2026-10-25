import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"
import { CIRCUIT_ID_RE, COMMAND_TTL_MS } from "@/lib/power-remote"

// 장비가 15초마다 묻는 경로 — 웹에서 넣은 전력 회로 명령을 가져가고, 실행 결과와
// 회로 규칙·손 조작 상태(power_control.py snapshot)를 올린다. supabase/migrations/power_remote.sql.
//
// 웹은 장비에 직접 닿지 못하므로(농장 공유기 뒤) 장비가 묻는 쪽이다. 장비가 명령을 실행할 때
// 안전 규칙(인입 회로·과열·산소 부족 강제 켜기)을 그대로 지킨다 — 여기서는 전달만 한다.

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20            // 15초마다 = 분당 4번. 명령 직후 바로 한 번 더 묻는 것까지 넉넉히
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  if (rateLimitMap.size > 5000) {
    for (const [k, e] of rateLimitMap) if (now - e.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(k)
  }
  const entry = rateLimitMap.get(key)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 제어 상태 JSON 상한 — 회로 수십 개의 규칙이 들어가도 수 KB 다. */
const MAX_CONTROL_BYTES = 32_000

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Device-Key")?.trim()
  if (!apiKey) return NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 })
  if (!checkRateLimit(apiKey)) return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }
  const admin = createAdminClient()

  const { data: device } = await admin
    .from("sensor_devices")
    .select("id, tank_id, active")
    .eq("api_key", apiKey)
    .maybeSingle()
  if (!device) return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
  if (!device.active) return NextResponse.json({ error: "비활성화된 기기입니다." }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 })
  }

  // 1. 제어 상태 — 장비가 실어 보냈을 때만(바뀌었을 때·1분마다). 웹 카드의 '장비 연결됨' 판정도 이 시각이다.
  const control = body.control
  if (control && typeof control === "object" && !Array.isArray(control)) {
    const text = JSON.stringify(control)
    if (text.length <= MAX_CONTROL_BYTES) {
      const { error } = await admin.from("power_control_state").upsert({
        device_id: device.id, tank_id: device.tank_id, control, updated_at: new Date().toISOString(),
      })
      if (error) {
        // power_remote.sql 을 아직 안 돌린 DB — 장비는 명령 없이 계속 돈다.
        console.warn("[sensors/power] 제어 상태 저장 실패(power_remote.sql 필요?):", error.message)
        return NextResponse.json({ commands: [], disabled: true })
      }
    }
  }

  // 2. 실행 결과 — 이 장비에 보낸 명령만 닫는다.
  const results = Array.isArray(body.results) ? body.results.slice(0, 20) : []
  for (const r of results) {
    if (!r || typeof r !== "object") continue
    const { id, ok, error } = r as { id?: unknown; ok?: unknown; error?: unknown }
    if (typeof id !== "string" || !UUID_RE.test(id)) continue
    await admin.from("power_commands")
      .update({
        status: ok === true ? "done" : "failed",
        result: typeof error === "string" ? error.slice(0, 200) : null,
        done_at: new Date().toISOString(),
      })
      .eq("id", id).eq("device_id", device.id).in("status", ["pending", "sent"])
  }

  // 3. 늦은 명령은 버린다 — 장비가 한참 끊겼다 돌아와서 몇 분 전 '켜기' 를 실행하면 안 된다.
  const cutoff = new Date(Date.now() - COMMAND_TTL_MS).toISOString()
  await admin.from("power_commands")
    .update({ status: "expired", done_at: new Date().toISOString() })
    .eq("device_id", device.id).in("status", ["pending", "sent"]).lt("created_at", cutoff)

  // 4. 새 명령 — 넣은 순서대로. 가져간 것은 sent 로 표시해 다음 물음에 다시 주지 않는다.
  const { data: pending, error: pendErr } = await admin.from("power_commands")
    .select("id, circuit_id, action, body")
    .eq("device_id", device.id).eq("status", "pending").gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(10)
  if (pendErr) {
    console.warn("[sensors/power] 명령 조회 실패(power_remote.sql 필요?):", pendErr.message)
    return NextResponse.json({ commands: [], disabled: true })
  }
  const rows = (pending ?? []).filter(p => CIRCUIT_ID_RE.test(p.circuit_id))
  if (rows.length > 0) {
    await admin.from("power_commands")
      .update({ status: "sent", picked_at: new Date().toISOString() })
      .in("id", rows.map(p => p.id)).eq("status", "pending")
  }
  const commands = rows.map(p => ({
    ...(p.body && typeof p.body === "object" ? p.body as Record<string, unknown> : {}),
    id: p.id,
    circuit: p.circuit_id,
    action: p.action,
  }))
  return NextResponse.json({ commands })
}
