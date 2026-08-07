import { NextRequest, NextResponse } from "next/server"
import { authorizeControl } from "@/lib/control-auth"

// 관제센터 데이터. 플랫폼 전체(모든 사용자)의 농장·수조·기기·알림을 모아 준다.
//
// RLS 는 사용자를 자기 농장에 가두므로, 전체를 보려면 service role 로
// 조회해야 한다. 그래서 이 경로의 권한 확인(authorizeControl)이 곧 이
// 데이터의 유일한 방어선이다 — 확인 없이 조기 반환하는 분기가 있어서는 안 된다.

// 측정 주기가 1분이므로, 5분 넘게 소식이 없으면 끊긴 것으로 본다.
const OFFLINE_AFTER_MS = 5 * 60_000

// Supabase 는 한 번에 최대 1000행만 준다. 플랫폼 전체 관제 화면은 농장·수조·
// 기기가 그보다 많을 수 있는데, 그냥 조회하면 1000번째 이후가 조용히 잘려
// 위험 농장이 지도에서 사라진다. 범위를 나눠 끝까지 읽는다.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break   // 마지막 페이지
  }
  return out
}

export async function GET(req: NextRequest) {
  const auth = await authorizeControl(req)
  if (!auth.ok) return auth.res
  const { admin } = auth

  try {
    // last_payload 는 여기서 쓰지 않으므로 빼서 전송량을 줄인다(큰 JSON 일 수 있음).
    type FarmRow = { id: string; user_id: string; name: string; location: string; latitude: number | null; longitude: number | null }
    type TankRow = { id: string; farm_id: string; name: string; status: string }
    type DeviceRow = { id: string; tank_id: string; name: string; active: boolean; last_seen_at: string | null; serial: string | null; agent_version: string | null }
    type ProfileRow = { id: string; name: string | null }

    const [farmRows, tanks, devices, profileRows, alertsRes] = await Promise.all([
      fetchAll<FarmRow>((f, t) => admin.from("farms").select("id, user_id, name, location, latitude, longitude").range(f, t)),
      fetchAll<TankRow>((f, t) => admin.from("tanks").select("id, farm_id, name, status").range(f, t)),
      fetchAll<DeviceRow>((f, t) => admin.from("sensor_devices").select("id, tank_id, name, active, last_seen_at, serial, agent_version").range(f, t)),
      fetchAll<ProfileRow>((f, t) => admin.from("profiles").select("id, name").range(f, t)),
      // 알림은 최근 30건만 보여 주므로 페이지네이션이 필요 없다.
      admin.from("alerts")
        .select("id, tank_id, type, parameter, value, message, created_at, tank:tanks!alerts_tank_id_fkey(name, farm:farms!tanks_farm_id_fkey(name))")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(30),
    ])

    const nameOf = new Map(profileRows.map(p => [p.id, p.name || ""]))
    const now = Date.now()

    const tanksByFarm = new Map<string, typeof tanks>()
    for (const t of tanks) {
      const list = tanksByFarm.get(t.farm_id) ?? []
      list.push(t)
      tanksByFarm.set(t.farm_id, list)
    }
    const devicesByTank = new Map<string, typeof devices>()
    for (const d of devices) {
      const list = devicesByTank.get(d.tank_id) ?? []
      list.push(d)
      devicesByTank.set(d.tank_id, list)
    }

    const farms = farmRows.map(f => {
      const own = tanksByFarm.get(f.id) ?? []
      const ownDevices = own.flatMap(t => devicesByTank.get(t.id) ?? [])
      const offline = ownDevices.filter(d =>
        d.active && (!d.last_seen_at || now - new Date(d.last_seen_at).getTime() > OFFLINE_AFTER_MS)
      ).length
      return {
        id: f.id,
        name: f.name,
        owner: nameOf.get(f.user_id) || "이름 없음",
        location: f.location,
        latitude: f.latitude,
        longitude: f.longitude,
        tanks: own.length,
        danger: own.filter(t => t.status === "danger").length,
        warning: own.filter(t => t.status === "warning").length,
        devices: ownDevices.length,
        offline,
      }
    })

    const deviceRows = devices.map(d => {
      const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : null
      return {
        id: d.id,
        name: d.name,
        serial: d.serial,
        version: d.agent_version,
        active: d.active,
        last_seen_at: d.last_seen_at,
        online: !!(d.active && seen && now - seen <= OFFLINE_AFTER_MS),
      }
    })

    return NextResponse.json({
      role: auth.role,
      stats: {
        farms: farms.length,
        tanks: tanks.length,
        tank_status: {
          active: tanks.filter(t => t.status === "active").length,
          warning: tanks.filter(t => t.status === "warning").length,
          danger: tanks.filter(t => t.status === "danger").length,
          inactive: tanks.filter(t => t.status === "inactive").length,
        },
        devices: deviceRows.filter(d => d.active).length,
        devices_online: deviceRows.filter(d => d.online).length,
        open_alerts: (alertsRes.data ?? []).length,
      },
      farms,
      offline_devices: deviceRows.filter(d => d.active && !d.online),
      alerts: (alertsRes.data ?? []).map(a => {
        const tank = (Array.isArray(a.tank) ? a.tank[0] : a.tank) as
          | { name?: string; farm?: { name?: string } | { name?: string }[] } | null
        const farm = tank && (Array.isArray(tank.farm) ? tank.farm[0] : tank.farm)
        return {
          id: a.id,
          type: a.type,
          parameter: a.parameter,
          value: a.value,
          message: a.message,
          created_at: a.created_at,
          tank_name: tank?.name ?? "",
          farm_name: (farm as { name?: string } | null)?.name ?? "",
        }
      }),
    })
  } catch (e) {
    console.error("[control/overview]", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "데이터를 불러오지 못했습니다." }, { status: 500 })
  }
}
