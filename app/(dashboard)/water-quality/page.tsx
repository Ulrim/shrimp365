"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts"
import { MOCK_TANKS, MOCK_WATER_QUALITY, WATER_QUALITY_STANDARDS, MOCK_ALERTS, MOCK_SENSOR_DEVICES, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getAllTanks, getWaterQuality, getLatestWaterQuality, getSensorDevices, resolveAlert } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs"
import {
  Thermometer, Droplets, Wind, Waves, AlertTriangle,
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Plus, Download, Wifi, Clock,
} from "lucide-react"
import { exportToCsv } from "@/lib/export"
import { formatDateTime } from "@/lib/utils"
import type { Tank, WaterQualityReading, Alert, SensorDevice } from "@/types"
import { useT } from "@/lib/i18n-context"
import { useAutoRefresh, sinceLabel } from "@/lib/use-auto-refresh"

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusLevel = "정상" | "주의" | "위험"

interface ParamMeta {
  key: keyof WaterQualityReading
  label: string
  unit: string
  icon: React.ReactNode
  chartColor: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<StatusLevel, { badge: string; dot: string; text: string; bg: string }> = {
  정상: { badge: "success", dot: "bg-emerald-400", text: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" },
  주의: { badge: "warning", dot: "bg-amber-400", text: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" },
  위험: { badge: "danger", dot: "bg-red-400", text: "text-red-500", bg: "bg-red-500/10 border-red-500/20" },
} as const

const PARAM_META: ParamMeta[] = [
  { key: "temperature", label: "수온",    unit: "°C",   icon: <Thermometer className="w-5 h-5" />, chartColor: "#0ea5e9" },
  { key: "ph",          label: "pH",      unit: "",     icon: <Droplets className="w-5 h-5" />,    chartColor: "#a78bfa" },
  { key: "do_level",    label: "DO",      unit: "mg/L", icon: <Wind className="w-5 h-5" />,        chartColor: "#14b8a6" },
  { key: "salinity",    label: "염도",    unit: "‰",  icon: <Waves className="w-5 h-5" />,       chartColor: "#f59e0b" },
  { key: "ammonia",     label: "암모니아", unit: "mg/L", icon: <AlertTriangle className="w-5 h-5" />, chartColor: "#f97316" },
  { key: "nitrite",     label: "아질산염", unit: "mg/L", icon: <AlertTriangle className="w-5 h-5" />, chartColor: "#ec4899" },
  { key: "nitrate",     label: "질산염",  unit: "mg/L", icon: <AlertTriangle className="w-5 h-5" />, chartColor: "#84cc16" },
  { key: "alkalinity",  label: "알칼리도", unit: "mg/L", icon: <Droplets className="w-5 h-5" />,   chartColor: "#06b6d4" },
  { key: "turbidity",   label: "탁도",    unit: "NTU",  icon: <Waves className="w-5 h-5" />,       chartColor: "#8b5cf6" },
]

const STD_KEYS = [
  "temperature", "ph", "do_level", "salinity",
  "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity",
] as const

const TIME_RANGES = [
  { labelKey: "period24h" as const, hours: 24 },
  { labelKey: "period3d" as const,  hours: 72 },
  { labelKey: "period7d" as const,  hours: 168 },
] as const



// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatus(value: number, stdKey: typeof STD_KEYS[number]): StatusLevel {
  const s = WATER_QUALITY_STANDARDS[stdKey]
  if (value >= s.min && value <= s.max) return "정상"
  if (value >= s.warning_min && value <= s.warning_max) return "주의"
  return "위험"
}

function buildChartData(readings: WaterQualityReading[], last24h = true) {
  const slice = last24h ? readings.slice(-25) : readings
  return slice.map(r => ({
    time: new Date(r.recorded_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    수온:    Number(r.temperature.toFixed(1)),
    pH:     Number(r.ph.toFixed(2)),
    DO:     Number(r.do_level.toFixed(1)),
    염도:    Number(r.salinity.toFixed(1)),
    암모니아: Number(r.ammonia.toFixed(3)),
    아질산염: Number(r.nitrite.toFixed(3)),
    질산염:  Number(r.nitrate.toFixed(1)),
    알칼리도: Number(r.alkalinity.toFixed(1)),
    탁도:    Number(r.turbidity.toFixed(1)),
  }))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReadingCard({ meta, reading }: { meta: ParamMeta; reading: WaterQualityReading }) {
  const { t } = useT()
  const stdKey = meta.key as typeof STD_KEYS[number]
  const value = reading[meta.key] as number
  const status = getStatus(value, stdKey)
  const styles = STATUS_STYLES[status]
  const std = WATER_QUALITY_STANDARDS[stdKey]

  const statusLabel = status === "정상" ? t.dashboard.normal : status === "주의" ? t.dashboard.warning : t.dashboard.danger

  return (
    <Card
      className={`border min-w-0 overflow-hidden ${styles.bg} transition-all hover:brightness-110`}
      aria-label={`${meta.label}: ${value.toFixed(meta.key === "ph" || meta.key === "ammonia" || meta.key === "nitrite" ? 2 : 1)}${meta.unit} — 상태: ${statusLabel}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${styles.bg} ${styles.text}`} aria-hidden="true">
            {meta.icon}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${styles.dot} ${status !== "정상" ? "animate-pulse" : ""}`} aria-hidden="true" />
            <Badge
              variant={styles.badge as "success" | "warning" | "danger"}
              aria-label={`${meta.label} 상태: ${statusLabel}`}
            >{statusLabel}</Badge>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-0.5">{meta.label}</p>
        <p className={`text-2xl font-bold ${styles.text}`}>
          {value.toFixed(meta.key === "ph" || meta.key === "ammonia" || meta.key === "nitrite" ? 2 : 1)}
          {meta.unit && <span className="text-sm font-normal text-muted-foreground ml-1">{meta.unit}</span>}
        </p>

        <div className="mt-2 text-xs text-muted-foreground">
          {t.waterQuality.normalRange}: {std.min} – {std.max}{meta.unit}
        </div>
      </CardContent>
    </Card>
  )
}

interface ChartPanelProps {
  chartData: ReturnType<typeof buildChartData>
  stdKey: typeof STD_KEYS[number]
  chartLabel: string
  chartColor: string
  unit: string
}

function SingleParamChart({ chartData, stdKey, chartLabel, chartColor, unit }: ChartPanelProps) {
  const std = WATER_QUALITY_STANDARDS[stdKey]
  const yVals = chartData.map(d => d[chartLabel as keyof typeof d] as number).filter(Boolean)
  const padding = (std.max - std.min) * 0.5
  const yMin = Math.min(std.warning_min - padding * 0.2, ...yVals)
  const yMax = Math.max(std.warning_max + padding * 0.2, ...yVals)

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
        <YAxis domain={[yMin, yMax]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={42} tickFormatter={v => `${v}${unit}`} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
        />
        <ReferenceLine y={std.max} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "최대", fill: "#34d399", fontSize: 10, position: "insideTopRight" }} />
        <ReferenceLine y={std.min} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "최소", fill: "#34d399", fontSize: 10, position: "insideBottomRight" }} />
        <ReferenceLine y={std.warning_max} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "경고↑", fill: "#fbbf24", fontSize: 10, position: "insideTopRight" }} />
        <ReferenceLine y={std.warning_min} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "경고↓", fill: "#fbbf24", fontSize: 10, position: "insideBottomRight" }} />
        <Line type="monotone" dataKey={chartLabel} stroke={chartColor} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function NitrogenChart({ chartData }: { chartData: ReturnType<typeof buildChartData> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={v => `${v}`} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v, name) => [`${v} mg/L`, name]}
        />
        <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
        <Line type="monotone" dataKey="암모니아" stroke="#f97316" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="아질산염" stroke="#ec4899" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="질산염"  stroke="#84cc16" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function OverviewChart({ chartData }: { chartData: ReturnType<typeof buildChartData> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
        <Line type="monotone" dataKey="수온"  stroke="#0ea5e9" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="DO"    stroke="#14b8a6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="pH"    stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WaterQualityPage() {
  const { user } = useAuth()
  const { t } = useT()
  const [tanks, setTanks] = useState<Tank[]>([])
  const [selectedTankId, setSelectedTankId] = useState<string>("")
  const initialTankIdFromUrl = useRef<string | null>(null)

  useEffect(() => {
    initialTankIdFromUrl.current = new URLSearchParams(window.location.search).get("tank")
  }, [])
  const [readings, setReadings] = useState<WaterQualityReading[]>([])
  const [latest, setLatest] = useState<WaterQualityReading | null>(null)
  const [tankAlerts, setTankAlerts] = useState<Alert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hours, setHours] = useState<24 | 72 | 168>(168)

  // Summary counts
  const [summaryStatusCounts, setSummaryStatusCounts] = useState({ 정상: 0, 주의: 0, 위험: 0 })

  // Sensor devices for selected tank
  const [tankDevices, setTankDevices] = useState<SensorDevice[]>([])

  // Load tanks on mount
  useEffect(() => {
    async function loadTanks() {
      const mock = isTestAccount(user?.email)
      if (mock) {
        setTanks(MOCK_TANKS)
        const paramId = initialTankIdFromUrl.current
        const target = paramId ? (MOCK_TANKS.find(t => t.id === paramId) ?? MOCK_TANKS[0]) : MOCK_TANKS[0]
        setSelectedTankId(target.id)
        return
      }
      try {
        const dbTanks = await getAllTanks()
        if (dbTanks.length > 0) {
          setTanks(dbTanks)
          const paramId = initialTankIdFromUrl.current
          const target = paramId ? (dbTanks.find(t => t.id === paramId) ?? dbTanks[0]) : dbTanks[0]
          setSelectedTankId(target.id)
        } else {
          setIsLoading(false)
        }
      } catch {
        setIsLoading(false)
      }
    }
    loadTanks()
  }, [user])

  // Load water quality when selected tank changes
  const loadTankData = useCallback(async (tankId: string) => {
    if (!tankId) return
    const mock = isTestAccount(user?.email)
    setIsLoading(true)
    if (mock) {
      const mockReadings = MOCK_WATER_QUALITY[tankId] ?? []
      setReadings(mockReadings)
      setLatest(mockReadings.length > 0 ? mockReadings[mockReadings.length - 1] : null)
      setTankAlerts(MOCK_ALERTS.filter(a => a.tank_id === tankId && !a.resolved))
      setTankDevices(MOCK_SENSOR_DEVICES.filter(d => d.tank_id === tankId))
      setIsLoading(false)
      return
    }
    try {
      const [dbReadings, dbLatest] = await Promise.all([
        getWaterQuality(tankId, hours),
        getLatestWaterQuality(tankId),
      ])
      setReadings(dbReadings)
      setLatest(dbLatest)
      setTankAlerts([])

      try {
        setTankDevices(await getSensorDevices(tankId))
      } catch {
        setTankDevices([])
      }
    } catch { } finally {
      setIsLoading(false)
    }
  }, [user?.email, hours])

  useEffect(() => {
    if (selectedTankId) loadTankData(selectedTankId)
  }, [selectedTankId, loadTankData])

  // 센서가 1분마다 값을 올리므로 화면도 그 주기로 따라간다.
  // 공통 훅을 쓰면 탭을 다른 곳에 두었다 돌아왔을 때도 곧바로 최신값을 가져온다
  // (브라우저가 안 보이는 탭의 타이머를 크게 늦추기 때문에 그것만으로는 부족하다).
  const refreshSec = 60
  const refreshTank = useCallback(async () => {
    if (selectedTankId) await loadTankData(selectedTankId)
  }, [selectedTankId, loadTankData])

  const { lastRefreshed } = useAutoRefresh(refreshTank, refreshSec, !!selectedTankId)

  // Derive a single tank's status from a water quality reading
  function deriveStatus(reading: WaterQualityReading): StatusLevel {
    return STD_KEYS.reduce<StatusLevel>((acc, k) => {
      const val = reading[k] as number
      if (!val || val === 0) return acc          // skip DB-default zeros
      const s = getStatus(val, k)
      if (s === "위험") return "위험"
      if (s === "주의" && acc !== "위험") return "주의"
      return acc
    }, "정상")
  }

  // Load the latest reading for every tank and recompute summary counts.
  // Called on initial tank load and after any tank's data is refreshed.
  const computeSummary = useCallback(async (tankList: Tank[]) => {
    if (!tankList.length) return
    const mock = isTestAccount(user?.email)
    const counts = { 정상: 0, 주의: 0, 위험: 0 }

    if (mock) {
      tankList.forEach(tank => {
        const mockReadings = MOCK_WATER_QUALITY[tank.id] ?? []
        const latestReading = mockReadings.length > 0 ? mockReadings[mockReadings.length - 1] : null
        if (!latestReading) { if (tank.status !== "inactive") counts.정상++; return }
        counts[deriveStatus(latestReading)]++
      })
      setSummaryStatusCounts(counts)
      return
    }

    await Promise.all(tankList.map(async (tank) => {
      try {
        const latestReading = await getLatestWaterQuality(tank.id)
        if (!latestReading) { if (tank.status !== "inactive") counts.정상++; return }
        counts[deriveStatus(latestReading)]++
      } catch {
        if (tank.status === "active")  counts.정상++
        else if (tank.status === "warning") counts.주의++
        else if (tank.status === "danger")  counts.위험++
      }
    }))

    setSummaryStatusCounts(counts)
  }, [user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    computeSummary(tanks)
  }, [tanks, computeSummary])

  const chartData = useMemo(() => buildChartData(readings, false), [readings])

  const selectedTank = tanks.find(t => t.id === selectedTankId)

  function handleRefresh() {
    setIsRefreshing(true)
    loadTankData(selectedTankId).then(() => computeSummary(tanks)).finally(() => setIsRefreshing(false))
  }

  function handleExportCsv() {
    if (!readings.length || !selectedTank) return
    const rows = readings.map(r => ({
      "측정일시": r.recorded_at,
      "수조": selectedTank.name,
      "수온(°C)": r.temperature,
      "pH": r.ph,
      "DO(mg/L)": r.do_level,
      "염도(ppt)": r.salinity,
      "암모니아(mg/L)": r.ammonia,
      "아질산염(mg/L)": r.nitrite,
      "질산염(mg/L)": r.nitrate,
      "알칼리도(mg/L)": r.alkalinity,
      "탁도(NTU)": r.turbidity,
    }))
    exportToCsv(rows, `수질데이터_${selectedTank.name}_${new Date().toISOString().split("T")[0]}`)
  }

  const timeRangeLabel = (hours: 24 | 72 | 168) => {
    if (hours === 24) return t.waterQuality.period24h
    if (hours === 72) return t.waterQuality.period3d
    return t.waterQuality.period7d
  }

  if (!isLoading && tanks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-ocean-500/20 flex items-center justify-center">
          <Droplets className="w-8 h-8 text-ocean-500" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">{t.waterQuality.noTanks}</h2>
          <p className="text-muted-foreground text-sm max-w-sm">
            {t.waterQuality.noTanksMsg}
          </p>
        </div>
        <a href="/farms">
          <Button className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2 min-h-[44px]">
            <Plus className="w-4 h-4" /> {t.dashboard.goToFarms}
          </Button>
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t.waterQuality.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t.waterQuality.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Summary badges */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CheckCircle2 className="w-3.5 h-3.5" />{t.dashboard.normal} {summaryStatusCounts.정상}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <AlertCircle className="w-3.5 h-3.5" />{t.dashboard.warning} {summaryStatusCounts.주의}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-red-500">
              <XCircle className="w-3.5 h-3.5" />{t.dashboard.danger} {summaryStatusCounts.위험}
            </span>
          </div>

          {/* Time range selector */}
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" aria-hidden="true" />
            <Select value={String(hours)} onValueChange={v => setHours(Number(v) as 24 | 72 | 168)}>
              <SelectTrigger
                className="w-full sm:w-24 min-h-[44px] h-auto bg-muted border-border text-muted-foreground text-xs focus:ring-ocean-500/30"
                aria-label="조회 기간 선택"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {TIME_RANGES.map(r => (
                  <SelectItem key={r.hours} value={String(r.hours)} className="text-foreground text-xs focus:bg-accent focus:text-foreground">
                    {t.waterQuality[r.labelKey]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleExportCsv}
            disabled={!readings.length}
            variant="outline"
            size="sm"
            className="border-border text-muted-foreground hover:bg-accent gap-2 shrink-0 min-h-[44px]"
            title={t.waterQuality.csvExport}
            aria-label={t.waterQuality.csvExport}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">CSV</span>
          </Button>

          <a href="/journal" className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="border-ocean-500/40 text-ocean-500 hover:bg-ocean-500/10 gap-2 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t.waterQuality.addRecord}</span>
              <span className="sm:hidden">{t.waterQuality.addRecord}</span>
            </Button>
          </a>

          <Button
            variant="outline"
            size="sm"
            className="border-border text-muted-foreground hover:bg-accent gap-2 shrink-0 min-h-[44px]"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="데이터 새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
        </div>
      </div>

      {/* ── Tank Selector ──────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">{t.waterQuality.tank}</p>
                <Select value={selectedTankId} onValueChange={setSelectedTankId}>
                  <SelectTrigger
                    className="w-full sm:w-48 min-h-[44px] bg-muted border-border text-foreground focus:ring-ocean-500/30"
                    aria-label="수조 선택"
                  >
                    <SelectValue placeholder={t.waterQuality.selectTank} />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {tanks.map(tank => (
                      <SelectItem
                        key={tank.id}
                        value={tank.id}
                        className="text-foreground focus:bg-accent focus:text-foreground"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            tank.status === "active"   ? "bg-emerald-500" :
                            tank.status === "warning"  ? "bg-amber-500" :
                            tank.status === "danger"   ? "bg-red-500" : "bg-muted-foreground"
                          }`} />
                          {tank.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedTank && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">사육일수</p>
                    <p className="font-semibold text-foreground">{selectedTank.cycle_day}일차</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">수용량</p>
                    <p className="font-semibold text-foreground">{selectedTank.volume.toLocaleString()}㎥</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">입식수</p>
                    <p className="font-semibold text-foreground">{selectedTank.shrimp_count.toLocaleString()}마리</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">밀도</p>
                    <p className="font-semibold text-foreground">{selectedTank.stocking_density}마리/㎥</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-1">
              {tankDevices.filter(d => d.active).length > 0 && (
                <span className="flex items-center gap-1 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
                  <Wifi className="w-3 h-3" />
                  센서 자동 수집 중 ({tankDevices.filter(d => d.active).length}대)
                </span>
              )}
              {latest && (
                <span className="text-xs text-muted-foreground">
                  최근 측정: {formatDateTime(latest.recorded_at)}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Loading State ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-ocean-500" />
            {t.waterQuality.loading}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Alert Banner ──────────────────────────────────────────────────── */}
          {tankAlerts.length > 0 && (
            <div className="space-y-2">
              {tankAlerts.map(alert => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 p-4 rounded-xl border ${
                    alert.type === "danger"
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  {alert.type === "danger"
                    ? <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${alert.type === "danger" ? "text-red-500" : "text-amber-500"}`}>
                      {alert.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      측정값: {alert.value} / 임계치: {alert.threshold} · {formatDateTime(alert.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try { await resolveAlert(alert.id) } catch { /* non-fatal */ }
                      setTankAlerts(prev => prev.filter(a => a.id !== alert.id))
                    }}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-emerald-500 hover:bg-accent transition-colors"
                    aria-label="알림 해제"
                    title="해결됨으로 표시"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Per-Parameter Status Strip ──────────────────────────────────── */}
          {latest && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-3 font-medium">항목별 현재 수질 상태</p>
                <div className="flex flex-wrap gap-2">
                  {PARAM_META.map(meta => {
                    const stdKey = meta.key as typeof STD_KEYS[number]
                    const value = latest[meta.key] as number
                    const status = getStatus(value, stdKey)
                    const styles = STATUS_STYLES[status]
                    const statusLabel = status === "정상" ? t.dashboard.normal : status === "주의" ? t.dashboard.warning : t.dashboard.danger
                    return (
                                  <div
                        key={meta.key}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${styles.bg} ${styles.text}`}
                        aria-label={`${meta.label} 상태: ${statusLabel}`}
                        role="status"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot} ${status !== "정상" ? "animate-pulse" : ""}`} aria-hidden="true" />
                        <span>{meta.label}</span>
                        <span className="opacity-50" aria-hidden="true">·</span>
                        <span>{statusLabel}</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Current Readings Grid ────────────────────────────────────────── */}
          {latest ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3">
              {PARAM_META.map(meta => (
                <ReadingCard key={meta.key} meta={meta} reading={latest} />
              ))}
            </div>
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Droplets className="w-10 h-10 text-muted-foreground/40" aria-hidden="true" />
                  <p className="text-muted-foreground text-sm font-medium">{t.waterQuality.noData}</p>
                  <p className="text-muted-foreground/60 text-xs">수질 데이터를 입력하거나 센서를 연결해 주세요.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Charts ───────────────────────────────────────────────────────── */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-foreground text-base">
                  {timeRangeLabel(hours)} {t.waterQuality.trend}
                </CardTitle>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="w-3 h-3" />
                  {refreshSec >= 60 ? `${refreshSec / 60}${t.waterQuality.autoRefreshMin}` : `${refreshSec}초마다 자동갱신`}
                  {lastRefreshed && <span className="opacity-70">· {sinceLabel(lastRefreshed)}</span>}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="overview">
                <TabsList className="bg-muted border border-border mb-4 flex-wrap gap-y-1 h-auto min-h-9">
                  <TabsTrigger value="overview"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">수온·DO·pH</TabsTrigger>
                  <TabsTrigger value="nitrogen"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">질소 복합</TabsTrigger>
                  <TabsTrigger value="temperature" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.temperature}</TabsTrigger>
                  <TabsTrigger value="ph"         className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.ph}</TabsTrigger>
                  <TabsTrigger value="do_level"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">DO</TabsTrigger>
                  <TabsTrigger value="salinity"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.salinity}</TabsTrigger>
                  <TabsTrigger value="ammonia"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.ammonia}</TabsTrigger>
                  <TabsTrigger value="nitrite"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.nitrite}</TabsTrigger>
                  <TabsTrigger value="nitrate"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.nitrate}</TabsTrigger>
                  <TabsTrigger value="alkalinity" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.alkalinity}</TabsTrigger>
                  <TabsTrigger value="turbidity"  className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.turbidity}</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  {chartData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                      <Waves className="w-10 h-10" aria-hidden="true" />
                      <p className="text-sm">표시할 데이터가 없습니다.</p>
                    </div>
                  ) : (
                    <div aria-label="수온·DO·pH 복합 추이 차트" role="img">
                      <OverviewChart chartData={chartData} />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 text-center">수온(°C) · DO(mg/L) · pH — 기준선 미표시 (복합 Y축)</p>
                </TabsContent>

                <TabsContent value="nitrogen">
                  {chartData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                      <Waves className="w-10 h-10" aria-hidden="true" />
                      <p className="text-sm">표시할 데이터가 없습니다.</p>
                    </div>
                  ) : (
                    <div aria-label="질소 복합 (암모니아·아질산염·질산염) 추이 차트" role="img">
                      <NitrogenChart chartData={chartData} />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 text-center">{t.waterQuality.ammonia} · {t.waterQuality.nitrite} · {t.waterQuality.nitrate} (단위: mg/L) — 기준선 미표시 (복합 Y축)</p>
                </TabsContent>

                {(
                  [
                    { tabValue: "temperature", chartLabel: "수온",    stdKey: "temperature", chartColor: "#0ea5e9", unit: "°C" },
                    { tabValue: "ph",          chartLabel: "pH",      stdKey: "ph",          chartColor: "#a78bfa", unit: "" },
                    { tabValue: "do_level",    chartLabel: "DO",      stdKey: "do_level",    chartColor: "#14b8a6", unit: "mg/L" },
                    { tabValue: "salinity",    chartLabel: "염도",    stdKey: "salinity",    chartColor: "#f59e0b", unit: "‰" },
                    { tabValue: "ammonia",     chartLabel: "암모니아", stdKey: "ammonia",     chartColor: "#f97316", unit: "mg/L" },
                    { tabValue: "nitrite",     chartLabel: "아질산염", stdKey: "nitrite",     chartColor: "#ec4899", unit: "mg/L" },
                    { tabValue: "nitrate",     chartLabel: "질산염",  stdKey: "nitrate",     chartColor: "#84cc16", unit: "mg/L" },
                    { tabValue: "alkalinity",  chartLabel: "알칼리도", stdKey: "alkalinity",  chartColor: "#06b6d4", unit: "mg/L" },
                    { tabValue: "turbidity",   chartLabel: "탁도",    stdKey: "turbidity",   chartColor: "#8b5cf6", unit: "NTU" },
                  ] as Array<{ tabValue: string; chartLabel: string; stdKey: typeof STD_KEYS[number]; chartColor: string; unit: string }>
                ).map(({ tabValue, chartLabel, stdKey, chartColor, unit }) => (
                  <TabsContent key={tabValue} value={tabValue}>
                    {chartData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                        <Waves className="w-10 h-10" aria-hidden="true" />
                        <p className="text-sm">표시할 데이터가 없습니다.</p>
                      </div>
                    ) : (
                      <div aria-label={`${chartLabel} 추이 차트`} role="img">
                        <SingleParamChart
                          chartData={chartData}
                          stdKey={stdKey}
                          chartLabel={chartLabel}
                          chartColor={chartColor}
                          unit={unit}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-4 border-t border-dashed border-emerald-400/60" />{t.waterQuality.normalRange}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-4 border-t border-dashed border-amber-400/60" />경고범위
                      </span>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* ── Alert List ───────────────────────────────────────────────────── */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {selectedTank?.name} 알림 내역
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tankAlerts.length === 0 ? (
                <div className="flex items-center gap-3 py-6 justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  <p className="text-muted-foreground text-sm">미처리 알림이 없습니다 — 수질이 {t.dashboard.normal} 범위에 있습니다.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tankAlerts.map(alert => {
                    const paramLabel = WATER_QUALITY_STANDARDS[alert.parameter as typeof STD_KEYS[number]]?.label ?? alert.parameter
                    const isDanger = alert.type === "danger"
                    return (
                      <div
                        key={alert.id}
                        className={`flex items-start gap-3 p-4 rounded-xl border ${
                          isDanger ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"
                        }`}
                      >
                        {isDanger
                          ? <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                          : <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-sm font-semibold ${isDanger ? "text-red-500" : "text-amber-500"}`}>
                              {alert.message}
                            </p>
                            <Badge variant={isDanger ? "danger" : "warning"}>
                              {isDanger ? t.dashboard.danger : t.dashboard.warning}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            항목: {paramLabel} · 측정값 {alert.value} → 임계치 {alert.threshold}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(alert.created_at)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
