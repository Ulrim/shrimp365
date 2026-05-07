export interface User {
  id: string
  email: string
  name: string
  role: "admin" | "operator" | "viewer"
  farm_count?: number
}

export interface Farm {
  id: string
  user_id: string
  name: string
  location: string
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
