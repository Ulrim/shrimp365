import type { ComponentType } from "react"

/** 아이콘 자리에 꽂는 컴포넌트. 실제로 들어오는 건 늘 lucide-react 아이콘이다.
 *
 *  여기서 React.ElementType 을 쓰면 안 된다. @react-three/fiber 가 전역
 *  JSX.IntrinsicElements 에 three.js 요소(mesh, group, boxGeometry …)를 얹기
 *  때문에, ElementType 유니온이 그 태그들까지 삼킨다. 그러면 태그마다 받는
 *  prop 이 달라 공통 prop 이 하나도 안 남고 className 이 never 로 좁혀진다.
 *  받는 쪽을 컴포넌트로 못박아 두면 그 영향에서 벗어난다. */
export type IconComponent = ComponentType<{ className?: string }>

export interface User {
  id: string
  email: string
  name: string
  role: "admin" | "manager" | "operator" | "viewer" | "farmer"
  plan?: "free" | "basic" | "pro" | "enterprise"
  farm_count?: number
  /** 계정 기본 화면 모드(profiles.ui_mode). 마이그레이션 전 DB 는 값이 없어
   *  선택 필드로 두고, 읽는 쪽에서 "shrimp" 으로 간주한다. */
  ui_mode?: "shrimp" | "agriculture"
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
  /** 농장 유형 — 기본 새우 양식. agriculture 는 수경재배(농업 모드).
   *  마이그레이션 전 DB·목데이터는 값이 없을 수 있어 선택 필드로 두고,
   *  읽는 쪽에서 "shrimp" 으로 간주한다. */
  farm_type?: "shrimp" | "agriculture"
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
  /** 소속 농장의 유형. 수조 자신의 칸이 아니라 getAllTanks 의 farms 조인에서
   *  파생한 값이다 — 그래서 선택 필드다(조인 없이 읽는 경로는 채우지 않는다).
   *  화면이 "이 수조가 이 화면에 속하는가"를 판단하는 데만 쓴다. */
  farm_type?: "shrimp" | "agriculture"
  /** 양액 레시피(농업 모드 베드 전용) — µS/cm 저장. null 이면 미설정. */
  target_ec?: number | null
  /** 허용 오차(±µS/cm). 사업 목표 ±0.1 dS/m = 100 µS/cm. */
  ec_tolerance?: number
  target_ph?: number | null
  ph_tolerance?: number
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
  /** 전도도(uS/cm). EC 센서를 전도도 모드로 쓰는 농장에서만 채워진다. */
  conductivity?: number | null
  /** 순환 유량(L/min) — 수경재배 순환 라인. 안 재는 곳은 null. */
  flow_rate?: number | null
  /** 차압(kPa) — UV 살균기·필터 막힘 감시. 안 재는 곳은 null. */
  diff_pressure?: number | null
  // ── 환경·기상(스마트팜 장비 · supabase/migrations/environment_readings.sql) ──
  // 지그비 온습도·토양수분과 기상센서 값. 안 재는 장비·예전 기록은 null(또는 칸 자체가 없음).
  /** 기온(2m) 또는 초관부 온도(지상 10cm), °C */
  air_temp?: number | null
  /** 초관부 온도(지상 10cm), °C — 2m 기온과 둘 다 잴 때만(canopy_temp.sql) */
  canopy_temp?: number | null
  /** 상대습도, % */
  humidity?: number | null
  /** 토양 체적함수율, % */
  soil_moisture?: number | null
  /** 지온, °C */
  soil_temp?: number | null
  /** 평균 풍속, m/s */
  wind_speed?: number | null
  /** 돌풍, m/s */
  wind_gust?: number | null
  /** 풍향, 도(0=북) */
  wind_dir?: number | null
  /** 장비 현지 자정부터의 강수 누계, mm */
  rain_day?: number | null
  /** 강우강도, mm/h */
  rain_rate?: number | null
  /** 일사, W/m² */
  solar?: number | null
  /** 자외선 지수 */
  uv_index?: number | null
  /** 해면기압, hPa */
  pressure?: number | null
  recorded_at: string
  created_at: string
}

/** 분전반 전력 회로 한 줄(supabase/migrations/power_readings.sql). 장비가 5분마다 올린다. */
export interface PowerReading {
  tank_id: string
  circuit_id: string
  /** lib/power.ts POWER_TYPES 중 하나 */
  circuit_type: string
  state: 0 | 1 | null
  power_w: number | null
  current_a: number | null
  voltage_v: number | null
  energy_today_kwh: number | null
  device_temp: number | null
  recorded_at: string
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
  /** 이 일지가 달린 수조가 속한 농장의 유형. 일지 자신의 칸이 아니라
   *  getJournalEntries 의 tanks→farms 조인에서 파생한 값이다(조회는 늘지
   *  않는다) — 그래서 선택 필드다. 화면이 "이 일지가 이 화면(URL)에
   *  속하는가"를 판단하는 데만 쓴다. */
  farm_type?: "shrimp" | "agriculture"
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
  /** 이 알림이 달린 수조가 속한 농장의 유형. 알림 자신의 칸이 아니라
   *  getAlerts 의 tanks→farms 조인에서 파생한 값이다(조회는 늘지 않는다) —
   *  그래서 선택 필드다. 화면이 "이 알림이 이 화면(URL)에 속하는가"와
   *  "어느 쪽 이름표를 붙일 것인가"를 판단하는 데 쓴다. */
  farm_type?: "shrimp" | "agriculture"
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
  latitude?: number | null    // 페어링 때 휴대폰 위치로 기록된 장비 좌표
  longitude?: number | null
  located_at?: string | null
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

// ── 개체수 모니터링 (카메라 비전) ────────────────────
//
// 카메라는 수조에 달린 장비다 — sensor_devices 와 같은 자리에 있고, 양식장은
// tank → farm 으로 따라간다. 개체수 기록은 수조·양식장 id 를 함께 들고 있어
// 수질 기록과 tank_id 로 곧장 맞물린다.

export interface VisionCamera {
  id: string
  tank_id: string
  name: string
  camera_type: "picamera" | "usb" | "rtsp" | "http"
  /** usb 는 장치 번호("0"), rtsp/http 는 전체 주소. 미설정이면 null. */
  stream_url: string | null
  resolution_w: number
  resolution_h: number
  /** 추론 샘플링 FPS(0.5~5) — 영상 재생 속도가 아니라 "초당 몇 번 세는가". */
  fps_target: number
  is_active: boolean
  install_height: number | null
  tank_area_m2: number | null
  /** 라즈베리파이 CPU 시리얼 — 페어링 때 장비가 스스로 보고한다. */
  serial: string | null
  firmware: string | null
  agent_version: string | null
  /** 장비가 마지막으로 살아 있음을 알린 시각. 연결 여부 판단에 쓴다. */
  last_seen_at: string | null
  /** 이 카메라를 서비스하는 장비의 공개 주소. 파이가 여러 대면 카메라마다 다르다. */
  host_url: string | null
  created_at: string
  /** 목록 조회에서 조인해 오는 표시용 값. 단건 조회에는 없다. */
  tank_name?: string
  farm_name?: string
}

export type VisionCameraStatus = "running" | "online" | "offline" | "error"

export interface CountRecord {
  time: string
  camera_id: string
  tank_id: string
  farm_id: string
  count: number
  confidence_avg: number | null
  model_version: string | null
  inference_ms: number | null
  /** 추정 체장(cm). 먹이망 격자로 축척을 잡은 장비만 보낸다. */
  length_cm?: number | null
}

/** vision_count_history() 가 돌려주는 한 칸. */
export interface CountBucket {
  bucket: string
  avg_count: number
  max_count: number
  min_count: number
  confidence_avg: number | null
  sample_count: number
  /** 추정 체장의 평균(cm). 길이 기준을 안 잡은 장비는 NULL 이라 빠진다. */
  avg_length_cm: number | null
}

/** vision_count_wq_series() 가 돌려주는 한 칸 — 개체수와 수질을 같은 시각에 맞춘 값.
 *  한쪽만 측정된 구간이 흔해서(수질은 분 단위, 개체수는 초 단위) 각 항목이 null 일 수 있다. */
export interface CountWaterQualityPoint {
  bucket: string
  avg_count: number | null
  count_samples: number
  avg_temperature: number | null
  avg_do: number | null
  avg_ph: number | null
  wq_samples: number
}

export type VisionAlertType = "count_drop" | "count_spike" | "offline" | "threshold"

export interface VisionAlertConfig {
  id: string
  camera_id: string | null
  user_id: string
  alert_type: VisionAlertType
  threshold_value: number | null
  threshold_pct: number | null
  window_minutes: number
  is_enabled: boolean
  notify_email: string | null
  notify_webhook: string | null
  created_at: string
}

/** WebSocket 으로 오는 실시간 이벤트. 비전 서비스가 미는 세 종류가 전부다. */
export type VisionEvent =
  | {
      type: "count_update"
      camera_id: string
      timestamp: string
      count: number
      confidence_avg: number | null
      bbox_count: number
      bboxes: { x1: number; y1: number; x2: number; y2: number; confidence: number }[]
      frame_width: number
      frame_height: number
      inference_ms: number
    }
  | {
      type: "alert"
      camera_id: string
      tank_id: string
      alert_type: VisionAlertType | "compound"
      severity: "danger" | "warning"
      message: string
      timestamp: string
    }
  | {
      type: "camera_status"
      camera_id: string
      status: VisionCameraStatus
      message: string
    }

// ─────────────────────────────────────────────
// 노지 재해위험 판단(OFDF 병합) — docs/plans/openfield-merge.md 4장
// ─────────────────────────────────────────────

/** 판단 근거 하나 — 어떤 변수가 어느 값일 때 얼마나 기여했는가. 카드는 첫 항목의 label 만 쓴다. */
export interface FieldRiskEvidence {
  feature: string
  /** 농가 말 라벨(엣지가 붙여 준 ko). 없으면 화면이 feature 를 env 사전으로 번역한다. */
  label: string | null
  value: number | null
  contribution: number | null
}

/** 권고 조치 하나. OFDF 는 하드웨어를 직접 돌리지 않으므로 `executed` 는 "엣지가 실행으로
 *  분류했다"는 뜻이고, 화면에는 모두 "할 일"로 보인다(advisory 는 권고). */
export interface FieldRiskAction {
  device: string
  command: string
  layer: number | null
  reason: string | null
  risk_type: string | null
  executed: boolean
  /** 현장 규칙·안전장치가 막은 조치. 있으면 회색으로 보인다. */
  rejected_by: string | null
  advisory: boolean
}

export type FieldRiskType = "heat_dry" | "rain_wet" | "disease" | "frost" | "compound"

/** 판단 1건 = field_risk_judgements 1행. (risk × horizon_h) 가 한 시각에 최대 10건. */
export interface FieldRiskJudgement {
  id: string
  tank_id: string
  device_id: string | null
  /** 판단 시각(ISO, tz 포함). */
  ts: string
  risk: FieldRiskType
  horizon_h: 1 | 3
  /** 0 정상 · 1 주의 · 2 경계 · 3 긴급(OFDF 등급 그대로). */
  level: 0 | 1 | 2 | 3
  /** OFDF 가 쓰는 한국어 등급명 — 참고용. 화면은 사전으로 번역한다. */
  level_name: string | null
  confidence: number | null
  model_version: string | null
  expected_onset: string | null
  evidence: FieldRiskEvidence[]
  actions: FieldRiskAction[]
  /** 그때의 기상·토양 9항목(t_air, canopy_temp, rh, leaf_wetness, solar_w, rain, soil_moisture, soil_index, wind_speed). */
  environment: Partial<Record<string, number>>
  created_at: string
}
