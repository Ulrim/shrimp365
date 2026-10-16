// 테스트·모니터 계정용 사용자 상세 목데이터.
//
// 그 계정의 사용자 목록은 admin-stats.ts 가 MOCK_ADMIN_STATS(mock-user-*)로 그린다.
// 상세도 같은 행에서 숫자(농장·수조·가동·알림 수)를 이어받아 목록과 어긋나지 않게
// 만든다. API 는 부르지 않는다.
import { MOCK_ADMIN_STATS } from "@/lib/mock-data"
import type { AdminUserDetail, TankStatusCounts } from "@/components/admin/user-detail/types"

const MIN = 60_000
const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const REGIONS = ["전남 무안군 해제면", "충남 태안군 남면", "전북 고창군 심원면", "경북 포항시 남구", "전남 신안군 지도읍"]
const PROVIDERS: Record<string, string[]> = {
  "mock-user-1": ["email"],
  "mock-user-2": ["email", "google"],
  "mock-user-3": ["kakao"],
  "mock-user-4": ["naver"],
  "mock-user-5": ["google"],
  "mock-user-6": ["email"],
}

/** 수조 total 개를 농장 n 곳에 고르게 나눈다(앞 농장이 하나씩 더). */
function split(total: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0))
}

export function buildMockUserDetail(id: string): AdminUserDetail | null {
  const row = MOCK_ADMIN_STATS.users.find(u => u.id === id)
  if (!row) return null
  const seed = Number(id.replace(/\D/g, "")) || 1

  // 농장별 수조 — 목록의 가동/전체 수와 알림 수를 상태로 나눠 담는다.
  const tankSplit = split(row.tank_count, row.farm_count)
  const activeSplit = split(row.active_tanks, row.farm_count)
  let alertsLeft = row.alert_count
  const farms: AdminUserDetail["farms"] = tankSplit.map((total, i) => {
    const active = Math.min(activeSplit[i], total)
    const rest = total - active
    const danger = Math.min(rest, alertsLeft > 2 ? 1 : 0)
    const warning = Math.min(rest - danger, alertsLeft > 0 ? 1 : 0)
    alertsLeft = Math.max(0, alertsLeft - danger - warning)
    const counts: TankStatusCounts = { total, active, warning, danger, inactive: rest - danger - warning }
    return {
      id: `${id}-farm-${i + 1}`,
      name: `제${i + 1}양식장`,
      farm_type: seed === 5 && i === 2 ? "agriculture" : "shrimp",
      location: REGIONS[(seed + i) % REGIONS.length],
      has_coords: i === 0,
      created_at: new Date(new Date(row.joined_at).getTime() + (i + 1) * 3 * DAY).toISOString(),
      tanks: counts,
    }
  })

  // 장비 — 농장마다 1~2대, 하나는 끊긴 상태로 둬 표의 두 상태가 다 보이게.
  const devices: AdminUserDetail["devices"] = farms.flatMap((f, i) => {
    const n = Math.min(f.tanks.total, i === 0 ? 2 : 1)
    return Array.from({ length: n }, (_, k) => {
      const online = !(i === 0 && k === 1)
      return {
        id: `${f.id}-dev-${k + 1}`,
        name: `수질센서 ${i + 1}-${k + 1}`,
        farm_id: f.id,
        farm_name: f.name,
        tank_id: `${f.id}-tank-${k + 1}`,
        tank_name: `${String.fromCharCode(65 + k)}-${i + 1}조`,
        active: true,
        serial: `S365-${String(seed).padStart(2, "0")}${i}${k}-A1`,
        version: online ? "1.4.2" : "1.3.0",
        last_seen_at: online ? ago((k + 1) * MIN) : ago(3 * 3_600_000),
        online,
      }
    })
  })

  const alertSamples: Omit<AdminUserDetail["alerts"]["recent"][number], "id" | "created_at" | "tank_name" | "farm_name">[] = [
    { type: "danger", parameter: "DO", message: "용존산소가 3.2mg/L 로 위험 기준(4.0) 아래입니다", resolved: false },
    { type: "warning", parameter: "수온", message: "수온이 31.5°C 로 주의 기준(31.0)을 넘었습니다", resolved: false },
    { type: "warning", parameter: "pH", message: "pH 가 8.9 로 주의 기준(8.8)을 넘었습니다", resolved: false },
    { type: "danger", parameter: "암모니아", message: "암모니아가 1.2mg/L 로 위험 기준(1.0)을 넘었습니다", resolved: false },
    { type: "info", parameter: null, message: "장비가 다시 연결되었습니다", resolved: true },
    { type: "warning", parameter: "염분", message: "염분이 12ppt 로 주의 기준(15) 아래입니다", resolved: true },
  ]
  const recentCount = farms.length === 0 ? 0 : Math.min(alertSamples.length, row.alert_count + 2)
  const recent = alertSamples.slice(0, recentCount).map((a, i) => {
    const f = farms[i % farms.length]
    return {
      ...a,
      resolved: i >= row.alert_count,
      id: `${id}-alert-${i + 1}`,
      created_at: ago((i + 1) * 47 * MIN),
      tank_name: `${String.fromCharCode(65 + (i % 3))}-${(i % farms.length) + 1}조`,
      farm_name: f.name,
    }
  })

  const hasTanks = row.tank_count > 0
  return {
    account: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      plan: row.plan,
      ui_mode: seed === 5 ? "agriculture" : "shrimp",
      created_at: row.joined_at,
      last_sign_in_at: row.last_login ?? null,
      email_confirmed: seed !== 6,
      providers: PROVIDERS[id] ?? ["email"],
      is_super_admin: false,
    },
    farms,
    devices,
    alerts: { open_count: row.alert_count, recent },
    activity: {
      readings_30d: hasTanks ? row.active_tanks * 30 * 24 : 0,
      last_reading_at: hasTanks ? ago(2 * MIN) : null,
      journal_count: hasTanks ? row.tank_count * 18 : 0,
      last_journal_date: hasTanks ? ago(DAY).split("T")[0] : null,
    },
    viewer_links: seed === 2 ? [{ farm_id: "mock-user-1-farm-1", farm_name: "제1양식장", owner_name: "김양식" }] : [],
  }
}
