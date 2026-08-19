"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Legend,
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
  Maximize2, X, Zap, Gauge, FlaskConical,
} from "lucide-react"
import { exportToCsv } from "@/lib/export"
import { formatDateTime, computeCycleDay } from "@/lib/utils"
import type { Tank, WaterQualityReading, Alert, SensorDevice } from "@/types"
import type { Dict, Locale } from "@/lib/i18n"
import { useT } from "@/lib/i18n-context"
import { useAgriRoute } from "@/lib/agri-route"
import { AGRI_QUALITY_STANDARDS, AGRI_STATUS_STYLES, agriStatusPulses, getAgriStatus, type AgriRecipe, type AgriStatusLevel } from "@/lib/agri-standards"
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

const PARAM_DEFS: Omit<ParamMeta, "label">[] = [
  { key: "temperature", unit: "°C",   icon: <Thermometer className="w-5 h-5" />, chartColor: "#0ea5e9" },
  { key: "ph",          unit: "",     icon: <Droplets className="w-5 h-5" />,    chartColor: "#a78bfa" },
  { key: "do_level",    unit: "mg/L", icon: <Wind className="w-5 h-5" />,        chartColor: "#14b8a6" },
  { key: "salinity",    unit: "‰",  icon: <Waves className="w-5 h-5" />,       chartColor: "#f59e0b" },
  { key: "ammonia",     unit: "mg/L", icon: <AlertTriangle className="w-5 h-5" />, chartColor: "#f97316" },
  { key: "nitrite",     unit: "mg/L", icon: <AlertTriangle className="w-5 h-5" />, chartColor: "#ec4899" },
  { key: "nitrate",     unit: "mg/L", icon: <AlertTriangle className="w-5 h-5" />, chartColor: "#84cc16" },
  { key: "alkalinity",  unit: "mg/L", icon: <Droplets className="w-5 h-5" />,   chartColor: "#06b6d4" },
  { key: "turbidity",   unit: "NTU",  icon: <Waves className="w-5 h-5" />,       chartColor: "#8b5cf6" },
]

/** 수질 항목 이름 — 사전(t)에서 가져온다. pH·DO 는 언어와 무관한 기호라 그대로 둔다. */
function paramLabel(t: Dict, key: string): string {
  switch (key) {
    case "temperature": return t.waterQuality.temperature
    case "ph":          return "pH"
    case "do_level":    return "DO"
    case "salinity":    return t.waterQuality.salinity
    case "ammonia":     return t.waterQuality.ammonia
    case "nitrite":     return t.waterQuality.nitrite
    case "nitrate":     return t.waterQuality.nitrate
    case "alkalinity":  return t.waterQuality.alkalinity
    case "turbidity":   return t.waterQuality.turbidity
    default:            return key
  }
}

const STD_KEYS = [
  "temperature", "ph", "do_level", "salinity",
  "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity",
] as const

// ── 농업(수경재배) 항목 6종 ───────────────────────────────────────────────
//
// 염도·암모니아·아질산염·질산염·알칼리도·탁도는 여기 없다. 농업 폼이 받지
// 않으므로 값이 늘 0 이고, **0 을 "정상" 으로 칠하는 지금이 가장 나쁜 상태**다.
// 새우 경로(PARAM_DEFS + getStatus + STATUS_STYLES)는 한 줄도 건드리지 않는다.
const AGRI_PARAM_DEFS: { key: keyof WaterQualityReading; unit: string; icon: React.ReactNode; chartColor: string }[] = [
  { key: "conductivity",  unit: "mS/cm", icon: <Zap className="w-5 h-5" />,         chartColor: "#0ea5e9" },
  { key: "ph",            unit: "",      icon: <Droplets className="w-5 h-5" />,    chartColor: "#a78bfa" },
  { key: "temperature",   unit: "°C",    icon: <Thermometer className="w-5 h-5" />, chartColor: "#0ea5e9" },
  { key: "do_level",      unit: "ppm",   icon: <Wind className="w-5 h-5" />,        chartColor: "#14b8a6" },
  { key: "flow_rate",     unit: "L/min", icon: <Waves className="w-5 h-5" />,       chartColor: "#6366f1" },
  { key: "diff_pressure", unit: "kPa",   icon: <Gauge className="w-5 h-5" />,       chartColor: "#f43f5e" },
]

function agriParamLabel(t: Dict, key: string): string {
  switch (key) {
    case "conductivity":  return "EC"
    case "ph":            return "pH"
    case "do_level":      return "DO"
    case "temperature":   return t.waterQuality.temperature
    case "flow_rate":     return t.waterQualityX.flowRate
    case "diff_pressure": return t.waterQualityX.diffPressure
    default:              return key
  }
}

/** 화면 표기값. EC 만 저장 µS/cm → 표시 mS/cm 로 내린다(단위 원칙). */
function agriDisplayValue(key: string, raw: number | null | undefined): string {
  if (raw == null || raw === 0) return "—"
  if (key === "conductivity") return (raw / 1000).toFixed(2)
  if (key === "ph") return raw.toFixed(2)
  return raw.toFixed(1)
}

function useAgriStatusText(): (s: AgriStatusLevel) => string {
  const { t } = useT()
  return (s) =>
    s === "정상" ? t.dashboard.normal
    : s === "주의" ? t.dashboard.warning
    : s === "위험" ? t.dashboard.danger
    : s === "미측정" ? t.agri.statusNotMeasured
    : t.agri.statusNoStandard
}

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

function buildChartData(readings: WaterQualityReading[], locale: Locale, last24h = true) {
  const slice = last24h ? readings.slice(-25) : readings
  // 하루가 넘는 구간이면 시각(HH:MM)만으로는 어느 날인지 알 수 없어
  // 라벨이 뭉개진다. 첫·끝 측정이 다른 날이면 날짜(월/일)로 찍는다.
  const first = slice.length ? new Date(slice[0].recorded_at) : null
  const lastPt = slice.length ? new Date(slice[slice.length - 1].recorded_at) : null
  const multiDay = !!(first && lastPt && (lastPt.getTime() - first.getTime()) > 24 * 3600_000)
  return slice.map(r => {
    const d = new Date(r.recorded_at)
    return {
    // 여러 날 구간이면 월/일 + 시:분, 하루 안이면 시:분. 눈금은 XAxis 가 픽셀
    // 간격으로 솎아 내므로(minTickGap) 촘촘한 데이터라도 라벨이 겹치지 않는다.
    time: multiDay
      ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      : d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    temperature: Number(r.temperature.toFixed(1)),
    ph:          Number(r.ph.toFixed(2)),
    do_level:    Number(r.do_level.toFixed(1)),
    salinity:    Number(r.salinity.toFixed(1)),
    ammonia:     Number(r.ammonia.toFixed(3)),
    nitrite:     Number(r.nitrite.toFixed(3)),
    nitrate:     Number(r.nitrate.toFixed(1)),
    alkalinity:  Number(r.alkalinity.toFixed(1)),
    turbidity:   Number(r.turbidity.toFixed(1)),
    // 전도도는 안 쓰는 농장이 많아 값이 있을 때만 점을 찍는다(선이 0 으로 처지지 않게).
    conductivity: typeof r.conductivity === "number" ? Math.round(r.conductivity) : null,
    // 유량·차압(농업 모드) — 전도도와 같은 이유로 값이 있을 때만.
    flow_rate: typeof r.flow_rate === "number" ? Number(r.flow_rate.toFixed(1)) : null,
    diff_pressure: typeof r.diff_pressure === "number" ? Number(r.diff_pressure.toFixed(1)) : null,
  }})
}

// 센서별 비교용 — 한 항목(metricKey)을 센서마다 한 줄로 만든다.
// device_id 가 있는 기록만 쓴다(수기·구기록은 센서 구분이 없어 제외).
const SENSOR_COLORS = ["#0ea5e9", "#f59e0b", "#a78bfa", "#14b8a6", "#ec4899", "#84cc16", "#f97316", "#06b6d4"]

function buildCompareData(
  readings: WaterQualityReading[],
  devNameById: Map<string, string>,
  // 새우 9항목은 non-null 이지만 conductivity·flow_rate·diff_pressure 는 이
  // 저장소가 **일부러 nullable 로 둔** 컬럼이다("쟀는데 0"과 "안 쟀다"를 구분하려고 —
  // lib/db.ts). 농업 비교 항목에 EC 가 들어오면서 그 null 이 여기까지 온다.
  metricKey: keyof WaterQualityReading,
  digits: number,
  locale: Locale,
) {
  const first = readings.length ? new Date(readings[0].recorded_at) : null
  const lastPt = readings.length ? new Date(readings[readings.length - 1].recorded_at) : null
  const multiDay = !!(first && lastPt && (lastPt.getTime() - first.getTime()) > 24 * 3600_000)
  return readings
    .filter(r => r.device_id && devNameById.has(r.device_id))
    .map(r => {
      const d = new Date(r.recorded_at)
      return {
        t: d.getTime(),
        time: multiDay
          ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
          : d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
        // buildChartData 와 같은 가드. 없으면 null 에서 TypeError 가 나고
        // useMemo 안이라 화면 전체가 죽는다(백스크린).
        [devNameById.get(r.device_id!)!]: typeof r[metricKey] === "number"
          ? Number((r[metricKey] as number).toFixed(digits))
          : null,
      } as Record<string, number | string | null>
    })
    .sort((a, b) => (a.t as number) - (b.t as number))
}

function SensorCompareChart({ data, names, fill = false, big = false }: { data: Record<string, number | string | null>[]; names: string[]; fill?: boolean; big?: boolean }) {
  const fs = big ? 17 : 11
  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : 260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={big ? 140 : 100} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} width={big ? 60 : 44} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: big ? 16 : 12 }} />
        <Legend wrapperStyle={{ fontSize: big ? 18 : 12 }} />
        {names.map((n, i) => (
          <Line key={n} type="monotone" dataKey={n} stroke={SENSOR_COLORS[i % SENSOR_COLORS.length]} strokeWidth={big ? 3.5 : 2} dot={false} connectNulls activeDot={{ r: big ? 6 : 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// 한 수조에 센서(기기)가 여러 대일 때, 각 센서가 마지막으로 보낸 값을
// 센서별로 보여 주기 위한 라벨. (이력·그래프는 아직 수조 단위 합산이다.)
function devicePayloadLabels(t: Dict): Record<string, { label: string; unit?: string }> {
  return {
    temperature:   { label: t.waterQuality.temperature, unit: "°C" },
    ph:            { label: "pH" },
    do_level:      { label: t.waterQualityX.dissolvedOxygen, unit: "ppm" },
    salinity:      { label: t.waterQuality.salinity, unit: "‰" },
    conductivity:  { label: t.waterQualityX.conductivity, unit: "µS/cm" },
    tds:           { label: "TDS", unit: "ppm" },
    do_saturation: { label: t.waterQualityX.doSaturation, unit: "%" },
    orp:           { label: "ORP", unit: "mV" },
    // 유량·차압 — 새우 모드에서도 무해(장비가 안 보내면 안 보임).
    flow_rate:     { label: t.waterQualityX.flowRate, unit: "L/min" },
    diff_pressure: { label: t.waterQualityX.diffPressure, unit: "kPa" },
  }
}

function deviceSeen(t: Dict, iso: string | null) {
  if (!iso) return t.waterQualityX.noSignal
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return t.time.justNow
  if (mins < 60) return t.time.minutesAgo.replace("{{n}}", String(mins))
  const h = Math.floor(mins / 60)
  if (h < 24) return t.time.hoursAgo.replace("{{n}}", String(h))
  return t.time.daysAgo.replace("{{n}}", String(Math.floor(h / 24)))
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
      aria-label={`${meta.label}: ${value.toFixed(meta.key === "ph" || meta.key === "ammonia" || meta.key === "nitrite" ? 2 : 1)}${meta.unit} — ${t.waterQualityX.statusLabel}: ${statusLabel}`}
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
              aria-label={`${meta.label} ${t.waterQualityX.statusLabel}: ${statusLabel}`}
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

function AgriReadingCard({ meta, reading, recipe }: {
  meta: { key: keyof WaterQualityReading; unit: string; icon: React.ReactNode }
  reading: WaterQualityReading
  recipe: AgriRecipe | null
}) {
  const { t } = useT()
  const statusText = useAgriStatusText()
  const label = agriParamLabel(t, meta.key as string)
  const raw = reading[meta.key] as number | null | undefined
  const status = getAgriStatus(meta.key as string, raw, recipe)
  const styles = AGRI_STATUS_STYLES[status]
  const shown = agriDisplayValue(meta.key as string, raw)

  // 기준선 문구 — 기준이 없는 항목에는 아무것도 쓰지 않는다. 없는 기준을
  // 그럴듯하게 채우면 그것이 곧 전역 기준선이 된다.
  let rangeText: string | null = null
  if (meta.key === "conductivity" && recipe?.target_ec != null) {
    rangeText = `${t.waterQualityX.targetLabel} ${(recipe.target_ec / 1000).toFixed(2)} ±${((recipe.ec_tolerance ?? 100) / 1000).toFixed(2)} ${meta.unit}`
  } else if (meta.key === "ph" && recipe?.target_ph != null) {
    rangeText = `${t.waterQualityX.targetLabel} ${recipe.target_ph} ±${recipe.ph_tolerance ?? 0.5}`
  } else if (meta.key === "ph" || meta.key === "temperature" || meta.key === "do_level") {
    const std = AGRI_QUALITY_STANDARDS[meta.key]
    rangeText = `${t.waterQuality.normalRange}: ${std.min} – ${std.max}${meta.unit}`
  }

  return (
    <Card
      className={`border min-w-0 overflow-hidden ${styles.bg} transition-all hover:brightness-110`}
      aria-label={`${label}: ${shown}${meta.unit} — ${t.waterQualityX.statusLabel}: ${statusText(status)}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${styles.bg} ${styles.text}`} aria-hidden="true">
            {meta.icon}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${styles.dot} ${agriStatusPulses(status) ? "animate-pulse" : ""}`} aria-hidden="true" />
            <span className={`text-xs font-medium ${styles.text}`}>{statusText(status)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${styles.text}`}>
          {shown}
          {meta.unit && <span className="text-sm font-normal text-muted-foreground ml-1">{meta.unit}</span>}
        </p>

        {rangeText && <div className="mt-2 text-xs text-muted-foreground">{rangeText}</div>}
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
  fill?: boolean
  big?: boolean
  /** 농업 모드 베드 레시피 — 있으면 std 기준선 대신 목표선+허용밴드를 그린다. */
  recipe?: { target: number; tol: number } | null
  /** 농업 모드에서 새우 해수 기준선(std)을 숨긴다(레시피 없어도 오탐 방지). */
  hideStd?: boolean
}

function SingleParamChart({ chartData, stdKey, chartLabel, chartColor, unit, fill = false, big = false, recipe = null, hideStd = false }: ChartPanelProps) {
  const { t } = useT()
  const std = WATER_QUALITY_STANDARDS[stdKey]
  const yVals = chartData.map(d => d[stdKey as keyof typeof d] as number).filter(Boolean)
  const padding = (std.max - std.min) * 0.5
  const yMin = Math.min(std.warning_min - padding * 0.2, ...yVals)
  const yMax = Math.max(std.warning_max + padding * 0.2, ...yVals)
  const fs = big ? 17 : 11
  const refFs = big ? 14 : 10
  const showStd = !hideStd && !recipe

  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : 260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={big ? 140 : 100} />
        <YAxis domain={[yMin, yMax]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} width={big ? 70 : 42} tickFormatter={v => `${v}${unit}`} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: big ? 16 : 12 }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
        />
        {showStd && <ReferenceLine y={std.max} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: t.waterQualityX.chartMax, fill: "#34d399", fontSize: refFs, position: "insideTopRight" }} />}
        {showStd && <ReferenceLine y={std.min} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: t.waterQualityX.chartMin, fill: "#34d399", fontSize: refFs, position: "insideBottomRight" }} />}
        {showStd && <ReferenceLine y={std.warning_max} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: t.waterQualityX.chartWarnHigh, fill: "#fbbf24", fontSize: refFs, position: "insideTopRight" }} />}
        {showStd && <ReferenceLine y={std.warning_min} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: t.waterQualityX.chartWarnLow, fill: "#fbbf24", fontSize: refFs, position: "insideBottomRight" }} />}
        {/* 레시피 목표선+허용밴드 — 정상 범위 = emerald(기존 std 선과 같은 문법) */}
        {recipe && <ReferenceArea y1={recipe.target - recipe.tol} y2={recipe.target + recipe.tol} fill="#34d399" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />}
        {recipe && <ReferenceLine y={recipe.target} stroke="#34d399" strokeDasharray="6 3" strokeOpacity={0.9} label={{ value: `${t.waterQualityX.targetLabel} ${recipe.target}`, fill: "#34d399", fontSize: refFs, position: "insideTopRight" }} />}
        {recipe && <ReferenceLine y={recipe.target + recipe.tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />}
        {recipe && <ReferenceLine y={recipe.target - recipe.tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />}
        <Line type="monotone" dataKey={stdKey} name={chartLabel} stroke={chartColor} strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function NitrogenChart({ chartData, fill = false, big = false }: { chartData: ReturnType<typeof buildChartData>; fill?: boolean; big?: boolean }) {
  const { t } = useT()
  const fs = big ? 17 : 11
  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : 260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={big ? 140 : 100} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} width={big ? 64 : 48} tickFormatter={v => `${v}`} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: big ? 16 : 12 }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v, name) => [`${v} mg/L`, name]}
        />
        <Legend wrapperStyle={{ fontSize: big ? "18px" : "12px", color: "hsl(var(--muted-foreground))" }} />
        <Line type="monotone" dataKey="ammonia" name={t.waterQuality.ammonia} stroke="#f97316" strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
        <Line type="monotone" dataKey="nitrite" name={t.waterQuality.nitrite} stroke="#ec4899" strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
        <Line type="monotone" dataKey="nitrate" name={t.waterQuality.nitrate} stroke="#84cc16" strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// 전도도(EC) — 해수 약 50,000 uS/cm, 양액 1~3 mS/cm 로 쓰는 곳마다 적정값이
// 달라 "전역" 기준선은 긋지 않는다. 다만 농업 모드에서 베드별 레시피가 있으면
// 그 베드의 목표 EC 선 + 허용밴드(±tolerance)를 그린다 — 전역 상수가 아니라
// 농장별 설정이므로 기존 결정과 충돌하지 않는다(설계서 4-3).
// recipe 의 target/tol 은 µS/cm — Y축이 µS/cm 이므로 환산 없이 그대로,
// 라벨만 mS/cm(÷1000)로 적는다.
function ConductivityChart({ chartData, fill = false, big = false, recipe = null, msCmHint = false }: {
  chartData: ReturnType<typeof buildChartData>
  fill?: boolean
  big?: boolean
  recipe?: { target: number; tol: number } | null
  msCmHint?: boolean
}) {
  const { t } = useT()
  const fs = big ? 17 : 11
  const refFs = big ? 14 : 10
  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : 260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={big ? 140 : 100} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} width={big ? 78 : 60} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: big ? 16 : 12 }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v) => [
            msCmHint ? `${v} µS/cm (${(Number(v) / 1000).toFixed(2)} mS/cm)` : `${v} µS/cm`,
            t.waterQualityX.conductivity,
          ]}
        />
        {recipe && <ReferenceArea y1={recipe.target - recipe.tol} y2={recipe.target + recipe.tol} fill="#34d399" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />}
        {recipe && <ReferenceLine y={recipe.target} stroke="#34d399" strokeDasharray="6 3" strokeOpacity={0.9} label={{ value: `${t.waterQualityX.targetLabel} ${(recipe.target / 1000).toFixed(2)}`, fill: "#34d399", fontSize: refFs, position: "insideTopRight" }} />}
        {recipe && <ReferenceLine y={recipe.target + recipe.tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />}
        {recipe && <ReferenceLine y={recipe.target - recipe.tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />}
        <Line type="monotone" dataKey="conductivity" name={t.waterQualityX.conductivity}
          stroke="#22d3ee" strokeWidth={big ? 3.5 : 2} dot={false} connectNulls activeDot={{ r: big ? 6 : 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// 유량·차압(농업 모드) — 기준선 없는 단일 라인. ConductivityChart 와 같은 결.
function AgriLineChart({ chartData, dataKey, name, color, unit, fill = false, big = false }: {
  chartData: ReturnType<typeof buildChartData>
  dataKey: "flow_rate" | "diff_pressure"
  name: string
  color: string
  unit: string
  fill?: boolean
  big?: boolean
}) {
  const fs = big ? 17 : 11
  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : 260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={big ? 140 : 100} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} width={big ? 64 : 48} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: big ? 16 : 12 }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(v) => [`${v} ${unit}`, name]}
        />
        <Line type="monotone" dataKey={dataKey} name={name}
          stroke={color} strokeWidth={big ? 3.5 : 2} dot={false} connectNulls activeDot={{ r: big ? 6 : 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function OverviewChart({ chartData, fill = false, big = false }: { chartData: ReturnType<typeof buildChartData>; fill?: boolean; big?: boolean }) {
  const { t } = useT()
  const fs = big ? 17 : 11
  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : 260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={big ? 140 : 100} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: fs }} tickLine={false} axisLine={false} width={big ? 60 : 42} />
        <Tooltip
          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: big ? 16 : 12 }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Legend wrapperStyle={{ fontSize: big ? "18px" : "12px", color: "hsl(var(--muted-foreground))" }} />
        <Line type="monotone" dataKey="temperature" name={t.waterQuality.temperature} stroke="#0ea5e9" strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
        <Line type="monotone" dataKey="do_level" name="DO" stroke="#14b8a6" strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
        <Line type="monotone" dataKey="ph" name="pH" stroke="#a78bfa" strokeWidth={big ? 3.5 : 2} dot={false} activeDot={{ r: big ? 6 : 4 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// 농업 모드 기본 노출 탭 — 이 밖의 탭(새우 지표)은 "더보기"로 접는다(수아 시안 5-1).
const AGRI_PRIMARY_TABS = new Set(["conductivity", "ph", "temperature", "do_level", "flow_rate", "diff_pressure"])

export function WaterQualityView() {
  const { user } = useAuth()
  const { t, locale } = useT()
  const { isAgri, href: withAgri } = useAgriRoute()
  const PARAM_META: ParamMeta[] = useMemo(
    () => PARAM_DEFS.map(m => ({ ...m, label: paramLabel(t, m.key as string) })),
    [t],
  )
  const AGRI_PARAM_META: ParamMeta[] = useMemo(
    () => AGRI_PARAM_DEFS.map(m => ({ ...m, label: agriParamLabel(t, m.key as string) })),
    [t],
  )
  const agriStatusText = useAgriStatusText()
  const [tanks, setTanks] = useState<Tank[]>([])
  const [selectedTankId, setSelectedTankId] = useState<string>("")
  const initialTankIdFromUrl = useRef<string | null>(null)

  useEffect(() => {
    initialTankIdFromUrl.current = new URLSearchParams(window.location.search).get("tank")
  }, [])
  // 수조의 전체 기록(모든 센서 + 수기). 센서별 보기는 여기서 걸러 낸다.
  const [allReadings, setAllReadings] = useState<WaterQualityReading[]>([])
  const [compareParam, setCompareParam] = useState<keyof WaterQualityReading>("temperature")
  const [tankAlerts, setTankAlerts] = useState<Alert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hours, setHours] = useState<24 | 72 | 168>(168)

  // Summary counts
  const [summaryStatusCounts, setSummaryStatusCounts] = useState({ 정상: 0, 주의: 0, 위험: 0 })

  // Sensor devices for selected tank
  const [tankDevices, setTankDevices] = useState<SensorDevice[]>([])
  // 센서별 보기 — null 이면 수조 전체(합산), 값이 있으면 그 센서만.
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  // 그래프 전체화면 — 현장에서 벽걸이 모니터나 태블릿으로 크게 볼 때 쓴다.
  const [fullChart, setFullChart] = useState<null | "main" | "compare">(null)
  // 전광판 모드 — 전체화면에서 글자·선을 키우고 항목을 자동 순환한다.
  const [boardMode, setBoardMode] = useState(false)
  // 추세 그래프 탭 — 전광판 자동 순환을 위해 제어형으로 둔다.
  const [chartTab, setChartTab] = useState("overview")
  // 농업 모드에서 새우 지표 탭(개요·질소·염도 등)을 펼쳤는지.
  const [showAllTabs, setShowAllTabs] = useState(false)

  // 농업 모드 기본 탭은 EC — 모드가 비동기로 파생되므로 초기값 대신 효과로 맞춘다.
  // 사용자가 이미 다른 탭을 골랐다면(기본 "overview" 그대로가 아니면) 건드리지 않는다.
  useEffect(() => {
    if (isAgri) setChartTab(cur => (cur === "overview" ? "conductivity" : cur))
  }, [isAgri])

  // 접을 때 현재 탭이 접히는 탭이면 EC 로 복귀시킨다(수아 시안 5-1).
  const toggleMoreTabs = () => {
    if (showAllTabs && !AGRI_PRIMARY_TABS.has(chartTab)) setChartTab("conductivity")
    setShowAllTabs(v => !v)
  }

  useEffect(() => {
    if (!fullChart) { setBoardMode(false); return }   // 전체화면을 닫으면 전광판도 끈다
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullChart(null) }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"   // 뒤 페이지 스크롤 잠금
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [fullChart])

  // 전광판 자동 순환 — 15초마다 다음 항목으로. 추세 그래프는 탭을,
  // 센서별 비교는 비교 항목을 돌린다.
  // 농업 모드는 농업 기본 탭 순서로 돈다 — 새우 고정 순서를 쓰면 conductivity 가
  // indexOf === -1 이라 overview 로 튀고 접힌 새우 탭만 순환한다.
  useEffect(() => {
    if (!boardMode || !fullChart) return
    const MAIN_ORDER = isAgri
      ? ["conductivity", "ph", "temperature", "do_level", "flow_rate", "diff_pressure"]
      : ["overview", "nitrogen", "temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"]
    const COMPARE_ORDER = ["temperature", "ph", "do_level", "salinity"] as const
    const id = setInterval(() => {
      if (fullChart === "main") {
        setChartTab(cur => MAIN_ORDER[(MAIN_ORDER.indexOf(cur) + 1) % MAIN_ORDER.length])
      } else {
        setCompareParam(cur => {
          const i = COMPARE_ORDER.indexOf(cur as typeof COMPARE_ORDER[number])
          return COMPARE_ORDER[(i + 1) % COMPARE_ORDER.length]
        })
      }
    }, 15_000)
    return () => clearInterval(id)
  }, [boardMode, fullChart, isAgri])

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
      setAllReadings(mockReadings)
      setTankAlerts(MOCK_ALERTS.filter(a => a.tank_id === tankId && !a.resolved))
      setTankDevices(MOCK_SENSOR_DEVICES.filter(d => d.tank_id === tankId))
      setIsLoading(false)
      return
    }
    try {
      // 수조 전체 기록을 한 번에 가져오고(센서 구분 포함), 센서별 보기는
      // 클라이언트에서 걸러 낸다. 그래야 센서별 비교 그래프도 같은 데이터로 그린다.
      const dbReadings = await getWaterQuality(tankId, hours)
      setAllReadings(dbReadings)
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

  // 수조를 바꾸면 센서 필터는 '수조 전체'로 되돌린다.
  useEffect(() => { setSelectedDeviceId(null) }, [selectedTankId])

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

  // 센서별 보기 필터 — selectedDeviceId 가 있으면 그 센서 기록만.
  const readings = useMemo(
    () => selectedDeviceId ? allReadings.filter(r => (r.device_id ?? null) === selectedDeviceId) : allReadings,
    [allReadings, selectedDeviceId],
  )
  const latest = useMemo(() => (readings.length ? readings[readings.length - 1] : null), [readings])
  const chartData = useMemo(() => buildChartData(readings, locale, false), [readings, locale])
  // 전도도를 쓰는 농장(EC 센서를 전도도 모드로 둔 곳)에서만 탭을 보여 준다.
  const hasConductivity = useMemo(
    () => readings.some(r => typeof r.conductivity === "number"), [readings])

  // 센서별 비교 그래프 데이터 — 활성 센서가 2대 이상일 때만 만든다.
  const activeDevices = useMemo(() => tankDevices.filter(d => d.active), [tankDevices])
  const compareNames = useMemo(() => activeDevices.map(d => d.name), [activeDevices])
  // 비교 그래프가 비었을 때 "왜" 비었는지 스스로 진단하기 위한 개수.
  // 0 이면 기록에 센서 표시 자체가 안 붙는 것(마이그레이션/스키마 캐시),
  // >0 인데 그래프가 비면 이 수조 센서와 불일치(재연결 직후 등).
  const taggedCount = useMemo(() => allReadings.filter(r => r.device_id).length, [allReadings])
  const compareData = useMemo(() => {
    if (activeDevices.length < 2) return []
    const nameById = new Map(activeDevices.map(d => [d.id, d.name]))
    const meta = [...PARAM_DEFS, ...AGRI_PARAM_DEFS].find(m => m.key === compareParam)
    // EC 는 µS/cm 정수로 찍는다(buildChartData 의 Math.round 와 같은 자릿수).
    const digits = compareParam === "conductivity" ? 0
      : meta?.unit === "" ? 2
      : (compareParam === "ammonia" || compareParam === "nitrite" ? 3 : 1)
    return buildCompareData(allReadings, nameById, compareParam, digits, locale)
  }, [allReadings, activeDevices, compareParam, locale])

  const selectedTank = tanks.find(t => t.id === selectedTankId)

  // 베드 레시피 목표선 — 농업 모드 + 해당 베드에 레시피가 있을 때만.
  // target/tol 은 µS/cm 저장값 그대로(Y축이 µS/cm), 라벨만 차트가 ÷1000 한다.
  const ecRecipe = isAgri && selectedTank?.target_ec != null
    ? { target: selectedTank.target_ec, tol: selectedTank.ec_tolerance ?? 100 }
    : null
  const phRecipe = isAgri && selectedTank?.target_ph != null
    ? { target: selectedTank.target_ph, tol: selectedTank.ph_tolerance ?? 0.5 }
    : null

  function handleRefresh() {
    setIsRefreshing(true)
    loadTankData(selectedTankId).then(() => computeSummary(tanks)).finally(() => setIsRefreshing(false))
  }

  function handleExportCsv() {
    if (!readings.length || !selectedTank) return
    // 농업 CSV — EC 는 **mS/cm 로 내보낸다.** 농가가 엑셀에서 보는 숫자가
    // 화면과 달라지면 안 된다(단위 원칙).
    const rows = isAgri ? readings.map(r => ({
      [t.waterQuality.recordedAt]: r.recorded_at,
      [t.waterQuality.tank]: selectedTank.name,
      "EC(mS/cm)": r.conductivity != null ? (r.conductivity / 1000).toFixed(2) : "",
      "pH": r.ph,
      [`${t.waterQuality.temperature}(°C)`]: r.temperature,
      "DO(ppm)": r.do_level,
      [`${t.waterQualityX.flowRate}(L/min)`]: r.flow_rate ?? "",
      [`${t.waterQualityX.diffPressure}(kPa)`]: r.diff_pressure ?? "",
    })) : readings.map(r => ({
      [t.waterQuality.recordedAt]: r.recorded_at,
      [t.waterQuality.tank]: selectedTank.name,
      [`${t.waterQuality.temperature}(°C)`]: r.temperature,
      "pH": r.ph,
      "DO(mg/L)": r.do_level,
      [`${t.waterQuality.salinity}(ppt)`]: r.salinity,
      [`${t.waterQuality.ammonia}(mg/L)`]: r.ammonia,
      [`${t.waterQuality.nitrite}(mg/L)`]: r.nitrite,
      [`${t.waterQuality.nitrate}(mg/L)`]: r.nitrate,
      [`${t.waterQuality.alkalinity}(mg/L)`]: r.alkalinity,
      [`${t.waterQuality.turbidity}(NTU)`]: r.turbidity,
      // 전도도를 쓰는 농장에서만 값이 있다. 안 쓰면 빈 칸으로 둔다.
      ...(hasConductivity ? { [`${t.waterQualityX.conductivity}(µS/cm)`]: r.conductivity ?? "" } : {}),
    }))
    exportToCsv(rows, `${t.waterQualityX.csvFilePrefix}_${selectedTank.name}_${new Date().toISOString().split("T")[0]}`)
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
        <Link href={withAgri("/farms")}>
          <Button className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2 min-h-[44px]">
            <Plus className="w-4 h-4" /> {t.dashboard.goToFarms}
          </Button>
        </Link>
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
                aria-label={t.waterQualityX.periodSelectAria}
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

          <Link href={withAgri("/journal")} className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="border-ocean-500/40 text-ocean-500 hover:bg-ocean-500/10 gap-2 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t.waterQuality.addRecord}</span>
              <span className="sm:hidden">{t.waterQuality.addRecord}</span>
            </Button>
          </Link>

          <Button
            variant="outline"
            size="sm"
            className="border-border text-muted-foreground hover:bg-accent gap-2 shrink-0 min-h-[44px]"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label={t.waterQualityX.refreshDataAria}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t.waterQualityX.refresh}</span>
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
                    aria-label={t.waterQualityX.tankSelectAria}
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

              {selectedTank && isAgri && (
                /* 입식수·밀도는 농업 베드에서 항상 0 이다. 값 없는 항목을 넣지 않고
                   농가가 실제로 확인하는 것(정식일·레시피)으로 바꾼다. */
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6 text-sm">
                  {selectedTank.stocking_date && (
                    <div>
                      <p className="text-xs text-muted-foreground">{t.waterQualityX.cycleDays}</p>
                      <p className="font-semibold text-foreground">{t.waterQualityX.dayN.replace("{{n}}", String(computeCycleDay(selectedTank.stocking_date)))}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">{t.waterQualityX.capacity}</p>
                    <p className="font-semibold text-foreground">{selectedTank.volume.toLocaleString()}㎥</p>
                  </div>
                  {selectedTank.stocking_date && (
                    <div>
                      <p className="text-xs text-muted-foreground">{t.agri.plantingDate}</p>
                      <p className="font-semibold text-foreground tabular-nums">{selectedTank.stocking_date}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">{t.agri.recipeTitle}</p>
                    <p className="font-semibold text-foreground tabular-nums flex items-center gap-1.5">
                      <FlaskConical className="w-3 h-3 text-ocean-600 shrink-0" aria-hidden="true" />
                      {selectedTank.target_ec == null && selectedTank.target_ph == null
                        ? t.agri.recipeNotSet
                        : [
                            selectedTank.target_ec != null
                              ? `EC ${(selectedTank.target_ec / 1000).toFixed(2)} ±${((selectedTank.ec_tolerance ?? 100) / 1000).toFixed(2)}`
                              : null,
                            selectedTank.target_ph != null
                              ? `pH ${selectedTank.target_ph} ±${selectedTank.ph_tolerance ?? 0.5}`
                              : null,
                          ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
              )}

              {selectedTank && !isAgri && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t.waterQualityX.cycleDays}</p>
                    <p className="font-semibold text-foreground">{t.waterQualityX.dayN.replace("{{n}}", String(selectedTank.cycle_day))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t.waterQualityX.capacity}</p>
                    <p className="font-semibold text-foreground">{selectedTank.volume.toLocaleString()}㎥</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t.waterQualityX.stockedCount}</p>
                    <p className="font-semibold text-foreground">{selectedTank.shrimp_count.toLocaleString()} {t.journalX.unitFish}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t.waterQualityX.density}</p>
                    <p className="font-semibold text-foreground">{selectedTank.stocking_density} {t.farms.tankDensityUnit}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-1">
              {tankDevices.filter(d => d.active).length > 0 && (
                <span className="flex items-center gap-1 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
                  <Wifi className="w-3 h-3" />
                  {t.waterQualityX.sensorAutoCollect.replace("{{n}}", String(tankDevices.filter(d => d.active).length))}
                </span>
              )}
              {latest && (
                <span className="text-xs text-muted-foreground">
                  {t.waterQualityX.latestMeasurement}: {formatDateTime(latest.recorded_at)}
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
                      {t.waterQualityX.measured}: {alert.value} / {t.waterQualityX.threshold}: {alert.threshold} · {formatDateTime(alert.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try { await resolveAlert(alert.id) } catch { /* non-fatal */ }
                      setTankAlerts(prev => prev.filter(a => a.id !== alert.id))
                    }}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-emerald-500 hover:bg-accent transition-colors"
                    aria-label={t.waterQualityX.dismissAlertAria}
                    title={t.notif.markResolved}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Sensor selector (한 수조에 센서가 2대 이상일 때) ──────────────── */}
          {tankDevices.filter(d => d.active).length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1 shrink-0">{t.waterQualityX.sensorView}</span>
              <button
                onClick={() => setSelectedDeviceId(null)}
                className={"px-3 py-1.5 rounded-full border text-xs font-medium transition-colors " +
                  (selectedDeviceId === null ? "bg-ocean-600 text-white border-ocean-600" : "bg-card text-muted-foreground border-border hover:bg-accent")}
              >
                {t.waterQualityX.wholeTank}
              </button>
              {tankDevices.filter(d => d.active).map(dev => (
                <button
                  key={dev.id}
                  onClick={() => setSelectedDeviceId(dev.id)}
                  className={"px-3 py-1.5 rounded-full border text-xs font-medium transition-colors max-w-[160px] truncate " +
                    (selectedDeviceId === dev.id ? "bg-ocean-600 text-white border-ocean-600" : "bg-card text-muted-foreground border-border hover:bg-accent")}
                  title={dev.name}
                >
                  {dev.name}
                </button>
              ))}
            </div>
          )}

          {/* ── Per-Parameter Status Strip ──────────────────────────────────── */}
          {latest && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-3 font-medium">{t.waterQualityX.paramStatusTitle}</p>
                <div className="flex flex-wrap gap-2">
                  {isAgri ? AGRI_PARAM_META.map(meta => {
                    const raw = latest[meta.key] as number | null | undefined
                    const status = getAgriStatus(meta.key as string, raw, selectedTank ?? null)
                    const styles = AGRI_STATUS_STYLES[status]
                    const label = agriStatusText(status)
                    const shown = agriDisplayValue(meta.key as string, raw)
                    return (
                      <div
                        key={meta.key}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${styles.bg} ${styles.text}`}
                        aria-label={`${meta.label} ${t.waterQualityX.statusLabel}: ${label}`}
                        role="status"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot} ${agriStatusPulses(status) ? "animate-pulse" : ""}`} aria-hidden="true" />
                        <span>{meta.label}</span>
                        <span className="opacity-50" aria-hidden="true">·</span>
                        {/* 값을 함께 넣는다 — "기준 없음" 일 때 상태만 있으면 정보가 0 이다 */}
                        <span className="tabular-nums">{shown}{meta.unit && ` ${meta.unit}`}</span>
                        <span className="opacity-50" aria-hidden="true">·</span>
                        <span>{label}</span>
                      </div>
                    )
                  }) : PARAM_META.map(meta => {
                    const stdKey = meta.key as typeof STD_KEYS[number]
                    const value = latest[meta.key] as number
                    const status = getStatus(value, stdKey)
                    const styles = STATUS_STYLES[status]
                    const statusLabel = status === "정상" ? t.dashboard.normal : status === "주의" ? t.dashboard.warning : t.dashboard.danger
                    return (
                                  <div
                        key={meta.key}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${styles.bg} ${styles.text}`}
                        aria-label={`${meta.label} ${t.waterQualityX.statusLabel}: ${statusLabel}`}
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
            isAgri ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {AGRI_PARAM_META.map(meta => (
                <AgriReadingCard key={meta.key} meta={meta} reading={latest} recipe={selectedTank ?? null} />
              ))}
            </div>
            ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3">
              {PARAM_META.map(meta => (
                <ReadingCard key={meta.key} meta={meta} reading={latest} />
              ))}
            </div>
            )
          ) : (
            <Card className="bg-card border-border">
              <CardContent className="p-8 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Droplets className="w-10 h-10 text-muted-foreground/40" aria-hidden="true" />
                  <p className="text-muted-foreground text-sm font-medium">{t.waterQuality.noData}</p>
                  <p className="text-muted-foreground/60 text-xs">{t.waterQualityX.noDataHint}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Per-Sensor Current Values — 센서가 1대여도 어느 센서 값인지 보이게 한다 ── */}
          {tankDevices.filter(d => d.active).length >= 1 && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-3 font-medium">
                  {t.waterQualityX.sensorCurrentN.replace("{{n}}", String(tankDevices.filter(d => d.active).length))}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {tankDevices.filter(d => d.active).map(dev => {
                    const payloadLabels = devicePayloadLabels(t)
                    const payload = dev.last_payload ?? {}
                    const measured = Object.entries(payload).filter(
                      ([k, v]) => typeof v === "number" && k in payloadLabels
                    ) as [string, number][]
                    return (
                      <div key={dev.id} className="rounded-lg border border-border bg-background/40 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-sm font-medium text-foreground truncate" title={dev.name}>{dev.name}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{deviceSeen(t, dev.last_seen_at)}</span>
                        </div>
                        {measured.length > 0 ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {measured.map(([k, v]) => {
                              const m = payloadLabels[k]
                              return (
                                <span key={k} className="text-xs text-muted-foreground tabular-nums">
                                  {m.label} <span className="text-foreground font-semibold">{v}</span>
                                  {m.unit && <span className="opacity-70">{m.unit}</span>}
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground/60">{t.waterQualityX.noValuesYet}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-3">
                  {t.waterQualityX.sensorCaption}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Per-Sensor Comparison Chart (센서 2대 이상) ───────────────────── */}
          {activeDevices.length > 1 && (
            <Card className={fullChart === "compare"
              ? "fixed inset-0 z-50 bg-card rounded-none border-0 flex flex-col overflow-hidden"
              : "bg-card border-border"}>
              <CardContent className={fullChart === "compare" ? "p-4 flex-1 flex flex-col min-h-0" : "p-4"}>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <p className="text-sm font-medium text-foreground">{t.waterQualityX.sensorCompare}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* 농업은 염도를 빼고 EC 를 1순위로 */}
                    {(isAgri
                      ? AGRI_PARAM_META.filter(m => ["conductivity", "ph", "temperature", "do_level"].includes(m.key))
                      : PARAM_META.filter(m => ["temperature", "ph", "do_level", "salinity"].includes(m.key))
                    ).map(m => (
                      <button
                        key={m.key}
                        onClick={() => setCompareParam(m.key)}
                        className={"px-2.5 py-1 rounded-full border text-xs font-medium transition-colors " +
                          (compareParam === m.key ? "bg-ocean-600 text-white border-ocean-600" : "bg-card text-muted-foreground border-border hover:bg-accent")}
                      >
                        {m.label}
                      </button>
                    ))}
                    {fullChart === "compare" && (
                      <button
                        onClick={() => setBoardMode(b => !b)}
                        aria-pressed={boardMode}
                        aria-label={t.waterQualityX.boardMode}
                        title={t.waterQualityX.boardMode}
                        className={"px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors " +
                          (boardMode ? "bg-ocean-600 text-white border-ocean-600" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}
                      >
                        {t.waterQualityX.boardMode}
                      </button>
                    )}
                    <button
                      onClick={() => setFullChart(fullChart === "compare" ? null : "compare")}
                      aria-label={fullChart === "compare" ? t.common.close : t.waterQualityX.fullscreen}
                      title={fullChart === "compare" ? t.common.close : t.waterQualityX.fullscreen}
                      className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      {fullChart === "compare" ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {compareData.length > 0 ? (
                  <div className={fullChart === "compare" ? "flex-1 min-h-0" : ""}>
                    <SensorCompareChart data={compareData} names={compareNames} fill={fullChart === "compare"} big={fullChart === "compare" && boardMode} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/70 py-8 text-center">
                    {allReadings.length === 0
                      ? t.waterQualityX.noSensorHistory
                      : taggedCount === 0
                        ? t.waterQualityX.noSensorTagAll
                        : t.waterQualityX.sensorTagMismatch}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Charts ───────────────────────────────────────────────────────── */}
          <Card className={fullChart === "main"
            ? "fixed inset-0 z-50 bg-card rounded-none border-0 flex flex-col overflow-hidden"
            : "bg-card border-border"}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-foreground text-base">
                  {timeRangeLabel(hours)} {t.waterQuality.trend}
                </CardTitle>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                    {refreshSec >= 60 ? `${refreshSec / 60}${t.waterQuality.autoRefreshMin}` : `${refreshSec}${t.waterQualityX.autoRefreshSec}`}
                    {lastRefreshed && <span className="opacity-70">· {sinceLabel(lastRefreshed)}</span>}
                  </span>
                  {fullChart === "main" && (
                    <button
                      onClick={() => setBoardMode(b => !b)}
                      aria-pressed={boardMode}
                      aria-label={t.waterQualityX.boardMode}
                      title={t.waterQualityX.boardMode}
                      className={"px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors " +
                        (boardMode ? "bg-ocean-600 text-white border-ocean-600" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}
                    >
                      {t.waterQualityX.boardMode}
                    </button>
                  )}
                  <button
                    onClick={() => setFullChart(fullChart === "main" ? null : "main")}
                    aria-label={fullChart === "main" ? t.common.close : t.waterQualityX.fullscreen}
                    title={fullChart === "main" ? t.common.close : t.waterQualityX.fullscreen}
                    className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {fullChart === "main" ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                </span>
              </div>
            </CardHeader>
            <CardContent className={fullChart === "main" ? "flex-1 min-h-0 overflow-auto" : undefined}>
              <Tabs value={chartTab} onValueChange={setChartTab}>
                {!isAgri ? (
                  <TabsList className="bg-muted border border-border mb-4 flex-wrap gap-y-1 h-auto min-h-9">
                    <TabsTrigger value="overview"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.tabOverview}</TabsTrigger>
                    <TabsTrigger value="nitrogen"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.tabNitrogen}</TabsTrigger>
                    <TabsTrigger value="temperature" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.temperature}</TabsTrigger>
                    <TabsTrigger value="ph"         className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.ph}</TabsTrigger>
                    <TabsTrigger value="do_level"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">DO</TabsTrigger>
                    <TabsTrigger value="salinity"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.salinity}</TabsTrigger>
                    <TabsTrigger value="ammonia"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.ammonia}</TabsTrigger>
                    <TabsTrigger value="nitrite"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.nitrite}</TabsTrigger>
                    <TabsTrigger value="nitrate"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.nitrate}</TabsTrigger>
                    <TabsTrigger value="alkalinity" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.alkalinity}</TabsTrigger>
                    <TabsTrigger value="turbidity"  className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.turbidity}</TabsTrigger>
                    {hasConductivity && <TabsTrigger value="conductivity" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.conductivity}</TabsTrigger>}
                  </TabsList>
                ) : (
                  /* 농업 모드 — EC 가 첫 탭(데이터 없어도 노출), 새우 지표는 "더보기"로 접는다. */
                  <TabsList className="bg-muted border border-border mb-4 flex-wrap gap-y-1 h-auto min-h-9">
                    <TabsTrigger value="conductivity"  className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">EC</TabsTrigger>
                    <TabsTrigger value="ph"            className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.ph}</TabsTrigger>
                    <TabsTrigger value="temperature"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.temperature}</TabsTrigger>
                    <TabsTrigger value="do_level"      className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">DO</TabsTrigger>
                    <TabsTrigger value="flow_rate"     className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.flowRate}</TabsTrigger>
                    <TabsTrigger value="diff_pressure" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.diffPressure}</TabsTrigger>
                    {showAllTabs && (
                      <>
                        <TabsTrigger value="overview"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.tabOverview}</TabsTrigger>
                        <TabsTrigger value="nitrogen"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQualityX.tabNitrogen}</TabsTrigger>
                        <TabsTrigger value="salinity"   className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.salinity}</TabsTrigger>
                        <TabsTrigger value="ammonia"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.ammonia}</TabsTrigger>
                        <TabsTrigger value="nitrite"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.nitrite}</TabsTrigger>
                        <TabsTrigger value="nitrate"    className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.nitrate}</TabsTrigger>
                        <TabsTrigger value="alkalinity" className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.alkalinity}</TabsTrigger>
                        <TabsTrigger value="turbidity"  className="text-xs data-[state=active]:bg-ocean-600 data-[state=active]:text-white">{t.waterQuality.turbidity}</TabsTrigger>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={toggleMoreTabs}
                      className="text-xs text-muted-foreground hover:text-foreground px-2"
                      aria-expanded={showAllTabs}
                    >
                      {showAllTabs ? t.waterQualityX.tabLess : t.waterQualityX.tabMore}
                    </button>
                  </TabsList>
                )}

                <TabsContent value="overview">
                  {chartData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                      <Waves className="w-10 h-10" aria-hidden="true" />
                      <p className="text-sm">{t.waterQualityX.noChartData}</p>
                    </div>
                  ) : (
                    <div aria-label={t.waterQualityX.overviewChartAria} role="img"
                      className={fullChart === "main" ? "h-[calc(100vh-250px)]" : undefined}>
                      <OverviewChart chartData={chartData} fill={fullChart === "main"} big={fullChart === "main" && boardMode} />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 text-center">{t.waterQualityX.overviewCaption}</p>
                </TabsContent>

                <TabsContent value="nitrogen">
                  {chartData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                      <Waves className="w-10 h-10" aria-hidden="true" />
                      <p className="text-sm">{t.waterQualityX.noChartData}</p>
                    </div>
                  ) : (
                    <div aria-label={t.waterQualityX.nitrogenChartAria} role="img"
                      className={fullChart === "main" ? "h-[calc(100vh-250px)]" : undefined}>
                      <NitrogenChart chartData={chartData} fill={fullChart === "main"} big={fullChart === "main" && boardMode} />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 text-center">{t.waterQualityX.nitrogenCaption}</p>
                </TabsContent>

                {(
                  [
                    { tabValue: "temperature", stdKey: "temperature", chartColor: "#0ea5e9", unit: "°C" },
                    { tabValue: "ph",          stdKey: "ph",          chartColor: "#a78bfa", unit: "" },
                    { tabValue: "do_level",    stdKey: "do_level",    chartColor: "#14b8a6", unit: "mg/L" },
                    { tabValue: "salinity",    stdKey: "salinity",    chartColor: "#f59e0b", unit: "‰" },
                    { tabValue: "ammonia",     stdKey: "ammonia",     chartColor: "#f97316", unit: "mg/L" },
                    { tabValue: "nitrite",     stdKey: "nitrite",     chartColor: "#ec4899", unit: "mg/L" },
                    { tabValue: "nitrate",     stdKey: "nitrate",     chartColor: "#84cc16", unit: "mg/L" },
                    { tabValue: "alkalinity",  stdKey: "alkalinity",  chartColor: "#06b6d4", unit: "mg/L" },
                    { tabValue: "turbidity",   stdKey: "turbidity",   chartColor: "#8b5cf6", unit: "NTU" },
                  ] as Array<{ tabValue: string; stdKey: typeof STD_KEYS[number]; chartColor: string; unit: string }>
                ).map(({ tabValue, stdKey, chartColor, unit }) => {
                  const chartLabel = paramLabel(t, stdKey)
                  return (
                  <TabsContent key={tabValue} value={tabValue}>
                    {chartData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                        <Waves className="w-10 h-10" aria-hidden="true" />
                        <p className="text-sm">{t.waterQualityX.noChartData}</p>
                      </div>
                    ) : (
                      <div aria-label={t.waterQualityX.trendChartAria.replace("{{label}}", chartLabel)} role="img"
                        className={fullChart === "main" ? "h-[calc(100vh-280px)]" : undefined}>
                        <SingleParamChart
                          chartData={chartData}
                          stdKey={stdKey}
                          chartLabel={chartLabel}
                          chartColor={chartColor}
                          unit={unit}
                          fill={fullChart === "main"}
                          big={fullChart === "main" && boardMode}
                          // 농업 모드 pH: 레시피가 있으면 목표선+밴드, 없어도 새우
                          // 해수 기준선(std)은 숨긴다(오탐 방지 — 수아 시안 5-3).
                          recipe={stdKey === "ph" ? phRecipe : null}
                          hideStd={isAgri && stdKey === "ph"}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-4 border-t border-dashed border-emerald-400/60" />{t.waterQuality.normalRange}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-4 border-t border-dashed border-amber-400/60" />{t.waterQualityX.warnRange}
                      </span>
                    </div>
                  </TabsContent>
                  )
                })}

                {(hasConductivity || isAgri) && (
                  <TabsContent value="conductivity">
                    {chartData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                        <Waves className="w-10 h-10" aria-hidden="true" />
                        <p className="text-sm">{t.waterQualityX.noChartData}</p>
                      </div>
                    ) : (
                      <div aria-label={t.waterQualityX.conductivity} role="img"
                        className={fullChart === "main" ? "h-[calc(100vh-280px)]" : undefined}>
                        <ConductivityChart chartData={chartData}
                          fill={fullChart === "main"} big={fullChart === "main" && boardMode}
                          recipe={ecRecipe} msCmHint={isAgri} />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      {t.waterQualityX.conductivityCaption}
                    </p>
                  </TabsContent>
                )}

                {/* 유량·차압 (농업 모드 전용 탭) */}
                {isAgri && (
                  <TabsContent value="flow_rate">
                    {chartData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                        <Waves className="w-10 h-10" aria-hidden="true" />
                        <p className="text-sm">{t.waterQualityX.noChartData}</p>
                      </div>
                    ) : (
                      <div aria-label={t.waterQualityX.flowRate} role="img"
                        className={fullChart === "main" ? "h-[calc(100vh-280px)]" : undefined}>
                        <AgriLineChart chartData={chartData} dataKey="flow_rate"
                          name={t.waterQualityX.flowRate} color="#6366f1" unit="L/min"
                          fill={fullChart === "main"} big={fullChart === "main" && boardMode} />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      {t.waterQualityX.flowCaption}
                    </p>
                  </TabsContent>
                )}
                {isAgri && (
                  <TabsContent value="diff_pressure">
                    {chartData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/60">
                        <Waves className="w-10 h-10" aria-hidden="true" />
                        <p className="text-sm">{t.waterQualityX.noChartData}</p>
                      </div>
                    ) : (
                      <div aria-label={t.waterQualityX.diffPressure} role="img"
                        className={fullChart === "main" ? "h-[calc(100vh-280px)]" : undefined}>
                        <AgriLineChart chartData={chartData} dataKey="diff_pressure"
                          name={t.waterQualityX.diffPressure} color="#f43f5e" unit="kPa"
                          fill={fullChart === "main"} big={fullChart === "main" && boardMode} />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      {t.waterQualityX.diffPressureCaption}
                    </p>
                  </TabsContent>
                )}
              </Tabs>
            </CardContent>
          </Card>

          {/* ── Alert List ───────────────────────────────────────────────────── */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {selectedTank?.name} {t.waterQualityX.alertHistory}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tankAlerts.length === 0 ? (
                <div className="flex items-center gap-3 py-6 justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  <p className="text-muted-foreground text-sm">{t.waterQualityX.noAlertsMsg}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tankAlerts.map(alert => {
                    const alertParamLabel = STD_KEYS.includes(alert.parameter as typeof STD_KEYS[number])
                      ? paramLabel(t, alert.parameter)
                      : alert.parameter
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
                            {t.waterQualityX.item}: {alertParamLabel} · {t.waterQualityX.measured} {alert.value} → {t.waterQualityX.threshold} {alert.threshold}
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
