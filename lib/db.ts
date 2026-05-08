import { supabase, DbFarm, DbTank, DbWaterQuality, DbJournalEntry, DbDiagnosis, DbAlert, DbSensorDevice } from "@/lib/supabase"
import { Farm, Tank, WaterQualityReading, JournalEntry, DiagnosisResult, Alert, SensorDevice } from "@/types"
import { checkThresholds } from "@/lib/thresholds"

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
