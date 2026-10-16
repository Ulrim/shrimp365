import { NextRequest, NextResponse, after } from "next/server"
import { authorizeControl } from "@/lib/control-auth"
import { createAdminClient } from "@/lib/supabase-server"
import {
  GEOCODE_MAX_PER_REQUEST, geocodePriority, isMissingTable, normalizeAddress, pickFarmCoord,
  refreshFarmGeocodes, type GeocodeCacheRow,
} from "@/lib/geocode"

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
    type FarmRow = { id: string; user_id: string; name: string; location: string; latitude: number | null; longitude: number | null; farm_type?: string | null }
    type TankRow = { id: string; farm_id: string; name: string; status: string }
    type DeviceRow = { id: string; tank_id: string; name: string; active: boolean; last_seen_at: string | null; serial: string | null; agent_version: string | null; latitude?: number | null; longitude?: number | null }
    type ProfileRow = { id: string; name: string | null }

    const [farmRows, tanks, devices, profileRows, alertsRes, geocodes] = await Promise.all([
      // farm_type 은 스마트팜 마이그레이션 전 DB 에 없다 — 없으면 빼고 다시 읽고
      // 모두 양식장으로 본다(장비 좌표 조회와 같은 재시도).
      (async () => {
        try {
          return await fetchAll<FarmRow>((f, t) => admin.from("farms")
            .select("id, user_id, name, location, latitude, longitude, farm_type").range(f, t))
        } catch {
          return await fetchAll<FarmRow>((f, t) => admin.from("farms")
            .select("id, user_id, name, location, latitude, longitude").range(f, t))
        }
      })(),
      fetchAll<TankRow>((f, t) => admin.from("tanks").select("id, farm_id, name, status").range(f, t)),
      // 장비 좌표(latitude/longitude)는 마이그레이션 전이면 컬럼이 없어
      // 조회가 통째로 실패한다. 그 경우 좌표 없이 다시 읽는다.
      (async () => {
        try {
          return await fetchAll<DeviceRow>((f, t) => admin.from("sensor_devices")
            .select("id, tank_id, name, active, last_seen_at, serial, agent_version, latitude, longitude").range(f, t))
        } catch {
          return await fetchAll<DeviceRow>((f, t) => admin.from("sensor_devices")
            .select("id, tank_id, name, active, last_seen_at, serial, agent_version").range(f, t))
        }
      })(),
      fetchAll<ProfileRow>((f, t) => admin.from("profiles").select("id, name").range(f, t)),
      // 알림은 최근 30건만 보여 주므로 페이지네이션이 필요 없다.
      admin.from("alerts")
        .select("id, tank_id, type, parameter, value, message, created_at, tank:tanks!alerts_tank_id_fkey(name, farm:farms!tanks_farm_id_fkey(name))")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(30),
      // 주소 지오코딩 캐시(설계서 2-2). 테이블이 아직 없으면(farm_geocodes.sql 미실행)
      // null — 지오코딩을 통째로 건너뛰고 1·2단계 좌표만 쓴다. 그 밖의 오류도
      // 관제 화면을 막지 않도록 같은 길로 보낸다.
      (async () => {
        try {
          return await fetchAll<GeocodeCacheRow>((f, t) => admin.from("farm_geocodes")
            .select("farm_id, query, latitude, longitude, precision, geocoded_at").range(f, t))
        } catch (e) {
          if (!isMissingTable(e)) console.warn("[control/overview] farm_geocodes 조회 실패", (e as { code?: string })?.code ?? "")
          return null
        }
      })(),
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

    // 지도 팝업에 보여 줄 대표 수조 1개의 최신 수질.
    // 대표는 "지금 가장 급한 수조" — 위험 > 주의 > 정상 순으로 고른다.
    const STATUS_RANK: Record<string, number> = { danger: 0, warning: 1, active: 2, inactive: 3 }
    const repTankByFarm = new Map<string, TankRow>()
    for (const [farmId, list] of tanksByFarm) {
      const rep = [...list].sort((a, b) =>
        (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name))[0]
      if (rep) repTankByFarm.set(farmId, rep)
    }
    type WqRow = {
      temperature: number | null; ph: number | null
      do_level: number | null; salinity: number | null; recorded_at: string
    }
    const wqByFarm = new Map<string, WqRow>()
    await Promise.all([...repTankByFarm.entries()].map(async ([farmId, tank]) => {
      const { data } = await admin
        .from("water_quality_readings")
        .select("temperature, ph, do_level, salinity, recorded_at")
        .eq("tank_id", tank.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) wqByFarm.set(farmId, data as WqRow)
    }))

    const farmTypeOf = (f: FarmRow) => (f.farm_type === "agriculture" ? "agriculture" : "shrimp") as "shrimp" | "agriculture"
    const geocodeByFarm = new Map((geocodes ?? []).map(g => [g.farm_id, g]))
    // 응답 뒤에 주소를 찾을 농장(1·2단계 좌표가 없고, 캐시가 없거나 낡은 곳).
    const toGeocode: { farm_id: string; location: string; rank: number }[] = []

    const farms = farmRows.map(f => {
      const own = tanksByFarm.get(f.id) ?? []
      const ownDevices = own.flatMap(t => devicesByTank.get(t.id) ?? [])
      const activeDevices = ownDevices.filter(d => d.active)
      const offline = activeDevices.filter(d =>
        !d.last_seen_at || now - new Date(d.last_seen_at).getTime() > OFFLINE_AFTER_MS
      ).length
      // 좌표 3단계: 농가 입력 → 장비 평균 → 주소 캐시(설계서 2-1). 읽기만 한다.
      const query = normalizeAddress(f.location)
      const cached = geocodeByFarm.get(f.id)
      const coord = pickFarmCoord(f, activeDevices, cached, query)
      if (geocodes && !coord) {
        const rank = geocodePriority(cached, query, now)
        if (rank !== null) toGeocode.push({ farm_id: f.id, location: f.location, rank })
      }
      return {
        id: f.id,
        name: f.name,
        owner: nameOf.get(f.user_id) || "이름 없음",
        location: f.location,
        farm_type: farmTypeOf(f),
        latitude: coord?.latitude ?? null,
        longitude: coord?.longitude ?? null,
        coord_source: coord?.source ?? null,
        ...(coord?.precision ? { coord_precision: coord.precision } : {}),
        has_sensor: activeDevices.length > 0,
        tanks: own.length,
        danger: own.filter(t => t.status === "danger").length,
        warning: own.filter(t => t.status === "warning").length,
        devices: ownDevices.length,
        offline,
        rep_tank: repTankByFarm.get(f.id)?.name ?? null,
        wq: wqByFarm.get(f.id) ?? null,
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

    // 좌표가 기록된 장비 — 지도에 장비별 마커로 찍는다.
    // (페어링 때 휴대폰 위치로 기록되며, 예전에 연결한 장비는 좌표가 없을 수 있다.)
    const tankById = new Map(tanks.map(t => [t.id, t]))
    const farmById = new Map(farmRows.map(f => [f.id, f]))
    const device_markers = devices
      .filter(d => d.active && typeof d.latitude === "number" && typeof d.longitude === "number")
      .map(d => {
        const tank = tankById.get(d.tank_id)
        const farm = tank ? farmById.get(tank.farm_id) : undefined
        const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : null
        return {
          id: d.id,
          name: d.name,
          latitude: d.latitude!,
          longitude: d.longitude!,
          online: !!(seen && now - seen <= OFFLINE_AFTER_MS),
          last_seen_at: d.last_seen_at,
          tank_name: tank?.name ?? "",
          farm_name: farm?.name ?? "",
          farm_id: farm?.id ?? null,
          farm_type: farm ? farmTypeOf(farm) : "shrimp",
        }
      })

    // 지오코딩은 응답을 늦추지 않는다 — 응답을 보낸 뒤 최대 10곳만 찾아 캐시에
    // 넣고, 다음 새로고침부터 지도에 보인다. service_role 은 서버 안에서만 쓴다.
    if (toGeocode.length) {
      const batch = toGeocode
        .sort((a, b) => a.rank - b.rank)
        .slice(0, GEOCODE_MAX_PER_REQUEST)
        .map(({ farm_id, location }) => ({ farm_id, location }))
      after(async () => {
        try {
          await refreshFarmGeocodes(createAdminClient(), batch)
        } catch (e) {
          console.warn("[control/overview] 지오코딩 실패", e instanceof Error ? e.message : "")
        }
      })
    }

    return NextResponse.json({
      role: auth.role,
      device_markers,
      stats: {
        farms: farms.length,
        farms_located: farms.filter(f => f.coord_source !== null).length,
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
