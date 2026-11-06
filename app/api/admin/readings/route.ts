import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"
import { SUPER_ADMIN_EMAIL } from "@/lib/control-auth"
import { isMissingColumnError, wqSourceCondition, wqSourceKind } from "@/lib/wq-source"
import {
  READINGS_CSV_MAX, READINGS_MAX_TANKS, READINGS_PAGE_SIZE, WQ_VALUE_KEYS,
  parseReadingsQuery, readingsCsv, readingsCsvFilename,
  type AdminReadingRow, type AdminReadingsResponse, type AdminReadingsScope, type ReadingsQuery, type WqValues,
} from "@/lib/admin-readings"

// 수질 기록 — 관리자 콘솔 /admin/readings 의 데이터(읽기 전용).
//
// 회원 모두의 기록을 보려면 RLS 를 넘어야 해서 service role 로 읽는다. 그래서 아래
// 권한 확인(api/admin/stats 와 같은 검사)이 이 데이터의 유일한 방어선이다 — 확인 전에
// 데이터를 내주는 분기가 있어서는 안 된다. 쓰기(수정·삭제)는 두지 않는다.
// sensor_devices 는 id·name 만 읽는다(장비 비밀 키 컬럼은 어떤 select 에도 넣지 않는다).
//
// 쿼리: user·farm·tank(UUID), source(all|manual|sensor), from·to(YYYY-MM-DD 또는 ISO),
//       page(1~, 50건), format=csv(최대 5,000건). 해석은 lib/admin-readings.ts.

export const dynamic = "force-dynamic"

type Res<T> = { data: T | null; error: unknown; count?: number | null }

/** Supabase 쿼리 빌더를 결과 타입이 정해진 thenable 로 본다. */
function q<T>(builder: PromiseLike<unknown>): PromiseLike<Res<T>> {
  return builder as PromiseLike<Res<T>>
}

type Admin = ReturnType<typeof createAdminClient>
type TankRow = { id: string; farm_id: string; name: string }
type FarmRow = { id: string; name: string; user_id: string; farm_type?: string | null }
type RawReading = Record<string, unknown> & {
  id: string; tank_id: string; device_id?: string | null; source?: string | null
  recorded_at: string; created_at: string
}

/** 조회 단위 — 보강 조회(수조·농장·이름)의 `.in()` 이 URL 길이를 넘지 않게 나눈다. */
const IN_CHUNK = 150
/** PostgREST 한 번에 돌려주는 최대 행(Supabase 기본 max rows). CSV 는 이 단위로 나눠 읽는다. */
const FETCH_CHUNK = 1000

async function selectIn<T>(ids: string[], run: (chunk: string[]) => PromiseLike<Res<T[]>>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await run(ids.slice(i, i + IN_CHUNK))
    if (error) throw error
    out.push(...(data ?? []))
  }
  return out
}

/** 농장 — farm_type 칸이 없는 DB(마이그레이션 전)면 빼고 다시 읽는다. */
async function farmsBy(admin: Admin, column: "id" | "user_id", ids: string[]): Promise<FarmRow[]> {
  if (ids.length === 0) return []
  try {
    return await selectIn<FarmRow>(ids, c => q(admin.from("farms").select("id, name, user_id, farm_type").in(column, c)))
  } catch (err) {
    if (!isMissingColumnError(err, "farm_type")) throw err
    return selectIn<FarmRow>(ids, c => q(admin.from("farms").select("id, name, user_id").in(column, c)))
  }
}

const farmTypeOf = (f: FarmRow | undefined): "shrimp" | "agriculture" =>
  f?.farm_type === "agriculture" ? "agriculture" : "shrimp"

/** 필터 → 수조 ID 목록. null 이면 수조로 거르지 않는다(사용자·농장·수조 필터가 모두 없을 때).
 *  사용자 필터가 있으면 그 사용자의 농장·수조 전체(scope)도 함께 돌려준다 — 화면의 선택지. */
async function resolveTanks(admin: Admin, query: ReadingsQuery): Promise<{ tankIds: string[] | null; scope?: AdminReadingsScope }> {
  if (query.user) {
    const farms = await farmsBy(admin, "user_id", [query.user])
    const tanks = farms.length === 0 ? [] : await selectIn<TankRow>(
      farms.map(f => f.id),
      c => q(admin.from("tanks").select("id, farm_id, name").in("farm_id", c)),
    )
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ko")
    const scope: AdminReadingsScope = {
      farms: [...farms].sort(byName).map(f => ({
        id: f.id,
        name: f.name,
        farm_type: farmTypeOf(f),
        tanks: tanks.filter(t => t.farm_id === f.id).sort(byName).map(t => ({ id: t.id, name: t.name })),
      })),
    }
    const tankIds = tanks
      .filter(t => (!query.farm || t.farm_id === query.farm) && (!query.tank || t.id === query.tank))
      .map(t => t.id)
    return { tankIds, scope }
  }
  if (query.tank) {
    const { data, error } = await q<TankRow | null>(
      admin.from("tanks").select("id, farm_id, name").eq("id", query.tank).maybeSingle(),
    )
    if (error) throw error
    if (!data || (query.farm && data.farm_id !== query.farm)) return { tankIds: [] }
    return { tankIds: [data.id] }
  }
  if (query.farm) {
    const { data, error } = await q<TankRow[]>(admin.from("tanks").select("id, farm_id, name").eq("farm_id", query.farm))
    if (error) throw error
    return { tankIds: (data ?? []).map(t => t.id) }
  }
  return { tankIds: null }
}

/** source 칸 존재 여부 — 한 번 읽어 보고 "칸 없음" 오류면 false. */
async function probeSourceColumn(admin: Admin): Promise<boolean> {
  const { error } = await q<unknown[]>(admin.from("water_quality_readings").select("source").limit(1))
  if (!error) return true
  if (isMissingColumnError(error, "source")) return false
  throw error
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  // numeric 컬럼은 문자열로 올 수 있다.
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 원본 기록 → 화면 행. 수조·농장·소유자 이름과 장비 이름을 붙인다. */
async function enrich(admin: Admin, raw: RawReading[]): Promise<AdminReadingRow[]> {
  if (raw.length === 0) return []
  const tankIds = [...new Set(raw.map(r => r.tank_id))]
  const deviceIds = [...new Set(raw.map(r => r.device_id).filter((d): d is string => !!d))]

  const [tanks, devices] = await Promise.all([
    selectIn<TankRow>(tankIds, c => q(admin.from("tanks").select("id, farm_id, name").in("id", c))),
    // 장비 이름은 곁들임이다 — 못 읽어도 기록은 보여 준다.
    selectIn<{ id: string; name: string }>(deviceIds, c => q(admin.from("sensor_devices").select("id, name").in("id", c)))
      .catch(() => [] as { id: string; name: string }[]),
  ])
  const farms = await farmsBy(admin, "id", [...new Set(tanks.map(t => t.farm_id))])
  const ownerIds = [...new Set(farms.map(f => f.user_id))]
  const owners = await selectIn<{ id: string; name: string | null }>(
    ownerIds, c => q(admin.from("profiles").select("id, name").in("id", c)),
  ).catch(() => [] as { id: string; name: string | null }[])

  const tankById = new Map(tanks.map(t => [t.id, t]))
  const farmById = new Map(farms.map(f => [f.id, f]))
  const ownerName = new Map(owners.map(o => [o.id, o.name || ""]))
  const deviceName = new Map(devices.map(d => [d.id, d.name]))

  return raw.map(r => {
    const tank = tankById.get(r.tank_id)
    const farm = tank ? farmById.get(tank.farm_id) : undefined
    const values = Object.fromEntries(WQ_VALUE_KEYS.map(k => [k, num(r[k])])) as WqValues
    const device = r.device_id ? deviceName.get(r.device_id) : undefined
    return {
      id: r.id,
      recorded_at: r.recorded_at,
      created_at: r.created_at,
      source_kind: wqSourceKind(r),
      ...(device ? { device_name: device } : {}),
      tank_id: r.tank_id,
      tank_name: tank?.name ?? "(삭제된 수조)",
      farm_id: farm?.id ?? "",
      farm_name: farm?.name ?? "—",
      farm_type: farmTypeOf(farm),
      owner_id: farm?.user_id ?? "",
      owner_name: (farm && ownerName.get(farm.user_id)) || "이름 없음",
      values,
    }
  })
}

export async function GET(req: NextRequest) {
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

    // 4. 입력 검증
    const parsed = parseReadingsQuery(req.nextUrl.searchParams, Date.now())
    if (!parsed.ok) return NextResponse.json({ error: "bad_request", message: parsed.message }, { status: 400 })
    const query = parsed.query

    // 5. 수조 범위·source 칸 여부
    const [hasSource, { tankIds, scope }] = await Promise.all([
      probeSourceColumn(admin),
      resolveTanks(admin, query),
    ])
    if (tankIds && tankIds.length > READINGS_MAX_TANKS) {
      return NextResponse.json(
        { error: "too_many_tanks", message: "수조가 너무 많습니다. 농장이나 수조로 좁혀 주세요" },
        { status: 400 },
      )
    }

    // 6. 기록 조회 — 필터를 매번 새 빌더에 건다(목록·건수·CSV 묶음).
    const cond = wqSourceCondition(query.source, hasSource)
    const base = (head = false) => {
      let qb = admin.from("water_quality_readings")
        .select("*", { count: "exact", head })
        .gte("recorded_at", query.from)
      if (query.to) qb = qb.lt("recorded_at", query.to)
      if (tankIds) qb = tankIds.length === 1 ? qb.eq("tank_id", tankIds[0]) : qb.in("tank_id", tankIds)
      if (cond.or) qb = qb.or(cond.or)
      else if (cond.deviceNull === true) qb = qb.is("device_id", null)
      else if (cond.deviceNull === false) qb = qb.not("device_id", "is", null)
      return qb
    }
    const ordered = (from: number, to: number) =>
      q<RawReading[]>(base().order("recorded_at", { ascending: false }).order("id", { ascending: false }).range(from, to))

    const empty = tankIds !== null && tankIds.length === 0

    if (query.format === "csv") {
      const raw: RawReading[] = []
      let total = 0
      if (!empty) {
        for (let off = 0; off < READINGS_CSV_MAX; off += FETCH_CHUNK) {
          const end = Math.min(off + FETCH_CHUNK, READINGS_CSV_MAX) - 1
          const { data, error, count } = await ordered(off, end)
          if (error) throw error
          if (off === 0) total = count ?? 0
          raw.push(...(data ?? []))
          if (!data || data.length === 0 || raw.length >= Math.min(total, READINGS_CSV_MAX)) break
        }
      }
      const rows = await enrich(admin, raw)
      const now = Date.now()
      return new NextResponse(readingsCsv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${readingsCsvFilename(now)}"`,
          "Cache-Control": "no-store",
          "X-Total-Count": String(total),
          "X-Truncated": total > rows.length ? "1" : "0",
        },
      })
    }

    let total = 0
    let raw: RawReading[] = []
    if (!empty) {
      const offset = (query.page - 1) * READINGS_PAGE_SIZE
      const res = await ordered(offset, offset + READINGS_PAGE_SIZE - 1)
      if (res.error) {
        // 마지막 쪽을 넘긴 page 는 PostgREST 가 범위 오류(PGRST103)로 답한다 — 빈 쪽으로 본다.
        if ((res.error as { code?: string }).code !== "PGRST103") throw res.error
        const head = await q<null>(base(true))
        if (head.error) throw head.error
        total = head.count ?? 0
      } else {
        total = res.count ?? 0
        raw = res.data ?? []
      }
    }

    const body: AdminReadingsResponse = {
      total,
      page: query.page,
      page_size: READINGS_PAGE_SIZE,
      rows: await enrich(admin, raw),
      has_source_column: hasSource,
      ...(scope ? { scope } : {}),
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("[admin/readings]", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
