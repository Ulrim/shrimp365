import { createBrowserClient } from "@supabase/ssr"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL 및 NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수를 설정해주세요."
  )
}

// 싱글톤 클라이언트
export const supabase = createBrowserClient(supabaseUrl, supabaseKey)

// ── DB 타입 정의 ──────────────────────────────────
export type DbFarm = {
  id: string
  user_id: string
  name: string
  location: string
  latitude: number | null
  longitude: number | null
  owner_name: string
  area: number
  /** 마이그레이션 전 DB 에서는 컬럼이 없어 undefined 로 온다. */
  farm_type?: "shrimp" | "agriculture"
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
  tank_type: "노지" | "실내" | "반실내"
  /** 양액 레시피(농업 모드) — µS/cm 저장. 마이그레이션 전에는 undefined. */
  target_ec?: number | null
  ec_tolerance?: number
  target_ph?: number | null
  ph_tolerance?: number
  created_at: string
}

export type DbWaterQuality = {
  id: string
  tank_id: string
  device_id?: string | null
  temperature: number | null
  ph: number | null
  do_level: number | null
  salinity: number | null
  ammonia: number | null
  nitrite: number | null
  nitrate: number | null
  alkalinity: number | null
  turbidity: number | null
  conductivity?: number | null
  flow_rate?: number | null
  diff_pressure?: number | null
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

export type DbSensorDevice = {
  id: string
  tank_id: string
  name: string
  device_type: "multi" | "temperature" | "ph" | "do"
  api_key: string
  active: boolean
  last_seen_at: string | null
  serial: string | null
  firmware: string | null
  last_payload: Record<string, number | string | boolean> | null
  agent_version: string | null
  update_to: string | null
  update_status: "requested" | "downloading" | "applied" | "failed" | "rolled_back" | null
  update_message: string | null
  update_status_at: string | null
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

// ── 생산 관리 ────────────────────────────────────────
export type DbProductionCycle = {
  id: string
  tank_id: string
  user_id: string
  name: string
  status: "active" | "completed" | "cancelled"
  stocking_date: string
  stocking_count: number
  pl_source: string | null
  pl_stage: string | null
  pl_species: string | null
  target_weight_g: number | null
  target_harvest_date: string | null
  actual_harvest_date: string | null
  actual_harvest_weight_kg: number | null
  actual_harvest_count: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type DbGrowthSample = {
  id: string
  cycle_id: string
  tank_id: string
  sampled_at: string
  sample_count: number
  total_weight_g: number
  abw_g: number
  survival_rate: number | null
  estimated_population: number | null
  estimated_biomass_kg: number | null
  notes: string | null
  created_at: string
}

export type DbCycleCost = {
  id: string
  cycle_id: string
  category: "pl" | "feed" | "electricity" | "labor" | "chemicals" | "other"
  label: string
  amount: number
  recorded_at: string
  notes: string | null
  created_at: string
}

export type DbCycleHarvest = {
  id: string
  cycle_id: string
  harvested_at: string
  weight_kg: number
  count: number | null
  price_per_kg: number
  revenue: number
  notes: string | null
  created_at: string
}

// ── 재고 관리 ────────────────────────────────────────
export type DbInventoryItem = {
  id: string
  user_id: string
  category: "feed" | "probiotic" | "chemical" | "other"
  name: string
  unit: string
  current_stock: number
  reorder_level: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type DbInventoryTransaction = {
  id: string
  item_id: string
  user_id: string
  type: "in" | "out"
  quantity: number
  unit_price: number | null
  tank_id: string | null
  supplier: string | null
  recorded_at: string
  notes: string | null
  created_at: string
}
