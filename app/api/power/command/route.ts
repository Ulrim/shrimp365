import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"
import { CIRCUIT_ID_RE, CONTROL_STALE_MS, checkRule, type ControlSnapshot } from "@/lib/power-remote"

// 웹에서 전력 회로 켜기·끄기·예약 — 명령함(power_commands)에 넣는다. 장비가 15초 안에 가져가 실행한다
// (app/api/sensors/power). 농장 주인만 넣을 수 있다 — 열람자는 상태만 본다.
//
// service-role 로 쓰므로 소유 확인이 이 경로의 유일한 방어선이다.

const WINDOW_MS = 60_000
const MAX_PER_USER = 30
const hits = new Map<string, { count: number; windowStart: number }>()

function tooMany(userId: string): boolean {
  const now = Date.now()
  if (hits.size > 5000) for (const [k, e] of hits) if (now - e.windowStart > WINDOW_MS) hits.delete(k)
  const e = hits.get(userId)
  if (!e || now - e.windowStart > WINDOW_MS) { hits.set(userId, { count: 1, windowStart: now }); return false }
  if (e.count >= MAX_PER_USER) return true
  e.count++
  return false
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function userClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } },
  )
}

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status })

export async function POST(req: NextRequest) {
  const { data: { user } } = await userClient(req).auth.getUser()
  if (!user) return err("login", 401)
  if (tooMany(user.id)) return err("tooMany", 429)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return err("server", 503)

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const tankId = typeof b.tank_id === "string" && UUID_RE.test(b.tank_id) ? b.tank_id : ""
  const deviceId = typeof b.device_id === "string" && UUID_RE.test(b.device_id) ? b.device_id : ""
  const circuit = typeof b.circuit === "string" && CIRCUIT_ID_RE.test(b.circuit) ? b.circuit.toUpperCase() : ""
  const action = b.action
  if (!tankId || !deviceId || !circuit) return err("bad", 400)

  let body: Record<string, unknown>
  if (action === "set") {
    if (typeof b.on !== "boolean") return err("bad", 400)
    const m = b.minutes
    if (m !== undefined && m !== null && !(Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 1440)) {
      return err("minutes", 400)
    }
    body = { on: b.on, ...(typeof m === "number" ? { minutes: m } : {}) }
  } else if (action === "auto") {
    body = {}
  } else if (action === "rule") {
    const bad = checkRule(b.rule)
    if (bad) return err(bad, 400)
    if (JSON.stringify(b.rule).length > 4000) return err("bad", 400)
    body = { rule: b.rule }
  } else {
    return err("bad", 400)
  }

  const admin = createAdminClient()

  // 1. 이 수조가 정말 내 것인지 — 열람자(farm_viewers)는 켜고 끌 수 없다.
  const { data: tank } = await admin
    .from("tanks")
    .select("id, farms!tanks_farm_id_fkey(user_id)")
    .eq("id", tankId)
    .maybeSingle()
  const farm = tank?.farms as unknown as { user_id?: string } | { user_id?: string }[] | null
  const ownerId = Array.isArray(farm) ? farm[0]?.user_id : farm?.user_id
  if (!tank || ownerId !== user.id) return err("owner", 403)

  // 2. 장비가 이 수조에 붙어 있고, 최근에 제어 상태를 올렸고, 그 회로를 제어할 수 있는가.
  const { data: state, error: stErr } = await admin
    .from("power_control_state")
    .select("device_id, tank_id, control, updated_at")
    .eq("device_id", deviceId)
    .maybeSingle()
  if (stErr) return err("notReady", 503)            // power_remote.sql 을 아직 안 돌렸다
  if (!state || state.tank_id !== tankId) return err("noDevice", 404)
  if (Date.now() - new Date(state.updated_at).getTime() > CONTROL_STALE_MS) return err("offline", 409)
  const c = (state.control as ControlSnapshot | null)?.circuits?.[circuit]
  if (!c || !c.can) return err("cannot", 409)

  // 3. 같은 회로에 아직 안 끝난 명령이 있으면 그것을 접는다 — 마지막 누름만 따른다.
  await admin.from("power_commands")
    .update({ status: "expired", done_at: new Date().toISOString(), result: "superseded" })
    .eq("device_id", deviceId).eq("circuit_id", circuit).eq("status", "pending")

  const { data: row, error: insErr } = await admin.from("power_commands").insert({
    device_id: deviceId, tank_id: tankId, circuit_id: circuit, action, body, created_by: user.id,
  }).select("id").single()
  if (insErr || !row) {
    console.warn("[power/command] 명령 저장 실패:", insErr?.message)
    return err("server", 500)
  }
  return NextResponse.json({ id: row.id })
}

// GET ?id= — 명령이 어디까지 갔는가. RLS 로 읽는다(주인만 보인다).
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? ""
  if (!UUID_RE.test(id)) return err("bad", 400)
  const supabase = userClient(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err("login", 401)
  const { data } = await supabase.from("power_commands")
    .select("id, status, result, created_at, done_at")
    .eq("id", id)
    .maybeSingle()
  if (!data) return err("noCommand", 404)
  return NextResponse.json(data)
}
