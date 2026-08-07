import { NextRequest, NextResponse } from "next/server"
import { authorizeControl } from "@/lib/control-auth"

// 관제센터 데이터. 플랫폼 전체(모든 사용자)의 농장·수조·기기·알림을 모아 준다.
//
// RLS 는 사용자를 자기 농장에 가두므로, 전체를 보려면 service role 로
// 조회해야 한다. 그래서 이 경로의 권한 확인(authorizeControl)이 곧 이
// 데이터의 유일한 방어선이다 — 확인 없이 조기 반환하는 분기가 있어서는 안 된다.

// 측정 주기가 1분이므로, 5분 넘게 소식이 없으면 끊긴 것으로 본다.
const OFFLINE_AFTER_MS = 5 * 60_000

export async function GET(req: NextRequest) {
  const auth = await authorizeControl(req)
  if (!auth.ok) return auth.res
  const { admin } = auth

  try {
    const [farmsRes, tanksRes, devicesRes, alertsRes, profilesRes] = await Promise.all([
      admin.from("farms").select("id, user_id, name, location, latitude, longitude"),
      admin.from("tanks").select("id, farm_id, name, status"),
      admin.from("sensor_devices").select("id, tank_id, name, active, last_seen_at, serial, agent_version, last_payload"),
      admin.from("alerts")
        .select("id, tank_id, type, parameter, value, message, created_at, tank:tanks!alerts_tank_id_fkey(name, farm:farms!tanks_farm_id_fkey(name))")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(30),
      admin.from("profiles").select("id, name"),
    ])

    const nameOf = new Map((profilesRes.data ?? []).map(p => [p.id as string, (p.name as string) || ""]))
    const tanks = tanksRes.data ?? []
    const devices = devicesRes.data ?? []
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

    const farms = (farmsRes.data ?? []).map(f => {
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
