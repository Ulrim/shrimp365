import { NextRequest, NextResponse } from "next/server"
import { randomBytes, randomInt } from "crypto"
import { createAdminClient } from "@/lib/supabase-server"

// 장비가 코드를 요청(POST)하고, 승인될 때까지 상태를 확인(GET)하는 경로.
// 둘 다 로그인 없이 호출되므로 남용 방지가 중요하다.

const REQUEST_LIMIT_WINDOW_MS = 60 * 60_000 // 1시간
const REQUEST_LIMIT_MAX = 10                // 장비 하나가 1시간에 코드 10개까지
const POLL_LIMIT_WINDOW_MS = 60_000
const POLL_LIMIT_MAX = 120                  // 5초 간격 폴링이면 분당 12회. 넉넉히 잡음

const requestCounts = new Map<string, { count: number; windowStart: number }>()
const pollCounts = new Map<string, { count: number; windowStart: number }>()

function rateLimited(map: Map<string, { count: number; windowStart: number }>, key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const entry = map.get(key)
  if (!entry || now - entry.windowStart > windowMs) {
    map.set(key, { count: 1, windowStart: now })
    return false
  }
  if (entry.count >= max) return true
  entry.count++
  return false
}

function clientKey(req: NextRequest, fallback: string): string {
  // Vercel 뒤에서는 x-forwarded-for 가 실제 클라이언트다.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return ip || fallback
}

function shortString(v: unknown, max = 64): string | null {
  if (typeof v !== "string") return null
  const t = v.trim().slice(0, max)
  return t || null
}

/** 6자리 코드. 헷갈리기 쉬운 값(000000 등)도 그대로 쓰되 유일성만 보장한다. */
function makeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

// ── 코드 발급 ────────────────────────────────────────────────────────────────
// POST /api/sensors/pair   { serial?, firmware? }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const serial = shortString(body.serial)
  const firmware = shortString(body.firmware)

  // 같은 장비가 코드를 계속 새로 뽑아 코드 공간을 채우는 것을 막는다.
  if (rateLimited(requestCounts, serial ?? clientKey(req, "anon"), REQUEST_LIMIT_WINDOW_MS, REQUEST_LIMIT_MAX)) {
    return NextResponse.json(
      { error: "코드 요청이 너무 잦습니다. 잠시 후 다시 시도하세요." },
      { status: 429 },
    )
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }
  const admin = createAdminClient()

  // 오래된 미승인 코드를 치운다(별도 스케줄러 없이 유지되도록).
  // 실패해도 코드 발급 자체를 막지는 않는다.
  try {
    await admin.rpc("purge_expired_sensor_pairings")
  } catch (e) {
    console.warn("[sensors/pair] purge 실패:", e instanceof Error ? e.message : e)
  }

  const pairingSecret = randomBytes(32).toString("hex")

  // 활성 코드가 겹치면 유니크 인덱스가 막는다. 몇 번 다시 뽑아 본다.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode()
    const { data, error } = await admin
      .from("sensor_pairings")
      .insert({ code, pairing_secret: pairingSecret, serial, firmware })
      .select("code, expires_at")
      .single()

    if (!error && data) {
      return NextResponse.json({
        code: data.code,
        pairing_secret: pairingSecret,
        expires_at: data.expires_at,
      })
    }
    if (error?.code !== "23505") {
      console.error("[sensors/pair] insert", error)
      return NextResponse.json({ error: "코드 발급에 실패했습니다." }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "코드 발급에 실패했습니다. 다시 시도하세요." }, { status: 503 })
}

// ── 상태 확인 ────────────────────────────────────────────────────────────────
// GET /api/sensors/pair?secret=...
// 승인 전에는 pending, 승인 후에는 기기 키를 돌려준다.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")?.trim()
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "secret 이 필요합니다." }, { status: 400 })
  }

  if (rateLimited(pollCounts, secret, POLL_LIMIT_WINDOW_MS, POLL_LIMIT_MAX)) {
    return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 })
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }
  const admin = createAdminClient()

  const { data: pairing } = await admin
    .from("sensor_pairings")
    .select("id, device_id, claimed_at, expires_at")
    .eq("pairing_secret", secret)
    .maybeSingle()

  if (!pairing) {
    return NextResponse.json({ status: "not_found" }, { status: 404 })
  }

  if (!pairing.claimed_at) {
    // 아직 아무도 승인하지 않았다. 만료됐으면 장비가 새 코드를 받아야 한다.
    if (new Date(pairing.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ status: "expired" })
    }
    return NextResponse.json({ status: "pending" })
  }

  // 승인됨 — 기기 키를 넘긴다.
  const { data: device } = await admin
    .from("sensor_devices")
    .select("api_key, name, tank_id, tanks!sensor_devices_tank_id_fkey(name, farms!tanks_farm_id_fkey(user_id))")
    .eq("id", pairing.device_id)
    .maybeSingle()

  if (!device) {
    // 승인 후 기기가 삭제된 경우. 장비는 처음부터 다시 시작해야 한다.
    return NextResponse.json({ status: "revoked" })
  }

  const tank = (Array.isArray(device.tanks) ? device.tanks[0] : device.tanks) as
    | { name?: string; farms?: { user_id?: string } | { user_id?: string }[] }
    | undefined
  const farm = (Array.isArray(tank?.farms) ? tank?.farms[0] : tank?.farms) as
    | { user_id?: string }
    | undefined

  // 장비 화면에 "어느 계정에 연결됐는지" 띄우기 위한 값.
  // 화면이 수조 옆에 놓이므로 이메일은 일부만 보여 준다.
  let account: string | null = null
  if (farm?.user_id) {
    const { data: owner } = await admin.auth.admin.getUserById(farm.user_id)
    const email = owner?.user?.email
    if (email) {
      const [local, domain] = email.split("@")
      if (domain) {
        const head = local.slice(0, 2)
        const tail = local.length > 3 ? local.slice(-1) : ""
        account = `${head}${"*".repeat(Math.max(1, local.length - head.length - tail.length))}${tail}@${domain}`
      } else {
        account = email
      }
    }
  }

  return NextResponse.json({
    status: "linked",
    device_key: device.api_key,
    device_name: device.name,
    tank_name: tank?.name ?? null,
    account,
  })
}
