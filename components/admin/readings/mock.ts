// 테스트·모니터 계정용 수질 기록 목데이터 — API 를 부르지 않는다.
//
// 사용자·농장·수조·장비 이름은 사용자 목록(MOCK_ADMIN_STATS)과 사용자 상세 목데이터
// (user-detail/mock.ts)의 규칙을 따라 화면끼리 어긋나지 않게 한다. 수기·센서·수기(추정)
// 이 섞인 30건이고, 수기 몇 건은 빈 칸을 0 으로 저장하던 이력과 사후 입력을 흉내 낸다.
import { MOCK_ADMIN_STATS } from "@/lib/mock-data"
import type { WqSourceKind } from "@/lib/wq-source"
import { wqSourceMatches } from "@/lib/wq-source"
import {
  READINGS_PAGE_SIZE, filterRange,
  type AdminReadingRow, type AdminReadingsResponse, type AdminReadingsScope, type ReadingsFilter, type WqValues,
} from "@/lib/admin-readings"

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const KST = 9 * HOUR

type MockFarm = AdminReadingsScope["farms"][number] & { owner_id: string; owner_name: string; devices: Record<string, string> }

/** 결정적 의사난수(0~1) — 새로고침해도 같은 값. */
function rand(n: number, k: number): number {
  const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

function mockFarms(): MockFarm[] {
  return MOCK_ADMIN_STATS.users.filter(u => u.farm_count > 0).flatMap(u => {
    const seed = Number(u.id.replace(/\D/g, "")) || 1
    return Array.from({ length: Math.min(u.farm_count, 3) }, (_, i) => {
      const id = `${u.id}-farm-${i + 1}`
      // 사용자 상세 목데이터와 같다 — mock-user-5 의 셋째 농장이 스마트팜.
      const agri = seed === 5 && i === 2
      const tanks = Array.from({ length: 2 }, (_, k) => ({
        id: `${id}-tank-${k + 1}`,
        name: `${String.fromCharCode(65 + k)}-${i + 1}조`,
      }))
      return {
        id,
        name: `제${i + 1}양식장`,
        farm_type: agri ? "agriculture" as const : "shrimp" as const,
        tanks,
        owner_id: u.id,
        owner_name: u.name,
        // 센서는 각 농장 첫 수조에만 — 둘째 수조는 수기로만 적는 곳.
        devices: { [tanks[0].id]: `수질센서 ${i + 1}-1` },
      }
    })
  })
}

function values(n: number, agri: boolean, kind: WqSourceKind): WqValues {
  const r = (k: number) => rand(n, k)
  // 수기 폼은 빈 칸을 0 으로 저장했다 — 몇 건은 그 흔적을 남긴다.
  const blank = kind === "manual" && n % 2 === 0
  if (agri) {
    return {
      temperature: round(20 + r(1) * 4, 1),
      ph: round(5.8 + r(2) * 0.6, 2),
      do_level: round(7 + r(3), 1),
      salinity: 0,
      ammonia: 0, nitrite: 0, nitrate: 0, alkalinity: 0, turbidity: 0,
      conductivity: round(1200 + r(4) * 600, 0),
      flow_rate: kind === "sensor" ? round(4 + r(5) * 2, 1) : null,
      diff_pressure: kind === "sensor" ? round(10 + r(6) * 8, 1) : null,
    }
  }
  return {
    temperature: round(26 + r(1) * 4, 1),
    ph: round(7.6 + r(2) * 0.8, 2),
    do_level: round(4.6 + r(3) * 2.8, 1),
    salinity: round(15 + r(4) * 15, 1),
    ammonia: blank ? 0 : round(0.05 + r(5) * 0.45, 2),
    nitrite: blank ? 0 : round(0.02 + r(6) * 0.3, 2),
    nitrate: blank ? 0 : round(2 + r(7) * 18, 1),
    alkalinity: blank ? 0 : round(100 + r(8) * 50, 0),
    turbidity: kind === "sensor" ? round(10 + r(9) * 30, 1) : 0,
    conductivity: null,
    flow_rate: null,
    diff_pressure: null,
  }
}

/** 30건 — 수기 12 · 센서 12 · 수기(추정) 6, 최근 29일에 고르게. */
export function buildMockReadings(now: number): AdminReadingRow[] {
  const farms = mockFarms()
  const todayKst = Math.floor((now + KST) / DAY) * DAY - KST   // 오늘 0시(KST)
  return Array.from({ length: 30 }, (_, n): AdminReadingRow => {
    const kind: WqSourceKind = n % 5 === 4 ? "manual_guess" : n % 2 === 0 ? "manual" : "sensor"
    // 농장을 한 칸씩 밀어 가며 고른다 — 짝홀(수기·센서)이 한 농장에 몰리지 않게.
    const farm = farms[(n + Math.floor(n / farms.length)) % farms.length]
    const tank = kind === "sensor" ? farm.tanks[0] : farm.tanks[n % 2]
    let recorded: number
    let created: number
    if (kind === "manual") {
      // 날짜만 고르는 폼 — 그날 12:00(KST)로 저장된다. 몇 건은 며칠 뒤에 적었다.
      recorded = todayKst - Math.floor(n * 0.95) * DAY + 12 * HOUR
      created = recorded + (n % 6 === 0 ? (2 + (n % 3)) * DAY : 3 * HOUR + Math.round(rand(n, 11) * 5 * HOUR))
      created = Math.min(created, now - 5 * MIN)
      recorded = Math.min(recorded, created)
    } else if (kind === "sensor") {
      recorded = now - Math.round(n * 0.9 * DAY) - Math.round(rand(n, 12) * 50) * MIN - 3 * MIN
      created = recorded + 2_000
    } else {
      // device_id 이전 옛 기록 — 분 단위 시각(센서였을 수도 있다).
      recorded = now - (18 + (n % 11)) * DAY - Math.round(rand(n, 13) * 600) * MIN
      created = recorded + 1_500
    }
    const agri = farm.farm_type === "agriculture"
    return {
      id: `mock-wq-${n + 1}`,
      recorded_at: new Date(recorded).toISOString(),
      created_at: new Date(created).toISOString(),
      source_kind: kind,
      ...(kind === "sensor" ? { device_name: farm.devices[tank.id] } : {}),
      tank_id: tank.id,
      tank_name: tank.name,
      farm_id: farm.id,
      farm_name: farm.name,
      farm_type: farm.farm_type,
      owner_id: farm.owner_id,
      owner_name: farm.owner_name,
      values: values(n, agri, kind),
    }
  }).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
}

/** 화면 필터를 목데이터에 그대로 적용한다 — 서버와 같은 규칙(수조 범위·출처·기간·쪽). */
export function mockReadingsResponse(f: ReadingsFilter, now: number): { response: AdminReadingsResponse; all: AdminReadingRow[] } {
  const { from, to } = filterRange(f, now)
  const all = buildMockReadings(now).filter(r => {
    const t = Date.parse(r.recorded_at)
    return (!f.user || r.owner_id === f.user)
      && (!f.farm || r.farm_id === f.farm)
      && (!f.tank || r.tank_id === f.tank)
      && wqSourceMatches(r.source_kind, f.source)
      && t >= from && (to === null || t < to)
  })
  const offset = (f.page - 1) * READINGS_PAGE_SIZE
  const scope: AdminReadingsScope | undefined = f.user
    ? { farms: mockFarms().filter(m => m.owner_id === f.user).map(({ id, name, farm_type, tanks }) => ({ id, name, farm_type, tanks })) }
    : undefined
  return {
    all,
    response: {
      total: all.length,
      page: f.page,
      page_size: READINGS_PAGE_SIZE,
      rows: all.slice(offset, offset + READINGS_PAGE_SIZE),
      has_source_column: true,
      ...(scope ? { scope } : {}),
    },
  }
}
