import { supabase, DbFarm, DbTank, DbWaterQuality, DbJournalEntry, DbSensorDevice, DbProductionCycle, DbGrowthSample, DbCycleCost, DbCycleHarvest, DbInventoryItem, DbInventoryTransaction } from "@/lib/supabase"
import { Farm, Tank, WaterQualityReading, JournalEntry, DiagnosisResult, Alert, SensorDevice, ProductionCycle, GrowthSample, CycleCost, CycleHarvest, InventoryItem, InventoryTransaction } from "@/types"
import { checkThresholds } from "@/lib/thresholds"
import { PLAN_LIMITS, type Plan } from "@/lib/plans"
import { isTestAccount } from "@/lib/mock-data"

// ─────────────────────────────────────────────
// 타입 변환 헬퍼
// ─────────────────────────────────────────────
function toFarm(f: DbFarm, tankCount = 0): Farm {
  return { ...f, owner_name: f.owner_name ?? "", tank_count: tankCount }
}

function toTank(t: DbTank): Tank {
  return {
    ...t,
    stocking_date: t.stocking_date ?? null,
    harvest_date: t.harvest_date ?? null,
    tank_type: t.tank_type ?? "노지",
  }
}

function toWaterQuality(w: DbWaterQuality): WaterQualityReading {
  return {
    id: w.id,
    tank_id: w.tank_id,
    temperature: w.temperature ?? 0,
    ph: w.ph ?? 0,
    do_level: w.do_level ?? 0,
    salinity: w.salinity ?? 0,
    ammonia: w.ammonia ?? 0,
    nitrite: w.nitrite ?? 0,
    nitrate: w.nitrate ?? 0,
    alkalinity: w.alkalinity ?? 0,
    turbidity: w.turbidity ?? 0,
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

export async function createFarm(values: { name: string; location?: string; area?: number; owner_name?: string }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")

  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).single()
  const plan: Plan = isTestAccount(user.email) ? "pro" : ((profile?.plan as Plan) || "free")
  const limit = PLAN_LIMITS[plan].farms

  const { count } = await supabase.from("farms").select("*", { count: "exact", head: true }).eq("user_id", user.id)
  if (limit !== Infinity && (count ?? 0) >= limit) {
    throw new Error(`현재 플랜(${plan.toUpperCase()})에서는 양식장을 최대 ${limit}개까지 등록할 수 있습니다. 업그레이드하려면 /pricing 페이지를 방문하세요.`)
  }

  const { data, error } = await supabase
    .from("farms")
    .insert({ ...values, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return toFarm(data)
}

export async function updateFarm(id: string, values: Partial<{ name: string; location: string; owner_name: string; area: number }>) {
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
  return (data || []).map(toTank)
}

export async function getAllTanks(): Promise<Tank[]> {
  const { data, error } = await supabase
    .from("tanks")
    .select("*, farms!inner(user_id)")
    .order("name", { ascending: true })

  if (error) throw error
  return (data || []).map(toTank)
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
export async function getWaterQuality(tankId: string, hours = 168): Promise<WaterQualityReading[]> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data, error } = await supabase
    .from("water_quality_readings")
    .select("*")
    .eq("tank_id", tankId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true })

  if (error) throw error
  return (data || []).map(toWaterQuality)
}

export async function getLatestWaterQuality(tankId: string): Promise<WaterQualityReading | null> {
  const { data, error } = await supabase
    .from("water_quality_readings")
    .select("*")
    .eq("tank_id", tankId)
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

  // Auto-generate alerts and update tank status based on threshold violations
  const thresholdAlerts = checkThresholds({
    temperature: values.temperature,
    ph: values.ph,
    do_level: values.do_level,
    salinity: values.salinity,
    ammonia: values.ammonia,
    nitrite: values.nitrite,
    nitrate: values.nitrate,
    alkalinity: values.alkalinity,
    turbidity: values.turbidity,
  })
  for (const alert of thresholdAlerts) {
    try {
      await supabase.from("alerts").insert({
        tank_id: tankId,
        type: alert.type,
        parameter: alert.parameter,
        value: alert.value,
        threshold: alert.threshold,
        message: alert.message,
        resolved: false,
      })
    } catch { /* alert insert failure is non-fatal */ }
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
export async function getJournalEntries(
  tankId?: string,
  limit = 50,
  from?: string,
  to?: string,
  offset = 0
): Promise<JournalEntry[]> {
  let query = supabase
    .from("journal_entries")
    .select("*, tanks(name)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (tankId) query = query.eq("tank_id", tankId)
  if (from) query = query.gte("date", from)
  if (to) query = query.lte("date", to)

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((e) => ({
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
  }))
}

export async function updateJournalEntry(
  id: string,
  values: Partial<Omit<DbJournalEntry, "id" | "created_at" | "created_by">>
): Promise<JournalEntry> {
  const { data, error } = await supabase
    .from("journal_entries")
    .update(values)
    .eq("id", id)
    .select("*, tanks(name)")
    .single()

  if (error) throw error
  return {
    id: data.id,
    tank_id: data.tank_id,
    tank_name: (data.tanks as { name: string } | null)?.name ?? "",
    date: data.date,
    feeding_amount: data.feeding_amount ?? 0,
    feed_type: data.feed_type ?? "",
    feeding_times: data.feeding_times ?? 0,
    mortality_count: data.mortality_count ?? 0,
    water_exchange_rate: data.water_exchange_rate ?? 0,
    microbial_input: data.microbial_input ?? false,
    microbial_type: data.microbial_type ?? undefined,
    microbial_amount: data.microbial_amount ?? null,
    disinfection: data.disinfection ?? false,
    disinfection_type: data.disinfection_type ?? null,
    check_aeration: data.check_aeration ?? false,
    check_filtration: data.check_filtration ?? false,
    check_circulation: data.check_circulation ?? false,
    check_feeding_check: data.check_feeding_check ?? false,
    notes: data.notes ?? undefined,
    created_by: data.created_by ?? "",
    created_at: data.created_at,
  } as JournalEntry
}

export async function deleteJournalEntry(id: string) {
  const { error } = await supabase.from("journal_entries").delete().eq("id", id)
  if (error) throw error
}

export async function createJournalEntry(values: Omit<DbJournalEntry, "id" | "created_at" | "created_by">) {
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from("journal_entries")
    .insert({ ...values, created_by: user?.id ?? null })
    .select("*, tanks(name)")
    .single()

  if (error) throw error
  return {
    id: data.id,
    tank_id: data.tank_id,
    tank_name: (data.tanks as { name: string } | null)?.name ?? "",
    date: data.date,
    feeding_amount: data.feeding_amount ?? 0,
    feed_type: data.feed_type ?? "",
    feeding_times: data.feeding_times ?? 0,
    mortality_count: data.mortality_count ?? 0,
    water_exchange_rate: data.water_exchange_rate ?? 0,
    microbial_input: data.microbial_input ?? false,
    microbial_type: data.microbial_type ?? undefined,
    microbial_amount: data.microbial_amount ?? null,
    disinfection: data.disinfection ?? false,
    disinfection_type: data.disinfection_type ?? null,
    check_aeration: data.check_aeration ?? false,
    check_filtration: data.check_filtration ?? false,
    check_circulation: data.check_circulation ?? false,
    check_feeding_check: data.check_feeding_check ?? false,
    notes: data.notes ?? undefined,
    created_by: data.created_by ?? "",
    created_at: data.created_at,
  } as JournalEntry
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
    .select("*, tanks(name)")
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
    created_at: d.created_at,
  }
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
function toCycle(c: DbProductionCycle & { tanks?: { name: string; farms?: { name: string }[] }[] }): ProductionCycle {
  const doc = Math.floor((Date.now() - new Date(c.stocking_date).getTime()) / 86400000)
  return {
    id: c.id, tank_id: c.tank_id, user_id: c.user_id, name: c.name,
    status: c.status, stocking_date: c.stocking_date, stocking_count: c.stocking_count,
    pl_source: c.pl_source, pl_stage: c.pl_stage, pl_species: c.pl_species ?? null,
    target_weight_g: c.target_weight_g, target_harvest_date: c.target_harvest_date,
    actual_harvest_date: c.actual_harvest_date,
    actual_harvest_weight_kg: c.actual_harvest_weight_kg,
    actual_harvest_count: c.actual_harvest_count,
    notes: c.notes, created_at: c.created_at, updated_at: c.updated_at,
    tank_name: c.tanks?.[0]?.name,
    farm_name: c.tanks?.[0]?.farms?.[0]?.name,
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
  return (data || []).map((c) => toCycle(c as DbProductionCycle & { tanks: { name: string; farms: { name: string }[] }[] }))
}

export async function createProductionCycle(values: {
  tank_id: string; name: string; stocking_date: string; stocking_count: number
  pl_source?: string; pl_stage?: string; pl_species?: string; target_weight_g?: number; target_harvest_date?: string; notes?: string
}): Promise<ProductionCycle> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")
  const { data, error } = await supabase
    .from("production_cycles")
    .insert({ ...values, user_id: user.id, status: "active" })
    .select("*, tanks(name, farms(name))")
    .single()
  if (error) throw error
  return toCycle(data as DbProductionCycle & { tanks: { name: string; farms: { name: string }[] }[] })
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
