import { Farm, Tank, WaterQualityReading, JournalEntry, DiagnosisResult, Alert } from "@/types"

export const MOCK_USER = {
  id: "mock-user-1",
  email: "admin@shrimp365.com",
  name: "김양식",
  role: "admin",
  farm_count: 2,
}

export const TEST_ACCOUNTS = [
  { email: "admin@shrimp365.com", password: "test1234", name: "김양식 (관리자)" },
  { email: "operator@shrimp365.com", password: "test1234", name: "이운영 (운영자)" },
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
  { id: "tank-1", farm_id: "farm-1", name: "A-1조", volume: 500, status: "active", stocking_density: 120, shrimp_count: 60000, cycle_day: 45, created_at: "2024-03-01" },
  { id: "tank-2", farm_id: "farm-1", name: "A-2조", volume: 500, status: "active", stocking_density: 115, shrimp_count: 57500, cycle_day: 45, created_at: "2024-03-01" },
  { id: "tank-3", farm_id: "farm-1", name: "B-1조", volume: 500, status: "active", stocking_density: 130, shrimp_count: 65000, cycle_day: 60, created_at: "2024-02-15" },
  { id: "tank-4", farm_id: "farm-1", name: "B-2조", volume: 500, status: "warning", stocking_density: 110, shrimp_count: 55000, cycle_day: 60, created_at: "2024-02-15" },
  { id: "tank-5", farm_id: "farm-1", name: "C-1조", volume: 500, status: "active", stocking_density: 100, shrimp_count: 50000, cycle_day: 30, created_at: "2024-04-01" },
  { id: "tank-6", farm_id: "farm-1", name: "C-2조", volume: 500, status: "danger", stocking_density: 95, shrimp_count: 47500, cycle_day: 30, created_at: "2024-04-01" },
  { id: "tank-7", farm_id: "farm-1", name: "D-1조", volume: 500, status: "active", stocking_density: 125, shrimp_count: 62500, cycle_day: 75, created_at: "2024-01-20" },
  { id: "tank-8", farm_id: "farm-1", name: "D-2조", volume: 500, status: "active", stocking_density: 118, shrimp_count: 59000, cycle_day: 75, created_at: "2024-01-20" },
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
  salinity: { min: 15, max: 25, warning_min: 12, warning_max: 28, unit: "ppt", label: "염분" },
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
