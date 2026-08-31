import { supabase, DbFarm, DbTank, DbWaterQuality, DbJournalEntry, DbSensorDevice, DbProductionCycle, DbGrowthSample, DbCycleCost, DbCycleHarvest, DbInventoryItem, DbInventoryTransaction } from "@/lib/supabase"
import { Farm, Tank, WaterQualityReading, JournalEntry, DiagnosisResult, Alert, SensorDevice, ProductionCycle, GrowthSample, CycleCost, CycleHarvest, InventoryItem, InventoryTransaction } from "@/types"
import { checkThresholds, checkRecipe, hasRecipe, resolvableParameters, type TankRecipe, type FarmProfile } from "@/lib/thresholds"
import { PLAN_LIMITS, type Plan } from "@/lib/plans"
import { isTestAccount } from "@/lib/mock-data"

// ─────────────────────────────────────────────
// 타입 변환 헬퍼
// ─────────────────────────────────────────────
function toFarm(f: DbFarm, tankCount = 0): Farm {
  return {
    ...f,
    owner_name: f.owner_name ?? "",
    // 마이그레이션 전이면 컬럼이 없어 undefined 로 온다. null 로 맞춰 둔다.
    latitude: f.latitude ?? null,
    longitude: f.longitude ?? null,
    // 마이그레이션 전이면 컬럼이 없다. 기본은 언제나 새우 양식이다.
    farm_type: f.farm_type ?? "shrimp",
    tank_count: tankCount,
  }
}

/** 조인해 온 farms 행에서 농장 유형을 뽑는다.
 *  Supabase 조인 결과는 카디널리티에 따라 객체 또는 배열로 온다.
 *  마이그레이션 전 DB 에는 farm_type 칸이 없어 undefined 로 오므로 새우로 본다. */
function joinedFarmType(row: { farms?: unknown }): "shrimp" | "agriculture" {
  const joined = row.farms
  const farm = Array.isArray(joined) ? joined[0] : joined
  return (farm as { farm_type?: string } | undefined)?.farm_type === "agriculture"
    ? "agriculture"
    : "shrimp"
}

/** 조인해 온 `tanks(name, farms(*))` 에서 그 수조가 속한 농장의 유형을 뽑는다.
 *
 *  알림·일지처럼 수조를 참조하는 목록이 **자기 축을 스스로 들고 오게** 하는
 *  공통 경로다. 화면 쪽에서 tank_id → 수조 목록 → farm_type 으로 되짚지
 *  않아도 되고, 이미 있던 `tanks(name)` 조인을 넓히는 것이라 조회는 한 번도
 *  늘지 않는다. 수조 목록을 들고 있지 않은 화면(알림 패널)도 판정할 수 있다.
 *
 *  `farms(*)` 로 받는 이유는 getAllTanks 와 같다 — 마이그레이션 전 DB 에는
 *  farm_type 칸이 없어 이름으로 집으면 쿼리 전체가 400 으로 죽는다.
 *
 *  조인이 비면(수조가 지워진 알림 등) undefined 를 준다. "모르는 것"과
 *  "새우인 것"을 구분해 두고, 읽는 쪽(belongsToAgriScreen)이 새우로 본다. */
function joinedTankFarmType(joined: unknown): "shrimp" | "agriculture" | undefined {
  const tank = Array.isArray(joined) ? joined[0] : joined
  if (!tank) return undefined
  return joinedFarmType(tank as { farms?: unknown })
}

function toTank(t: DbTank, farmType?: "shrimp" | "agriculture"): Tank {
  return {
    ...t,
    // 농장 유형은 조인해 온 경우에만 싣는다. 조인 없는 경로에서 "shrimp" 를
    // 기본으로 채우면 "모르는 것"과 "새우인 것"이 구분되지 않는다.
    ...(farmType ? { farm_type: farmType } : {}),
    stocking_date: t.stocking_date ?? null,
    harvest_date: t.harvest_date ?? null,
    tank_type: t.tank_type ?? "노지",
    // 양액 레시피 — 미설정(NULL)과 마이그레이션 전(undefined)을 같게 다룬다.
    target_ec: t.target_ec ?? null,
    ec_tolerance: t.ec_tolerance ?? 100,
    target_ph: t.target_ph ?? null,
    ph_tolerance: t.ph_tolerance ?? 0.5,
  }
}

function toWaterQuality(w: DbWaterQuality): WaterQualityReading {
  return {
    id: w.id,
    tank_id: w.tank_id,
    device_id: w.device_id ?? null,
    temperature: w.temperature ?? 0,
    ph: w.ph ?? 0,
    do_level: w.do_level ?? 0,
    salinity: w.salinity ?? 0,
    ammonia: w.ammonia ?? 0,
    nitrite: w.nitrite ?? 0,
    nitrate: w.nitrate ?? 0,
    alkalinity: w.alkalinity ?? 0,
    turbidity: w.turbidity ?? 0,
    // 전도도는 안 쓰는 농장이 대부분이라 0 으로 채우지 않는다 —
    // 0 으로 두면 "쟀는데 0" 과 "안 쟀다" 가 구분되지 않는다.
    conductivity: w.conductivity ?? null,
    // 유량·차압도 전도도와 같은 이유로 0 을 채우지 않는다.
    flow_rate: w.flow_rate ?? null,
    diff_pressure: w.diff_pressure ?? null,
    recorded_at: w.recorded_at,
    created_at: w.created_at,
  }
}

// ─────────────────────────────────────────────
// FARMS
// ─────────────────────────────────────────────
export async function getFarms(): Promise<Farm[]> {
  const { data, error } = await supabase
    .from("farms")
    .select("*, tanks(count)")
    .order("created_at", { ascending: true })

  if (error) throw error
  return (data || []).map((f: DbFarm & { tanks: { count: number }[] }) =>
    toFarm(f, f.tanks?.[0]?.count ?? 0)
  )
}

// farm_type 은 정의된 경우에만 insert 에 싣는다 — 마이그레이션 전 DB 에서
// 새우 계정의 농장 추가가 "없는 컬럼" 오류로 막히면 안 된다.
export async function createFarm(values: { name: string; location?: string; area?: number; owner_name?: string; latitude?: number | null; longitude?: number | null; farm_type?: "shrimp" | "agriculture" }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")

  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).single()
  const plan: Plan = isTestAccount(user.email) ? "pro" : ((profile?.plan as Plan) || "free")
  const limit = PLAN_LIMITS[plan].farms

  const { count } = await supabase.from("farms").select("*", { count: "exact", head: true }).eq("user_id", user.id)
  if (limit !== Infinity && (count ?? 0) >= limit) {
    throw new Error(`현재 플랜(${plan.toUpperCase()})에서는 양식장을 최대 ${limit}개까지 등록할 수 있습니다. 업그레이드하려면 /pricing 페이지를 방문하세요.`)
  }

  const { farm_type, ...rest } = values
  const { data, error } = await supabase
    .from("farms")
    .insert({ ...rest, ...(farm_type !== undefined ? { farm_type } : {}), user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return toFarm(data)
}

export async function updateFarm(id: string, values: Partial<{ name: string; location: string; owner_name: string; area: number; latitude: number | null; longitude: number | null; farm_type: "shrimp" | "agriculture" }>) {
  const { data, error } = await supabase
    .from("farms")
    .update(values)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return toFarm(data)
}

export async function deleteFarm(id: string) {
  const { error } = await supabase.from("farms").delete().eq("id", id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// TANKS
// ─────────────────────────────────────────────
export async function getTanksByFarm(farmId: string): Promise<Tank[]> {
  const { data, error } = await supabase
    .from("tanks")
    .select("*")
    .eq("farm_id", farmId)
    .order("name", { ascending: true })

  if (error) throw error
  // 화살표로 감싼다 — `.map(toTank)` 는 두 번째 인자로 index 를 넘긴다.
  return (data || []).map(t => toTank(t))
}

export async function getAllTanks(): Promise<Tank[]> {
  // farms 조인은 원래 RLS 용이었다. 여기에 농장 유형을 함께 실어, 화면이
  // "이 수조가 지금 이 화면(URL)에 속하는가"를 판단할 수 있게 한다.
  //
  // farm_type 을 이름으로 집지 않고 `*` 로 받는 이유: 마이그레이션 전 DB 에는
  // 그 칸이 없어 이름을 집으면 쿼리 전체가 400 으로 죽는다. 그러면 기존 새우
  // 계정의 수조 목록이 통째로 사라진다.
  const { data, error } = await supabase
    .from("tanks")
    .select("*, farms!inner(*)")
    .order("name", { ascending: true })

  if (error) throw error
  return (data || []).map(t => toTank(t, joinedFarmType(t)))
}

export async function createTank(values: {
  farm_id: string
  name: string
  volume: number
  stocking_density: number
  shrimp_count: number
  cycle_day?: number
  stocking_date?: string | null
  harvest_date?: string | null
  tank_type?: "노지" | "실내" | "반실내"
  /** 양액 레시피(농업 모드) — µS/cm. 정의된 경우에만 insert 에 실린다. */
  target_ec?: number | null
  ec_tolerance?: number
  target_ph?: number | null
  ph_tolerance?: number
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")

  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).single()
  const plan: Plan = isTestAccount(user.email) ? "pro" : ((profile?.plan as Plan) || "free")
  const limit = PLAN_LIMITS[plan].tanksPerFarm

  if (limit !== Infinity) {
    const { count } = await supabase.from("tanks").select("*", { count: "exact", head: true }).eq("farm_id", values.farm_id)
    if ((count ?? 0) >= limit) {
      throw new Error(`현재 플랜(${plan.toUpperCase()})에서는 양식장당 수조를 최대 ${limit}개까지 등록할 수 있습니다. 업그레이드하려면 /pricing 페이지를 방문하세요.`)
    }
  }

  const { data, error } = await supabase
    .from("tanks")
    .insert(values)
    .select()
    .single()

  if (error) throw error
  return toTank(data)
}

export async function updateTank(id: string, values: Partial<DbTank>) {
  const { data, error } = await supabase
    .from("tanks")
    .update(values)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return toTank(data)
}

export async function deleteTank(id: string) {
  const { error } = await supabase.from("tanks").delete().eq("id", id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// WATER QUALITY
// ─────────────────────────────────────────────
// deviceId 를 주면 그 센서(기기)가 잰 값만 돌려준다. 없으면 수조 전체(합산).
//
// Supabase API 는 요청당 최대 1,000행만 준다. 센서 여러 대가 분 단위로 올리면
// 7일치는 수만 행이라, 예전처럼 "오래된 순 + 상한" 으로 받으면 화면이
// 가장 오래된 일부만 보게 된다(최신 값·센서 표시가 영영 안 보이는 버그).
// 그래서 ① DB 함수 wq_series(구간 평균으로 압축, 전 구간 커버)를 먼저 쓰고,
// ② 함수가 아직 없으면(마이그레이션 전) 최신 순으로 1,000행을 받아 뒤집는다
//    — 이 경우 구간이 길면 최근 것부터 보이는 게 옳다.
type WqSeriesRow = {
  recorded_at: string; device_id: string | null
  temperature: number | null; ph: number | null; do_level: number | null
  salinity: number | null; ammonia: number | null; nitrite: number | null
  nitrate: number | null; alkalinity: number | null; turbidity: number | null
  conductivity?: number | null
  flow_rate?: number | null
  diff_pressure?: number | null
}

export async function getWaterQuality(tankId: string, hours = 168, deviceId?: string | null): Promise<WaterQualityReading[]> {
  // ① 구간 평균 시리즈 (전 구간 커버, 행 수 상한 안전)
  const { data: series, error: rpcError } = await supabase.rpc("wq_series", {
    p_tank: tankId,
    p_hours: hours,
    p_device: deviceId ?? null,
  })
  if (!rpcError && Array.isArray(series)) {
    return (series as WqSeriesRow[]).map(r => toWaterQuality({
      id: `${r.recorded_at}:${r.device_id ?? "manual"}`,
      tank_id: tankId,
      device_id: r.device_id,
      temperature: r.temperature, ph: r.ph, do_level: r.do_level,
      salinity: r.salinity, ammonia: r.ammonia, nitrite: r.nitrite,
      nitrate: r.nitrate, alkalinity: r.alkalinity, turbidity: r.turbidity,
      conductivity: r.conductivity ?? null,
      flow_rate: r.flow_rate ?? null,
      diff_pressure: r.diff_pressure ?? null,
      recorded_at: r.recorded_at,
      created_at: r.recorded_at,
    }))
  }

  // ② 폴백 — 최신 순 1,000행을 받아 시간순으로 뒤집는다.
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()
  let query = supabase
    .from("water_quality_readings")
    .select("*")
    .eq("tank_id", tankId)
    .gte("recorded_at", since)
  if (deviceId) query = query.eq("device_id", deviceId)

  const { data, error } = await query.order("recorded_at", { ascending: false }).limit(1000)

  if (error) throw error
  return (data || []).map(toWaterQuality).reverse()
}

export async function getLatestWaterQuality(tankId: string, deviceId?: string | null): Promise<WaterQualityReading | null> {
  let query = supabase
    .from("water_quality_readings")
    .select("*")
    .eq("tank_id", tankId)
  if (deviceId) query = query.eq("device_id", deviceId)

  const { data, error } = await query
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return toWaterQuality(data)
}

export async function insertWaterQuality(
  tankId: string,
  values: Omit<WaterQualityReading, "id" | "tank_id" | "created_at">
) {
  const { data, error } = await supabase
    .from("water_quality_readings")
    .insert({ ...values, tank_id: tankId })
    .select()
    .single()

  if (error) throw error

  // 판정 프로필과 베드 레시피를 한 번에 조회한다.
  //
  // 지금까지 이 수동 입력 경로에는 checkRecipe 가 아예 없었다 — 센서로 들어온
  // 값에는 레시피 이탈 알림이 생기는데 손으로 적은 같은 값에는 안 생겼다.
  // 두 경로의 판정이 다르면 농가는 어느 쪽도 믿지 않는다. 대칭으로 맞춘다.
  //
  // 판정 축은 URL 이 아니라 farms.farm_type 이다(설계서 3-5). 조회 실패는
  // 비치명 — profile 은 "shrimp", recipe 는 null 로 남아 기존 흐름 그대로다.
  let recipe: TankRecipe | null = null
  let profile: FarmProfile = "shrimp"
  try {
    const { data: tankRow, error: tankErr } = await supabase
      .from("tanks")
      .select("target_ec, ec_tolerance, target_ph, ph_tolerance, farms!inner(farm_type)")
      .eq("id", tankId)
      .maybeSingle()
    if (tankErr) console.warn("[db] 베드 레시피·농장유형 조회 실패 — shrimp 프로필로 진행:", tankErr.message)
    if (tankRow) {
      recipe = tankRow as TankRecipe
      const joined = (tankRow as { farms?: unknown }).farms
      const farmRow = Array.isArray(joined) ? joined[0] : joined
      if ((farmRow as { farm_type?: string } | undefined)?.farm_type === "agriculture") {
        profile = "agriculture"
      }
      // 레시피는 농업 농장에서만 적용한다 — 센서 경로와 같은 규칙.
      // 농장을 shrimp 로 되돌려도 tanks 의 target_ec/target_ph 는 남고, 새우
      // 농장 폼에는 그 칸이 없어 지울 방법이 없다. 그 잔재를 적용하면 염도
      // 알림이 영구히 사라지고 양식지 pH 가 매번 danger 로 뜬다.
      if (profile !== "agriculture") recipe = null
    }
  } catch { /* 컬럼 없음 등 — 기본값(새우·레시피 없음)으로 진행 */ }

  // Auto-generate alerts and update tank status based on threshold violations
  const globalValues = {
    temperature: values.temperature,
    ph: values.ph,
    do_level: values.do_level,
    salinity: values.salinity,
    ammonia: values.ammonia,
    nitrite: values.nitrite,
    nitrate: values.nitrate,
    alkalinity: values.alkalinity,
    turbidity: values.turbidity,
  }
  // 센서 경로(app/api/sensors/data/route.ts)와 같은 예외 규칙.
  //  - 염도: 레시피가 있는 베드에서는 새우 해수 기준이 오탐이 된다.
  //  - pH: 목표 pH 가 있으면 레시피가 판정을 맡는다. 전역 체크와 둘이 다투면
  //    같은 parameter("pH") 알림이 저장할 때마다 뒤집힌다.
  if (hasRecipe(recipe)) delete (globalValues as { salinity?: number }).salinity
  if (recipe?.target_ph != null) delete (globalValues as { ph?: number }).ph

  const thresholdAlerts = [
    ...checkThresholds(globalValues, profile),
    ...checkRecipe({ conductivity: values.conductivity ?? undefined, ph: values.ph }, recipe),
  ]
  // 같은 항목이 아직 열려 있으면 새 줄을 만들지 않고 그 줄을 갱신한다.
  // 센서 경로(app/api/sensors/data/route.ts)와 **같은 규칙**이다.
  //
  // 이 경로에는 원래 중복 억제도 자동 해제도 없었다. 수동 입력은 하루 몇 번이라
  // 밤새 480건 쌓이는 문제가 없었기 때문이다. 그런데 열린 알림 **개수**를 세는
  // 화면이 생기면서(대시보드 "EC 이탈" 타일) 결과가 달라졌다 — 이탈한 값을
  // 손으로 적을 때마다 개수가 1씩 오르고, 정상값을 적어도 내려가지 않는다.
  // 센서가 없는 베드에서는 다음 수신이 닫아 주지도 않으니 영영 0 이 안 된다.
  // 두 경로의 알림 규칙을 하나로 맞춘다.
  for (const alert of thresholdAlerts) {
    try {
      const { data: open } = await supabase
        .from("alerts")
        .select("id")
        .eq("tank_id", tankId)
        .eq("parameter", alert.parameter)
        .eq("resolved", false)
        .limit(1)
        .maybeSingle()

      if (open) {
        // 이미 알린 상태다. 최신 값과 심각도만 반영한다.
        await supabase
          .from("alerts")
          .update({ type: alert.type, value: alert.value, message: alert.message })
          .eq("id", open.id)
      } else {
        await supabase.from("alerts").insert({
          tank_id: tankId,
          type: alert.type,
          parameter: alert.parameter,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
          resolved: false,
        })
      }
    } catch { /* alert insert failure is non-fatal */ }
  }

  // 범위 안으로 돌아온 항목은 알림을 닫는다. 안 닫으면 위 중복 억제 때문에
  // 다음에 정말 문제가 생겨도 옛 알림만 갱신되고 새로 알리지 않는다.
  //
  // 판정한 항목만 닫는다 — resolvableParameters 가 값 키를 알림 키("수온")로
  // 바꾸면서 "이번에 판정한 것만" 을 함께 거른다. 빈 칸으로 저장된 0 은
  // 판정도 복귀도 아니다(그래서 안 적은 항목이 남의 알림을 닫지 않는다).
  const stillBad = new Set(thresholdAlerts.map(a => a.parameter))
  const recovered = resolvableParameters(globalValues, profile)
    .filter(p => !stillBad.has(p))
  // 레시피 알림은 parameter 가 값 키와 달라("EC"/"pH") 별도 매핑으로 잡는다.
  // 0 은 판정에서 제외했으므로 복귀에서도 제외한다(비대칭이면 전극이 물 밖에
  // 나온 순간 진짜 이탈 알림이 닫힌다).
  const ec = values.conductivity
  if (recipe?.target_ec != null && ec != null && ec !== 0 && !stillBad.has("EC")) {
    recovered.push("EC")
  }
  if (recipe?.target_ph != null && values.ph !== 0 && !stillBad.has("pH")) {
    recovered.push("pH")
  }
  if (recovered.length > 0) {
    try {
      await supabase
        .from("alerts")
        .update({ resolved: true })
        .eq("tank_id", tankId)
        .eq("resolved", false)
        .in("parameter", recovered)
    } catch { /* non-fatal */ }
  }

  // Sync tank status with the worst threshold level from this reading
  const newStatus = thresholdAlerts.some(a => a.type === "danger") ? "danger"
    : thresholdAlerts.some(a => a.type === "warning") ? "warning"
    : "active"
  try {
    await supabase.from("tanks").update({ status: newStatus }).eq("id", tankId)
  } catch { /* non-fatal */ }

  return toWaterQuality(data)
}

// ─────────────────────────────────────────────
// JOURNAL ENTRIES
// ─────────────────────────────────────────────
/** journal_entries 행 → JournalEntry.
 *
 *  조회·생성·수정 세 경로가 **같은 매핑**을 쓰게 한군데로 모은다. 같은
 *  타입인데 경로마다 필드가 있다 없다 하면, 화면의 축 필터
 *  (belongsToAgriScreen)가 방금 저장한 일지를 남의 축으로 보고 목록에서
 *  지워 버린다 — 저장은 됐는데 카드가 사라지니 농가는 다시 쓴다.
 *
 *  farm_type 은 일지 자신의 칸이 아니라 tanks→farms 조인에서 파생한다.
 *  그래서 세 경로 모두 select 에 `tanks(name, farms(*))` 를 실어야 한다.
 *  이미 있던 `tanks(name)` 조인을 넓히는 것이라 조회는 한 번도 늘지 않고,
 *  `farms(*)` 로 받는 이유는 getAllTanks 와 같다 — 마이그레이션 전 DB 에는
 *  farm_type 칸이 없어 이름으로 집으면 쿼리 전체가 400 으로 죽는다. */
function toJournalEntry(e: DbJournalEntry & { tanks?: unknown }): JournalEntry {
  return {
    id: e.id,
    tank_id: e.tank_id,
    tank_name: (e.tanks as { name: string } | null)?.name ?? "",
    date: e.date,
    feeding_amount: e.feeding_amount ?? 0,
    feed_type: e.feed_type ?? "",
    feeding_times: e.feeding_times ?? 0,
    mortality_count: e.mortality_count ?? 0,
    water_exchange_rate: e.water_exchange_rate ?? 0,
    microbial_input: e.microbial_input ?? false,
    microbial_type: e.microbial_type ?? undefined,
    microbial_amount: e.microbial_amount ?? null,
    disinfection: e.disinfection ?? false,
    disinfection_type: e.disinfection_type ?? null,
    check_aeration: e.check_aeration ?? false,
    check_filtration: e.check_filtration ?? false,
    check_circulation: e.check_circulation ?? false,
    check_feeding_check: e.check_feeding_check ?? false,
    notes: e.notes ?? undefined,
    created_by: e.created_by ?? "",
    created_at: e.created_at,
    farm_type: joinedTankFarmType(e.tanks),
  }
}

// 세 경로가 같은 조인을 쓴다. 하나만 좁히면 farm_type 이 빠져 축 필터가
// 방금 저장한 일지를 지운다 — 문자열을 나눠 두지 않는 이유다.
const JOURNAL_SELECT = "*, tanks(name, farms(*))"

export async function getJournalEntries(
  tankId?: string,
  limit = 50,
  from?: string,
  to?: string,
  offset = 0
): Promise<JournalEntry[]> {
  let query = supabase
    .from("journal_entries")
    .select(JOURNAL_SELECT)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (tankId) query = query.eq("tank_id", tankId)
  if (from) query = query.gte("date", from)
  if (to) query = query.lte("date", to)

  const { data, error } = await query
  if (error) throw error

  return (data || []).map(toJournalEntry)
}

export async function updateJournalEntry(
  id: string,
  values: Partial<Omit<DbJournalEntry, "id" | "created_at" | "created_by">>
): Promise<JournalEntry> {
  const { data, error } = await supabase
    .from("journal_entries")
    .update(values)
    .eq("id", id)
    .select(JOURNAL_SELECT)
    .single()

  if (error) throw error
  return toJournalEntry(data)
}

export async function deleteJournalEntry(id: string) {
  const { error } = await supabase.from("journal_entries").delete().eq("id", id)
  if (error) throw error
}

export async function createJournalEntry(values: Omit<DbJournalEntry, "id" | "created_at" | "created_by">): Promise<JournalEntry> {
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from("journal_entries")
    .insert({ ...values, created_by: user?.id ?? null })
    .select(JOURNAL_SELECT)
    .single()

  if (error) throw error
  return toJournalEntry(data)
}

// ─────────────────────────────────────────────
// DIAGNOSIS RESULTS
// ─────────────────────────────────────────────
export async function getDiagnoses(
  tankId?: string,
  from?: string,
  to?: string,
  offset = 0,
  limit = 50
): Promise<DiagnosisResult[]> {
  let query = supabase
    .from("diagnosis_results")
    .select("*, tanks(name)")
    .order("tested_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (tankId) query = query.eq("tank_id", tankId)
  if (from) query = query.gte("tested_at", from)
  if (to) query = query.lte("tested_at", to + "T23:59:59")

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((d) => ({
    id: d.id,
    tank_id: d.tank_id,
    tank_name: (d.tanks as { name: string } | null)?.name ?? "",
    test_type: d.test_type as DiagnosisResult["test_type"],
    result: d.result as DiagnosisResult["result"],
    vibrio_count: d.vibrio_count ?? 0,
    pathogenic_ratio: d.pathogenic_ratio ?? 0,
    risk_level: d.risk_level as DiagnosisResult["risk_level"],
    tested_at: d.tested_at,
    tested_by: d.tested_by ?? "",
    action_taken: d.action_taken ?? undefined,
    notes: d.notes ?? undefined,
  }))
}

export async function updateDiagnosis(
  id: string,
  values: Partial<{
    tank_id: string
    test_type: string
    result: string
    vibrio_count: number
    pathogenic_ratio: number
    risk_level: string
    action_taken: string | null
    notes: string | null
  }>
): Promise<DiagnosisResult> {
  const { data, error } = await supabase
    .from("diagnosis_results")
    .update(values)
    .eq("id", id)
    .select("*, tanks(name)")
    .single()

  if (error) throw error
  return {
    id: data.id,
    tank_id: data.tank_id,
    tank_name: (data.tanks as { name: string } | null)?.name ?? "",
    test_type: data.test_type as DiagnosisResult["test_type"],
    result: data.result as DiagnosisResult["result"],
    vibrio_count: data.vibrio_count ?? 0,
    pathogenic_ratio: data.pathogenic_ratio ?? 0,
    risk_level: data.risk_level as DiagnosisResult["risk_level"],
    tested_at: data.tested_at,
    tested_by: data.tested_by ?? "",
    action_taken: data.action_taken ?? undefined,
    notes: data.notes ?? undefined,
  } as DiagnosisResult
}

export async function deleteDiagnosis(id: string) {
  const { error } = await supabase.from("diagnosis_results").delete().eq("id", id)
  if (error) throw error
}

export async function getDiagnosisCount(): Promise<number> {
  const { count, error } = await supabase
    .from("diagnosis_results")
    .select("*", { count: "exact", head: true })
    .in("risk_level", ["high", "critical"])
  if (error) return 0
  return count ?? 0
}

export async function createDiagnosis(values: {
  tank_id: string
  test_type: string
  result: string
  vibrio_count: number
  pathogenic_ratio: number
  risk_level: string
  action_taken?: string
  notes?: string
}) {
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from("diagnosis_results")
    .insert({ ...values, tested_by: user?.id ?? null })
    .select("*, tanks(name)")
    .single()

  if (error) throw error
  return {
    id: data.id,
    tank_id: data.tank_id,
    tank_name: (data.tanks as { name: string } | null)?.name ?? "",
    test_type: data.test_type as DiagnosisResult["test_type"],
    result: data.result as DiagnosisResult["result"],
    vibrio_count: data.vibrio_count ?? 0,
    pathogenic_ratio: data.pathogenic_ratio ?? 0,
    risk_level: data.risk_level as DiagnosisResult["risk_level"],
    tested_at: data.tested_at,
    tested_by: data.tested_by ?? "",
    action_taken: data.action_taken ?? undefined,
    notes: data.notes ?? undefined,
  } as DiagnosisResult
}

// ─────────────────────────────────────────────
// ALERTS
// ─────────────────────────────────────────────
export async function getAlerts(onlyActive = true): Promise<Alert[]> {
  let query = supabase
    .from("alerts")
    .select("*, tanks(name, farms(*))")
    .order("created_at", { ascending: false })
    .limit(50)

  if (onlyActive) query = query.eq("resolved", false)

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((a) => ({
    id: a.id,
    tank_id: a.tank_id,
    tank_name: (a.tanks as { name: string } | null)?.name ?? "",
    type: a.type as Alert["type"],
    parameter: a.parameter ?? "",
    value: a.value ?? 0,
    threshold: a.threshold ?? 0,
    message: a.message,
    created_at: a.created_at,
    resolved: a.resolved,
    farm_type: joinedTankFarmType(a.tanks),
  }))
}

export async function resolveAlert(id: string) {
  const { error } = await supabase
    .from("alerts")
    .update({ resolved: true })
    .eq("id", id)
  if (error) throw error
}

export async function createAlert(values: {
  tank_id: string
  type: "danger" | "warning" | "info"
  parameter?: string
  value?: number
  threshold?: number
  message: string
}) {
  const { data, error } = await supabase
    .from("alerts")
    .insert(values)
    .select()
    .single()
  if (error) throw error
  return data
}

// ─────────────────────────────────────────────
// SENSOR DEVICES
// ─────────────────────────────────────────────

function toSensorDevice(d: DbSensorDevice): SensorDevice {
  return {
    id: d.id,
    tank_id: d.tank_id,
    name: d.name,
    device_type: d.device_type,
    api_key: d.api_key,
    active: d.active,
    last_seen_at: d.last_seen_at,
    serial: d.serial ?? null,
    firmware: d.firmware ?? null,
    last_payload: d.last_payload ?? null,
    agent_version: d.agent_version ?? null,
    update_to: d.update_to ?? null,
    update_status: d.update_status ?? null,
    update_message: d.update_message ?? null,
    update_status_at: d.update_status_at ?? null,
    created_at: d.created_at,
  }
}

/** 이 기기에 특정 버전으로의 업데이트를 승인한다.
 *  기기는 다음 확인 때(하루 한 번) 이 값을 보고 받아 간다.
 *  null 을 주면 승인을 거둬들인다 — 아직 안 받아 갔다면 취소된다. */
export async function requestDeviceUpdate(id: string, version: string | null): Promise<SensorDevice> {
  // 다운그레이드 승인 방지 — 장비는 현재보다 높지 않은 버전을 거부하므로
  // (updater.py), 낮거나 같은 버전을 승인해 두면 장비가 매번 거부하고
  // 승인이 영영 소비되지 않는 상태로 남는다. 여기서 미리 막는다.
  if (version) {
    const { data: dev } = await supabase
      .from("sensor_devices").select("agent_version").eq("id", id).single()
    const cur = dev?.agent_version as string | null | undefined
    const parse = (v: string) => v.split(".").map(Number)
    if (cur && /^\d+\.\d+\.\d+$/.test(cur) && /^\d+\.\d+\.\d+$/.test(version)) {
      const [a, b] = [parse(version), parse(cur)]
      const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]
      if (!newer) throw new Error(`현재 버전(${cur})보다 높은 버전만 승인할 수 있습니다.`)
    }
  }

  const { data, error } = await supabase
    .from("sensor_devices")
    .update({
      update_to: version,
      update_requested_at: version ? new Date().toISOString() : null,
      update_status: version ? "requested" : null,
      update_message: null,
    })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return toSensorDevice(data)
}

export async function getSensorDevices(tankId: string): Promise<SensorDevice[]> {
  const { data, error } = await supabase
    .from("sensor_devices")
    .select("*")
    .eq("tank_id", tankId)
    .order("created_at", { ascending: true })

  if (error) throw error
  return (data || []).map(toSensorDevice)
}

export async function createSensorDevice(values: {
  tank_id: string
  name: string
  device_type: SensorDevice["device_type"]
}): Promise<SensorDevice> {
  const { data, error } = await supabase
    .from("sensor_devices")
    .insert(values)
    .select()
    .single()

  if (error) throw error
  return toSensorDevice(data)
}

export async function deleteSensorDevice(id: string): Promise<void> {
  const { error } = await supabase.from("sensor_devices").delete().eq("id", id)
  if (error) throw error
}

export async function toggleSensorDevice(id: string, active: boolean): Promise<SensorDevice> {
  const { data, error } = await supabase
    .from("sensor_devices")
    .update({ active })
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return toSensorDevice(data)
}

// ─────────────────────────────────────────────
// 생산 관리 — 타입 변환 헬퍼
// ─────────────────────────────────────────────
function toCycle(c: DbProductionCycle & { tanks?: { name?: string; farms?: { name?: string } | null } | null }): ProductionCycle {
  const doc = Math.floor((Date.now() - new Date(c.stocking_date).getTime()) / 86400000)
  return {
    id: c.id, tank_id: c.tank_id, user_id: c.user_id, name: c.name,
    status: c.status, stocking_date: c.stocking_date, stocking_count: c.stocking_count,
    pl_source: c.pl_source, pl_stage: c.pl_stage, pl_species: c.pl_species ?? null,
    initial_weight_g: (c as unknown as { initial_weight_g?: number | null }).initial_weight_g ?? null,
    target_weight_g: c.target_weight_g, target_harvest_date: c.target_harvest_date,
    actual_harvest_date: c.actual_harvest_date,
    actual_harvest_weight_kg: c.actual_harvest_weight_kg,
    actual_harvest_count: c.actual_harvest_count,
    notes: c.notes, created_at: c.created_at, updated_at: c.updated_at,
    tank_name: c.tanks?.name,
    farm_name: c.tanks?.farms?.name,
    doc: c.status === "active" ? Math.max(0, doc) : undefined,
  }
}

function toSample(s: DbGrowthSample): GrowthSample { return { ...s } }
function toCost(c: DbCycleCost): CycleCost { return { ...c } }
function toHarvest(h: DbCycleHarvest): CycleHarvest { return { ...h } }

// ─────────────────────────────────────────────
// 생산 사이클 CRUD
// ─────────────────────────────────────────────
export async function getProductionCycles(tankId?: string): Promise<ProductionCycle[]> {
  let q = supabase
    .from("production_cycles")
    .select("*, tanks(name, farms(name))")
    .order("stocking_date", { ascending: false })
  if (tankId) q = q.eq("tank_id", tankId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((c) => toCycle(c as DbProductionCycle & { tanks?: { name?: string; farms?: { name?: string } | null } | null }))
}

export async function createProductionCycle(values: {
  tank_id: string; name: string; stocking_date: string; stocking_count: number
  pl_source?: string; pl_stage?: string; pl_species?: string; initial_weight_g?: number; target_weight_g?: number; target_harvest_date?: string; notes?: string
}): Promise<ProductionCycle> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")
  const { data, error } = await supabase
    .from("production_cycles")
    .insert({ ...values, user_id: user.id, status: "active" })
    .select("*, tanks(name, farms(name))")
    .single()
  if (error) throw error
  return toCycle(data as DbProductionCycle & { tanks?: { name?: string; farms?: { name?: string } | null } | null })
}

export async function updateProductionCycle(id: string, values: Partial<{
  name: string; status: "active" | "completed" | "cancelled"
  target_weight_g: number; target_harvest_date: string
  actual_harvest_date: string; actual_harvest_weight_kg: number; actual_harvest_count: number; notes: string
}>): Promise<void> {
  const { error } = await supabase.from("production_cycles").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) throw error
}

export async function deleteProductionCycle(id: string): Promise<void> {
  const { error } = await supabase.from("production_cycles").delete().eq("id", id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// 성장 샘플링 CRUD
// ─────────────────────────────────────────────
export async function getGrowthSamples(cycleId: string): Promise<GrowthSample[]> {
  const { data, error } = await supabase
    .from("growth_samples")
    .select("*")
    .eq("cycle_id", cycleId)
    .order("sampled_at", { ascending: true })
  if (error) throw error
  return (data || []).map(toSample)
}

export async function createGrowthSample(values: {
  cycle_id: string; tank_id: string; sampled_at: string
  sample_count: number; total_weight_g: number
  survival_rate?: number; notes?: string
}): Promise<GrowthSample> {
  if (!values.sample_count || values.sample_count <= 0) {
    throw new Error("표본 수는 1 이상이어야 합니다.")
  }
  const abw_g = values.total_weight_g / values.sample_count
  const { data: cycleData } = await supabase.from("production_cycles").select("stocking_count").eq("id", values.cycle_id).single()
  const stocking = cycleData?.stocking_count ?? 0
  const survRate = values.survival_rate ?? null
  const est_pop = survRate !== null && stocking > 0 ? Math.round(stocking * survRate / 100) : null
  const est_biomass = est_pop !== null ? Math.round(est_pop * abw_g) / 1000 : null

  const { data, error } = await supabase
    .from("growth_samples")
    .insert({ ...values, abw_g, estimated_population: est_pop, estimated_biomass_kg: est_biomass })
    .select()
    .single()
  if (error) throw error
  return toSample(data)
}

export async function deleteGrowthSample(id: string): Promise<void> {
  const { error } = await supabase.from("growth_samples").delete().eq("id", id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// 비용 CRUD
// ─────────────────────────────────────────────
export async function getCycleCosts(cycleId: string): Promise<CycleCost[]> {
  const { data, error } = await supabase
    .from("cycle_costs")
    .select("*")
    .eq("cycle_id", cycleId)
    .order("recorded_at", { ascending: true })
  if (error) throw error
  return (data || []).map(toCost)
}

export async function createCycleCost(values: {
  cycle_id: string; category: CycleCost["category"]; label: string; amount: number; recorded_at: string; notes?: string
}): Promise<CycleCost> {
  const { data, error } = await supabase.from("cycle_costs").insert(values).select().single()
  if (error) throw error
  return toCost(data)
}

export async function deleteCycleCost(id: string): Promise<void> {
  const { error } = await supabase.from("cycle_costs").delete().eq("id", id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// 수확 CRUD
// ─────────────────────────────────────────────
export async function getCycleHarvests(cycleId: string): Promise<CycleHarvest[]> {
  const { data, error } = await supabase
    .from("cycle_harvests")
    .select("*")
    .eq("cycle_id", cycleId)
    .order("harvested_at", { ascending: true })
  if (error) throw error
  return (data || []).map(toHarvest)
}

export async function createCycleHarvest(values: {
  cycle_id: string; harvested_at: string; weight_kg: number; price_per_kg: number; count?: number; notes?: string
}): Promise<CycleHarvest> {
  const revenue = values.weight_kg * values.price_per_kg
  const { data, error } = await supabase
    .from("cycle_harvests")
    .insert({ ...values, revenue })
    .select()
    .single()
  if (error) throw error
  return toHarvest(data)
}

export async function deleteCycleHarvest(id: string): Promise<void> {
  const { error } = await supabase.from("cycle_harvests").delete().eq("id", id)
  if (error) throw error
}

// ─────────────────────────────────────────────
// 재고 관리
// ─────────────────────────────────────────────
function toInventoryItem(r: DbInventoryItem): InventoryItem { return { ...r } }

function toInventoryTransaction(r: DbInventoryTransaction & { inventory_items?: { name: string; unit: string } | null; tanks?: { name: string } | null }): InventoryTransaction {
  return {
    ...r,
    item_name: r.inventory_items?.name,
    item_unit: r.inventory_items?.unit,
    tank_name: r.tanks?.name ?? null,
  }
}

export async function getInventoryItems(): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .order("category", { ascending: true })
  if (error) throw error
  return (data || []).map(toInventoryItem)
}

export async function createInventoryItem(values: {
  category: InventoryItem["category"]; name: string; unit: string
  current_stock?: number; reorder_level?: number; notes?: string
}): Promise<InventoryItem> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")
  const { data, error } = await supabase
    .from("inventory_items")
    .insert({ ...values, user_id: user.id, current_stock: values.current_stock ?? 0, reorder_level: values.reorder_level ?? 0 })
    .select()
    .single()
  if (error) throw error
  return toInventoryItem(data)
}

export async function updateInventoryItem(id: string, values: Partial<{
  name: string; category: InventoryItem["category"]; unit: string
  current_stock: number; reorder_level: number; notes: string | null
}>): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase.from("inventory_items").delete().eq("id", id)
  if (error) throw error
}

export async function getInventoryTransactions(itemId?: string): Promise<InventoryTransaction[]> {
  let q = supabase
    .from("inventory_transactions")
    .select("*, inventory_items(name, unit), tanks(name)")
    .order("recorded_at", { ascending: false })
    .limit(200)
  if (itemId) q = q.eq("item_id", itemId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((r) => toInventoryTransaction(r as DbInventoryTransaction & { inventory_items: { name: string; unit: string } | null; tanks: { name: string } | null }))
}

export async function createInventoryTransaction(values: {
  item_id: string; type: "in" | "out"; quantity: number
  unit_price?: number; tank_id?: string; supplier?: string
  recorded_at: string; notes?: string
}): Promise<InventoryTransaction> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")

  const { data, error } = await supabase
    .from("inventory_transactions")
    .insert({ ...values, user_id: user.id })
    .select("*, inventory_items(name, unit), tanks(name)")
    .single()
  if (error) throw error

  // Update current_stock
  const { data: item } = await supabase.from("inventory_items").select("current_stock").eq("id", values.item_id).single()
  if (item) {
    const delta = values.type === "in" ? values.quantity : -values.quantity
    await supabase.from("inventory_items").update({ current_stock: Math.max(0, item.current_stock + delta), updated_at: new Date().toISOString() }).eq("id", values.item_id)
  }

  return toInventoryTransaction(data as DbInventoryTransaction & { inventory_items: { name: string; unit: string } | null; tanks: { name: string } | null })
}

export async function deleteInventoryTransaction(id: string, itemId: string, type: "in" | "out", quantity: number): Promise<void> {
  const { error } = await supabase.from("inventory_transactions").delete().eq("id", id)
  if (error) throw error

  const { data: item } = await supabase.from("inventory_items").select("current_stock").eq("id", itemId).single()
  if (item) {
    const delta = type === "in" ? -quantity : quantity
    await supabase.from("inventory_items").update({ current_stock: Math.max(0, item.current_stock + delta), updated_at: new Date().toISOString() }).eq("id", itemId)
  }
}
