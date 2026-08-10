export interface User {
  id: string
  email: string
  name: string
  role: "admin" | "manager" | "operator" | "viewer"
  plan?: "free" | "basic" | "pro" | "enterprise"
  farm_count?: number
}

export interface Farm {
  id: string
  user_id: string
  name: string
  location: string
  /** 지도 표시와 기상 연동에 쓰는 좌표. 아직 안 정했으면 null. */
  latitude: number | null
  longitude: number | null
  owner_name?: string
  area: number
  tank_count: number
  created_at: string
}

export interface Tank {
  id: string
  farm_id: string
  name: string
  volume: number
  status: "active" | "warning" | "danger" | "inactive"
  stocking_density: number
  shrimp_count: number
  cycle_day: number
  stocking_date?: string | null
  harvest_date?: string | null
  tank_type?: "노지" | "실내" | "반실내"
  created_at: string
}

export interface WaterQualityReading {
  id: string
  tank_id: string
  device_id?: string | null   // 어느 센서(기기)가 잰 값인지. 예전 기록은 null.
  temperature: number
  ph: number
  do_level: number
  salinity: number
  ammonia: number
  nitrite: number
  nitrate: number
  alkalinity: number
  turbidity: number
  recorded_at: string
  created_at: string
}

export interface JournalEntry {
  id: string
  tank_id: string
  tank_name: string
  date: string
  feeding_amount: number
  feed_type: string
  feeding_times: number
  mortality_count: number
  water_exchange_rate: number
  microbial_input: boolean
  microbial_type?: string
  microbial_amount?: number | null
  disinfection: boolean
  disinfection_type?: string | null
  check_aeration: boolean
  check_filtration: boolean
  check_circulation: boolean
  check_feeding_check: boolean
  notes?: string
  created_by: string
  created_at: string
}

export interface DiagnosisResult {
  id: string
  tank_id: string
  tank_name: string
  test_type: "AHPND" | "총비브리오" | "EHP" | "WSSV" | "기타"
  result: "양성" | "음성" | "의심"
  vibrio_count: number
  pathogenic_ratio: number
  risk_level: "low" | "medium" | "high" | "critical"
  tested_at: string
  tested_by: string
  action_taken?: string
  notes?: string
}

export interface Alert {
  id: string
  tank_id: string
  tank_name: string
  type: "danger" | "warning" | "info"
  parameter: string
  value: number
  threshold: number
  message: string
  created_at: string
  resolved: boolean
}

export interface SensorDevice {
  id: string
  tank_id: string
  name: string
  device_type: "multi" | "temperature" | "ph" | "do"
  api_key: string
  active: boolean
  last_seen_at: string | null
  /** 라즈베리파이 CPU 시리얼 등 하드웨어 고정값. 기기가 스스로 보고한다. */
  serial: string | null
  /** 장비에서 도는 클라이언트 버전. */
  firmware: string | null
  /** 마지막으로 수신한 원본 측정값. 수질 기록에 저장하지 않는 값도 들어 있다. */
  last_payload: Record<string, number | string | boolean> | null
  /** 장비가 보고한 수집기 버전. 원격 업데이트의 기준이 된다. */
  agent_version: string | null
  /** 주인이 승인한 목표 버전. null 이면 업데이트하지 않는다. */
  update_to: string | null
  /** 기기가 되보고한 진행 상황. */
  update_status: "requested" | "downloading" | "applied" | "failed" | "rolled_back" | null
  update_message: string | null
  update_status_at: string | null
  created_at: string
}

export interface WaterQualityStandard {
  min: number
  max: number
  warning_min: number
  warning_max: number
  unit: string
  label: string
}

// ── 생산 관리 ────────────────────────────────────
export interface ProductionCycle {
  id: string
  tank_id: string
  tank_name?: string
  farm_name?: string
  user_id: string
  name: string
  status: "active" | "completed" | "cancelled"
  stocking_date: string
  stocking_count: number
  pl_source: string | null
  pl_stage: string | null
  initial_weight_g: number | null
  pl_species: string | null
  target_weight_g: number | null
  target_harvest_date: string | null
  actual_harvest_date: string | null
  actual_harvest_weight_kg: number | null
  actual_harvest_count: number | null
  notes: string | null
  created_at: string
  updated_at: string
  doc?: number
  latest_abw_g?: number
  latest_biomass_kg?: number
  survival_rate?: number
  total_feed_kg?: number
  fcr?: number
  total_cost?: number
  total_revenue?: number
  profit?: number
}

export interface GrowthSample {
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

export interface CycleCost {
  id: string
  cycle_id: string
  category: "pl" | "feed" | "electricity" | "labor" | "chemicals" | "other"
  label: string
  amount: number
  recorded_at: string
  notes: string | null
  created_at: string
}

export interface CycleHarvest {
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

// ── 재고 관리 ────────────────────────────────────
export interface InventoryItem {
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

export interface InventoryTransaction {
  id: string
  item_id: string
  item_name?: string
  item_unit?: string
  user_id: string
  type: "in" | "out"
  quantity: number
  unit_price: number | null
  tank_id: string | null
  tank_name?: string | null
  supplier: string | null
  recorded_at: string
  notes: string | null
  created_at: string
}
