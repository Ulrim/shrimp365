// 비전 장비(라즈베리파이)가 서버와 주고받는 **유일한 창구**.
//
// 왜 이 경로가 있나
// -----------------
// 예전에는 장비가 Supabase Postgres 에 직접 붙었다. 그래서 설치할 때 사람이
// DATABASE_URL — 비밀번호가 박힌 연결 문자열 — 을 찾아 넣어야 했고, 그것이
// 설치에서 가장 큰 걸림돌이었다(pooler 와 direct 구분, +asyncpg 접두사,
// 비밀번호 특수문자 인코딩…). 수질 센서 파이는 그런 것이 하나도 없다 —
// 기기 키 하나로 /api/sensors/data 에 보낸다. 비전도 같게 만든다.
//
// 보안상으로도 이쪽이 맞다. 장비가 DB 비밀번호를 들고 있으면, 그 파이 하나를
// 집어 가면 **모든 농장의 데이터**를 읽고 쓸 수 있다. 기기 키는 자기 카메라
// 하나로 범위가 묶인다.
//
//   GET  /api/vision/device  — "나는 어느 수조에 붙어 있고, 내 카메라는 무엇이며,
//                              경보 규칙은 무엇인가"
//   POST /api/vision/device  — 개체수 기록을 묶어서 올린다(+ 살아 있음 보고)
//
// 인증은 X-Device-Key. 페어링(6자리 코드 승인) 때 발급되어 장비가 보관하는
// 값이고, 사람이 옮겨 적지 않는다.
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

/** 한 번에 받는 기록 수 상한. 장비가 오래 끊겼다 붙어도 한 번에 쏟아붓지 못하게. */
const MAX_COUNTS_PER_REQUEST = 500

type DeviceCamera = {
  id: string
  tank_id: string
  name: string
  camera_type: string
  stream_url: string | null
  resolution_w: number
  resolution_h: number
  fps_target: number
  is_active: boolean
}

/** 이 기기가 살아 있다고 적는다. GET·POST 어느 쪽이든 연락은 연락이다. */
async function touch(
  admin: ReturnType<typeof createAdminClient>,
  key: string,
  extra: { agent_version?: string; host_url?: string | null } = {}
) {
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
  if (extra.agent_version) patch.agent_version = extra.agent_version
  if (extra.host_url !== undefined) patch.host_url = extra.host_url || null
  await admin.from("vision_cameras").update(patch).eq("api_key", key)
}

function unauthorized() {
  return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
}

function serviceUnavailable() {
  return NextResponse.json(
    { error: "서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다." },
    { status: 503 }
  )
}

type CameraRow = DeviceCamera & {
  tanks?: { name?: string; farm_id?: string } | { name?: string; farm_id?: string }[]
}

/** 이 기기 키가 맡은 카메라들. 없으면 빈 배열(아직 연결 전이거나 해제됨). */
async function camerasOf(
  admin: ReturnType<typeof createAdminClient>,
  key: string
): Promise<CameraRow[]> {
  const { data } = await admin
    .from("vision_cameras")
    .select(
      "id, tank_id, name, camera_type, stream_url, resolution_w, resolution_h, fps_target, is_active, tanks!vision_cameras_tank_id_fkey(name, farm_id)"
    )
    .eq("api_key", key)
  return (data ?? []) as unknown as CameraRow[]
}

// ---------------------------------------------------------------------------
// GET — 내가 맡은 것과 지켜야 할 규칙
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const key = req.headers.get("X-Device-Key")?.trim()
  if (!key) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return serviceUnavailable()

  const admin = createAdminClient()
  const rows = await camerasOf(admin, key)
  if (rows.length === 0) {
    // 키 자체가 틀렸는지, 연결이 해제됐는지 장비는 구분할 필요가 없다 —
    // 어느 쪽이든 맡을 카메라가 없다는 뜻이고, 화면은 "연결하세요"를 띄운다.
    return NextResponse.json({ cameras: [], alert_configs: [] })
  }

  const cameraIds = rows.map((c) => c.id)
  // 이 카메라에 걸린 규칙 + 전체 적용 규칙(camera_id 가 null).
  const { data: configs } = await admin
    .from("vision_alert_configs")
    .select("*")
    .eq("is_enabled", true)
    .or(`camera_id.is.null,camera_id.in.(${cameraIds.join(",")})`)

  // 이 조회 자체가 살아 있음 보고다. 개체수를 올릴 때만 적으면, 카메라가
  // 멈춘 장비는 멀쩡히 돌고 있어도 화면에 "마지막 응답"이 옛날로 남는다 —
  // 사람은 장비가 죽은 줄 안다.
  await touch(admin, key)

  const cameras = rows.map((c) => {
    const tank = Array.isArray(c.tanks) ? c.tanks[0] : c.tanks
    return {
      id: c.id,
      tank_id: c.tank_id,
      farm_id: tank?.farm_id ?? null,
      tank_name: tank?.name ?? null,
      name: c.name,
      camera_type: c.camera_type,
      stream_url: c.stream_url,
      resolution_w: c.resolution_w,
      resolution_h: c.resolution_h,
      fps_target: c.fps_target,
      is_active: c.is_active,
    }
  })

  return NextResponse.json({ cameras, alert_configs: configs ?? [] })
}

// ---------------------------------------------------------------------------
// POST — 개체수 기록을 올린다
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const key = req.headers.get("X-Device-Key")?.trim()
  if (!key) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return serviceUnavailable()

  let body: {
    counts?: Array<{
      camera_id?: string
      time?: string
      count?: number
      confidence_avg?: number | null
      model_version?: string | null
      inference_ms?: number | null
      length_cm?: number | null
    }>
    agent_version?: string
    host_url?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON 본문을 읽지 못했습니다." }, { status: 400 })
  }

  const admin = createAdminClient()
  const mine = await camerasOf(admin, key)
  if (mine.length === 0) return unauthorized()

  // 이 기기가 쓸 수 있는 카메라만 받는다. 남의 camera_id 를 실어 보내도
  // 통과시키면 기기 키 하나로 남의 수조에 기록을 심을 수 있다.
  const allowed = new Map<string, { tank_id: string; farm_id: string | null }>()
  for (const c of mine) {
    const tank = Array.isArray(c.tanks) ? c.tanks[0] : c.tanks
    allowed.set(c.id, { tank_id: c.tank_id, farm_id: tank?.farm_id ?? null })
  }

  type CountRow = {
    time: string
    camera_id: string
    tank_id: string
    farm_id: string
    count: number
    confidence_avg: number | null
    model_version: string | null
    inference_ms: number | null
    length_cm: number | null
  }

  const incoming = Array.isArray(body.counts) ? body.counts.slice(0, MAX_COUNTS_PER_REQUEST) : []
  const rows: CountRow[] = []
  let rejected = 0
  for (const r of incoming) {
    const owner = r.camera_id ? allowed.get(r.camera_id) : undefined
    if (!owner || !owner.farm_id || typeof r.count !== "number" || r.count < 0 || !r.time) {
      rejected++
      continue
    }
    rows.push({
      time: r.time,
      camera_id: r.camera_id as string,
      tank_id: owner.tank_id,
      farm_id: owner.farm_id,
      count: Math.round(r.count),
      confidence_avg: r.confidence_avg ?? null,
      model_version: r.model_version ?? null,
      inference_ms: r.inference_ms ?? null,
      length_cm: typeof r.length_cm === "number" ? r.length_cm : null,
    })
  }

  if (rows.length > 0) {
    // 장비가 재전송해도 중복으로 쌓이지 않게 한다 — 끊겼다 붙으면 보관분을
    // 다시 보내는데, 그때마다 행이 늘면 기록이 믿을 수 없게 된다.
    const save = (r: Array<Partial<CountRow>>) =>
      admin.from("count_records").upsert(r, { onConflict: "camera_id,time", ignoreDuplicates: true })

    let { error } = await save(rows)
    // length_cm 은 나중에 생긴 열이다. 마이그레이션(vision_length.sql)을 아직
    // 돌리지 않은 서버에서는 그 열이 없어 **개체수 전체가 저장되지 않는다.**
    // 길이 하나 때문에 기록이 멈추면 안 되므로, 그 경우에만 길이를 떼고 다시
    // 넣는다. 마이그레이션을 돌리면 저절로 길이까지 들어가기 시작한다.
    if (error && /length_cm/.test(`${error.message} ${error.details ?? ""}`)) {
      console.warn("[vision/device] count_records.length_cm 열이 없습니다 — 길이를 빼고 저장합니다. supabase/migrations/vision_length.sql 을 실행하세요.")
      const withoutLength = rows.map((r) => {
        const copy: Partial<CountRow> = { ...r }
        delete copy.length_cm
        return copy
      })
      ;({ error } = await save(withoutLength))
    }
    if (error) {
      return NextResponse.json({ error: "기록을 저장하지 못했습니다." }, { status: 500 })
    }
  }

  // 살아 있음 보고 — 화면에서 "이 장비가 돌고 있나"를 보려면 필요하다.
  // 개체수 기록만으로는 구분이 안 된다(카메라가 멈춰도 마지막 기록은 남는다).
  await touch(admin, key, { agent_version: body.agent_version, host_url: body.host_url })

  return NextResponse.json({ stored: rows.length, rejected })
}
