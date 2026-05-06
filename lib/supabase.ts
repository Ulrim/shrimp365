import { createBrowserClient } from "@supabase/ssr"

// 환경변수 없을 때 기본값 사용 (publishable key는 공개 안전)
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://okecfkqpoigxvlsomqjc.supabase.co"

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_Apo03iZBcxLWn-XsCCCHMw_H0iQW8_x"

// 싱글톤 클라이언트
export const supabase = createBrowserClient(supabaseUrl, supabaseKey)

// ── DB 타입 정의 ──────────────────────────────────
export type DbFarm = {
  id: string
  user_id: string
  name: string
  location: string
  area: number
  created_at: string
}

export type DbTank = {
  id: string
  farm_id: string
  name: string
  volume: number
  status: "active" | "warning" | "danger" | "inactive"
  stocking_density: number
  shrimp_count: number
  cycle_day: number
  stocking_date: string | null
  harvest_date: string | null
  created_at: string
}

export type DbWaterQuality = {
  id: string
  tank_id: string
  temperature: number | null
  ph: number | null
  do_level: number | null
  salinity: number | null
  ammonia: number | null
  nitrite: number | null
  nitrate: number | null
  alkalinity: number | null
  turbidity: number | null
  recorded_at: string
  created_at: string
}

export type DbJournalEntry = {
  id: string
  tank_id: string
  date: string
  feeding_amount: number
  feed_type: string
  feeding_times: number
  mortality_count: number
  water_exchange_rate: number
  microbial_input: boolean
  microbial_type: string | null
  microbial_amount: number | null
  disinfection: boolean
  disinfection_type: string | null
  check_aeration: boolean
  check_filtration: boolean
  check_circulation: boolean
  check_feeding_check: boolean
  notes: string | null
  created_by: string | null
  created_at: string
}

export type DbDiagnosis = {
  id: string
  tank_id: string
  test_type: string
  result: "양성" | "음성" | "의심"
  vibrio_count: number
  pathogenic_ratio: number
  risk_level: "low" | "medium" | "high" | "critical"
  tested_at: string
  tested_by: string | null
  action_taken: string | null
  notes: string | null
  created_at: string
}

export type DbAlert = {
  id: string
  tank_id: string
  type: "danger" | "warning" | "info"
  parameter: string | null
  value: number | null
  threshold: number | null
  message: string
  resolved: boolean
  created_at: string
}
