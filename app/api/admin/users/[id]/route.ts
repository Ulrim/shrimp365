import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"
import { SUPER_ADMIN_EMAIL } from "@/lib/control-auth"
import type { AdminUserDetail, TankStatusCounts } from "@/components/admin/user-detail/types"

// 사용자 상세 — 관리자 콘솔 /admin/users/[id] 의 데이터(읽기 전용).
//
// 다른 사용자의 농장·장비·알림을 보려면 RLS 를 넘어야 해서 service role 로 읽는다.
// 그래서 아래 권한 확인(api/admin/stats 와 같은 검사)이 이 데이터의 유일한
// 방어선이다 — 확인 전에 조기 반환하며 데이터를 내주는 분기가 있어서는 안 된다.
// sensor_devices 의 장비 비밀 키 컬럼은 어떤 select 에도 넣지 않는다(장비 컬럼은 명시 나열).

export const dynamic = "force-dynamic"

// 관제센터(api/control/overview)와 같은 규칙 — 측정 주기 1분, 5분 넘게 소식이 없으면 끊김.
const OFFLINE_AFTER_MS = 5 * 60_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: Promise<{ id: string }> }
type Res<T> = { data: T | null; error: unknown; count?: number | null }

/** Supabase 쿼리 빌더를 결과 타입이 정해진 thenable 로 본다. */
function q<T>(builder: PromiseLike<unknown>): PromiseLike<Res<T>> {
  return builder as PromiseLike<Res<T>>
}

/** 앞에서부터 시도해 처음 성공한 결과를 돌려준다 — 마이그레이션 전이라 컬럼이
 *  없으면 select 가 통째로 실패하므로, 컬럼을 줄인 select 로 다시 읽는 데 쓴다. */
async function firstOk<T>(attempts: (() => PromiseLike<Res<T>>)[]): Promise<Res<T>> {
  let last: Res<T> = { data: null, error: new Error("no attempt") }
  for (const run of attempts) {
    last = await run()
    if (!last.error) return last
  }
  return last
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params

  // 1. 호출자 인증 확인
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 2. Service Role Key 존재 여부 확인
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }

  try {
    const admin = createAdminClient()

    // 3. 호출자 권한 확인 (admin 역할 또는 총관리자 이메일) — api/admin/stats 와 같다.
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    const isOwner = (user.email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase()
    if (callerProfile?.role !== "admin" && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // 4. 대상 사용자 — 형식이 틀린 id 는 조회 없이 404.
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { data: authData, error: authErr } = await admin.auth.admin.getUserById(id)
    if (authErr || !authData?.user) {
      const status = (authErr as { status?: number } | null)?.status
      if (!authErr || status === 404 || status === 400) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      throw authErr
    }
    const target = authData.user

    // 5. 프로필·농장 (컬럼 부재 폴백)
    type ProfileRow = { name: string | null; role: string | null; plan: string | null; ui_mode?: string | null }
    type FarmRow = {
      id: string; name: string; location: string | null; created_at: string | null
      farm_type?: string | null; latitude?: number | null; longitude?: number | null
    }
    const [profileRes, farmsRes] = await Promise.all([
      firstOk<ProfileRow>([
        () => q(admin.from("profiles").select("name, role, plan, ui_mode").eq("id", id).maybeSingle()),
        () => q(admin.from("profiles").select("name, role, plan").eq("id", id).maybeSingle()),
      ]),
      firstOk<FarmRow[]>([
        () => q(admin.from("farms").select("id, name, location, created_at, farm_type, latitude, longitude").eq("user_id", id).order("created_at", { ascending: true })),
        () => q(admin.from("farms").select("id, name, location, created_at, farm_type").eq("user_id", id).order("created_at", { ascending: true })),
        () => q(admin.from("farms").select("id, name, location, created_at").eq("user_id", id).order("created_at", { ascending: true })),
      ]),
    ])
    if (farmsRes.error) throw farmsRes.error
    const profile = profileRes.data
    const farmRows = farmsRes.data ?? []
    const farmIds = farmRows.map(f => f.id)

    // 6. 수조 → 장비·알림·활동
    type TankRow = { id: string; farm_id: string; name: string; status: string | null }
    let tankRows: TankRow[] = []
    if (farmIds.length > 0) {
      const { data, error } = await q<TankRow[]>(
        admin.from("tanks").select("id, farm_id, name, status").in("farm_id", farmIds),
      )
      if (error) throw error
      tankRows = data ?? []
    }
    const tankIds = tankRows.map(t => t.id)
    const hasTanks = tankIds.length > 0
    const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString()

    type DeviceRow = {
      id: string; tank_id: string; name: string; active: boolean
      serial: string | null; agent_version: string | null; last_seen_at: string | null
    }
    type AlertRow = {
      id: string; tank_id: string; type: "danger" | "warning" | "info"; parameter: string | null
      message: string; created_at: string; resolved: boolean | null
    }
    type ViewerRow = { farm_id: string }
    const empty = <T,>(data: T): Promise<Res<T>> => Promise.resolve({ data, error: null, count: 0 })

    const [devicesRes, openAlertsRes, recentAlertsRes, readingsCountRes, lastReadingRes, journalCountRes, lastJournalRes, viewersRes] =
      await Promise.all([
        hasTanks
          ? q<DeviceRow[]>(admin.from("sensor_devices")
              .select("id, tank_id, name, active, serial, agent_version, last_seen_at")
              .in("tank_id", tankIds))
          : empty<DeviceRow[]>([]),
        hasTanks
          ? q<null>(admin.from("alerts").select("id", { count: "exact", head: true })
              .in("tank_id", tankIds).eq("resolved", false))
          : empty<null>(null),
        hasTanks
          ? q<AlertRow[]>(admin.from("alerts")
              .select("id, tank_id, type, parameter, message, created_at, resolved")
              .in("tank_id", tankIds)
              .order("created_at", { ascending: false })
              .limit(10))
          : empty<AlertRow[]>([]),
        hasTanks
          ? q<null>(admin.from("water_quality_readings").select("id", { count: "exact", head: true })
              .in("tank_id", tankIds).gte("recorded_at", since30d))
          : empty<null>(null),
        hasTanks
          ? q<{ recorded_at: string } | null>(admin.from("water_quality_readings").select("recorded_at")
              .in("tank_id", tankIds).order("recorded_at", { ascending: false }).limit(1).maybeSingle())
          : empty<{ recorded_at: string } | null>(null),
        hasTanks
          ? q<null>(admin.from("journal_entries").select("id", { count: "exact", head: true })
              .in("tank_id", tankIds))
          : empty<null>(null),
        hasTanks
          ? q<{ date: string } | null>(admin.from("journal_entries").select("date")
              .in("tank_id", tankIds).order("date", { ascending: false }).limit(1).maybeSingle())
          : empty<{ date: string } | null>(null),
        q<ViewerRow[]>(admin.from("farm_viewers").select("farm_id").eq("user_id", id)),
      ])
    if (devicesRes.error) throw devicesRes.error
    if (recentAlertsRes.error) throw recentAlertsRes.error

    // 7. 열람 연결 — farm_viewers 가 없으면(마이그레이션 전) 생략(null).
    let viewerLinks: AdminUserDetail["viewer_links"] = null
    if (!viewersRes.error) {
      const viewFarmIds = [...new Set((viewersRes.data ?? []).map(v => v.farm_id))]
      viewerLinks = []
      if (viewFarmIds.length > 0) {
        const { data: vFarms, error: vErr } = await q<{ id: string; name: string; user_id: string }[]>(
          admin.from("farms").select("id, name, user_id").in("id", viewFarmIds),
        )
        if (vErr) throw vErr
        const ownerIds = [...new Set((vFarms ?? []).map(f => f.user_id))]
        const { data: owners } = ownerIds.length > 0
          ? await q<{ id: string; name: string | null }[]>(admin.from("profiles").select("id, name").in("id", ownerIds))
          : { data: [] as { id: string; name: string | null }[] }
        const ownerName = new Map((owners ?? []).map(o => [o.id, o.name || ""]))
        viewerLinks = (vFarms ?? []).map(f => ({
          farm_id: f.id,
          farm_name: f.name,
          owner_name: ownerName.get(f.user_id) || "이름 없음",
        }))
      }
    }

    // 8. 조립
    const now = Date.now()
    const farmById = new Map(farmRows.map(f => [f.id, f]))
    const tankById = new Map(tankRows.map(t => [t.id, t]))

    const farms: AdminUserDetail["farms"] = farmRows.map(f => {
      const counts: TankStatusCounts = { total: 0, active: 0, warning: 0, danger: 0, inactive: 0 }
      for (const t of tankRows) {
        if (t.farm_id !== f.id) continue
        counts.total++
        const s = t.status ?? "active"
        if (s === "active" || s === "warning" || s === "danger" || s === "inactive") counts[s]++
      }
      const hasCoordCols = "latitude" in f
      return {
        id: f.id,
        name: f.name,
        farm_type: f.farm_type === "agriculture" ? "agriculture" : "shrimp",
        location: f.location ?? "",
        has_coords: hasCoordCols ? typeof f.latitude === "number" && typeof f.longitude === "number" : null,
        created_at: f.created_at,
        tanks: counts,
      }
    })

    const devices: AdminUserDetail["devices"] = (devicesRes.data ?? []).map(d => {
      const tank = tankById.get(d.tank_id)
      const farm = tank ? farmById.get(tank.farm_id) : undefined
      const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : null
      return {
        id: d.id,
        name: d.name,
        farm_id: farm?.id ?? "",
        farm_name: farm?.name ?? "",
        tank_id: d.tank_id,
        tank_name: tank?.name ?? "",
        active: d.active,
        serial: d.serial,
        version: d.agent_version,
        last_seen_at: d.last_seen_at,
        online: !!(d.active && seen && now - seen <= OFFLINE_AFTER_MS),
      }
    })

    const recent: AdminUserDetail["alerts"]["recent"] = (recentAlertsRes.data ?? []).map(a => {
      const tank = tankById.get(a.tank_id)
      return {
        id: a.id,
        type: a.type,
        parameter: a.parameter,
        message: a.message,
        created_at: a.created_at,
        resolved: !!a.resolved,
        tank_name: tank?.name ?? "",
        farm_name: (tank && farmById.get(tank.farm_id)?.name) ?? "",
      }
    })

    // 로그인 방식 — app_metadata.provider(가입 방식)를 앞에, providers 를 뒤에.
    const meta = (target.app_metadata ?? {}) as { provider?: unknown; providers?: unknown }
    const providers = [
      ...(typeof meta.provider === "string" ? [meta.provider] : []),
      ...(Array.isArray(meta.providers) ? meta.providers.filter((p): p is string => typeof p === "string") : []),
    ].filter((p, i, arr) => arr.indexOf(p) === i)

    const uiMode = profile?.ui_mode
    const email = target.email ?? ""
    const body: AdminUserDetail = {
      account: {
        id: target.id,
        name: profile?.name || email.split("@")[0] || "",
        email,
        role: profile?.role || "farmer",
        plan: profile?.plan || "free",
        ui_mode: uiMode === "shrimp" || uiMode === "agriculture" ? uiMode : null,
        created_at: target.created_at,
        last_sign_in_at: target.last_sign_in_at ?? null,
        email_confirmed: !!target.email_confirmed_at,
        providers,
        is_super_admin: email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase(),
      },
      farms,
      devices,
      alerts: {
        open_count: openAlertsRes.error ? null : (openAlertsRes.count ?? 0),
        recent,
      },
      activity: {
        readings_30d: readingsCountRes.error ? null : (readingsCountRes.count ?? 0),
        last_reading_at: lastReadingRes.error ? null : (lastReadingRes.data?.recorded_at ?? null),
        journal_count: journalCountRes.error ? null : (journalCountRes.count ?? 0),
        last_journal_date: lastJournalRes.error ? null : (lastJournalRes.data?.date ?? null),
      },
      viewer_links: viewerLinks,
    }
    return NextResponse.json(body)
  } catch (err) {
    console.error("[admin/users/:id]", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
