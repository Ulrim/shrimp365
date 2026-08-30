import { Farm, Tank, WaterQualityReading, JournalEntry, DiagnosisResult, Alert, SensorDevice, ProductionCycle, GrowthSample, CycleCost, CycleHarvest, InventoryItem, InventoryTransaction } from "@/types"
import { checkMissingInput, MISSING_INPUT_HOURS } from "@/lib/thresholds"

export const MOCK_USER = {
  id: "mock-user-1",
  email: "admin@shrimp365.com",
  name: "김양식",
  role: "admin",
  plan: "pro",
  farm_count: 2,
}

export const TEST_ACCOUNTS = [
  { email: "admin@shrimp365.com",    name: "김양식 (관리자)" },
  { email: "operator@shrimp365.com", name: "이운영 (운영자)" },
  { email: "monitor@shrimp365.com",  name: "모니터 (시스템 관리자)" },
]

export const TEST_EMAILS = ["admin@shrimp365.com", "operator@shrimp365.com", "monitor@shrimp365.com"]

export function isTestAccount(email?: string | null): boolean {
  return TEST_EMAILS.includes(email ?? "")
}

export function isMonitorAccount(email?: string | null): boolean {
  return email === "monitor@shrimp365.com"
}

// ─────────────────────────────────────────────
// 관리자 모니터링용 통계 데이터
// ─────────────────────────────────────────────
export interface AdminUserRow {
  id: string
  email: string
  name: string
  role: string
  plan: string
  farm_count: number
  tank_count: number
  active_tanks: number
  alert_count: number
  joined_at: string
  last_login?: string | null
}

export const MOCK_ADMIN_STATS = {
  users: [
    { id: "mock-user-1", email: "admin@shrimp365.com",    name: "김양식",   role: "admin",    plan: "pro",    farm_count: 2, tank_count: 12, active_tanks: 8,  alert_count: 4, joined_at: "2024-01-15T00:00:00Z", last_login: "2026-08-10T01:20:00Z" },
    { id: "mock-user-2", email: "operator@shrimp365.com", name: "이운영",   role: "farmer",   plan: "basic",  farm_count: 1, tank_count: 5,  active_tanks: 4,  alert_count: 1, joined_at: "2024-03-10T00:00:00Z", last_login: "2026-08-09T22:05:00Z" },
    { id: "mock-user-3", email: "park@aqua.kr",           name: "박수산",   role: "farmer",   plan: "free",   farm_count: 1, tank_count: 3,  active_tanks: 3,  alert_count: 0, joined_at: "2024-05-20T00:00:00Z", last_login: "2026-08-08T09:41:00Z" },
    { id: "mock-user-4", email: "choi@sea.kr",            name: "최새우",   role: "farmer",   plan: "basic",  farm_count: 1, tank_count: 8,  active_tanks: 6,  alert_count: 2, joined_at: "2024-02-28T00:00:00Z", last_login: "2026-07-30T14:12:00Z" },
    { id: "mock-user-5", email: "jung@shrimp.com",        name: "정양식",   role: "farmer",   plan: "pro",    farm_count: 3, tank_count: 20, active_tanks: 18, alert_count: 0, joined_at: "2024-04-01T00:00:00Z", last_login: "2026-08-10T00:03:00Z" },
    { id: "mock-user-6", email: "newuser@test.com",       name: "신규가입자", role: "farmer",   plan: "free",   farm_count: 0, tank_count: 0,  active_tanks: 0,  alert_count: 0, joined_at: "2026-05-12T00:00:00Z", last_login: null },
  ] as AdminUserRow[],
  total_farms: 8,
  total_tanks: 48,
  total_active_alerts: 7,
  tanks_by_status: { active: 39, warning: 4, danger: 3, inactive: 2 },
  plan_distribution: { free: 2, basic: 2, pro: 2, enterprise: 0 },
}

// ─────────────────────────────────────────────
// 날짜 헬퍼
// ─────────────────────────────────────────────
const TODAY = new Date()
const daysAgo  = (n: number) => new Date(TODAY.getTime() - n * 86400000).toISOString().split("T")[0]
const daysAgoZ = (n: number) => new Date(TODAY.getTime() - n * 86400000).toISOString()

// ─────────────────────────────────────────────
// 농장
// ─────────────────────────────────────────────
export const MOCK_FARMS: Farm[] = [
  {
    id: "farm-1",
    user_id: "mock-user-1",
    name: "제1양식장",
    location: "전남 여수시 돌산읍",
    latitude: 34.6667, longitude: 127.7614,
    owner_name: "김양식",
    area: 5000,
    tank_count: 8,
    created_at: "2024-01-15T00:00:00Z",
  },
  {
    id: "farm-2",
    user_id: "mock-user-1",
    name: "제2양식장",
    location: "전남 고흥군 도화면",
    latitude: 34.5147, longitude: 127.2856,
    owner_name: "김양식",
    area: 3200,
    tank_count: 4,
    created_at: "2024-03-20T00:00:00Z",
  },
]

// ─────────────────────────────────────────────
// 수조 (제1양식장 8개 + 제2양식장 4개)
// ─────────────────────────────────────────────
export const MOCK_TANKS: Tank[] = [
  // 제1양식장
  { id: "tank-1", farm_id: "farm-1", name: "A-1조", volume: 500, status: "active",   stocking_density: 120, shrimp_count: 42000, cycle_day: 55, stocking_date: daysAgo(55), tank_type: "실내",  created_at: "2024-01-20T00:00:00Z" },
  { id: "tank-2", farm_id: "farm-1", name: "A-2조", volume: 500, status: "active",   stocking_density: 115, shrimp_count: 40950, cycle_day: 38, stocking_date: daysAgo(38), tank_type: "실내",  created_at: "2024-01-20T00:00:00Z" },
  { id: "tank-3", farm_id: "farm-1", name: "B-1조", volume: 500, status: "active",   stocking_density: 108, shrimp_count: 38400, cycle_day: 18, stocking_date: daysAgo(18), tank_type: "노지",  created_at: "2024-02-15T00:00:00Z" },
  { id: "tank-4", farm_id: "farm-1", name: "B-2조", volume: 500, status: "warning",  stocking_density: 110, shrimp_count: 41800, cycle_day: 62, stocking_date: daysAgo(62), tank_type: "노지",  created_at: "2024-02-15T00:00:00Z" },
  { id: "tank-5", farm_id: "farm-1", name: "C-1조", volume: 500, status: "active",   stocking_density: 100, shrimp_count: 46500, cycle_day: 72, stocking_date: daysAgo(72), tank_type: "반실내", created_at: "2024-03-01T00:00:00Z" },
  { id: "tank-6", farm_id: "farm-1", name: "C-2조", volume: 500, status: "danger",   stocking_density: 95,  shrimp_count: 44200, cycle_day: 72, stocking_date: daysAgo(72), tank_type: "반실내", created_at: "2024-03-01T00:00:00Z" },
  { id: "tank-7", farm_id: "farm-1", name: "D-1조", volume: 500, status: "active",   stocking_density: 125, shrimp_count: 59000, cycle_day: 29, stocking_date: daysAgo(29), tank_type: "실내",  created_at: "2024-01-20T00:00:00Z" },
  { id: "tank-8", farm_id: "farm-1", name: "D-2조", volume: 500, status: "inactive", stocking_density: 0,   shrimp_count: 0,     cycle_day: 0,  stocking_date: null,         tank_type: "실내",  created_at: "2024-01-20T00:00:00Z" },
  // 제2양식장
  { id: "tank-9",  farm_id: "farm-2", name: "E-1조", volume: 400, status: "active",   stocking_density: 110, shrimp_count: 42240, cycle_day: 42, stocking_date: daysAgo(42), tank_type: "실내",  created_at: "2024-03-25T00:00:00Z" },
  { id: "tank-10", farm_id: "farm-2", name: "E-2조", volume: 400, status: "active",   stocking_density: 105, shrimp_count: 40320, cycle_day: 42, stocking_date: daysAgo(42), tank_type: "실내",  created_at: "2024-03-25T00:00:00Z" },
  { id: "tank-11", farm_id: "farm-2", name: "F-1조", volume: 400, status: "warning",  stocking_density: 118, shrimp_count: 45000, cycle_day: 58, stocking_date: daysAgo(58), tank_type: "노지",  created_at: "2024-03-25T00:00:00Z" },
  { id: "tank-12", farm_id: "farm-2", name: "F-2조", volume: 400, status: "inactive", stocking_density: 0,   shrimp_count: 0,     cycle_day: 0,  stocking_date: null,         tank_type: "노지",  created_at: "2024-03-25T00:00:00Z" },
]

// ─────────────────────────────────────────────
// 수질 데이터
// ─────────────────────────────────────────────
/** 목데이터는 언제 열어도 같아야 한다.
 *
 *  Math.random() 을 쓰면 시연할 때마다 화면이 달라지고, 이상징후 판정도 뜰 때가
 *  있고 안 뜰 때가 있다. 증빙 캡처는 재현되어야 하므로 tankId 로 씨앗을 고정한다. */
function seeded(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6D2B79F5
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 시연용 수질 기록을 만든다.
 *
 *  opts 의 앞 세 개(lowDo·highTurbidity·highAmmonia)는 **임계값 초과** 상황이라
 *  알림함과 수조 상태 뱃지를 보여 준다. 뒤 세 개는 **임계값을 넘기 전** 상황이라
 *  이상징후 탐지(lib/thresholds.ts) 화면을 보여 준다 — 이 둘은 다른 기능이고,
 *  데모 계정에 둘 다 있어야 각각을 캡처할 수 있다.
 *
 *  이상징후 시나리오 구간은 잡음을 넣지 않는다. 잡음이 한 걸음 폭보다 크면
 *  단조 증가·감소가 끊겨 "연속 악화" 판정이 성립하지 않는다. */
function generateWQ(
  tankId: string,
  days = 7,
  opts: {
    highTurbidity?: boolean
    lowDo?: boolean
    highAmmonia?: boolean
    /** 급변 — 최근 2시간 안에 DO 가 크게 떨어진다(임계값 5.0 은 아직 안 넘음). */
    doSurge?: boolean
    /** 일별 악화 — 날마다 최저 DO 가 내려간다. 하루 주기와 구분되는 신호다. */
    doDailyDecline?: boolean
    /** 연속 악화 — 암모니아가 여러 시간에 걸쳐 꾸준히 오른다(임계값 0.5 미만에서). */
    ammoniaDrift?: boolean
    /** 입력 누락 — 기록 전체를 이만큼 과거로 밀어 마지막 기록이 오래되게 만든다.
     *  값 자체는 건드리지 않는다(씨앗 난수 호출 순서도 그대로). 시각만 옮긴다. */
    staleDays?: number
  } = {},
) {
  const data: WaterQualityReading[] = []
  const rnd = seeded(tankId)
  const now = new Date()
  const staleH = (opts.staleDays ?? 0) * 24
  for (let i = days * 24; i >= 0; i--) {
    const t = new Date(now.getTime() - (i + staleH) * 3600000)
    // 값을 만드는 기준은 옮기지 않은 i 그대로다 — 그래야 staleDays 를 줘도
    // 파형과 난수열이 변하지 않고, 이 수조의 기존 캡처가 그대로 재현된다.
    const hoursAgo = i

    // ── DO ──────────────────────────────────────────────────────────────
    let doLevel: number
    if (opts.doDailyDecline) {
      // 하루 0.45 씩 꾸준히 내려간다. 하루 주기(sin)도 살려 두되 진폭을 하락 폭보다
      // 작게(±0.15) 둔다 — 주기가 하락보다 크면 날짜별 최저값이 오르내려 "연속 악화"가
      // 성립하지 않는다(날짜 경계와 시각이 어긋나기 때문이며, 실제로 그렇게 끊겼다).
      // 시간에 비례해 내리므로 달력 날짜와 무관하게 날마다 바닥이 낮아진다.
      doLevel = 3.95 + (hoursAgo / 24) * 0.45 + Math.sin(hoursAgo / 6) * 0.15
    } else if (opts.doSurge && hoursAgo <= 2) {
      doLevel = 5.05                                   // 6.5 대에서 한 번에 떨어짐
    } else if (opts.lowDo) {
      doLevel = 3.8 + (rnd() - 0.5) * 0.6
    } else {
      doLevel = 6.5 + Math.sin(hoursAgo / 6) * 0.8 + (rnd() - 0.5) * 0.3
    }

    // ── 암모니아 ────────────────────────────────────────────────────────
    let ammonia: number
    if (opts.ammoniaDrift && hoursAgo <= 8) {
      ammonia = 0.09 + (8 - hoursAgo) * 0.045          // 0.09 → 0.45 (임계 0.5 미만)
    } else if (opts.highAmmonia) {
      ammonia = 0.55 + rnd() * 0.2
    } else {
      ammonia = 0.08 + rnd() * 0.12
    }

    data.push({
      id: `wq-${tankId}-${i}`,
      tank_id: tankId,
      temperature: 28 + Math.sin(hoursAgo / 12) * 1.5 + (rnd() - 0.5) * 0.4,
      ph: 7.9 + Math.sin(hoursAgo / 8) * 0.25 + (rnd() - 0.5) * 0.08,
      do_level: doLevel,
      salinity: 20 + (rnd() - 0.5) * 0.5,
      ammonia,
      nitrite: 0.04 + rnd() * 0.06,
      nitrate: 6 + rnd() * 4,
      alkalinity: 125 + (rnd() - 0.5) * 10,
      turbidity: opts.highTurbidity ? 28 + rnd() * 12 : 4 + rnd() * 4,
      recorded_at: t.toISOString(),
      created_at: t.toISOString(),
    })
  }
  return data
}

export const MOCK_WATER_QUALITY: Record<string, WaterQualityReading[]> = {
  "tank-1":  generateWQ("tank-1"),
  "tank-2":  generateWQ("tank-2", 7, { doSurge: true }),          // 이상징후: 급변
  "tank-3":  generateWQ("tank-3"),
  "tank-4":  generateWQ("tank-4", 7, { doDailyDecline: true }),   // 이상징후: 일별 악화 (+ DO 임계 근접)
  "tank-5":  generateWQ("tank-5"),
  "tank-6":  generateWQ("tank-6", 7, { highTurbidity: true }),
  "tank-7":  generateWQ("tank-7", 7, { staleDays: 4 }),   // 입력 누락: 마지막 기록이 4일 전(기준 72시간 초과)
  "tank-8":  generateWQ("tank-8"),
  "tank-9":  generateWQ("tank-9", 7, { ammoniaDrift: true }),     // 이상징후: 연속 악화
  "tank-10": generateWQ("tank-10"),
  "tank-11": generateWQ("tank-11", 7, { highAmmonia: true }),
  "tank-12": generateWQ("tank-12"),
}

export const WATER_QUALITY_STANDARDS = {
  temperature: { min: 25, max: 32, warning_min: 23, warning_max: 34, unit: "°C",   label: "수온" },
  ph:          { min: 7.5, max: 8.5, warning_min: 7.0, warning_max: 9.0, unit: "", label: "pH" },
  do_level:    { min: 5.0, max: 9.0, warning_min: 4.0, warning_max: 10.0, unit: "mg/L", label: "용존산소(DO)" },
  salinity:    { min: 15, max: 35, warning_min: 12, warning_max: 40, unit: "‰", label: "염도" },
  ammonia:     { min: 0, max: 0.5, warning_min: 0, warning_max: 1.0, unit: "mg/L", label: "암모니아" },
  nitrite:     { min: 0, max: 0.1, warning_min: 0, warning_max: 0.5, unit: "mg/L", label: "아질산염" },
  nitrate:     { min: 0, max: 20,  warning_min: 0, warning_max: 40,  unit: "mg/L", label: "질산염" },
  alkalinity:  { min: 100, max: 150, warning_min: 80, warning_max: 180, unit: "mg/L", label: "알칼리도" },
  turbidity:   { min: 0, max: 10, warning_min: 0, warning_max: 20, unit: "NTU",   label: "탁도" },
}

// ─────────────────────────────────────────────
// 알림
// ─────────────────────────────────────────────
export const MOCK_ALERTS: Alert[] = [
  { id: "alert-1", tank_id: "tank-6",  tank_name: "C-2조", type: "danger",  parameter: "turbidity", value: 32.5, threshold: 20,  message: "탁도가 임계치를 초과했습니다. 즉시 환수 또는 여과 점검이 필요합니다", created_at: daysAgoZ(0.02), resolved: false },
  { id: "alert-2", tank_id: "tank-4",  tank_name: "B-2조", type: "danger",  parameter: "do_level",  value: 3.8,  threshold: 5.0, message: "용존산소 농도가 위험 수준입니다. 긴급 산소 공급이 필요합니다",           created_at: daysAgoZ(0.05), resolved: false },
  { id: "alert-3", tank_id: "tank-11", tank_name: "F-1조", type: "warning", parameter: "ammonia",   value: 0.62, threshold: 0.5, message: "암모니아 농도가 주의 수준을 초과했습니다. 환수 및 미생물 투입 권장",       created_at: daysAgoZ(0.1),  resolved: false },
  { id: "alert-4", tank_id: "tank-6",  tank_name: "C-2조", type: "warning", parameter: "ph",        value: 9.1,  threshold: 8.5, message: "pH가 허용 범위를 초과했습니다",                                           created_at: daysAgoZ(0.15), resolved: false },
]

// 입력 누락 알림 — 데모 계정에서도 이 알림을 캡처할 수 있어야 한다(과업지시서 4-2 증빙).
//
// 문구를 손으로 적어 넣지 않고 실제 판정 함수를 그대로 돌린다. 데모 화면에
// 보이는 것과 현장에서 만들어지는 것이 한 글자도 달라지면 증빙으로 못 쓴다.
// tank-7(D-1조) 은 MOCK_WATER_QUALITY 에서 staleDays: 4 로 기록이 4일 전에
// 끊겨 있어, 기준(72시간)을 넘긴 유일한 수조다.
const MISSING_INPUT_DEMO_TANK = MOCK_TANKS.find(t => t.id === "tank-7")
const MISSING_INPUT_DEMO_LAST =
  MOCK_WATER_QUALITY["tank-7"]?.[MOCK_WATER_QUALITY["tank-7"].length - 1]?.recorded_at ?? null
const MISSING_INPUT_DEMO_VERDICT = MISSING_INPUT_DEMO_TANK
  ? checkMissingInput(MISSING_INPUT_DEMO_TANK, MISSING_INPUT_DEMO_LAST)
  : null

if (MISSING_INPUT_DEMO_TANK && MISSING_INPUT_DEMO_VERDICT && MISSING_INPUT_DEMO_LAST) {
  MOCK_ALERTS.push({
    id: "alert-5",
    tank_id: MISSING_INPUT_DEMO_TANK.id,
    tank_name: MISSING_INPUT_DEMO_TANK.name,
    ...MISSING_INPUT_DEMO_VERDICT,
    // 마지막 기록에서 정확히 기준 시간이 지난 순간에 생겼을 알림이다.
    created_at: new Date(
      new Date(MISSING_INPUT_DEMO_LAST).getTime() + MISSING_INPUT_HOURS * 3600000,
    ).toISOString(),
    resolved: false,
  })
}

// ─────────────────────────────────────────────
// 양식일지 (최근 14일, 다양한 수조)
// ─────────────────────────────────────────────
const mkJournal = (overrides: Partial<JournalEntry> & Pick<JournalEntry, "id" | "tank_id" | "tank_name" | "date">): JournalEntry => ({
  feeding_amount: 15, feed_type: "PHOCA 9073S(39%)", feeding_times: 4,
  mortality_count: 30, water_exchange_rate: 10,
  microbial_input: false, microbial_type: undefined, microbial_amount: undefined,
  disinfection: false, disinfection_type: null,
  check_aeration: true, check_filtration: true, check_circulation: true, check_feeding_check: true,
  notes: undefined, created_by: "김양식", created_at: overrides.date + "T09:00:00Z",
  ...overrides,
})

export const MOCK_JOURNALS: JournalEntry[] = [
  // 오늘
  mkJournal({ id: "j-01", tank_id: "tank-1",  tank_name: "A-1조",  date: daysAgo(0),  feeding_amount: 16.5, mortality_count: 45,  microbial_input: true,  microbial_type: "컬리버 1호", microbial_amount: 500,  check_aeration: true, notes: "활동성 양호, 섭이반응 정상" }),
  mkJournal({ id: "j-02", tank_id: "tank-4",  tank_name: "B-2조",  date: daysAgo(0),  feeding_amount: 10.0, mortality_count: 320, water_exchange_rate: 25, disinfection: true, disinfection_type: "차아염소산나트륨 200ppm", check_filtration: false, notes: "DO 저하 지속, 긴급 환수 실시" }),
  mkJournal({ id: "j-03", tank_id: "tank-6",  tank_name: "C-2조",  date: daysAgo(0),  feeding_amount: 9.5,  mortality_count: 280, water_exchange_rate: 30, disinfection: true, disinfection_type: "과산화수소 50ppm", notes: "탁도 상승으로 급이량 감소" }),
  // 어제
  mkJournal({ id: "j-04", tank_id: "tank-2",  tank_name: "A-2조",  date: daysAgo(1),  feeding_amount: 14.0, mortality_count: 25,  microbial_input: true,  microbial_type: "컬리버 2호", microbial_amount: 400,  notes: "성장 양호" }),
  mkJournal({ id: "j-05", tank_id: "tank-5",  tank_name: "C-1조",  date: daysAgo(1),  feeding_amount: 18.5, mortality_count: 40,  water_exchange_rate: 15 }),
  mkJournal({ id: "j-06", tank_id: "tank-9",  tank_name: "E-1조",  date: daysAgo(1),  feeding_amount: 12.5, mortality_count: 35,  microbial_input: true,  microbial_type: "컬리버 1호", microbial_amount: 300,  created_by: "이운영" }),
  // 2일 전
  mkJournal({ id: "j-07", tank_id: "tank-1",  tank_name: "A-1조",  date: daysAgo(2),  feeding_amount: 16.0, mortality_count: 38 }),
  mkJournal({ id: "j-08", tank_id: "tank-3",  tank_name: "B-1조",  date: daysAgo(2),  feeding_amount: 8.0,  mortality_count: 10,  water_exchange_rate: 5, notes: "입식 후 안정화 중" }),
  mkJournal({ id: "j-09", tank_id: "tank-11", tank_name: "F-1조",  date: daysAgo(2),  feeding_amount: 13.0, mortality_count: 120, water_exchange_rate: 20, microbial_input: true, microbial_type: "컬리버 3호", microbial_amount: 500, created_by: "이운영", notes: "암모니아 상승으로 미생물 투입" }),
  // 3일 전
  mkJournal({ id: "j-10", tank_id: "tank-7",  tank_name: "D-1조",  date: daysAgo(3),  feeding_amount: 11.5, mortality_count: 22,  microbial_input: true,  microbial_type: "컬리버 1호", microbial_amount: 300 }),
  mkJournal({ id: "j-11", tank_id: "tank-4",  tank_name: "B-2조",  date: daysAgo(3),  feeding_amount: 11.0, mortality_count: 180, water_exchange_rate: 20, notes: "DO 회복 지연" }),
  mkJournal({ id: "j-12", tank_id: "tank-10", tank_name: "E-2조",  date: daysAgo(3),  feeding_amount: 12.0, mortality_count: 28,  created_by: "이운영" }),
  // 5일 전
  mkJournal({ id: "j-13", tank_id: "tank-1",  tank_name: "A-1조",  date: daysAgo(5),  feeding_amount: 15.5, mortality_count: 55,  microbial_input: true,  microbial_type: "컬리버 1호", microbial_amount: 500, water_exchange_rate: 10 }),
  mkJournal({ id: "j-14", tank_id: "tank-5",  tank_name: "C-1조",  date: daysAgo(5),  feeding_amount: 19.0, mortality_count: 35,  disinfection: true, disinfection_type: "석회 처리", notes: "정기 소독 실시" }),
  mkJournal({ id: "j-15", tank_id: "tank-2",  tank_name: "A-2조",  date: daysAgo(5),  feeding_amount: 13.0, mortality_count: 20 }),
  // 7일 전
  mkJournal({ id: "j-16", tank_id: "tank-5",  tank_name: "C-1조",  date: daysAgo(7),  feeding_amount: 18.0, mortality_count: 50,  water_exchange_rate: 15, feed_type: "PHOCA 9074S(39%)" }),
  mkJournal({ id: "j-17", tank_id: "tank-6",  tank_name: "C-2조",  date: daysAgo(7),  feeding_amount: 12.0, mortality_count: 150, water_exchange_rate: 20, disinfection: true, disinfection_type: "과산화수소 50ppm" }),
  mkJournal({ id: "j-18", tank_id: "tank-9",  tank_name: "E-1조",  date: daysAgo(7),  feeding_amount: 11.5, mortality_count: 30,  created_by: "이운영" }),
  // 10일 전
  mkJournal({ id: "j-19", tank_id: "tank-1",  tank_name: "A-1조",  date: daysAgo(10), feeding_amount: 14.0, mortality_count: 60, microbial_input: true, microbial_type: "컬리버 2호", microbial_amount: 400 }),
  mkJournal({ id: "j-20", tank_id: "tank-4",  tank_name: "B-2조",  date: daysAgo(10), feeding_amount: 13.5, mortality_count: 95, water_exchange_rate: 15, notes: "수질 개선 추세" }),
  // 14일 전
  mkJournal({ id: "j-21", tank_id: "tank-2",  tank_name: "A-2조",  date: daysAgo(14), feeding_amount: 10.5, mortality_count: 15, feed_type: "PHOCA 9072(39%)", notes: "초기 입식 적응 완료" }),
  mkJournal({ id: "j-22", tank_id: "tank-11", tank_name: "F-1조",  date: daysAgo(14), feeding_amount: 14.0, mortality_count: 80, water_exchange_rate: 10, created_by: "이운영" }),
]

// ─────────────────────────────────────────────
// 질병 진단
// ─────────────────────────────────────────────
export const MOCK_DIAGNOSES: DiagnosisResult[] = [
  {
    id: "diag-1", tank_id: "tank-4", tank_name: "B-2조",
    test_type: "AHPND", result: "양성", vibrio_count: 8500, pathogenic_ratio: 35,
    risk_level: "high", tested_at: daysAgoZ(1), tested_by: "김양식",
    action_taken: "격리 조치, 전문 수의사 자문 의뢰", notes: "확진 판정, 인근 수조 예방 모니터링 필요",
  },
  {
    id: "diag-2", tank_id: "tank-6", tank_name: "C-2조",
    test_type: "총비브리오", result: "의심", vibrio_count: 4200, pathogenic_ratio: 18,
    risk_level: "medium", tested_at: daysAgoZ(1), tested_by: "김양식",
    action_taken: "추가 검사 예정, 바실러스균 집중 투입", notes: "탁도 상승 연관 의심",
  },
  {
    id: "diag-3", tank_id: "tank-1", tank_name: "A-1조",
    test_type: "총비브리오", result: "음성", vibrio_count: 180, pathogenic_ratio: 4,
    risk_level: "low", tested_at: daysAgoZ(3), tested_by: "이운영",
    action_taken: "정기 예방 투여 유지", notes: "정상 범위",
  },
  {
    id: "diag-4", tank_id: "tank-11", tank_name: "F-1조",
    test_type: "EHP", result: "음성", vibrio_count: 320, pathogenic_ratio: 6,
    risk_level: "low", tested_at: daysAgoZ(5), tested_by: "이운영",
    action_taken: undefined, notes: "선제적 검사, 이상 없음",
  },
  {
    id: "diag-5", tank_id: "tank-5", tank_name: "C-1조",
    test_type: "WSSV", result: "음성", vibrio_count: 250, pathogenic_ratio: 3,
    risk_level: "low", tested_at: daysAgoZ(7), tested_by: "김양식",
    action_taken: "정기 모니터링 유지", notes: undefined,
  },
  {
    id: "diag-6", tank_id: "tank-3", tank_name: "B-1조",
    test_type: "총비브리오", result: "음성", vibrio_count: 150, pathogenic_ratio: 2,
    risk_level: "low", tested_at: daysAgoZ(10), tested_by: "이운영",
    action_taken: undefined, notes: "입식 후 초기 검사",
  },
  {
    id: "diag-7", tank_id: "tank-9", tank_name: "E-1조",
    test_type: "AHPND", result: "음성", vibrio_count: 420, pathogenic_ratio: 7,
    risk_level: "low", tested_at: daysAgoZ(14), tested_by: "김양식",
    action_taken: "예방적 바실러스균 투입", notes: "정기 검사",
  },
]

// ─────────────────────────────────────────────
// IoT 센서
// ─────────────────────────────────────────────
export const MOCK_SENSOR_DEVICES: SensorDevice[] = [
  { id: "dev-1", tank_id: "tank-1", name: "A-1조 멀티센서 (수온·DO·pH·염도)", device_type: "multi", api_key: "sk-demo-a1-xxxxx", active: true, last_seen_at: daysAgoZ(0.003), serial: "10000000c0ffee01", firmware: "pi-1.0.0", last_payload: { temperature: 28.4, ph: 7.85, do_level: 6.42, salinity: 21.4, conductivity: 32100 }, agent_version: "1.1.0", update_to: null, update_status: null, update_message: null, update_status_at: null, created_at: "2024-04-01T00:00:00Z" },
  { id: "dev-2", tank_id: "tank-3", name: "B-1조 멀티센서", device_type: "multi", api_key: "sk-demo-b1-xxxxx", active: true, last_seen_at: daysAgoZ(0.008), serial: "10000000c0ffee02", firmware: "pi-1.0.0", last_payload: { temperature: 29.1, ph: 8.02, do_level: 6.9, salinity: 22.0 }, agent_version: "1.0.0", update_to: null, update_status: null, update_message: null, update_status_at: null, created_at: "2024-04-05T00:00:00Z" },
  { id: "dev-3", tank_id: "tank-5", name: "C-1조 수온·DO 센서", device_type: "do", api_key: "sk-demo-c1-xxxxx", active: true, last_seen_at: daysAgoZ(0.01), serial: "10000000c0ffee03", firmware: "pi-1.0.0", last_payload: { temperature: 27.8, do_level: 5.8 }, agent_version: "1.0.0", update_to: "1.1.0", update_status: "requested", update_message: null, update_status_at: null, created_at: "2024-04-10T00:00:00Z" },
  { id: "dev-4", tank_id: "tank-6", name: "C-2조 멀티센서", device_type: "multi", api_key: "sk-demo-c2-xxxxx", active: true, last_seen_at: daysAgoZ(0.006), serial: "10000000c0ffee04", firmware: "pi-1.0.0", last_payload: { temperature: 28.9, ph: 7.7, do_level: 6.1, salinity: 20.6 }, agent_version: "1.1.0", update_to: null, update_status: null, update_message: null, update_status_at: null, created_at: "2024-04-10T00:00:00Z" },
  { id: "dev-5", tank_id: "tank-9", name: "E-1조 수온센서", device_type: "temperature", api_key: "sk-demo-e1-xxxxx", active: true, last_seen_at: daysAgoZ(0.02), serial: "10000000c0ffee05", firmware: "pi-1.0.0", last_payload: { temperature: 28.2 }, agent_version: "1.0.0", update_to: null, update_status: "failed", update_message: null, update_status_at: null, created_at: "2024-04-20T00:00:00Z" },
]

// ─────────────────────────────────────────────
// 생산 사이클
// ─────────────────────────────────────────────
export const MOCK_PRODUCTION_CYCLES: ProductionCycle[] = [
  // 진행 중
  {
    id: "cycle-1", tank_id: "tank-1", tank_name: "A-1조", farm_name: "제1양식장", user_id: "mock-user-1",
    name: "2026-1차", status: "active",
    stocking_date: daysAgo(55), stocking_count: 50000,
    pl_source: "대성종묘", pl_stage: "PL12", initial_weight_g: 0.001, pl_species: "사이아쿠아",
    target_weight_g: 20, target_harvest_date: daysAgo(-25),
    actual_harvest_date: null, actual_harvest_weight_kg: null, actual_harvest_count: null,
    notes: null,
    created_at: daysAgo(55) + "T00:00:00Z", updated_at: daysAgo(1) + "T00:00:00Z",
    doc: 55, latest_abw_g: 12.4, latest_biomass_kg: 521, survival_rate: 84,
    total_feed_kg: 312, fcr: undefined, total_cost: 4850000, total_revenue: 0, profit: -4850000,
  },
  {
    id: "cycle-2", tank_id: "tank-2", tank_name: "A-2조", farm_name: "제1양식장", user_id: "mock-user-1",
    name: "2026-1차", status: "active",
    stocking_date: daysAgo(38), stocking_count: 45000,
    pl_source: "대성종묘", pl_stage: "PL10", initial_weight_g: 0.001, pl_species: "SIS 1번",
    target_weight_g: 18, target_harvest_date: daysAgo(-40),
    actual_harvest_date: null, actual_harvest_weight_kg: null, actual_harvest_count: null,
    notes: null,
    created_at: daysAgo(38) + "T00:00:00Z", updated_at: daysAgo(1) + "T00:00:00Z",
    doc: 38, latest_abw_g: 7.8, latest_biomass_kg: 320, survival_rate: 91,
    total_feed_kg: 188, fcr: undefined, total_cost: 3920000, total_revenue: 0, profit: -3920000,
  },
  {
    id: "cycle-5", tank_id: "tank-5", tank_name: "C-1조", farm_name: "제1양식장", user_id: "mock-user-1",
    name: "2026-1차", status: "active",
    stocking_date: daysAgo(72), stocking_count: 55000,
    pl_source: "한국수산종묘", pl_stage: "PL12", initial_weight_g: 0.001, pl_species: "사이아쿠아",
    target_weight_g: 22, target_harvest_date: daysAgo(-8),
    actual_harvest_date: null, actual_harvest_weight_kg: null, actual_harvest_count: null,
    notes: null,
    created_at: daysAgo(72) + "T00:00:00Z", updated_at: daysAgo(1) + "T00:00:00Z",
    doc: 72, latest_abw_g: 17.2, latest_biomass_kg: 800, survival_rate: 85,
    total_feed_kg: 524, fcr: undefined, total_cost: 7200000, total_revenue: 0, profit: -7200000,
  },
  {
    id: "cycle-6", tank_id: "tank-9", tank_name: "E-1조", farm_name: "제2양식장", user_id: "mock-user-1",
    name: "2026-1차", status: "active",
    stocking_date: daysAgo(42), stocking_count: 44000,
    pl_source: "부경종묘", pl_stage: "PL11", initial_weight_g: 0.001, pl_species: "SIS 2번",
    target_weight_g: 18, target_harvest_date: daysAgo(-35),
    actual_harvest_date: null, actual_harvest_weight_kg: null, actual_harvest_count: null,
    notes: null,
    created_at: daysAgo(42) + "T00:00:00Z", updated_at: daysAgo(1) + "T00:00:00Z",
    doc: 42, latest_abw_g: 8.9, latest_biomass_kg: 380, survival_rate: 96,
    total_feed_kg: 230, fcr: undefined, total_cost: 4100000, total_revenue: 0, profit: -4100000,
  },
  // 완료
  {
    id: "cycle-3", tank_id: "tank-3", tank_name: "B-1조", farm_name: "제1양식장", user_id: "mock-user-1",
    name: "2025-3차", status: "completed",
    stocking_date: daysAgo(130), stocking_count: 48000,
    pl_source: "한국수산종묘", pl_stage: "PL12", initial_weight_g: 0.001, pl_species: "사이아쿠아",
    target_weight_g: 20, target_harvest_date: daysAgo(15),
    actual_harvest_date: daysAgo(18), actual_harvest_weight_kg: 720, actual_harvest_count: 38400,
    notes: "최종 FCR 1.42, 생존율 80%",
    created_at: daysAgo(130) + "T00:00:00Z", updated_at: daysAgo(18) + "T00:00:00Z",
    doc: undefined, latest_abw_g: 18.75, latest_biomass_kg: 720, survival_rate: 80,
    total_feed_kg: 1022, fcr: 1.42, total_cost: 8640000, total_revenue: 11520000, profit: 2880000,
  },
  {
    id: "cycle-4", tank_id: "tank-7", tank_name: "D-1조", farm_name: "제1양식장", user_id: "mock-user-1",
    name: "2025-2차", status: "completed",
    stocking_date: daysAgo(200), stocking_count: 52000,
    pl_source: "대성종묘", pl_stage: "PL12", initial_weight_g: 0.001, pl_species: "SIS 1번",
    target_weight_g: 20, target_harvest_date: daysAgo(100),
    actual_harvest_date: daysAgo(105), actual_harvest_weight_kg: 810, actual_harvest_count: 43200,
    notes: "FCR 1.38, 우수 사이클",
    created_at: daysAgo(200) + "T00:00:00Z", updated_at: daysAgo(105) + "T00:00:00Z",
    doc: undefined, latest_abw_g: 18.75, latest_biomass_kg: 810, survival_rate: 83,
    total_feed_kg: 1118, fcr: 1.38, total_cost: 9200000, total_revenue: 13770000, profit: 4570000,
  },
  {
    id: "cycle-7", tank_id: "tank-10", tank_name: "E-2조", farm_name: "제2양식장", user_id: "mock-user-1",
    name: "2025-3차", status: "completed",
    stocking_date: daysAgo(170), stocking_count: 40000,
    pl_source: "부경종묘", pl_stage: "PL10", initial_weight_g: 0.001, pl_species: "사이아쿠아",
    target_weight_g: 18, target_harvest_date: daysAgo(60),
    actual_harvest_date: daysAgo(62), actual_harvest_weight_kg: 540, actual_harvest_count: 30000,
    notes: "태풍 영향으로 생존율 저조",
    created_at: daysAgo(170) + "T00:00:00Z", updated_at: daysAgo(62) + "T00:00:00Z",
    doc: undefined, latest_abw_g: 18.0, latest_biomass_kg: 540, survival_rate: 75,
    total_feed_kg: 810, fcr: 1.50, total_cost: 7600000, total_revenue: 8640000, profit: 1040000,
  },
]

// ─────────────────────────────────────────────
// 성장 샘플
// ─────────────────────────────────────────────
export const MOCK_GROWTH_SAMPLES: Record<string, GrowthSample[]> = {
  "cycle-1": [
    { id: "s1-1", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(45), sample_count: 30, total_weight_g: 45,  abw_g: 1.5,  survival_rate: 95, estimated_population: 47500, estimated_biomass_kg: 71.3,  notes: null,          created_at: daysAgo(45) + "T08:00:00Z" },
    { id: "s1-2", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(35), sample_count: 30, total_weight_g: 114, abw_g: 3.8,  survival_rate: 92, estimated_population: 46000, estimated_biomass_kg: 174.8, notes: null,          created_at: daysAgo(35) + "T08:00:00Z" },
    { id: "s1-3", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(25), sample_count: 30, total_weight_g: 228, abw_g: 7.6,  survival_rate: 88, estimated_population: 44000, estimated_biomass_kg: 334.4, notes: null,          created_at: daysAgo(25) + "T08:00:00Z" },
    { id: "s1-4", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(10), sample_count: 30, total_weight_g: 372, abw_g: 12.4, survival_rate: 84, estimated_population: 42000, estimated_biomass_kg: 520.8, notes: "성장 양호",   created_at: daysAgo(10) + "T08:00:00Z" },
  ],
  "cycle-2": [
    { id: "s2-1", cycle_id: "cycle-2", tank_id: "tank-2", sampled_at: daysAgo(28), sample_count: 30, total_weight_g: 36,  abw_g: 1.2,  survival_rate: 96, estimated_population: 43200, estimated_biomass_kg: 51.8,  notes: null,          created_at: daysAgo(28) + "T08:00:00Z" },
    { id: "s2-2", cycle_id: "cycle-2", tank_id: "tank-2", sampled_at: daysAgo(18), sample_count: 30, total_weight_g: 117, abw_g: 3.9,  survival_rate: 93, estimated_population: 41850, estimated_biomass_kg: 163.2, notes: null,          created_at: daysAgo(18) + "T08:00:00Z" },
    { id: "s2-3", cycle_id: "cycle-2", tank_id: "tank-2", sampled_at: daysAgo(7),  sample_count: 30, total_weight_g: 234, abw_g: 7.8,  survival_rate: 91, estimated_population: 40950, estimated_biomass_kg: 319.4, notes: null,          created_at: daysAgo(7)  + "T08:00:00Z" },
  ],
  "cycle-5": [
    { id: "s5-1", cycle_id: "cycle-5", tank_id: "tank-5", sampled_at: daysAgo(60), sample_count: 30, total_weight_g: 54,  abw_g: 1.8,  survival_rate: 94, estimated_population: 51700, estimated_biomass_kg: 93.1,  notes: null,          created_at: daysAgo(60) + "T08:00:00Z" },
    { id: "s5-2", cycle_id: "cycle-5", tank_id: "tank-5", sampled_at: daysAgo(45), sample_count: 30, total_weight_g: 168, abw_g: 5.6,  survival_rate: 90, estimated_population: 49500, estimated_biomass_kg: 277.2, notes: null,          created_at: daysAgo(45) + "T08:00:00Z" },
    { id: "s5-3", cycle_id: "cycle-5", tank_id: "tank-5", sampled_at: daysAgo(28), sample_count: 30, total_weight_g: 318, abw_g: 10.6, survival_rate: 87, estimated_population: 47850, estimated_biomass_kg: 507.2, notes: null,          created_at: daysAgo(28) + "T08:00:00Z" },
    { id: "s5-4", cycle_id: "cycle-5", tank_id: "tank-5", sampled_at: daysAgo(10), sample_count: 30, total_weight_g: 516, abw_g: 17.2, survival_rate: 85, estimated_population: 46750, estimated_biomass_kg: 804.1, notes: "수확 임박",   created_at: daysAgo(10) + "T08:00:00Z" },
  ],
  "cycle-6": [
    { id: "s6-1", cycle_id: "cycle-6", tank_id: "tank-9", sampled_at: daysAgo(32), sample_count: 30, total_weight_g: 42,  abw_g: 1.4,  survival_rate: 97, estimated_population: 42680, estimated_biomass_kg: 59.8,  notes: null,          created_at: daysAgo(32) + "T08:00:00Z" },
    { id: "s6-2", cycle_id: "cycle-6", tank_id: "tank-9", sampled_at: daysAgo(20), sample_count: 30, total_weight_g: 129, abw_g: 4.3,  survival_rate: 96, estimated_population: 42240, estimated_biomass_kg: 181.6, notes: null,          created_at: daysAgo(20) + "T08:00:00Z" },
    { id: "s6-3", cycle_id: "cycle-6", tank_id: "tank-9", sampled_at: daysAgo(7),  sample_count: 30, total_weight_g: 267, abw_g: 8.9,  survival_rate: 96, estimated_population: 42240, estimated_biomass_kg: 376.0, notes: null,          created_at: daysAgo(7)  + "T08:00:00Z" },
  ],
  "cycle-3": [
    { id: "s3-1", cycle_id: "cycle-3", tank_id: "tank-3", sampled_at: daysAgo(120), sample_count: 30, total_weight_g: 48,  abw_g: 1.6,  survival_rate: 95, estimated_population: 45600, estimated_biomass_kg: 73.0,  notes: null, created_at: daysAgo(120) + "T08:00:00Z" },
    { id: "s3-2", cycle_id: "cycle-3", tank_id: "tank-3", sampled_at: daysAgo(100), sample_count: 30, total_weight_g: 180, abw_g: 6.0,  survival_rate: 90, estimated_population: 43200, estimated_biomass_kg: 259.2, notes: null, created_at: daysAgo(100) + "T08:00:00Z" },
    { id: "s3-3", cycle_id: "cycle-3", tank_id: "tank-3", sampled_at: daysAgo(75),  sample_count: 30, total_weight_g: 330, abw_g: 11.0, survival_rate: 85, estimated_population: 40800, estimated_biomass_kg: 448.8, notes: null, created_at: daysAgo(75)  + "T08:00:00Z" },
    { id: "s3-4", cycle_id: "cycle-3", tank_id: "tank-3", sampled_at: daysAgo(40),  sample_count: 30, total_weight_g: 456, abw_g: 15.2, survival_rate: 82, estimated_population: 39360, estimated_biomass_kg: 598.3, notes: null, created_at: daysAgo(40)  + "T08:00:00Z" },
    { id: "s3-5", cycle_id: "cycle-3", tank_id: "tank-3", sampled_at: daysAgo(20),  sample_count: 30, total_weight_g: 563, abw_g: 18.75,survival_rate: 80, estimated_population: 38400, estimated_biomass_kg: 720.0, notes: "수확 완료", created_at: daysAgo(20) + "T08:00:00Z" },
  ],
}

// ─────────────────────────────────────────────
// 원가
// ─────────────────────────────────────────────
export const MOCK_CYCLE_COSTS: Record<string, CycleCost[]> = {
  "cycle-1": [
    { id: "c1-1", cycle_id: "cycle-1", category: "pl",          label: "치어(PL12) 구매",     amount: 750000,  recorded_at: daysAgo(55), notes: "대성종묘 50,000마리",  created_at: daysAgo(55) + "T00:00:00Z" },
    { id: "c1-2", cycle_id: "cycle-1", category: "feed",        label: "배합사료 1차",         amount: 1200000, recorded_at: daysAgo(40), notes: null,                  created_at: daysAgo(40) + "T00:00:00Z" },
    { id: "c1-3", cycle_id: "cycle-1", category: "feed",        label: "배합사료 2차",         amount: 1100000, recorded_at: daysAgo(20), notes: null,                  created_at: daysAgo(20) + "T00:00:00Z" },
    { id: "c1-4", cycle_id: "cycle-1", category: "electricity", label: "전기료 (4월)",         amount: 920000,  recorded_at: daysAgo(40), notes: null,                  created_at: daysAgo(40) + "T00:00:00Z" },
    { id: "c1-5", cycle_id: "cycle-1", category: "electricity", label: "전기료 (5월)",         amount: 980000,  recorded_at: daysAgo(10), notes: null,                  created_at: daysAgo(10) + "T00:00:00Z" },
    { id: "c1-6", cycle_id: "cycle-1", category: "chemicals",   label: "유용미생물 (컬리버)",   amount: 320000,  recorded_at: daysAgo(30), notes: null,                  created_at: daysAgo(30) + "T00:00:00Z" },
    { id: "c1-7", cycle_id: "cycle-1", category: "labor",       label: "인건비 (4~5월)",       amount: 500000,  recorded_at: daysAgo(5),  notes: null,                  created_at: daysAgo(5)  + "T00:00:00Z" },
    { id: "c1-8", cycle_id: "cycle-1", category: "other",       label: "소모품·소독제",        amount: 180000,  recorded_at: daysAgo(25), notes: null,                  created_at: daysAgo(25) + "T00:00:00Z" },
  ],
  "cycle-2": [
    { id: "c2-1", cycle_id: "cycle-2", category: "pl",          label: "치어(PL10) 구매",     amount: 630000,  recorded_at: daysAgo(38), notes: "대성종묘 45,000마리",  created_at: daysAgo(38) + "T00:00:00Z" },
    { id: "c2-2", cycle_id: "cycle-2", category: "feed",        label: "배합사료 1차",         amount: 980000,  recorded_at: daysAgo(25), notes: null,                  created_at: daysAgo(25) + "T00:00:00Z" },
    { id: "c2-3", cycle_id: "cycle-2", category: "feed",        label: "배합사료 2차",         amount: 860000,  recorded_at: daysAgo(10), notes: null,                  created_at: daysAgo(10) + "T00:00:00Z" },
    { id: "c2-4", cycle_id: "cycle-2", category: "electricity", label: "전기료 (4~5월)",       amount: 890000,  recorded_at: daysAgo(8),  notes: null,                  created_at: daysAgo(8)  + "T00:00:00Z" },
    { id: "c2-5", cycle_id: "cycle-2", category: "chemicals",   label: "유용미생물",           amount: 280000,  recorded_at: daysAgo(20), notes: null,                  created_at: daysAgo(20) + "T00:00:00Z" },
    { id: "c2-6", cycle_id: "cycle-2", category: "labor",       label: "인건비",               amount: 280000,  recorded_at: daysAgo(3),  notes: null,                  created_at: daysAgo(3)  + "T00:00:00Z" },
  ],
  "cycle-5": [
    { id: "c5-1", cycle_id: "cycle-5", category: "pl",          label: "치어(PL12) 구매",     amount: 825000,  recorded_at: daysAgo(72), notes: "한국수산종묘 55,000마리", created_at: daysAgo(72) + "T00:00:00Z" },
    { id: "c5-2", cycle_id: "cycle-5", category: "feed",        label: "배합사료 1차",         amount: 1350000, recorded_at: daysAgo(55), notes: null,                  created_at: daysAgo(55) + "T00:00:00Z" },
    { id: "c5-3", cycle_id: "cycle-5", category: "feed",        label: "배합사료 2차",         amount: 1480000, recorded_at: daysAgo(30), notes: null,                  created_at: daysAgo(30) + "T00:00:00Z" },
    { id: "c5-4", cycle_id: "cycle-5", category: "feed",        label: "배합사료 3차",         amount: 1020000, recorded_at: daysAgo(10), notes: null,                  created_at: daysAgo(10) + "T00:00:00Z" },
    { id: "c5-5", cycle_id: "cycle-5", category: "electricity", label: "전기료 (4월)",         amount: 980000,  recorded_at: daysAgo(40), notes: null,                  created_at: daysAgo(40) + "T00:00:00Z" },
    { id: "c5-6", cycle_id: "cycle-5", category: "electricity", label: "전기료 (5월)",         amount: 1020000, recorded_at: daysAgo(10), notes: null,                  created_at: daysAgo(10) + "T00:00:00Z" },
    { id: "c5-7", cycle_id: "cycle-5", category: "chemicals",   label: "유용미생물·약품",      amount: 420000,  recorded_at: daysAgo(35), notes: null,                  created_at: daysAgo(35) + "T00:00:00Z" },
    { id: "c5-8", cycle_id: "cycle-5", category: "labor",       label: "인건비 (4~5월)",       amount: 600000,  recorded_at: daysAgo(5),  notes: null,                  created_at: daysAgo(5)  + "T00:00:00Z" },
    { id: "c5-9", cycle_id: "cycle-5", category: "other",       label: "소모품",               amount: 150000,  recorded_at: daysAgo(40), notes: null,                  created_at: daysAgo(40) + "T00:00:00Z" },
  ],
  "cycle-6": [
    { id: "c6-1", cycle_id: "cycle-6", category: "pl",          label: "치어(PL11) 구매",     amount: 616000,  recorded_at: daysAgo(42), notes: "부경종묘 44,000마리",  created_at: daysAgo(42) + "T00:00:00Z" },
    { id: "c6-2", cycle_id: "cycle-6", category: "feed",        label: "배합사료 1차",         amount: 980000,  recorded_at: daysAgo(28), notes: null,                  created_at: daysAgo(28) + "T00:00:00Z" },
    { id: "c6-3", cycle_id: "cycle-6", category: "feed",        label: "배합사료 2차",         amount: 860000,  recorded_at: daysAgo(10), notes: null,                  created_at: daysAgo(10) + "T00:00:00Z" },
    { id: "c6-4", cycle_id: "cycle-6", category: "electricity", label: "전기료",               amount: 720000,  recorded_at: daysAgo(8),  notes: null,                  created_at: daysAgo(8)  + "T00:00:00Z" },
    { id: "c6-5", cycle_id: "cycle-6", category: "chemicals",   label: "유용미생물",           amount: 240000,  recorded_at: daysAgo(20), notes: null,                  created_at: daysAgo(20) + "T00:00:00Z" },
    { id: "c6-6", cycle_id: "cycle-6", category: "labor",       label: "인건비",               amount: 280000,  recorded_at: daysAgo(3),  notes: null,                  created_at: daysAgo(3)  + "T00:00:00Z" },
  ],
  "cycle-3": [
    { id: "c3-1", cycle_id: "cycle-3", category: "pl",          label: "치어 구매",            amount: 720000,  recorded_at: daysAgo(130), notes: null, created_at: daysAgo(130) + "T00:00:00Z" },
    { id: "c3-2", cycle_id: "cycle-3", category: "feed",        label: "배합사료 전체",        amount: 4200000, recorded_at: daysAgo(80),  notes: null, created_at: daysAgo(80)  + "T00:00:00Z" },
    { id: "c3-3", cycle_id: "cycle-3", category: "electricity", label: "전기료 합계",          amount: 2100000, recorded_at: daysAgo(20),  notes: null, created_at: daysAgo(20)  + "T00:00:00Z" },
    { id: "c3-4", cycle_id: "cycle-3", category: "labor",       label: "인건비",               amount: 1200000, recorded_at: daysAgo(20),  notes: null, created_at: daysAgo(20)  + "T00:00:00Z" },
    { id: "c3-5", cycle_id: "cycle-3", category: "chemicals",   label: "약품·소독제",          amount: 420000,  recorded_at: daysAgo(50),  notes: null, created_at: daysAgo(50)  + "T00:00:00Z" },
  ],
  "cycle-4": [
    { id: "c4-1", cycle_id: "cycle-4", category: "pl",          label: "치어 구매",            amount: 780000,  recorded_at: daysAgo(200), notes: null, created_at: daysAgo(200) + "T00:00:00Z" },
    { id: "c4-2", cycle_id: "cycle-4", category: "feed",        label: "배합사료 전체",        amount: 5120000, recorded_at: daysAgo(150), notes: null, created_at: daysAgo(150) + "T00:00:00Z" },
    { id: "c4-3", cycle_id: "cycle-4", category: "electricity", label: "전기료 합계",          amount: 2200000, recorded_at: daysAgo(110), notes: null, created_at: daysAgo(110) + "T00:00:00Z" },
    { id: "c4-4", cycle_id: "cycle-4", category: "labor",       label: "인건비",               amount: 800000,  recorded_at: daysAgo(110), notes: null, created_at: daysAgo(110) + "T00:00:00Z" },
    { id: "c4-5", cycle_id: "cycle-4", category: "chemicals",   label: "약품·소독제",          amount: 300000,  recorded_at: daysAgo(150), notes: null, created_at: daysAgo(150) + "T00:00:00Z" },
  ],
  "cycle-7": [
    { id: "c7-1", cycle_id: "cycle-7", category: "pl",          label: "치어 구매",            amount: 560000,  recorded_at: daysAgo(170), notes: null, created_at: daysAgo(170) + "T00:00:00Z" },
    { id: "c7-2", cycle_id: "cycle-7", category: "feed",        label: "배합사료 전체",        amount: 3840000, recorded_at: daysAgo(120), notes: null, created_at: daysAgo(120) + "T00:00:00Z" },
    { id: "c7-3", cycle_id: "cycle-7", category: "electricity", label: "전기료 합계",          amount: 1800000, recorded_at: daysAgo(65),  notes: null, created_at: daysAgo(65)  + "T00:00:00Z" },
    { id: "c7-4", cycle_id: "cycle-7", category: "labor",       label: "인건비",               amount: 900000,  recorded_at: daysAgo(65),  notes: null, created_at: daysAgo(65)  + "T00:00:00Z" },
    { id: "c7-5", cycle_id: "cycle-7", category: "chemicals",   label: "약품·소독제",          amount: 500000,  recorded_at: daysAgo(100), notes: "태풍 피해 복구 약품", created_at: daysAgo(100) + "T00:00:00Z" },
  ],
}

// ─────────────────────────────────────────────
// 수확
// ─────────────────────────────────────────────
export const MOCK_CYCLE_HARVESTS: Record<string, CycleHarvest[]> = {
  "cycle-3": [
    { id: "h3-1", cycle_id: "cycle-3", harvested_at: daysAgo(18), weight_kg: 720, count: 38400, price_per_kg: 16000, revenue: 11520000, notes: "전량 수확", created_at: daysAgo(18) + "T00:00:00Z" },
  ],
  "cycle-4": [
    { id: "h4-1", cycle_id: "cycle-4", harvested_at: daysAgo(106), weight_kg: 480, count: 25600, price_per_kg: 17000, revenue: 8160000, notes: "1차 수확 (60%)", created_at: daysAgo(106) + "T00:00:00Z" },
    { id: "h4-2", cycle_id: "cycle-4", harvested_at: daysAgo(105), weight_kg: 330, count: 17600, price_per_kg: 17000, revenue: 5610000, notes: "2차 수확 (40%)",  created_at: daysAgo(105) + "T00:00:00Z" },
  ],
  "cycle-7": [
    { id: "h7-1", cycle_id: "cycle-7", harvested_at: daysAgo(62), weight_kg: 540, count: 30000, price_per_kg: 16000, revenue: 8640000, notes: "전량 수확",        created_at: daysAgo(62)  + "T00:00:00Z" },
  ],
}

// ─────────────────────────────────────────────
// 재고
// ─────────────────────────────────────────────
export const MOCK_INVENTORY_ITEMS: InventoryItem[] = [
  { id: "inv-1", user_id: "mock-user-1", category: "feed",     name: "새우 전용 사료 0.3mm (치어기)",  unit: "kg",  current_stock: 180, reorder_level: 50,  notes: "치어기 전용 소립자",     created_at: daysAgo(60) + "T00:00:00Z", updated_at: daysAgo(2) + "T00:00:00Z" },
  { id: "inv-2", user_id: "mock-user-1", category: "feed",     name: "PHOCA 9073S(39%) 1.5mm",         unit: "kg",  current_stock: 420, reorder_level: 100, notes: "성장기 주력 사료",       created_at: daysAgo(60) + "T00:00:00Z", updated_at: daysAgo(1) + "T00:00:00Z" },
  { id: "inv-3", user_id: "mock-user-1", category: "feed",     name: "PHOCA 9074S(39%) 2.0mm",         unit: "kg",  current_stock: 260, reorder_level: 80,  notes: "후기 성장기용",          created_at: daysAgo(30) + "T00:00:00Z", updated_at: daysAgo(3) + "T00:00:00Z" },
  { id: "inv-4", user_id: "mock-user-1", category: "probiotic",name: "컬리버 1호 (바실러스 복합균)",   unit: "L",   current_stock: 18,  reorder_level: 5,   notes: null,                     created_at: daysAgo(45) + "T00:00:00Z", updated_at: daysAgo(5) + "T00:00:00Z" },
  { id: "inv-5", user_id: "mock-user-1", category: "probiotic",name: "컬리버 2호 (질산화균)",          unit: "L",   current_stock: 8,   reorder_level: 5,   notes: null,                     created_at: daysAgo(45) + "T00:00:00Z", updated_at: daysAgo(7) + "T00:00:00Z" },
  { id: "inv-6", user_id: "mock-user-1", category: "chemical", name: "과산화수소 소독제 (35%)",        unit: "L",   current_stock: 8,   reorder_level: 10,  notes: "재고 부족 주의",         created_at: daysAgo(45) + "T00:00:00Z", updated_at: daysAgo(3) + "T00:00:00Z" },
  { id: "inv-7", user_id: "mock-user-1", category: "chemical", name: "차아염소산나트륨 (12%)",         unit: "L",   current_stock: 45,  reorder_level: 20,  notes: null,                     created_at: daysAgo(30) + "T00:00:00Z", updated_at: daysAgo(6) + "T00:00:00Z" },
  { id: "inv-8", user_id: "mock-user-1", category: "chemical", name: "제오라이트 (수질정화)",          unit: "kg",  current_stock: 280, reorder_level: 80,  notes: null,                     created_at: daysAgo(30) + "T00:00:00Z", updated_at: daysAgo(7) + "T00:00:00Z" },
  { id: "inv-9", user_id: "mock-user-1", category: "other",    name: "에어스톤 (교체용)",              unit: "개",  current_stock: 3,   reorder_level: 5,   notes: null,                     created_at: daysAgo(20) + "T00:00:00Z", updated_at: daysAgo(10) + "T00:00:00Z" },
  { id: "inv-10",user_id: "mock-user-1", category: "other",    name: "pH 측정 시약",                  unit: "개",  current_stock: 12,  reorder_level: 3,   notes: "교정 시약 포함",         created_at: daysAgo(20) + "T00:00:00Z", updated_at: daysAgo(14) + "T00:00:00Z" },
]

export const MOCK_INVENTORY_TRANSACTIONS: InventoryTransaction[] = [
  // 사료 입고·출고
  { id: "tx-01", item_id: "inv-2", item_name: "PHOCA 9073S(39%) 1.5mm",       item_unit: "kg", user_id: "mock-user-1", type: "in",  quantity: 500, unit_price: 3200,  tank_id: null,     tank_name: null,   supplier: "대성사료",   recorded_at: daysAgo(30), notes: "5월 1차 입고",   created_at: daysAgo(30) + "T09:00:00Z" },
  { id: "tx-02", item_id: "inv-2", item_name: "PHOCA 9073S(39%) 1.5mm",       item_unit: "kg", user_id: "mock-user-1", type: "out", quantity: 80,  unit_price: null,  tank_id: "tank-1", tank_name: "A-1조", supplier: null,        recorded_at: daysAgo(25), notes: null,             created_at: daysAgo(25) + "T08:00:00Z" },
  { id: "tx-03", item_id: "inv-2", item_name: "PHOCA 9073S(39%) 1.5mm",       item_unit: "kg", user_id: "mock-user-1", type: "out", quantity: 65,  unit_price: null,  tank_id: "tank-2", tank_name: "A-2조", supplier: null,        recorded_at: daysAgo(20), notes: null,             created_at: daysAgo(20) + "T08:00:00Z" },
  { id: "tx-04", item_id: "inv-3", item_name: "PHOCA 9074S(39%) 2.0mm",       item_unit: "kg", user_id: "mock-user-1", type: "in",  quantity: 300, unit_price: 3500,  tank_id: null,     tank_name: null,   supplier: "대성사료",   recorded_at: daysAgo(20), notes: "5월 2차 입고",   created_at: daysAgo(20) + "T09:00:00Z" },
  { id: "tx-05", item_id: "inv-3", item_name: "PHOCA 9074S(39%) 2.0mm",       item_unit: "kg", user_id: "mock-user-1", type: "out", quantity: 40,  unit_price: null,  tank_id: "tank-5", tank_name: "C-1조", supplier: null,        recorded_at: daysAgo(15), notes: null,             created_at: daysAgo(15) + "T08:00:00Z" },
  { id: "tx-06", item_id: "inv-1", item_name: "새우 전용 사료 0.3mm (치어기)", item_unit: "kg", user_id: "mock-user-1", type: "in",  quantity: 200, unit_price: 2800,  tank_id: null,     tank_name: null,   supplier: "대성사료",   recorded_at: daysAgo(18), notes: "치어용 입고",    created_at: daysAgo(18) + "T09:00:00Z" },
  { id: "tx-07", item_id: "inv-1", item_name: "새우 전용 사료 0.3mm (치어기)", item_unit: "kg", user_id: "mock-user-1", type: "out", quantity: 20,  unit_price: null,  tank_id: "tank-3", tank_name: "B-1조", supplier: null,        recorded_at: daysAgo(14), notes: "입식 초기 급이", created_at: daysAgo(14) + "T08:00:00Z" },
  // 미생물 입고·출고
  { id: "tx-08", item_id: "inv-4", item_name: "컬리버 1호 (바실러스 복합균)", item_unit: "L",  user_id: "mock-user-1", type: "in",  quantity: 30,  unit_price: 45000, tank_id: null,     tank_name: null,   supplier: "바이오테크", recorded_at: daysAgo(45), notes: "4월 정기 입고",  created_at: daysAgo(45) + "T10:00:00Z" },
  { id: "tx-09", item_id: "inv-4", item_name: "컬리버 1호 (바실러스 복합균)", item_unit: "L",  user_id: "mock-user-1", type: "out", quantity: 5,   unit_price: null,  tank_id: "tank-1", tank_name: "A-1조", supplier: null,        recorded_at: daysAgo(10), notes: "수질 개선 처리", created_at: daysAgo(10) + "T08:00:00Z" },
  { id: "tx-10", item_id: "inv-4", item_name: "컬리버 1호 (바실러스 복합균)", item_unit: "L",  user_id: "mock-user-1", type: "out", quantity: 5,   unit_price: null,  tank_id: "tank-2", tank_name: "A-2조", supplier: null,        recorded_at: daysAgo(5),  notes: null,             created_at: daysAgo(5)  + "T08:00:00Z" },
  { id: "tx-11", item_id: "inv-5", item_name: "컬리버 2호 (질산화균)",        item_unit: "L",  user_id: "mock-user-1", type: "in",  quantity: 15,  unit_price: 48000, tank_id: null,     tank_name: null,   supplier: "바이오테크", recorded_at: daysAgo(30), notes: null,             created_at: daysAgo(30) + "T10:00:00Z" },
  { id: "tx-12", item_id: "inv-5", item_name: "컬리버 2호 (질산화균)",        item_unit: "L",  user_id: "mock-user-1", type: "out", quantity: 7,   unit_price: null,  tank_id: "tank-4", tank_name: "B-2조", supplier: null,        recorded_at: daysAgo(7),  notes: "암모니아 처리",  created_at: daysAgo(7)  + "T08:00:00Z" },
  // 약품 입고·출고
  { id: "tx-13", item_id: "inv-6", item_name: "과산화수소 소독제 (35%)",      item_unit: "L",  user_id: "mock-user-1", type: "in",  quantity: 20,  unit_price: 12000, tank_id: null,     tank_name: null,   supplier: "하나케미칼", recorded_at: daysAgo(45), notes: null,             created_at: daysAgo(45) + "T10:00:00Z" },
  { id: "tx-14", item_id: "inv-6", item_name: "과산화수소 소독제 (35%)",      item_unit: "L",  user_id: "mock-user-1", type: "out", quantity: 12,  unit_price: null,  tank_id: null,     tank_name: null,   supplier: null,        recorded_at: daysAgo(3),  notes: "시설 소독",      created_at: daysAgo(3)  + "T08:00:00Z" },
  { id: "tx-15", item_id: "inv-7", item_name: "차아염소산나트륨 (12%)",       item_unit: "L",  user_id: "mock-user-1", type: "in",  quantity: 60,  unit_price: 3500,  tank_id: null,     tank_name: null,   supplier: "하나케미칼", recorded_at: daysAgo(25), notes: null,             created_at: daysAgo(25) + "T10:00:00Z" },
  { id: "tx-16", item_id: "inv-7", item_name: "차아염소산나트륨 (12%)",       item_unit: "L",  user_id: "mock-user-1", type: "out", quantity: 15,  unit_price: null,  tank_id: "tank-6", tank_name: "C-2조", supplier: null,        recorded_at: daysAgo(2),  notes: "긴급 소독",      created_at: daysAgo(2)  + "T08:00:00Z" },
]
