/**
 * recommendation-service — 추천(운전 레시피) 조립 + 버전 영속화.
 * 원본: mrv-platform/apps/api/app/services/recommendation_service.py
 *
 * ★ 산식은 `computeRecommendation` 을 호출만 한다. 이 모듈의 책임은 조립과 저장 규칙:
 *   1) DB 행(readings/meters/tanks/harvest_logs/feed_logs)을 RecommendationInput 으로 변환,
 *   2) 엔진 호출,
 *   3) 결과가 직전 버전과 다를 때만 recipe_versions 에 새 버전 추가,
 *   4) 라우터가 감쌀 수 있는 형태로 반환.
 *
 * 결정론 경계: generated_at 과 조회 lookback 기간은 "언제 어떤 데이터를 모을지"를 정하는
 * 조립 메타데이터이지 산식 입력이 아니다.
 */

import {
  DEFAULT_CONFIG_VERSION,
  computeRecommendation,
  recommendConfigFromParams,
} from "./kpi"
import type { DoBand, DoReading, FeedReading, ParamsJson } from "./kpi"
import { T, fetchAll, newId, type MrvDb } from "./db"

export const RECIPE_TYPES = ["feed", "oxygen", "circulation"] as const
export type RecipeType = (typeof RECIPE_TYPES)[number]

const FEED_HISTORY_LOOKBACK_DAYS = 14
const AERATION_LOOKBACK_DAYS = 14

const RATIONALE_MARKERS: readonly [string, RecipeType][] = [
  ["[급이]", "feed"],
  ["[산소]", "oxygen"],
  ["[순환]", "circulation"],
]

async function loadActiveConfig(
  db: MrvDb,
): Promise<{ version: string; params: ParamsJson }> {
  const { data, error } = await db
    .from(T.kpiConfig)
    .select("version, params_json")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as { version: string; params_json: ParamsJson } | null
  return row
    ? { version: row.version, params: row.params_json ?? {} }
    : { version: DEFAULT_CONFIG_VERSION, params: {} }
}

/** 사이트의 특정 타입 계측기 id 목록. */
async function meterIdsOfType(
  db: MrvDb,
  siteId: string,
  type: string,
): Promise<string[]> {
  const rows = await fetchAll<{ id: string }>((f, t) =>
    db
      .from(T.meters)
      .select("id")
      .eq("site_id", siteId)
      .eq("type", type)
      .order("id", { ascending: true })
      .range(f, t),
  )
  return rows.map((r) => r.id)
}

/** 최신 유효('ok') DO 샘플. 없으면 null → 엔진이 "추천 불가"로 처리한다. */
async function latestDoReading(db: MrvDb, siteId: string): Promise<DoReading | null> {
  const meterIds = await meterIdsOfType(db, siteId, "do")
  if (meterIds.length === 0) return null
  const { data, error } = await db
    .from(T.readings)
    .select("time, meter_id, value, quality_flag")
    .in("meter_id", meterIds)
    .eq("quality_flag", "ok")
    .order("time", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as {
    time: string
    meter_id: string
    value: number
    quality_flag: string
  } | null
  if (!row) return null
  return {
    meterId: row.meter_id,
    ts: new Date(row.time),
    doMgL: row.value,
    qualityFlag: row.quality_flag,
  }
}

/** 최신 유효 수온. 수온 계측기가 없는 사이트는 null. */
async function latestWaterTemp(db: MrvDb, siteId: string): Promise<number | null> {
  const meterIds = await meterIdsOfType(db, siteId, "temp")
  if (meterIds.length === 0) return null
  const { data, error } = await db
    .from(T.readings)
    .select("value")
    .in("meter_id", meterIds)
    .eq("quality_flag", "ok")
    .order("time", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { value: number } | null)?.value ?? null
}

/**
 * 사이트의 DO 목표대역(첫 유효 대역 수조 — id 오름차순).
 * 대역이 설정된 수조가 하나도 없으면 어떤 실측값도 근접 판정에 걸리지 않는 넓은 중립
 * 대역으로 폴백한다. 산식 판단이 아니라 '대역 데이터 부재 시 조립 기본값'이다
 * (엔진은 doMin < doMax 인 유한값을 요구하므로 null 을 넘길 수 없다).
 */
async function doBandForSite(db: MrvDb, siteId: string): Promise<DoBand> {
  const tanks = await fetchAll<{
    id: string
    target_do_min: number | null
    target_do_max: number | null
  }>((f, t) =>
    db
      .from(T.tanks)
      .select("id, target_do_min, target_do_max")
      .eq("site_id", siteId)
      .order("id", { ascending: true })
      .range(f, t),
  )
  for (const tank of tanks) {
    if (tank.target_do_min !== null && tank.target_do_max !== null) {
      return { doMin: tank.target_do_min, doMax: tank.target_do_max }
    }
  }
  return { doMin: 0.0, doMax: 100.0 }
}

/** 최근 harvest_logs 기준 생체량(가장 최근 1행). */
async function latestBiomassKg(db: MrvDb, siteId: string): Promise<number | null> {
  const { data, error } = await db
    .from(T.harvestLogs)
    .select("biomass_kg")
    .eq("site_id", siteId)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { biomass_kg: number } | null)?.biomass_kg ?? null
}

async function siteBatchIds(db: MrvDb, siteId: string): Promise<string[]> {
  const tanks = await fetchAll<{ id: string }>((f, t) =>
    db
      .from(T.tanks)
      .select("id")
      .eq("site_id", siteId)
      .order("id", { ascending: true })
      .range(f, t),
  )
  if (tanks.length === 0) return []
  const batches = await fetchAll<{ id: string }>((f, t) =>
    db
      .from(T.batches)
      .select("id")
      .in(
        "tank_id",
        tanks.map((x) => x.id),
      )
      .order("id", { ascending: true })
      .range(f, t),
  )
  return batches.map((b) => b.id)
}

/** [start, end) 급이 이력. quality_flag 필터는 엔진이 한다(여기서 거르지 않는다). */
async function feedHistory(
  db: MrvDb,
  siteId: string,
  start: Date,
  end: Date,
): Promise<FeedReading[]> {
  const batchIds = await siteBatchIds(db, siteId)
  if (batchIds.length === 0) return []
  const rows = await fetchAll<{
    id: string
    batch_id: string
    ts: string
    feed_kg: number
    quality_flag: string
  }>((f, t) =>
    db
      .from(T.feedLogs)
      .select("id, batch_id, ts, feed_kg, quality_flag")
      .in("batch_id", batchIds)
      .gte("ts", start.toISOString())
      .lt("ts", end.toISOString())
      .order("ts", { ascending: true })
      .range(f, t),
  )
  return rows.map((f) => ({
    sourceRef: f.id,
    batchId: f.batch_id,
    ts: new Date(f.ts),
    feedKg: f.feed_kg,
    qualityFlag: f.quality_flag,
  }))
}

/** 폭기 계측기의 [start, end) 'ok' 전력 합. */
async function recentAerationPowerKwh(
  db: MrvDb,
  siteId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const meters = await fetchAll<{ id: string }>((f, t) =>
    db
      .from(T.meters)
      .select("id")
      .eq("site_id", siteId)
      .eq("is_aeration", true)
      .order("id", { ascending: true })
      .range(f, t),
  )
  if (meters.length === 0) return 0.0
  const rows = await fetchAll<{ value: number }>((f, t) =>
    db
      .from(T.readings)
      .select("value")
      .in(
        "meter_id",
        meters.map((m) => m.id),
      )
      .gte("time", start.toISOString())
      .lt("time", end.toISOString())
      .eq("quality_flag", "ok")
      // 이 행들을 합산하므로 페이지 경계가 흔들리면 합이 틀린다(정렬 없는 LIMIT/OFFSET 은
      // 행 순서를 보장하지 않아 일부가 빠지거나 두 번 세어질 수 있다).
      .order("time", { ascending: true })
      .order("meter_id", { ascending: true })
      .range(f, t),
  )
  return rows.reduce((acc, r) => acc + r.value, 0.0)
}

/**
 * 엔진이 만든 결합 rationale("[급이] … [산소] … [순환] …")을 타입별 문장으로 나눈다.
 * 이미 산출된 텍스트의 표시용 분할일 뿐 새 판단이 아니다. 엔진이 세 마커를 항상 이
 * 순서로 이어붙이므로 위치 기준 분할이 안전하고, 마커가 없으면(포맷이 바뀌면) 전체
 * 문자열을 그대로 담아 방어적으로 동작한다.
 */
function splitRationale(rationale: string): Record<RecipeType, string> {
  const positions = RATIONALE_MARKERS.map(([marker]) => rationale.indexOf(marker))
  if (positions.some((p) => p < 0)) {
    return Object.fromEntries(
      RATIONALE_MARKERS.map(([, key]) => [key, rationale]),
    ) as Record<RecipeType, string>
  }
  const order = positions
    .map((pos, i) => ({ pos, i }))
    .sort((a, b) => a.pos - b.pos)

  const parts = {} as Record<RecipeType, string>
  order.forEach((entry, idx) => {
    const start = entry.pos
    const end = idx + 1 < order.length ? order[idx + 1].pos : rationale.length
    parts[RATIONALE_MARKERS[entry.i][1]] = rationale.slice(start, end).trim()
  })
  return parts
}

type RecipeRow = { id: string; site_id: string; org_id: string; type: string; current_version: number }

/** recipes(site_id, type) 유니크 행을 조회하고, 없으면 최초 생성한다. */
async function getOrCreateRecipe(
  db: MrvDb,
  siteId: string,
  orgId: string,
  recipeType: RecipeType,
): Promise<RecipeRow> {
  const { data, error } = await db
    .from(T.recipes)
    .select("id, site_id, org_id, type, current_version")
    .eq("site_id", siteId)
    .eq("type", recipeType)
    .maybeSingle()
  if (error) throw error
  if (data) return data as RecipeRow

  const row: RecipeRow = {
    id: newId("recipe"),
    site_id: siteId,
    org_id: orgId,
    type: recipeType,
    current_version: 0,
  }
  const { error: insertError } = await db.from(T.recipes).insert(row)
  if (insertError) throw insertError
  return row
}

/**
 * 파라미터가 최신 버전과 같으면 새 버전을 만들지 않는다.
 * 추천은 조회할 때마다 계산되므로, 결과가 그대로인데도 버전을 늘리면 이력이 의미 없는
 * 행으로 뒤덮여 "언제 무엇이 바뀌었는가"를 읽을 수 없게 된다.
 * 엔진이 결정론적이라 같은 입력이면 같은 표현이 나오므로 값 비교로 충분하다.
 */
async function persistVersionIfChanged(
  db: MrvDb,
  recipe: RecipeRow,
  paramsJson: Record<string, unknown>,
  rationale: string,
  createdBy: string,
): Promise<number> {
  const { data, error } = await db
    .from(T.recipeVersions)
    .select("params_json")
    .eq("recipe_id", recipe.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error

  const latest = data as { params_json: Record<string, unknown> } | null
  if (latest && JSON.stringify(latest.params_json) === JSON.stringify(paramsJson)) {
    return recipe.current_version
  }

  const newVersion = recipe.current_version + 1
  const { error: insertError } = await db.from(T.recipeVersions).insert({
    id: newId("recipever"),
    recipe_id: recipe.id,
    org_id: recipe.org_id, // 항상 부모 recipe 와 동일(RLS 앵커).
    version: newVersion,
    params_json: paramsJson,
    rationale,
    created_by: createdBy,
  })
  if (insertError) throw insertError

  const { error: updateError } = await db
    .from(T.recipes)
    .update({ current_version: newVersion })
    .eq("id", recipe.id)
  if (updateError) throw updateError

  return newVersion
}

export type RecommendationItemData = {
  type: RecipeType
  recipe_id: string
  current_version: number
  params: Record<string, unknown>
  source_refs: string[]
  rationale: string
  config_version: string
}

/**
 * 3종 추천을 산출하고 필요할 때만 새 버전을 남긴다.
 * ⚠ 호출 전에 resolveSiteForOrg 로 site 소유권이 검증되어 있어야 한다.
 */
export async function computeSiteRecommendations(
  db: MrvDb,
  siteId: string,
  orgId: string,
  actorId: string,
): Promise<RecommendationItemData[]> {
  const { version: configVersion, params } = await loadActiveConfig(db)
  const recommendConfig = recommendConfigFromParams(params)

  const generatedAt = new Date()
  const periodStart = new Date(
    generatedAt.getTime() - FEED_HISTORY_LOOKBACK_DAYS * 86_400_000,
  )
  const aerationStart = new Date(
    generatedAt.getTime() - AERATION_LOOKBACK_DAYS * 86_400_000,
  )

  const output = computeRecommendation(
    {
      doLatest: await latestDoReading(db, siteId),
      doBand: await doBandForSite(db, siteId),
      waterTempLatest: await latestWaterTemp(db, siteId),
      biomassLatestKg: await latestBiomassKg(db, siteId),
      feedHistory: await feedHistory(db, siteId, periodStart, generatedAt),
      aerationPowerRecentKwh: await recentAerationPowerKwh(
        db,
        siteId,
        aerationStart,
        generatedAt,
      ),
      periodStart,
      periodEnd: generatedAt,
    },
    recommendConfig,
    configVersion,
  )

  const rationaleByType = splitRationale(output.rationale)
  const valueByType: Record<RecipeType, Record<string, unknown>> = {
    feed: { feed_kg_per_day: output.feedKgPerDay },
    oxygen: { oxygen_target_do_mg_l: output.oxygenTargetDoMgL },
    circulation: { circulation_setting: output.circulationSetting },
  }
  // 순환 추천의 근거도 DO 계측값이므로 산소와 같은 참조를 단다(원본과 동일).
  const refsByType: Record<RecipeType, readonly string[]> = {
    feed: output.sourceRefs.feed ?? [],
    oxygen: output.sourceRefs.do ?? [],
    circulation: output.sourceRefs.do ?? [],
  }

  const items: RecommendationItemData[] = []
  for (const recipeType of RECIPE_TYPES) {
    const recipe = await getOrCreateRecipe(db, siteId, orgId, recipeType)
    const value = valueByType[recipeType]
    const refs = [...refsByType[recipeType]]
    const currentVersion = await persistVersionIfChanged(
      db,
      recipe,
      { ...value, source_refs: refs },
      rationaleByType[recipeType],
      actorId,
    )
    items.push({
      type: recipeType,
      recipe_id: recipe.id,
      current_version: currentVersion,
      params: value,
      source_refs: refs,
      rationale: rationaleByType[recipeType],
      config_version: configVersion,
    })
  }
  return items
}
