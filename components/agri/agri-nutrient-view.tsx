"use client"

// 양액 관리 — `/daumlabs/water-quality` 전용 뷰(설계서 mode-split.md 5장, 시안 5-6).
//
// 위에서 아래로: 헤더 → 선택 줄(베드·센서·기간·자동 갱신) → 상태 스트립 →
// 최신값 카드 6개 → 추세 차트(탭 6개 = AGRI_PARAMS 순서) → 센서별 비교(센서 2대↑)
// → 알림. 데이터는 lib/db.ts 함수만 쓰고, 뷰 안에서 `farm_type === "agriculture"`
// 한 줄로 거른다. 새우 농장·새우 어휘는 이 파일에 없다.
//
// 0 의 뜻·판정·단위 환산은 전부 lib/agri-standards.ts · lib/agri-params.ts 에
// 맡긴다 — 여기서 숫자 기준을 새로 적지 않는다(전역 EC 기준선 금지).
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  FlaskConical, Download, RefreshCw, AlertTriangle, Activity, CheckCircle2, Building2, Sprout, Bell,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AgriPageHeader } from "@/components/agri/agri-page-header"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { BedStatusBadge, useAgriStatusLabel } from "@/components/agri/bed-status-badge"
import { isFieldAlert, fieldAlertLabel } from "@/components/agri/openfield/field-alert-label"
import { ChartCard, BOARD_CYCLE_MS } from "@/components/agri/charts/chart-card"
import { ParamTrendChart, TrendEmpty, buildTrendData, type TrendRecipe } from "@/components/agri/charts/param-trend-chart"
import { SensorCompareChart, buildCompareData, COMPARE_KEYS } from "@/components/agri/charts/sensor-compare-chart"
import { getFarms, getAllTanks, getWaterQuality, getSensorDevices, getAlerts, resolveAlert } from "@/lib/db"
import { metricOn, sensorsOnFrom } from "@/lib/sensors-on"
import { AGRI_PARAMS, agriParam, agriFormat, agriScaled, type AgriParam, type AgriParamKey } from "@/lib/agri-params"
import {
  AGRI_QUALITY_STANDARDS, AGRI_STATUS_STYLES, getAgriStatus,
  type AgriRecipe, type AgriStandard, type AgriStatusLevel, type AgriStdKey,
} from "@/lib/agri-standards"
import { alertDisplayLabel, PARAM_LABELS } from "@/lib/thresholds"
import { exportToCsv } from "@/lib/export"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { useAgriT, useT } from "@/lib/i18n-context"
import type { AgriDict } from "@/lib/i18n/agri"
import type { Dict } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Alert, Farm, SensorDevice, Tank, WaterQualityReading } from "@/types"

// ─── 상수·헬퍼 ────────────────────────────────────────────────────────────────

type Hours = 24 | 72 | 168
const HOURS: readonly Hours[] = [24, 72, 168]
const REFRESH_SEC = 60
// 최신값 카드 열 — 꺼 둔 센서를 빼고 남은 수에 맞춘다(빈 칸을 남기지 않는다).
const LATEST_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
}

// `?? []` 를 렌더마다 새로 만들면 useMemo 의존성이 매번 바뀐다 — 빈 배열은 모듈 상수로.
const NO_TANKS: Tank[] = []
const NO_READINGS: WaterQualityReading[] = []
const NO_DEVICES: SensorDevice[] = []
const NO_ALERTS: Alert[] = []

const isAgri = (x: { farm_type?: "shrimp" | "agriculture" }) => x.farm_type === "agriculture"

/** `{{k}}` 자리표시자 치환. */
const fmt = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), s)

/** 알림 행의 `parameter`(저장 키) → 농업 항목 키. 모르는 키는 undefined(메시지 원문을 쓴다). */
const ALERT_PARAM_KEY: Record<string, AgriParamKey> = {
  EC: "conductivity",
  pH: "ph",
  [PARAM_LABELS.temperature]: "temperature",
  [PARAM_LABELS.do_level]: "do_level",
}

function hasStandard(key: AgriParamKey): key is AgriStdKey {
  return key in AGRI_QUALITY_STANDARDS
}

/** 표준 밴드 문구 — 한쪽이 열린 밴드(DO 하한만)도 문장이 되게. */
function stdRangeText(std: AgriStandard, unit: string, n: AgriDict["nutrient"]): string {
  const u = unit ? ` ${unit}` : ""
  if (std.min != null && std.max != null) return fmt(n.rangeBetween, { min: std.min, max: `${std.max}${u}` })
  if (std.min != null) return fmt(n.rangeAtLeast, { v: `${std.min}${u}` })
  if (std.max != null) return fmt(n.rangeAtMost, { v: `${std.max}${u}` })
  return ""
}

/** 화면 단위로 환산한 레시피. EC 는 DB 저장값을 ÷1000 해 mS/cm 로 맞춘다. */
function chartRecipe(key: AgriParamKey, tank: Tank | undefined): TrendRecipe | null {
  if (!tank) return null
  if (key === "conductivity" && tank.target_ec != null) {
    return { target: tank.target_ec / 1000, tol: (tank.ec_tolerance ?? 100) / 1000 }
  }
  if (key === "ph" && tank.target_ph != null) {
    return { target: tank.target_ph, tol: tank.ph_tolerance ?? 0.5 }
  }
  return null
}

/** 최신값 카드 기준 줄(시안 5-6 표). 기준이 없는 항목은 빈 문자열 — 자리는 지킨다. */
function rangeTextFor(param: AgriParam, tank: Tank | undefined, status: AgriStatusLevel, n: AgriDict["nutrient"]): string {
  const recipe = chartRecipe(param.key, tank)
  if (param.key === "conductivity") {
    return recipe ? `${fmt(n.targetWithTol, { target: recipe.target.toFixed(2), tol: recipe.tol.toFixed(2) })} ${param.unit}` : ""
  }
  if (param.key === "ph") {
    return recipe ? fmt(n.targetWithTol, { target: recipe.target, tol: recipe.tol }) : stdRangeText(AGRI_QUALITY_STANDARDS.ph, "", n)
  }
  if (hasStandard(param.key)) return stdRangeText(AGRI_QUALITY_STANDARDS[param.key], param.unit, n)
  if (param.key === "flow_rate" && status === "위험") return n.flowStoppedHint
  return ""
}

/** "방금 전 / n분 전" — 4개 언어 모두 t.time 으로. */
function agoLabel(time: Dict["time"], at: Date | null): string {
  if (!at) return ""
  const mins = Math.floor((Date.now() - at.getTime()) / 60_000)
  if (mins < 1) return time.justNow
  if (mins < 60) return fmt(time.minutesAgo, { n: mins })
  const h = Math.floor(mins / 60)
  if (h < 24) return fmt(time.hoursAgo, { n: h })
  return fmt(time.daysAgo, { n: Math.floor(h / 24) })
}

/** 순환: 데이터가 있는 다음 항목으로. 하나도 없으면 그대로. */
function nextWithData(cur: AgriParamKey, order: readonly AgriParamKey[], withData: ReadonlySet<AgriParamKey>): AgriParamKey {
  const n = order.length
  const start = Math.max(0, order.indexOf(cur))
  for (let i = 1; i <= n; i++) {
    const k = order[(start + i) % n]
    if (withData.has(k)) return k
  }
  return cur
}

interface Series {
  key: string
  readings: WaterQualityReading[]
  devices: SensorDevice[]
  alerts: Alert[]
  error: boolean
}

async function loadSeries(tankId: string, hours: Hours): Promise<Omit<Series, "key" | "error">> {
  const [readings, devices, alerts] = await Promise.all([
    getWaterQuality(tankId, hours),
    getSensorDevices(tankId).catch(() => [] as SensorDevice[]),
    getAlerts(true).catch(() => [] as Alert[]),
  ])
  return {
    readings,
    devices,
    alerts: alerts.filter(a => a.tank_id === tankId && isAgri(a)),
  }
}

// ─── 뷰 ──────────────────────────────────────────────────────────────────────

/** `useSearchParams` 는 Suspense 경계가 필요하다(Next 문서) — 페이지 래퍼는 3줄
 *  그대로 두고 여기서 감싼다. */
export function AgriNutrientView() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NutrientInner />
    </Suspense>
  )
}

function NutrientInner() {
  const d = useAgriT()
  const n = d.nutrient
  const { t, locale } = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusLabel = useAgriStatusLabel()

  // 농장·베드 — 농업 것만.
  const [base, setBase] = useState<{ farms: Farm[]; tanks: Tank[] } | null>(null)
  const [baseError, setBaseError] = useState(false)
  const [baseRetry, setBaseRetry] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([getFarms(), getAllTanks()])
      .then(([farms, tanks]) => {
        if (!alive) return
        setBase({ farms: farms.filter(isAgri), tanks: tanks.filter(isAgri) })
      })
      .catch(() => { if (alive) setBaseError(true) })
    return () => { alive = false }
  }, [baseRetry])

  const tanks = base?.tanks ?? NO_TANKS

  // 선택 베드 — 고른 것 → ?tank= → 첫 베드. 상태로 복사하지 않고 파생시킨다.
  const [pickedTankId, setPickedTankId] = useState("")
  const urlTankId = searchParams.get("tank")
  const selectedTankId = useMemo(() => {
    if (!tanks.length) return ""
    if (pickedTankId && tanks.some(tk => tk.id === pickedTankId)) return pickedTankId
    if (urlTankId && tanks.some(tk => tk.id === urlTankId)) return urlTankId
    return tanks[0].id
  }, [tanks, pickedTankId, urlTankId])
  const selectedTank = tanks.find(tk => tk.id === selectedTankId)

  const [hours, setHours] = useState<Hours>(168)
  // 센서별 보기 — null 이면 베드 전체(합산).
  const [deviceId, setDeviceId] = useState<string | null>(null)

  function selectTank(id: string) {
    setPickedTankId(id)
    setDeviceId(null)
    // 대시보드·알림의 딥링크가 그대로 살아 있게 쿼리를 따라 바꾼다.
    router.replace(`/daumlabs/water-quality?tank=${id}`, { scroll: false })
  }

  // 측정·기기·알림 — 베드/기간이 바뀌면 키가 바뀌고, 키가 다르면 "로딩 중"이다.
  const [seriesRetry, setSeriesRetry] = useState(0)
  const seriesKey = `${selectedTankId}:${hours}:${seriesRetry}`
  const [series, setSeries] = useState<Series | null>(null)

  useEffect(() => {
    if (!selectedTankId) return
    let alive = true
    const key = seriesKey
    loadSeries(selectedTankId, hours)
      .then(res => { if (alive) setSeries({ key, ...res, error: false }) })
      .catch(() => { if (alive) setSeries({ key, readings: [], devices: [], alerts: [], error: true }) })
    return () => { alive = false }
  }, [selectedTankId, hours, seriesKey])

  // 센서가 1분마다 올리므로 화면도 같은 주기로 따라간다(탭 복귀 시 즉시 갱신 포함).
  const refresh = useCallback(async () => {
    if (!selectedTankId) return
    const res = await loadSeries(selectedTankId, hours)
    setSeries({ key: seriesKey, ...res, error: false })
  }, [selectedTankId, hours, seriesKey])
  const { lastRefreshed } = useAutoRefresh(refresh, REFRESH_SEC, !!selectedTankId)

  const seriesLoading = !!selectedTankId && series?.key !== seriesKey
  const allReadings = series?.readings ?? NO_READINGS
  const devices = series?.devices ?? NO_DEVICES
  const alerts = series?.alerts ?? NO_ALERTS

  const activeDevices = useMemo(() => devices.filter(dv => dv.active), [devices])
  // 장비 [센서 설정]에서 꺼 둔 센서의 항목은 상태줄·최신값 카드·추세 탭에서 뺀다.
  const shownParams = useMemo(() => {
    const on = sensorsOnFrom(devices)
    return AGRI_PARAMS.filter(p => metricOn(p.key, on))
  }, [devices])
  // 서명(문자열)으로 묶는다 — 장비 목록이 1분마다 새로 와도 같은 내용이면 같은 배열(전광판 박자가 안 틀어진다).
  const shownSig = shownParams.map(p => p.key).join(",")
  const shownKeys = useMemo(() => shownSig.split(",").filter(Boolean) as AgriParamKey[], [shownSig])
  const shownCompare = useMemo(() => COMPARE_KEYS.filter(k => shownKeys.includes(k)), [shownKeys])
  const readings = useMemo(
    () => (deviceId ? allReadings.filter(r => (r.device_id ?? null) === deviceId) : allReadings),
    [allReadings, deviceId],
  )
  const latest = readings.length ? readings[readings.length - 1] : null
  const recipe: AgriRecipe | null = selectedTank ?? null

  // 항목별 데이터 유무 — 전광판 순환이 빈 탭을 건너뛰고, 빈 상태 판단에도 쓴다.
  const keysWithData = useMemo(() => {
    const set = new Set<AgriParamKey>()
    for (const p of shownParams) {
      if (readings.some(r => agriScaled(p.key, r[p.key] as number | null | undefined) != null)) set.add(p.key)
    }
    return set
  }, [readings, shownParams])
  const keysWithDataSig = shownKeys.filter(k => keysWithData.has(k)).join(",")

  // 추세 차트
  const [pickedTab, setChartTab] = useState<AgriParamKey>("conductivity")
  // 고른 탭의 센서를 꺼 두었으면 남은 첫 항목으로 — 상태를 고쳐 쓰지 않고 파생시킨다.
  const chartTab: AgriParamKey = shownKeys.includes(pickedTab) ? pickedTab : (shownKeys[0] ?? pickedTab)
  const trendParam = agriParam(chartTab)
  const trendData = useMemo(() => buildTrendData(readings, chartTab, locale), [readings, chartTab, locale])
  const trendHasData = keysWithData.has(chartTab)

  // 센서별 비교
  const [pickedCompare, setCompareKey] = useState<AgriParamKey>("conductivity")
  const compareKey: AgriParamKey = shownCompare.includes(pickedCompare) ? pickedCompare : (shownCompare[0] ?? pickedCompare)
  const compareParam = agriParam(compareKey)
  const compareNames = useMemo(() => activeDevices.map(dv => dv.name), [activeDevices])
  const compareData = useMemo(() => {
    if (activeDevices.length < 2) return []
    const nameById = new Map(activeDevices.map(dv => [dv.id, dv.name]))
    return buildCompareData(allReadings, nameById, compareKey, locale)
  }, [allReadings, activeDevices, compareKey, locale])
  const taggedCount = useMemo(() => allReadings.filter(r => r.device_id).length, [allReadings])

  // 전체화면·전광판
  const [fullChart, setFullChart] = useState<null | "main" | "compare">(null)
  const [board, setBoard] = useState(false)
  const [cycleTick, setCycleTick] = useState(0)
  const closeFull = useCallback(() => { setFullChart(null); setBoard(false) }, [])
  const toggleBoard = () => { setBoard(b => !b); setCycleTick(x => x + 1) }

  useEffect(() => {
    if (!board || !fullChart) return
    const withData = new Set(keysWithDataSig.split(",").filter(Boolean) as AgriParamKey[])
    const id = setInterval(() => {
      if (fullChart === "main") setChartTab(cur => nextWithData(cur, shownKeys, withData))
      else setCompareKey(cur => nextWithData(cur, shownCompare, withData))
      setCycleTick(x => x + 1)
    }, BOARD_CYCLE_MS)
    return () => clearInterval(id)
  }, [board, fullChart, keysWithDataSig, shownKeys, shownCompare])

  // 알림 처리
  const [resolving, setResolving] = useState<string | null>(null)
  async function handleResolve(id: string) {
    setResolving(id)
    try {
      await resolveAlert(id)
      setSeries(prev => (prev ? { ...prev, alerts: prev.alerts.filter(a => a.id !== id) } : prev))
    } catch { /* 다음 갱신에서 다시 보인다 */ } finally {
      setResolving(null)
    }
  }

  // CSV — EC 는 mS/cm, 미측정은 빈 셀("—" 가 아니다: 스프레드시트 숫자 열이 깨진다).
  function handleExportCsv() {
    if (!readings.length || !selectedTank) return
    const nameById = new Map(devices.map(dv => [dv.id, dv.name]))
    const cell = (key: AgriParamKey, v: number | null | undefined) => {
      const s = agriFormat(key, v)
      return s === "—" ? "" : s
    }
    const rows = readings.map(r => {
      const row: Record<string, unknown> = {
        [n.csvTime]: r.recorded_at,
        [d.common.bed]: selectedTank.name,
        [n.csvSensor]: r.device_id ? (nameById.get(r.device_id) ?? r.device_id) : "",
      }
      for (const p of AGRI_PARAMS) {
        const header = p.unit ? `${d.common.param[p.dictKey]} (${p.unit})` : d.common.param[p.dictKey]
        row[header] = cell(p.key, r[p.key] as number | null | undefined)
      }
      return row
    })
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    exportToCsv(rows, `${n.csvPrefix}_${selectedTank.name}_${stamp}`)
  }

  const periodLabel: Record<Hours, string> = { 24: n.period24h, 72: n.period72h, 168: n.period7d }
  const chip = (active: boolean) => cn(
    "min-h-[36px] px-3 rounded-full border text-xs font-medium whitespace-nowrap transition-colors duration-200",
    active ? "bg-brand text-white border-brand" : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground",
  )

  const header = (
    <AgriPageHeader
      icon={FlaskConical}
      title={n.title}
      subtitle={n.subtitle}
      actions={
        <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!readings.length}
          className="min-h-[44px] gap-2 border-border text-muted-foreground hover:bg-accent flex-1 sm:flex-none"
          aria-label={n.csv} title={n.csv}>
          <Download className="w-4 h-4" aria-hidden="true" />{n.csv}
        </Button>
      }
    />
  )

  // ── 페이지 수준 상태: 로딩 / 에러 / 농장 0 / 베드 0 ──
  if (baseError) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <LoadError d={d} onRetry={() => { setBaseError(false); setBaseRetry(x => x + 1) }} />
      </div>
    )
  }
  if (!base) return <PageSkeleton header={header} />
  if (base.farms.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriEmptyState icon={Building2} title={d.common.noFarmsTitle} description={d.common.noFarmsMsg}
          ctaLabel={d.common.registerFarm} ctaHref="/daumlabs/farms" />
      </div>
    )
  }
  if (tanks.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriEmptyState icon={Sprout} title={n.noBedsTitle} description={n.noBedsMsg}
          ctaLabel={n.addBedCta} ctaHref="/daumlabs/farms" />
      </div>
    )
  }

  const ecRecipe = chartRecipe("conductivity", selectedTank)
  const trendRecipe = chartRecipe(chartTab, selectedTank)
  const trendStandard = !trendRecipe && hasStandard(chartTab) ? AGRI_QUALITY_STANDARDS[chartTab] : null
  const trendCaption = (() => {
    const text = n.caption[trendParam.dictKey]
    if (chartTab !== "conductivity") return text
    if (ecRecipe && selectedTank) {
      return `${text} · ${fmt(n.targetWithTol, { target: ecRecipe.target.toFixed(2), tol: ecRecipe.tol.toFixed(2) })} mS/cm · ${fmt(n.recipeOf, { name: selectedTank.name })}`
    }
    return `${text} · ${n.noRecipeLine}`
  })()

  const headlineFor = (param: AgriParam) => (
    <>
      <span className="text-muted-foreground font-medium text-xl">{selectedTank?.name}</span>
      <span>{d.common.param[param.dictKey]}</span>
      <span>
        {agriFormat(param.key, latest?.[param.key] as number | null | undefined)}
        {param.unit && <span className="text-lg text-muted-foreground font-medium ml-1">{param.unit}</span>}
      </span>
    </>
  )

  const chartLabels = { fullscreen: n.fullscreen, close: t.common.close, board: n.boardMode, cycleNote: n.boardCycleNote }
  const refreshNote = (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" role="status">
      <RefreshCw className="w-3 h-3" aria-hidden="true" />
      {fmt(n.autoRefresh, { n: REFRESH_SEC / 60 })}
      {lastRefreshed && <span className="opacity-70">· {agoLabel(t.time, lastRefreshed)}</span>}
    </span>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {header}

      {/* ── 선택 줄 ── */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap min-w-0">
            <Select value={selectedTankId} onValueChange={selectTank}>
              <SelectTrigger aria-label={n.bedSelectAria} className="w-full sm:w-52 min-h-[44px] bg-muted border-border text-foreground focus:ring-brand-a30">
                <SelectValue placeholder={d.common.selectBed} />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {tanks.map(tk => <SelectItem key={tk.id} value={tk.id}>{tk.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {activeDevices.length >= 2 && (
              <div role="group" aria-label={n.sensorSelectAria} className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <button type="button" onClick={() => setDeviceId(null)} aria-pressed={deviceId === null} className={chip(deviceId === null)}>
                  {n.allSensors}
                </button>
                {activeDevices.map(dv => (
                  <button key={dv.id} type="button" onClick={() => setDeviceId(dv.id)} aria-pressed={deviceId === dv.id} className={chip(deviceId === dv.id)}>
                    {dv.name}
                  </button>
                ))}
              </div>
            )}

            <div role="group" aria-label={n.periodSelectAria} className="flex items-center gap-1.5 flex-wrap">
              {HOURS.map(h => (
                <button key={h} type="button" onClick={() => setHours(h)} aria-pressed={hours === h} className={chip(hours === h)}>
                  {periodLabel[h]}
                </button>
              ))}
            </div>
          </div>
          {refreshNote}
        </CardContent>
      </Card>

      {/* ── 상태 스트립 + 최신값 카드 ── */}
      {seriesLoading ? (
        <>
          <div className="h-12 rounded-xl bg-muted animate-pulse" aria-hidden="true" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-hidden="true">
            {AGRI_PARAMS.map(p => <div key={p.key} className="h-32 rounded-xl bg-muted animate-pulse" />)}
          </div>
        </>
      ) : series?.error ? (
        <LoadError d={d} onRetry={() => setSeriesRetry(x => x + 1)} />
      ) : !latest ? (
        <AgriEmptyState icon={FlaskConical} title={n.noData} description={n.noDataHint} className="py-8">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Link href="/daumlabs/record/water-quality"
              className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors">
              {n.logReading}
            </Link>
            <Link href="/daumlabs/farms"
              className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors">
              {n.connectDevice}
            </Link>
          </div>
        </AgriEmptyState>
      ) : (
        <>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2">{n.statusStripTitle}</p>
              <div className="flex flex-wrap gap-2" role="list">
                {shownParams.map(p => {
                  const raw = latest[p.key] as number | null | undefined
                  const status = getAgriStatus(p.key, raw, recipe)
                  const style = AGRI_STATUS_STYLES[status]
                  const shown = agriFormat(p.key, raw)
                  return (
                    <span key={p.key} role="listitem"
                      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs", style.bg)}>
                      <span className="text-foreground font-medium">{d.common.param[p.dictKey]}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className={cn("font-semibold tabular-nums", style.text)}>
                        {shown}{shown !== "—" && p.unit ? ` ${p.unit}` : ""}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <BedStatusBadge status={status} size="sm" className="border-0 bg-transparent px-0 py-0" />
                    </span>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <section aria-label={n.latestHeading} className={cn("grid gap-3", LATEST_COLS[shownParams.length] ?? LATEST_COLS[6])}>
            {shownParams.map(p => {
              const raw = latest[p.key] as number | null | undefined
              const status = getAgriStatus(p.key, raw, recipe)
              return (
                <ReadingCard key={p.key} param={p} label={d.common.param[p.dictKey]} value={agriFormat(p.key, raw)}
                  status={status} statusText={statusLabel(status)} statusHeading={n.statusLabel}
                  rangeText={rangeTextFor(p, selectedTank, status, n)} />
              )
            })}
          </section>
        </>
      )}

      {/* ── 추세 차트 ── */}
      <ChartCard
        title={<><Activity className="w-4 h-4 text-brand-fg" aria-hidden="true" />{fmt(n.trendTitle, { range: periodLabel[hours] })}</>}
        meta={refreshNote}
        toolbar={
          <Tabs value={chartTab} onValueChange={v => setChartTab(v as AgriParamKey)}>
            <TabsList className="bg-muted border border-border flex-wrap gap-y-1 h-auto justify-start">
              {shownParams.map(p => {
                const Icon = p.icon
                return (
                  <TabsTrigger key={p.key} value={p.key}
                    className="text-xs min-h-[36px] gap-1.5 data-[state=active]:bg-brand data-[state=active]:text-white">
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />{d.common.param[p.dictKey]}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        }
        headline={headlineFor(trendParam)}
        caption={trendCaption}
        fullscreen={fullChart === "main"} onOpenFullscreen={() => setFullChart("main")} onClose={closeFull}
        board={board} onToggleBoard={toggleBoard} cycleTick={cycleTick} labels={chartLabels}
      >
        <div className={fullChart === "main" ? "h-[calc(100vh-280px)] min-h-[200px]" : "h-[220px] sm:h-[260px]"}>
          {seriesLoading ? (
            <div className="h-full rounded-xl bg-muted animate-pulse" aria-hidden="true" />
          ) : !trendHasData ? (
            <TrendEmpty param={trendParam} title={n.noChartData} ctaLabel={n.noChartDataCta} ctaHref="/daumlabs/record/water-quality" fill />
          ) : (
            <div role="img" aria-label={fmt(n.trendChartAria, { label: d.common.param[trendParam.dictKey] })} className="h-full">
              <ParamTrendChart data={trendData} param={trendParam} label={d.common.param[trendParam.dictKey]}
                recipe={trendRecipe} standard={trendStandard}
                targetLabel={trendRecipe ? fmt(n.targetLine, { v: trendRecipe.target.toFixed(trendParam.digits) }) : undefined}
                fill big={fullChart === "main" && board} />
            </div>
          )}
        </div>
      </ChartCard>

      {/* ── 센서별 비교(센서 2대↑) ── */}
      {activeDevices.length >= 2 && shownCompare.length > 0 && (
        <ChartCard
          title={<><Activity className="w-4 h-4 text-brand-fg" aria-hidden="true" />{n.compareTitle}</>}
          toolbar={
            <div role="group" aria-label={n.compareTitle} className="flex items-center gap-1.5 flex-wrap">
              {shownCompare.map(k => {
                const p = agriParam(k)
                return (
                  <button key={k} type="button" onClick={() => setCompareKey(k)} aria-pressed={compareKey === k} className={chip(compareKey === k)}>
                    {d.common.param[p.dictKey]}
                  </button>
                )
              })}
            </div>
          }
          headline={headlineFor(compareParam)}
          fullscreen={fullChart === "compare"} onOpenFullscreen={() => setFullChart("compare")} onClose={closeFull}
          board={board} onToggleBoard={toggleBoard} cycleTick={cycleTick} labels={chartLabels}
        >
          <div className={fullChart === "compare" ? "h-[calc(100vh-280px)] min-h-[200px]" : "h-[220px] sm:h-[260px]"}>
            {seriesLoading ? (
              <div className="h-full rounded-xl bg-muted animate-pulse" aria-hidden="true" />
            ) : compareData.length === 0 ? (
              <TrendEmpty param={compareParam} title={taggedCount === 0 ? n.compareNoTag : n.compareNoHistory} fill />
            ) : (
              <div role="img" aria-label={`${n.compareTitle} — ${d.common.param[compareParam.dictKey]}`} className="h-full">
                <SensorCompareChart data={compareData} names={compareNames} param={compareParam} fill big={fullChart === "compare" && board} />
              </div>
            )}
          </div>
        </ChartCard>
      )}

      {/* ── 알림 ── */}
      <Card id="alerts" className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-brand-fg" aria-hidden="true" />
            {n.alertsTitle}
            {alerts.length > 0 && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">· {fmt(n.alertsOpenN, { n: alerts.length })}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {alerts.length === 0 ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />{n.noAlerts}
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.map(a => (
                <AlertRow key={a.id} alert={a} locale={locale} resolveLabel={n.resolve} thresholdLine={n.thresholdLine}
                  resolving={resolving === a.id} onResolve={() => handleResolve(a.id)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── 조각 ─────────────────────────────────────────────────────────────────────

function ReadingCard({ param, label, value, status, statusText, statusHeading, rangeText }: {
  param: AgriParam
  label: string
  value: string
  status: AgriStatusLevel
  statusText: string
  statusHeading: string
  rangeText: string
}) {
  const style = AGRI_STATUS_STYLES[status]
  const Icon = param.icon
  return (
    <Card className={cn("border min-w-0 overflow-hidden", style.bg)}
      aria-label={`${label}: ${value}${param.unit ? ` ${param.unit}` : ""} — ${statusHeading}: ${statusText}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-1 mb-2">
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", style.text)} aria-hidden="true">
            <Icon className="w-4 h-4" />
          </div>
          <BedStatusBadge status={status} size="sm" />
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-bold tabular-nums leading-tight", style.text)}>
          {value}
          {param.unit && <span className="text-xs font-medium text-muted-foreground ml-1">{param.unit}</span>}
        </p>
        {/* 기준이 없어도 자리를 지켜 6장 높이가 같게. */}
        <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums min-h-[16px]">{rangeText}</p>
      </CardContent>
    </Card>
  )
}

function AlertRow({ alert, locale, resolveLabel, thresholdLine, resolving, onResolve }: {
  alert: Alert
  locale: string
  resolveLabel: string
  thresholdLine: string
  resolving: boolean
  onResolve: () => void
}) {
  const { openfield: of } = useAgriT()
  const key: AgriParamKey | undefined = ALERT_PARAM_KEY[alert.parameter]
  let text = alert.message
  if (isFieldAlert(alert.parameter)) {
    // 노지 재해위험 알림 — parameter 가 키("field:frost")라 openfield 사전으로 이름표를 붙인다.
    text = `${fieldAlertLabel(alert.parameter, of)} — ${alert.message}`
  } else if (key) {
    const unit = agriParam(key).unit
    const withUnit = (v: number) => `${agriFormat(key, v)}${unit ? ` ${unit}` : ""}`
    text = `${alertDisplayLabel(alert.parameter, "agriculture")} ${withUnit(alert.value)} — ${fmt(thresholdLine, { v: withUnit(alert.threshold) })}`
  }
  const danger = alert.type === "danger"
  const when = new Date(alert.created_at).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  return (
    <li className={cn("flex items-center gap-3 flex-wrap rounded-xl border p-3", danger ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20")}>
      {danger
        ? <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" aria-hidden="true" />
        : <Activity className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />}
      <p className="flex-1 min-w-0 text-sm text-foreground tabular-nums">{text}</p>
      <span className="text-xs text-muted-foreground tabular-nums">{when}</span>
      <Button variant="outline" size="sm" onClick={onResolve} disabled={resolving} className="min-h-[44px] border-border">
        {resolveLabel}
      </Button>
    </li>
  )
}

function LoadError({ d, onRetry }: { d: AgriDict; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-border bg-card px-6 py-12">
      <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
      <p className="text-lg font-semibold text-foreground">{d.common.loadErrorTitle}</p>
      <p className="text-sm text-muted-foreground">{d.common.loadErrorMsg}</p>
      <Button onClick={onRetry} className="bg-brand hover:bg-brand-hover text-white min-h-[44px] px-6 rounded-xl">{d.common.retry}</Button>
    </div>
  )
}

/** 첫 로딩 스켈레톤 — 카드가 들어올 자리를 실제 높이로 잡아 CLS 를 막는다. */
function PageSkeleton({ header }: { header?: ReactNode }) {
  return (
    <div className="space-y-6 animate-fade-in" role="status" aria-busy="true">
      {header ?? <div className="h-12 w-56 rounded-xl bg-muted animate-pulse" />}
      <div className="h-20 rounded-xl bg-muted animate-pulse" />
      <div className="h-12 rounded-xl bg-muted animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {AGRI_PARAMS.map(p => <div key={p.key} className="h-32 rounded-xl bg-muted animate-pulse" />)}
      </div>
      <div className="h-[300px] rounded-xl bg-muted animate-pulse" />
    </div>
  )
}
