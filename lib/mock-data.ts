import { Farm, Tank, WaterQualityReading, JournalEntry, DiagnosisResult, Alert, SensorDevice, ProductionCycle, GrowthSample, CycleCost, CycleHarvest } from "@/types"

export const MOCK_USER = {
  id: "mock-user-1",
  email: "admin@shrimp365.com",
  name: "김양식",
  role: "admin",
  farm_count: 2,
}

export const TEST_ACCOUNTS = [
  { email: "admin@shrimp365.com", name: "김양식 (관리자)" },
  { email: "operator@shrimp365.com", name: "이운영 (운영자)" },
]

export const TEST_EMAILS = ["admin@shrimp365.com", "operator@shrimp365.com"]

export function isTestAccount(email?: string | null): boolean {
  return TEST_EMAILS.includes(email ?? "")
}

export const MOCK_FARMS: Farm[] = [
  {
    id: "farm-1",
    user_id: "mock-user-1",
    name: "제1양식장",
    location: "전남 여수시 돌산읍",
    area: 5000,
    tank_count: 8,
    created_at: "2024-01-15",
  },
  {
    id: "farm-2",
    user_id: "mock-user-1",
    name: "제2양식장",
    location: "전남 고흥군 도화면",
    area: 3000,
    tank_count: 5,
    created_at: "2024-03-20",
  },
]

export const MOCK_TANKS: Tank[] = [
  { id: "tank-1", farm_id: "farm-1", name: "A-1조", volume: 500, status: "active", stocking_density: 120, shrimp_count: 60000, cycle_day: 45, tank_type: "실내", created_at: "2024-03-01" },
  { id: "tank-2", farm_id: "farm-1", name: "A-2조", volume: 500, status: "active", stocking_density: 115, shrimp_count: 57500, cycle_day: 45, tank_type: "실내", created_at: "2024-03-01" },
  { id: "tank-3", farm_id: "farm-1", name: "B-1조", volume: 500, status: "active", stocking_density: 130, shrimp_count: 65000, cycle_day: 60, tank_type: "노지", created_at: "2024-02-15" },
  { id: "tank-4", farm_id: "farm-1", name: "B-2조", volume: 500, status: "warning", stocking_density: 110, shrimp_count: 55000, cycle_day: 60, tank_type: "노지", created_at: "2024-02-15" },
  { id: "tank-5", farm_id: "farm-1", name: "C-1조", volume: 500, status: "active", stocking_density: 100, shrimp_count: 50000, cycle_day: 30, tank_type: "반실내", created_at: "2024-04-01" },
  { id: "tank-6", farm_id: "farm-1", name: "C-2조", volume: 500, status: "danger", stocking_density: 95, shrimp_count: 47500, cycle_day: 30, tank_type: "반실내", created_at: "2024-04-01" },
  { id: "tank-7", farm_id: "farm-1", name: "D-1조", volume: 500, status: "active", stocking_density: 125, shrimp_count: 62500, cycle_day: 75, tank_type: "실내", created_at: "2024-01-20" },
  { id: "tank-8", farm_id: "farm-1", name: "D-2조", volume: 500, status: "active", stocking_density: 118, shrimp_count: 59000, cycle_day: 75, tank_type: "실내", created_at: "2024-01-20" },
]

function generateTimeSeriesData(tankId: string, days: number = 7) {
  const data = []
  const now = new Date()
  for (let i = days * 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 3600000)
    data.push({
      id: `wq-${tankId}-${i}`,
      tank_id: tankId,
      temperature: 28 + Math.sin(i / 12) * 1.5 + (Math.random() - 0.5) * 0.5,
      ph: 7.8 + Math.sin(i / 8) * 0.3 + (Math.random() - 0.5) * 0.1,
      do_level: 6.5 + Math.sin(i / 6) * 1.0 + (Math.random() - 0.5) * 0.3,
      salinity: 20 + (Math.random() - 0.5) * 0.5,
      ammonia: 0.1 + Math.random() * 0.15,
      nitrite: 0.05 + Math.random() * 0.08,
      nitrate: 5 + Math.random() * 3,
      alkalinity: 120 + (Math.random() - 0.5) * 10,
      turbidity: tankId === "tank-6" ? 25 + Math.random() * 15 : 5 + Math.random() * 5,
      recorded_at: time.toISOString(),
      created_at: time.toISOString(),
    })
  }
  return data
}

export const MOCK_WATER_QUALITY: Record<string, WaterQualityReading[]> = {
  "tank-1": generateTimeSeriesData("tank-1"),
  "tank-2": generateTimeSeriesData("tank-2"),
  "tank-3": generateTimeSeriesData("tank-3"),
  "tank-4": generateTimeSeriesData("tank-4"),
  "tank-5": generateTimeSeriesData("tank-5"),
  "tank-6": generateTimeSeriesData("tank-6"),
  "tank-7": generateTimeSeriesData("tank-7"),
  "tank-8": generateTimeSeriesData("tank-8"),
}

export const WATER_QUALITY_STANDARDS = {
  temperature: { min: 25, max: 32, warning_min: 23, warning_max: 34, unit: "°C", label: "수온" },
  ph: { min: 7.5, max: 8.5, warning_min: 7.0, warning_max: 9.0, unit: "", label: "pH" },
  do_level: { min: 5.0, max: 9.0, warning_min: 4.0, warning_max: 10.0, unit: "mg/L", label: "용존산소(DO)" },
  salinity: { min: 15, max: 25, warning_min: 12, warning_max: 28, unit: "ppt", label: "염도" },
  ammonia: { min: 0, max: 0.5, warning_min: 0, warning_max: 1.0, unit: "mg/L", label: "암모니아" },
  nitrite: { min: 0, max: 0.1, warning_min: 0, warning_max: 0.5, unit: "mg/L", label: "아질산염" },
  nitrate: { min: 0, max: 20, warning_min: 0, warning_max: 40, unit: "mg/L", label: "질산염" },
  alkalinity: { min: 100, max: 150, warning_min: 80, warning_max: 180, unit: "mg/L", label: "알칼리도" },
  turbidity: { min: 0, max: 10, warning_min: 0, warning_max: 20, unit: "NTU", label: "탁도" },
}

export const MOCK_ALERTS: Alert[] = [
  { id: "alert-1", tank_id: "tank-6", tank_name: "C-2조", type: "danger", parameter: "turbidity", value: 32.5, threshold: 20, message: "탁도가 임계치를 초과했습니다", created_at: new Date(Date.now() - 1800000).toISOString(), resolved: false },
  { id: "alert-2", tank_id: "tank-4", tank_name: "B-2조", type: "warning", parameter: "do_level", value: 4.2, threshold: 5.0, message: "용존산소 농도가 낮습니다", created_at: new Date(Date.now() - 3600000).toISOString(), resolved: false },
  { id: "alert-3", tank_id: "tank-3", tank_name: "B-1조", type: "warning", parameter: "ammonia", value: 0.62, threshold: 0.5, message: "암모니아 농도 주의 수준", created_at: new Date(Date.now() - 7200000).toISOString(), resolved: false },
]

export const MOCK_JOURNALS: JournalEntry[] = [
  {
    id: "journal-1",
    tank_id: "tank-1",
    tank_name: "A-1조",
    date: new Date().toISOString().split("T")[0],
    feeding_amount: 15.5,
    feed_type: "성장기 사료 (No.3)",
    feeding_times: 4,
    mortality_count: 50,
    water_exchange_rate: 10,
    microbial_input: true,
    microbial_type: "EM균",
    microbial_amount: 500,
    disinfection: false,
    disinfection_type: null,
    check_aeration: true,
    check_filtration: true,
    check_circulation: true,
    check_feeding_check: true,
    notes: "활동성 양호, 섭이반응 정상",
    created_by: "김양식",
    created_at: new Date().toISOString(),
  },
  {
    id: "journal-2",
    tank_id: "tank-4",
    tank_name: "B-2조",
    date: new Date().toISOString().split("T")[0],
    feeding_amount: 12.0,
    feed_type: "성장기 사료 (No.3)",
    feeding_times: 3,
    mortality_count: 200,
    water_exchange_rate: 20,
    microbial_input: true,
    microbial_type: "바실러스균",
    microbial_amount: 300,
    disinfection: true,
    disinfection_type: "차아염소산나트륨 200ppm",
    check_aeration: true,
    check_filtration: false,
    check_circulation: true,
    check_feeding_check: false,
    notes: "DO 저하로 급이량 감소, 환수 실시",
    created_by: "이운영",
    created_at: new Date().toISOString(),
  },
]

export const MOCK_DIAGNOSES: DiagnosisResult[] = [
  {
    id: "diag-1",
    tank_id: "tank-4",
    tank_name: "B-2조",
    test_type: "AHPND",
    result: "양성",
    vibrio_count: 8500,
    pathogenic_ratio: 35,
    risk_level: "high",
    tested_at: new Date(Date.now() - 86400000).toISOString(),
    tested_by: "김양식",
    action_taken: "항생제 투여 검토, 격리 조치",
    notes: "전문 수의사 자문 예정",
  },
  {
    id: "diag-2",
    tank_id: "tank-1",
    tank_name: "A-1조",
    test_type: "총비브리오",
    result: "음성",
    vibrio_count: 200,
    pathogenic_ratio: 5,
    risk_level: "low",
    tested_at: new Date(Date.now() - 172800000).toISOString(),
    tested_by: "이운영",
    action_taken: "정기 예방 투여 유지",
    notes: "정상 범위",
  },
]

export const MOCK_SENSOR_DEVICES: SensorDevice[] = [
  {
    id: "dev-1",
    tank_id: "tank-1",
    name: "A-1조 멀티센서",
    device_type: "multi",
    api_key: "mock-api-key-hidden",
    active: true,
    last_seen_at: new Date(Date.now() - 5 * 60000).toISOString(),
    created_at: "2024-04-01T00:00:00Z",
  },
  {
    id: "dev-2",
    tank_id: "tank-3",
    name: "B-1조 수온·DO 센서",
    device_type: "multi",
    api_key: "mock-api-key-hidden-2",
    active: true,
    last_seen_at: new Date(Date.now() - 12 * 60000).toISOString(),
    created_at: "2024-04-05T00:00:00Z",
  },
]

// ─────────────────────────────────────────────
// 생산 관리 목 데이터
// ─────────────────────────────────────────────
const TODAY = new Date()
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86400000).toISOString().split("T")[0]

export const MOCK_PRODUCTION_CYCLES: ProductionCycle[] = [
  {
    id: "cycle-1",
    tank_id: "tank-1",
    tank_name: "A-1조",
    farm_name: "데모 양식장",
    user_id: "mock-user",
    name: "2026-1차",
    status: "active",
    stocking_date: daysAgo(55),
    stocking_count: 50000,
    pl_source: "대성종묘",
    pl_stage: "PL12",
    target_weight_g: 20,
    target_harvest_date: daysAgo(-25),
    actual_harvest_date: null,
    actual_harvest_weight_kg: null,
    actual_harvest_count: null,
    notes: null,
    created_at: daysAgo(55) + "T00:00:00Z",
    updated_at: daysAgo(55) + "T00:00:00Z",
    doc: 55,
    latest_abw_g: 12.4,
    latest_biomass_kg: 521,
    survival_rate: 84,
    total_feed_kg: 312,
    fcr: undefined,
    total_cost: 4850000,
    total_revenue: 0,
    profit: -4850000,
  },
  {
    id: "cycle-2",
    tank_id: "tank-2",
    tank_name: "A-2조",
    farm_name: "데모 양식장",
    user_id: "mock-user",
    name: "2026-1차",
    status: "active",
    stocking_date: daysAgo(38),
    stocking_count: 45000,
    pl_source: "대성종묘",
    pl_stage: "PL10",
    target_weight_g: 18,
    target_harvest_date: daysAgo(-40),
    actual_harvest_date: null,
    actual_harvest_weight_kg: null,
    actual_harvest_count: null,
    notes: null,
    created_at: daysAgo(38) + "T00:00:00Z",
    updated_at: daysAgo(38) + "T00:00:00Z",
    doc: 38,
    latest_abw_g: 7.8,
    latest_biomass_kg: 320,
    survival_rate: 91,
    total_feed_kg: 188,
    fcr: undefined,
    total_cost: 3920000,
    total_revenue: 0,
    profit: -3920000,
  },
  {
    id: "cycle-3",
    tank_id: "tank-3",
    tank_name: "B-1조",
    farm_name: "데모 양식장",
    user_id: "mock-user",
    name: "2025-3차",
    status: "completed",
    stocking_date: daysAgo(130),
    stocking_count: 48000,
    pl_source: "한국수산종묘",
    pl_stage: "PL12",
    target_weight_g: 20,
    target_harvest_date: daysAgo(15),
    actual_harvest_date: daysAgo(18),
    actual_harvest_weight_kg: 720,
    actual_harvest_count: 38400,
    notes: "최종 FCR 1.42, 생존율 80%",
    created_at: daysAgo(130) + "T00:00:00Z",
    updated_at: daysAgo(18) + "T00:00:00Z",
    doc: undefined,
    latest_abw_g: 18.75,
    latest_biomass_kg: 720,
    survival_rate: 80,
    total_feed_kg: 1022,
    fcr: 1.42,
    total_cost: 8640000,
    total_revenue: 11520000,
    profit: 2880000,
  },
]

export const MOCK_GROWTH_SAMPLES: Record<string, GrowthSample[]> = {
  "cycle-1": [
    { id: "s1-1", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(45), sample_count: 30, total_weight_g: 45, abw_g: 1.5, survival_rate: 95, estimated_population: 47500, estimated_biomass_kg: 71.25, notes: null, created_at: daysAgo(45) + "T08:00:00Z" },
    { id: "s1-2", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(35), sample_count: 30, total_weight_g: 114, abw_g: 3.8, survival_rate: 92, estimated_population: 46000, estimated_biomass_kg: 174.8, notes: null, created_at: daysAgo(35) + "T08:00:00Z" },
    { id: "s1-3", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(25), sample_count: 30, total_weight_g: 228, abw_g: 7.6, survival_rate: 88, estimated_population: 44000, estimated_biomass_kg: 334.4, notes: null, created_at: daysAgo(25) + "T08:00:00Z" },
    { id: "s1-4", cycle_id: "cycle-1", tank_id: "tank-1", sampled_at: daysAgo(10), sample_count: 30, total_weight_g: 372, abw_g: 12.4, survival_rate: 84, estimated_population: 42000, estimated_biomass_kg: 520.8, notes: "성장 양호", created_at: daysAgo(10) + "T08:00:00Z" },
  ],
  "cycle-2": [
    { id: "s2-1", cycle_id: "cycle-2", tank_id: "tank-2", sampled_at: daysAgo(28), sample_count: 30, total_weight_g: 36, abw_g: 1.2, survival_rate: 96, estimated_population: 43200, estimated_biomass_kg: 51.8, notes: null, created_at: daysAgo(28) + "T08:00:00Z" },
    { id: "s2-2", cycle_id: "cycle-2", tank_id: "tank-2", sampled_at: daysAgo(18), sample_count: 30, total_weight_g: 117, abw_g: 3.9, survival_rate: 93, estimated_population: 41850, estimated_biomass_kg: 163.2, notes: null, created_at: daysAgo(18) + "T08:00:00Z" },
    { id: "s2-3", cycle_id: "cycle-2", tank_id: "tank-2", sampled_at: daysAgo(7), sample_count: 30, total_weight_g: 234, abw_g: 7.8, survival_rate: 91, estimated_population: 40950, estimated_biomass_kg: 319.4, notes: null, created_at: daysAgo(7) + "T08:00:00Z" },
  ],
}

export const MOCK_CYCLE_COSTS: Record<string, CycleCost[]> = {
  "cycle-1": [
    { id: "c1-1", cycle_id: "cycle-1", category: "pl", label: "치어(PL12) 구매", amount: 750000, recorded_at: daysAgo(55), notes: "대성종묘 50,000마리", created_at: daysAgo(55) + "T00:00:00Z" },
    { id: "c1-2", cycle_id: "cycle-1", category: "feed", label: "배합사료 1차", amount: 1200000, recorded_at: daysAgo(40), notes: null, created_at: daysAgo(40) + "T00:00:00Z" },
    { id: "c1-3", cycle_id: "cycle-1", category: "feed", label: "배합사료 2차", amount: 1100000, recorded_at: daysAgo(20), notes: null, created_at: daysAgo(20) + "T00:00:00Z" },
    { id: "c1-4", cycle_id: "cycle-1", category: "electricity", label: "전기료 (5월)", amount: 980000, recorded_at: daysAgo(10), notes: null, created_at: daysAgo(10) + "T00:00:00Z" },
    { id: "c1-5", cycle_id: "cycle-1", category: "chemicals", label: "바실러스균 프로바이오틱스", amount: 320000, recorded_at: daysAgo(30), notes: null, created_at: daysAgo(30) + "T00:00:00Z" },
    { id: "c1-6", cycle_id: "cycle-1", category: "labor", label: "인건비 (4~5월)", amount: 500000, recorded_at: daysAgo(5), notes: null, created_at: daysAgo(5) + "T00:00:00Z" },
  ],
  "cycle-3": [
    { id: "c3-1", cycle_id: "cycle-3", category: "pl", label: "치어 구매", amount: 720000, recorded_at: daysAgo(130), notes: null, created_at: daysAgo(130) + "T00:00:00Z" },
    { id: "c3-2", cycle_id: "cycle-3", category: "feed", label: "배합사료 전체", amount: 4200000, recorded_at: daysAgo(80), notes: null, created_at: daysAgo(80) + "T00:00:00Z" },
    { id: "c3-3", cycle_id: "cycle-3", category: "electricity", label: "전기료 합계", amount: 2100000, recorded_at: daysAgo(20), notes: null, created_at: daysAgo(20) + "T00:00:00Z" },
    { id: "c3-4", cycle_id: "cycle-3", category: "labor", label: "인건비", amount: 1200000, recorded_at: daysAgo(20), notes: null, created_at: daysAgo(20) + "T00:00:00Z" },
    { id: "c3-5", cycle_id: "cycle-3", category: "chemicals", label: "약품·소독제", amount: 420000, recorded_at: daysAgo(50), notes: null, created_at: daysAgo(50) + "T00:00:00Z" },
  ],
}

export const MOCK_CYCLE_HARVESTS: Record<string, CycleHarvest[]> = {
  "cycle-3": [
    { id: "h3-1", cycle_id: "cycle-3", harvested_at: daysAgo(18), weight_kg: 720, count: 38400, price_per_kg: 16000, revenue: 11520000, notes: "전량 수확", created_at: daysAgo(18) + "T00:00:00Z" },
  ],
}
