"use client"

import { useState, useMemo } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts"
import { MOCK_TANKS, MOCK_WATER_QUALITY, WATER_QUALITY_STANDARDS, MOCK_ALERTS } from "@/lib/mock-data"
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
  CheckCircle2, XCircle, AlertCircle, RefreshCw,
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import type { Tank, WaterQualityReading } from "@/types"

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
  정상: { badge: "success", dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  주의: { badge: "warning", dot: "bg-amber-400", text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  위험: { badge: "danger", dot: "bg-red-400", text: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
} as const

const PARAM_META: ParamMeta[] = [
  { key: "temperature", label: "수온",    unit: "°C",   icon: <Thermometer className="w-5 h-5" />, chartColor: "#0ea5e9" },
  { key: "ph",          label: "pH",      unit: "",     icon: <Droplets className="w-5 h-5" />,    chartColor: "#a78bfa" },
  { key: "do_level",    label: "DO",      unit: "mg/L", icon: <Wind className="w-5 h-5" />,        chartColor: "#14b8a6" },
  { key: "salinity",    label: "염분",    unit: "ppt",  icon: <Waves className="w-5 h-5" />,       chartColor: "#f59e0b" },
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
    염분:    Number(r.salinity.toFixed(1)),
    암모니아: Number(r.ammonia.toFixed(3)),
    아질산염: Number(r.nitrite.toFixed(3)),
    질산염:  Number(r.nitrate.toFixed(1)),
    알칼리도: Number(r.alkalinity.toFixed(1)),
    탁도:    Number(r.turbidity.toFixed(1)),
  }))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReadingCard({ meta, reading }: { meta: ParamMeta; reading: WaterQualityReading }) {
  const stdKey = meta.key as typeof STD_KEYS[number]
  const value = reading[meta.key] as number
  const status = getStatus(value, stdKey)
  const styles = STATUS_STYLES[status]
  const std = WATER_QUALITY_STANDARDS[stdKey]

  return (
    <Card className={`border ${styles.bg} transition-all hover:brightness-110`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${styles.bg} ${styles.text}`}>
            {meta.icon}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${styles.dot} ${status !== "정상" ? "animate-pulse" : ""}`} />
            <Badge variant={styles.badge as "success" | "warning" | "danger"}>{status}</Badge>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-0.5">{meta.label}</p>
        <p className={`text-2xl font-bold ${styles.text}`}>
          {value.toFixed(meta.key === "ph" || meta.key === "ammonia" || meta.key === "nitrite" ? 2 : 1)}
          {meta.unit && <span className="text-sm font-normal text-slate-400 ml-1">{meta.unit}</span>}
        </p>

        <div className="mt-2 text-xs text-slate-500">
          정상: {std.min} – {std.max}{meta.unit}
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
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
        <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
        <YAxis domain={[yMin, yMax]} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={42} tickFormatter={v => `${v}${unit}`} />
        <Tooltip
          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#e2e8f0" }}
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

function OverviewChart({ chartData }: { chartData: ReturnType<typeof buildChartData> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
        <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} interval={4} />
        <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
        <Tooltip
          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#e2e8f0" }}
        />
        <Legend wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }} />
        <Line type="monotone" dataKey="수온"  stroke="#0ea5e9" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="DO"    stroke="#14b8a6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        <Line type="monotone" dataKey="pH"    stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WaterQualityPage() {
  const [selectedTankId, setSelectedTankId] = useState<string>(MOCK_TANKS[0].id)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const selectedTank = MOCK_TANKS.find(t => t.id === selectedTankId) as Tank
  const readings = MOCK_WATER_QUALITY[selectedTankId] ?? []
  const latest = readings[readings.length - 1] as WaterQualityReading | undefined

  const chartData = useMemo(() => buildChartData(readings, true), [readings])

  const tankAlerts = MOCK_ALERTS.filter(a => a.tank_id === selectedTankId && !a.resolved)

  function handleRefresh() {
    setIsRefreshing(true)
    setTimeout(() => setIsRefreshing(false), 1200)
  }

  // Summary counts across all tanks
  const summaryStatusCounts = useMemo(() => {
    const counts = { 정상: 0, 주의: 0, 위험: 0 }
    MOCK_TANKS.forEach(tank => {
      const tankReadings = MOCK_WATER_QUALITY[tank.id] ?? []
      if (!tankReadings.length) return
      const last = tankReadings[tankReadings.length - 1]
      const worst = STD_KEYS.reduce<StatusLevel>((acc, k) => {
        const s = getStatus(last[k] as number, k)
        if (s === "위험") return "위험"
        if (s === "주의" && acc !== "위험") return "주의"
        return acc
      }, "정상")
      counts[worst]++
    })
    return counts
  }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">수질 모니터링</h1>
          <p className="text-sm text-slate-400 mt-0.5">실시간 수질 데이터 및 이력 분석</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Summary badges */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />정상 {summaryStatusCounts.정상}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <AlertCircle className="w-3.5 h-3.5" />주의 {summaryStatusCounts.주의}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-red-400">
              <XCircle className="w-3.5 h-3.5" />위험 {summaryStatusCounts.위험}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="border-white/10 text-slate-300 hover:bg-white/5 gap-2"
            onClick={handleRefresh}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            새로고침
          </Button>
        </div>
      </div>

      {/* ── Tank Selector ──────────────────────────────────────────────────── */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div>
                <p className="text-xs text-slate-400 mb-1.5">수조 선택</p>
                <Select value={selectedTankId} onValueChange={setSelectedTankId}>
                  <SelectTrigger className="w-48 bg-slate-900/60 border-white/10 text-white focus:ring-ocean-500/30">
                    <SelectValue placeholder="수조를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    {MOCK_TANKS.map(tank => (
                      <SelectItem
                        key={tank.id}
                        value={tank.id}
                        className="text-slate-200 focus:bg-white/10 focus:text-white"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            tank.status === "active" ? "bg-emerald-400" :
                            tank.status === "warning" ? "bg-amber-400" : "bg-red-400"
                          }`} />
                          {tank.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedTank && (
                <div className="flex items-center gap-6 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">사육일수</p>
                    <p className="font-semibold text-white">{selectedTank.cycle_day}일차</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">수용량</p>
                    <p className="font-semibold text-white">{selectedTank.volume.toLocaleString()}㎥</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">입식수</p>
                    <p className="font-semibold text-white">{selectedTank.shrimp_count.toLocaleString()}마리</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">밀도</p>
                    <p className="font-semibold text-white">{selectedTank.stocking_density}마리/㎥</p>
                  </div>
                </div>
              )}
            </div>

            {latest && (
              <div className="text-xs text-slate-500">
                최근 측정: {formatDateTime(latest.recorded_at)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Alert Banner ────────────────────────────────────────────────────── */}
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
                <p className={`text-sm font-medium ${alert.type === "danger" ? "text-red-300" : "text-amber-300"}`}>
                  {alert.message}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  측정값: {alert.value} / 임계치: {alert.threshold} · {formatDateTime(alert.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Current Readings Grid ───────────────────────────────────────────── */}
      {latest ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3">
          {PARAM_META.map(meta => (
            <ReadingCard key={meta.key} meta={meta} reading={latest} />
          ))}
        </div>
      ) : (
        <Card className="bg-slate-800/50 border-white/5">
          <CardContent className="p-8 text-center text-slate-400">
            선택한 수조의 수질 데이터가 없습니다.
          </CardContent>
        </Card>
      )}

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-base">24시간 수질 추이</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList className="bg-slate-900/60 border border-white/5 h-9 mb-4">
              <TabsTrigger value="overview"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">수온·DO·pH</TabsTrigger>
              <TabsTrigger value="temperature" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">수온</TabsTrigger>
              <TabsTrigger value="ph"         className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">pH</TabsTrigger>
              <TabsTrigger value="do_level"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">DO</TabsTrigger>
              <TabsTrigger value="salinity"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">염분</TabsTrigger>
              <TabsTrigger value="ammonia"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">암모니아</TabsTrigger>
              <TabsTrigger value="turbidity"  className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">탁도</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <OverviewChart chartData={chartData} />
              <p className="text-xs text-slate-500 mt-2 text-center">수온(°C) · DO(mg/L) · pH — 기준선 미표시 (복합 Y축)</p>
            </TabsContent>

            {(
              [
                { tabValue: "temperature", chartLabel: "수온",    stdKey: "temperature", chartColor: "#0ea5e9", unit: "°C" },
                { tabValue: "ph",          chartLabel: "pH",      stdKey: "ph",          chartColor: "#a78bfa", unit: "" },
                { tabValue: "do_level",    chartLabel: "DO",      stdKey: "do_level",    chartColor: "#14b8a6", unit: "mg/L" },
                { tabValue: "salinity",    chartLabel: "염분",    stdKey: "salinity",    chartColor: "#f59e0b", unit: "ppt" },
                { tabValue: "ammonia",     chartLabel: "암모니아", stdKey: "ammonia",     chartColor: "#f97316", unit: "mg/L" },
                { tabValue: "turbidity",   chartLabel: "탁도",    stdKey: "turbidity",   chartColor: "#8b5cf6", unit: "NTU" },
              ] as Array<{ tabValue: string; chartLabel: string; stdKey: typeof STD_KEYS[number]; chartColor: string; unit: string }>
            ).map(({ tabValue, chartLabel, stdKey, chartColor, unit }) => (
              <TabsContent key={tabValue} value={tabValue}>
                <SingleParamChart
                  chartData={chartData}
                  stdKey={stdKey}
                  chartLabel={chartLabel}
                  chartColor={chartColor}
                  unit={unit}
                />
                <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-4 border-t border-dashed border-emerald-400/60" />정상범위
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

      {/* ── Alert List ──────────────────────────────────────────────────────── */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            {selectedTank?.name} 알림 내역
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tankAlerts.length === 0 ? (
            <div className="flex items-center gap-3 py-6 justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              <p className="text-slate-400 text-sm">미처리 알림이 없습니다 — 수질이 정상 범위에 있습니다.</p>
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
                        <p className={`text-sm font-semibold ${isDanger ? "text-red-300" : "text-amber-300"}`}>
                          {alert.message}
                        </p>
                        <Badge variant={isDanger ? "danger" : "warning"}>
                          {isDanger ? "위험" : "주의"}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        항목: {paramLabel} · 측정값 {alert.value} → 임계치 {alert.threshold}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatDateTime(alert.created_at)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
