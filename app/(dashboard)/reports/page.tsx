"use client"

import { useState, useEffect } from "react"
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell, ReferenceLine,
} from "recharts"
import { MOCK_TANKS, MOCK_WATER_QUALITY, MOCK_FARMS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getFarms, getAllTanks, getJournalEntries } from "@/lib/db"
import { exportToCsv } from "@/lib/export"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Download, TrendingUp, TrendingDown, Minus, BarChart3, Fish, Droplets, AlertTriangle, BookOpen, ChevronDown, ChevronUp, Calendar } from "lucide-react"
import type { Farm, Tank, JournalEntry } from "@/types"
import { useT } from "@/lib/i18n-context"

const WEEK_LABELS = ["5/28", "5/29", "5/30", "5/31", "6/1", "6/2", "6/3"]

// ─── 예시 보고서 시나리오 ─────────────────────────────────────────────────────
//
// 예시 보고서는 지원사업 증빙(화면 캡처 + CSV)으로 함께 제출되고, 검토자가 KPI ·
// 양식장 표 · 상태 파이 · 폐사 추이 차트 · CSV 를 서로 대조한다. 그래서 수치는
// 아래 한 곳에서만 정하고 나머지는 전부 여기서 파생시킨다. 값을 바꿀 때도 여기만
// 고치면 다섯 곳이 동시에 따라온다. 무작위 값(Math.random)은 렌더마다 숫자가
// 달라져 캡처끼리도 어긋나므로 쓰지 않는다.
//
// 시나리오: 양식장 2곳 · 수조 13개(정상 10 · 주의 1 · 위험 2) · 주간 폐사 1,480마리.
// 주의/위험 수조는 모두 1양식장에 있고, 이슈 이력의 B-1(주의) · B-2(위험) ·
// C-2(위험) 와 같은 수조다.

/** 양식장 표 — 화면 표와 CSV 가 같은 행을 쓴다. normal+warning+danger 는 tankCount 와 같아야 한다. */
const EXAMPLE_FARM_ROWS = [
  { nameKey: "exampleFarm1" as const, tankCount: 8, shrimpCount: 476500, normal: 5, warning: 1, danger: 2, mortality: 1250, risk: "medium" as const },
  { nameKey: "exampleFarm2" as const, tankCount: 5, shrimpCount: 312000, normal: 5, warning: 0, danger: 0, mortality: 230, risk: "low" as const },
]

/** 표를 세로로 합한 총계 — KPI · 상태 파이 · 폐사 추이 차트가 모두 이 값을 쓴다. */
const EXAMPLE_TOTALS = EXAMPLE_FARM_ROWS.reduce(
  (acc, row) => ({
    tanks: acc.tanks + row.tankCount,
    normal: acc.normal + row.normal,
    warning: acc.warning + row.warning,
    danger: acc.danger + row.danger,
    mortality: acc.mortality + row.mortality,
  }),
  { tanks: 0, normal: 0, warning: 0, danger: 0, mortality: 0 }
)

/** 주요 이슈 이력. 문구는 t.reportsX.issueHistoryItems 의 같은 순서 항목을 쓴다.
 *  KPI "경보 발생" 건수는 여기서 정기 점검(success)을 뺀 수다. */
const EXAMPLE_ISSUE_ROWS = [
  { date: "06/03", badge: "danger" as const },
  { date: "06/02", badge: "danger" as const },
  { date: "06/01", badge: "warning" as const },
  { date: "05/31", badge: "warning" as const },
  { date: "05/29", badge: "success" as const },
]

const EXAMPLE_ALERT_COUNT = EXAMPLE_ISSUE_ROWS.filter(row => row.badge !== "success").length

/** 표본 수조 3개의 용존산소 추이(mg/L). KPI 평균 DO 는 이 표본에서 계산한다.
 *  B-2조 06/01 의 4.2 는 이슈 이력 "DO 4.2 mg/L 저하"와 같은 사건이고,
 *  그 뒤 값이 회복하는 것은 같은 행의 조치("폭기 증가")와 맞춘 것이다. */
const EXAMPLE_DO_SERIES: Record<"A-1조" | "B-2조" | "C-2조", number[]> = {
  "A-1조": [6.6, 6.5, 6.4, 6.3, 6.1, 6.0, 5.9],
  "B-2조": [5.4, 5.1, 4.8, 4.5, 4.2, 4.4, 4.6],
  "C-2조": [6.0, 5.9, 5.8, 5.6, 5.5, 5.3, 5.1],
}

/** DO 위험 기준선(mg/L). 차트의 기준선 시리즈와 ReferenceLine 이 같은 값을 쓴다. */
const DO_BASELINE = 5.0

/** 차트가 대조 대상이 아닌 값 — 시나리오 서술을 위해 같은 자리에 둔다.
 *  탁도 9.8 은 주간 평균이고, 이슈 이력의 C-2조 32.5 NTU 는 그중 하루의 최고값이다. */
const EXAMPLE_AVG = { temperature: 28.5, turbidity: 9.8 }

/** 이전 주 값 — KPI 의 "이전 주" 표시와 폐사 추이 차트의 이전주 막대가 같은 값을 쓴다. */
const EXAMPLE_PREV = {
  temperature: 28.1,
  do: 5.9,
  mortality: 980,
  turbidity: 7.2,
  alerts: 2,
  normalTanks: 11,
}

/** 주간 총계를 가중치대로 요일에 나눈다. 마지막 날이 반올림 잔차를 흡수해
 *  일자별 합계가 총계와 항상 정확히 같다(검토자가 막대를 더해 본다). */
function splitByDay(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0)
  const parts = weights.map(w => Math.round((total * w) / weightSum))
  parts[parts.length - 1] += total - parts.reduce((sum, v) => sum + v, 0)
  return parts
}

// 주 후반으로 갈수록 가파른 곡선 — 06/02 AHPND 양성, 06/03 탁도 위험과 같은 흐름.
const MORTALITY_WEIGHTS = [13, 15, 17, 19, 23, 29, 32]
const PREV_MORTALITY_WEIGHTS = [11, 12, 13, 14, 15, 16, 17]

const exampleMortalityByDay = splitByDay(EXAMPLE_TOTALS.mortality, MORTALITY_WEIGHTS)
const examplePrevMortalityByDay = splitByDay(EXAMPLE_PREV.mortality, PREV_MORTALITY_WEIGHTS)

/** 차트에 그린 표본 값 전체의 평균 = KPI 평균 DO. */
const EXAMPLE_AVG_DO = (() => {
  const values = Object.values(EXAMPLE_DO_SERIES).flat()
  return +(values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1)
})()

const weeklyDo = WEEK_LABELS.map((day, i) => ({
  day,
  "A-1조": EXAMPLE_DO_SERIES["A-1조"][i],
  "B-2조": EXAMPLE_DO_SERIES["B-2조"][i],
  "C-2조": EXAMPLE_DO_SERIES["C-2조"][i],
  기준선: DO_BASELINE,
}))

const weeklyMortality = WEEK_LABELS.map((day, i) => ({
  day,
  폐사량: exampleMortalityByDay[i],
  이전주: examplePrevMortalityByDay[i],
}))

/** 인쇄물 표제에 쓰는 값 — 제목·기간·발행일. */
type PrintMeta = { periodLabel: string; dateRange: string; issuedAt: string }

// 화면에서는 숨기고 인쇄에서만 나오는 표제. 출력물이 어떤 기간의 보고서인지 드러낸다.
function PrintTitle({ meta }: { meta: PrintMeta }) {
  const { t } = useT()
  return (
    <div className="hidden print:block mb-4 pb-3 border-b border-border">
      <h1 className="text-lg font-bold text-foreground">{t.reports.title} · {meta.periodLabel}</h1>
      <p className="text-xs text-muted-foreground mt-1">{meta.dateRange} · {t.reports.issuedAt}: {meta.issuedAt}</p>
    </div>
  )
}

function TrendIcon({ trend, bad }: { trend: string; bad: boolean }) {
  const isGood = (trend === "up" && !bad) || (trend === "down" && bad)
  if (trend === "up") return <TrendingUp className={`w-4 h-4 ${isGood ? "text-emerald-500" : "text-red-500"}`} />
  if (trend === "down") return <TrendingDown className={`w-4 h-4 ${isGood ? "text-emerald-500" : "text-red-500"}`} />
  return <Minus className="w-4 h-4 text-muted-foreground" />
}

// ─── Example Report (mock) ────────────────────────────────────────────────────

function ExampleReport({ printMeta }: { printMeta: PrintMeta }) {
  const { t } = useT()

  // 파이 = 양식장 표의 상태 열을 세로로 합한 값(합 13개 = 총 수조 수).
  const exampleTankStatusData = [
    { name: t.reports.normalDays, value: EXAMPLE_TOTALS.normal, color: "#10b981" },
    { name: t.reports.warningDays, value: EXAMPLE_TOTALS.warning, color: "#f59e0b" },
    { name: t.reports.dangerDays, value: EXAMPLE_TOTALS.danger, color: "#ef4444" },
  ]

  // KPI 는 모두 시나리오 상수에서 파생된다. 여기에 숫자를 직접 적지 말 것.
  const exampleKpis = [
    { label: t.reports.avgTemperature, value: `${EXAMPLE_AVG.temperature}°C`, prev: `${EXAMPLE_PREV.temperature}°C`, trend: "up", bad: true },
    { label: t.reports.avgDo, value: `${EXAMPLE_AVG_DO} mg/L`, prev: `${EXAMPLE_PREV.do} mg/L`, trend: "down", bad: true },
    { label: t.reports.totalMortality, value: `${EXAMPLE_TOTALS.mortality.toLocaleString()}${t.reportsX.unitShrimp}`, prev: `${EXAMPLE_PREV.mortality.toLocaleString()}${t.reportsX.unitShrimp}`, trend: "up", bad: true },
    { label: t.reports.avgTurbidity, value: `${EXAMPLE_AVG.turbidity} NTU`, prev: `${EXAMPLE_PREV.turbidity} NTU`, trend: "up", bad: true },
    { label: t.reports.alertsCount, value: `${EXAMPLE_ALERT_COUNT}${t.reportsX.unitCases}`, prev: `${EXAMPLE_PREV.alerts}${t.reportsX.unitCases}`, trend: "up", bad: true },
    { label: t.reports.normalTanks, value: `${EXAMPLE_TOTALS.normal}${t.common.unit.pcs}`, prev: `${EXAMPLE_PREV.normalTanks}${t.common.unit.pcs}`, trend: "down", bad: true },
  ]

  return (
    <div id="print-report" className="space-y-6">
      <PrintTitle meta={printMeta} />

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {exampleKpis.map(kpi => (
          <Card key={kpi.label} className="bg-card border-border min-w-0 overflow-hidden print:break-inside-avoid">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2">{kpi.label}</p>
              <p className="text-xl font-bold text-foreground mb-1">{kpi.value}</p>
              <div className="flex items-center gap-1">
                <TrendIcon trend={kpi.trend} bad={kpi.bad} />
                <span className="text-xs text-muted-foreground">{t.reports.prevWeek} {kpi.prev}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <Card className="bg-card border-border print:break-inside-avoid">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-foreground flex items-center gap-2">
                <Droplets className="w-4 h-4 text-teal-500" />{t.reports.doWeeklyTrend}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={weeklyDo} aria-label={t.reportsX.doTrendChartAria} role="img">
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} />
                  <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} domain={[3.5, 8]} width={35} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} labelStyle={{ color: "hsl(var(--muted-foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
                  <ReferenceLine y={DO_BASELINE} stroke="#ef4444" strokeDasharray="4 4" label={{ value: t.reports.baseline, fill: "#ef4444", fontSize: 10, position: "right" }} />
                  <Line type="monotone" dataKey="A-1조" name={t.reportsX.tankA1} stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="B-2조" name={t.reportsX.tankB2} stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="C-2조" name={t.reportsX.tankC2} stroke="#a78bfa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border print:break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-500" />{t.reports.tankStatusDist}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart aria-label={t.reportsX.tankStatusChartAria} role="img">
                <Pie data={exampleTankStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {exampleTankStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              {exampleTankStatusData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-foreground/80">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="bg-card border-border print:break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <Fish className="w-4 h-4 text-amber-500" />{t.reports.mortalityComparison}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyMortality} barSize={14} aria-label={t.reportsX.mortalityCompareChartAria} role="img">
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} />
                <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
                <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
                <Bar dataKey="폐사량" name={t.reports.mortality} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="이전주" name={t.reports.prevWeek} fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card border-border print:break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />{t.reports.issueHistory}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {EXAMPLE_ISSUE_ROWS.map((item, i) => {
              const info = t.reportsX.issueHistoryItems[i]
              return (
              <div key={i} className="flex items-start gap-3 p-3 bg-muted rounded-xl border border-border">
                <div className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5">{item.date}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm text-foreground font-medium">{info.tank}</span>
                    <Badge variant={item.badge} className="text-xs h-4 px-1.5">
                      {item.badge === "danger" ? t.dashboard.danger : item.badge === "warning" ? t.dashboard.warning : t.dashboard.normal}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{info.issue}</p>
                  <p className="text-xs text-ocean-500 mt-0.5">→ {info.action}</p>
                </div>
              </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border print:break-inside-avoid">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-foreground">{t.reports.farmSummaryExample}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs border-b border-border">
                  <th className="text-left pb-3 font-medium">{t.reports.farm}</th>
                  <th className="text-center pb-3 font-medium">{t.reports.tank}</th>
                  <th className="text-center pb-3 font-medium">{t.reports.shrimpCount}</th>
                  <th className="text-center pb-3 font-medium">{t.reports.normalDays}/{t.reports.warningDays}/{t.reports.dangerDays}</th>
                  <th className="text-center pb-3 font-medium">{t.reports.weeklyMortality}</th>
                  <th className="text-right pb-3 font-medium">{t.reports.riskLevel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {EXAMPLE_FARM_ROWS.map(row => (
                  <tr key={row.nameKey} className="hover:bg-accent">
                    <td className="py-3 text-foreground font-medium">{t.reportsX[row.nameKey]}</td>
                    <td className="py-3 text-center text-foreground/80">{row.tankCount}{t.common.unit.pcs}</td>
                    <td className="py-3 text-center text-foreground/80">{row.shrimpCount.toLocaleString()}{t.reportsX.unitShrimp}</td>
                    <td className="py-3 text-center">
                      <span className="text-emerald-500">{row.normal}</span><span className="text-muted-foreground"> / </span>
                      <span className="text-amber-500">{row.warning}</span><span className="text-muted-foreground"> / </span>
                      <span className="text-red-500">{row.danger}</span>
                    </td>
                    <td className={`py-3 text-center ${row.risk === "medium" ? "text-amber-500" : "text-foreground/80"}`}>{row.mortality.toLocaleString()}{t.reportsX.unitShrimp}</td>
                    <td className="py-3 text-right">
                      <Badge variant={row.risk === "medium" ? "warning" : "success"}>{row.risk === "medium" ? t.reports.riskMedium : t.reports.riskLow}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Real Report ──────────────────────────────────────────────────────────────

function RealReport({ farms, tanks, journals, periodDays, printMeta }: { farms: Farm[]; tanks: Tank[]; journals: JournalEntry[]; periodDays: number; printMeta: PrintMeta }) {
  const { t } = useT()
  const periodStart = new Date(Date.now() - periodDays * 86400000)
  const weekJournals = journals.filter(j => new Date(j.date) >= periodStart)

  const totalMortality = weekJournals.reduce((s, j) => s + j.mortality_count, 0)
  const totalFeeding = weekJournals.reduce((s, j) => s + j.feeding_amount, 0)

  const statusCounts = {
    active: tanks.filter(t => t.status === "active").length,
    warning: tanks.filter(t => t.status === "warning").length,
    danger: tanks.filter(t => t.status === "danger").length,
  }

  const tankStatusData = [
    { name: t.reports.normalDays, value: statusCounts.active, color: "#10b981" },
    { name: t.reports.warningDays, value: statusCounts.warning, color: "#f59e0b" },
    { name: t.reports.dangerDays, value: statusCounts.danger, color: "#ef4444" },
  ].filter(d => d.value > 0)

  const chartDays = Math.min(periodDays, 30)
  const dailyMortality = Array.from({ length: chartDays }, (_, i) => {
    const d = new Date(Date.now() - (chartDays - 1 - i) * 86400000)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    const dateStr = d.toISOString().split("T")[0]
    const dayJournals = journals.filter(j => j.date === dateStr)
    return {
      day: label,
      [t.reports.mortality]: dayJournals.reduce((s, j) => s + j.mortality_count, 0),
    }
  })

  return (
    <div id="print-report" className="space-y-6">
      <PrintTitle meta={printMeta} />

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t.reports.activeFarms, value: `${farms.length}${t.common.unit.pcs}` },
          { label: t.reports.totalTanks, value: `${tanks.length}${t.common.unit.pcs}` },
          { label: t.reports.periodMortality, value: `${totalMortality.toLocaleString()}${t.reportsX.unitShrimp}` },
          { label: t.reports.periodFeeding, value: `${totalFeeding.toFixed(1)}kg` },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-card border-border min-w-0 overflow-hidden print:break-inside-avoid">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2">{kpi.label}</p>
              <p className="text-xl font-bold text-foreground">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Mortality chart */}
        <div className="xl:col-span-2">
          <Card className="bg-card border-border print:break-inside-avoid">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-foreground flex items-center gap-2">
                <Fish className="w-4 h-4 text-amber-500" />{t.reports.dailyMortality}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyMortality.some(d => (d[t.reports.mortality] as number) > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dailyMortality} barSize={20} aria-label={t.reportsX.dailyMortalityChartAria} role="img">
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.15} />
                    <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
                    <Bar dataKey={t.reports.mortality} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Fish className="w-10 h-10 opacity-30" aria-hidden="true" />
                  <p className="text-sm">{t.reports.noMortalityRecord}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tank status */}
        <Card className="bg-card border-border print:break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-500" />{t.reports.tankStatusDist}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {tankStatusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart aria-label={t.reportsX.tankStatusChartAria} role="img">
                    <Pie data={tankStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                      {tankStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  {tankStatusData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-foreground/80">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">{t.reports.noTanks}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Farm summary table */}
      <Card className="bg-card border-border print:break-inside-avoid">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-foreground">{t.reports.farmSummary}</CardTitle>
        </CardHeader>
        <CardContent>
          {farms.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">{t.reports.noFarms}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[500px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b border-border">
                    <th className="text-left pb-3 font-medium">{t.reports.farm}</th>
                    <th className="text-center pb-3 font-medium">{t.reports.tank}</th>
                    <th className="text-center pb-3 font-medium">{t.reports.shrimpCount}</th>
                    <th className="text-center pb-3 font-medium">{t.reports.normalDays}/{t.reports.warningDays}/{t.reports.dangerDays}</th>
                    <th className="text-center pb-3 font-medium">{t.reports.weeklyMortality}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {farms.map(farm => {
                    const farmTanks = tanks.filter(t => t.farm_id === farm.id)
                    const farmJournals = weekJournals.filter(j => farmTanks.some(t => t.id === j.tank_id))
                    const farmMortality = farmJournals.reduce((s, j) => s + j.mortality_count, 0)
                    const active = farmTanks.filter(t => t.status === "active").length
                    const warning = farmTanks.filter(t => t.status === "warning").length
                    const danger = farmTanks.filter(t => t.status === "danger").length
                    return (
                      <tr key={farm.id} className="hover:bg-accent">
                        <td className="py-3 text-foreground font-medium">{farm.name}</td>
                        <td className="py-3 text-center text-foreground/80">{farmTanks.length}{t.common.unit.pcs}</td>
                        <td className="py-3 text-center text-foreground/80">{farmTanks.reduce((s, t) => s + t.shrimp_count, 0).toLocaleString()}{t.reportsX.unitShrimp}</td>
                        <td className="py-3 text-center">
                          <span className="text-emerald-500">{active}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-amber-500">{warning}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-red-500">{danger}</span>
                        </td>
                        <td className="py-3 text-center text-foreground/80">{farmMortality.toLocaleString()}{t.reportsX.unitShrimp}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent journal entries */}
      {weekJournals.length > 0 && (
        <Card className="bg-card border-border print:break-inside-avoid">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-ocean-500" />{t.reports.journalSummary}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekJournals.slice(0, 10).map(j => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-muted rounded-xl text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-muted-foreground text-xs w-16 shrink-0">{j.date}</span>
                  <span className="text-foreground font-medium truncate">{j.tank_name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
                  <span>{t.reports.feeding} {j.feeding_amount}kg</span>
                  <span className={j.mortality_count > 0 ? "text-amber-500" : "text-muted-foreground"}>{t.reports.mortality} {j.mortality_count}{t.reportsX.unitShrimp}</span>
                  <span>{t.reports.waterExchange} {j.water_exchange_rate}%</span>
                </div>
              </div>
            ))}
            {weekJournals.length > 10 && (
              <a href="/journal" className="block text-center text-xs text-ocean-500 hover:text-ocean-400 transition-colors pt-1">
                {t.reports.viewAllJournals} ({weekJournals.length}{t.reportsX.unitCases}) →
              </a>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user } = useAuth()
  const { t, locale } = useT()

  const PERIOD_OPTIONS = [
    { labelKey: "period7d" as const, days: 7 },
    { labelKey: "period30d" as const, days: 30 },
    { labelKey: "period90d" as const, days: 90 },
  ]
  const [farms, setFarms] = useState<Farm[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showExample, setShowExample] = useState(false)
  const [periodDays, setPeriodDays] = useState(7)

  const isMock = isTestAccount(user?.email)

  async function loadData(days: number) {
    setLoading(true)
    if (isMock) {
      setFarms(MOCK_FARMS)
      setTanks(MOCK_TANKS)
      setLoading(false)
      return
    }
    try {
      const from = new Date(Date.now() - days * 86400000).toISOString().split("T")[0]
      const [f, t, j] = await Promise.all([getFarms(), getAllTanks(), getJournalEntries(undefined, 500, from)])
      setFarms(f)
      setTanks(t)
      setJournals(j)
    } catch { } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(7)
  }, [user])

  const handlePeriodChange = (days: number) => {
    setPeriodDays(days)
    loadData(days)
  }

  const now = new Date()
  const periodStart = new Date(now.getTime() - periodDays * 86400000)
  const dateLocale = locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"
  const fmtDate = (d: Date) => d.toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric" })
  const dateRange = `${fmtDate(periodStart)} ~ ${fmtDate(now)}`
  // 발행일 = 오늘. 인쇄물이 언제 뽑은 보고서인지 드러나야 한다.
  const issuedAt = fmtDate(now)
  const periodLabel = t.reports[(PERIOD_OPTIONS.find(opt => opt.days === periodDays) ?? PERIOD_OPTIONS[0]).labelKey]
  const printMeta: PrintMeta = { periodLabel, dateRange, issuedAt }

  function handlePdf() {
    window.print()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hasData = farms.length > 0 || tanks.length > 0
  // 화면에 예시 보고서가 떠 있으면 CSV 도 같은 예시 값을 내보낸다(증빙 캡처용).
  const showingExample = isMock || (!hasData && showExample)
  // RealReport 와 같은 기준으로 기간 내 일지를 고른다.
  const csvJournals = journals.filter(j => new Date(j.date) >= periodStart)
  const canExportCsv = showingExample || farms.length > 0 || csvJournals.length > 0

  // CSV 열 이름 — 새 문구를 만들지 않고 화면에 이미 쓰는 라벨만 조합한다.
  const CSV_COL = {
    section: t.common.type,
    date: t.common.date,
    farm: t.reports.farm,
    tank: t.reports.tank,
    tankCount: t.reports.totalTanks,
    shrimpCount: t.reports.shrimpCount,
    normal: t.reports.normalDays,
    warning: t.reports.warningDays,
    danger: t.reports.dangerDays,
    mortality: `${t.reports.mortality}(${t.reportsX.unitShrimp.trim()})`,
    feeding: `${t.reports.feeding}(kg)`,
    exchange: `${t.reports.waterExchange}(%)`,
  }

  // exportToCsv 는 첫 행의 key 를 헤더로 쓴다. 요약 행과 일지 행이 열을 공유하도록
  // 모든 행을 빈 행에서 시작해 같은 열을 빠짐없이 갖게 만든다.
  function csvBlankRow(section: string): Record<string, unknown> {
    return {
      [CSV_COL.section]: section,
      [CSV_COL.date]: "",
      [CSV_COL.farm]: "",
      [CSV_COL.tank]: "",
      [CSV_COL.tankCount]: "",
      [CSV_COL.shrimpCount]: "",
      [CSV_COL.normal]: "",
      [CSV_COL.warning]: "",
      [CSV_COL.danger]: "",
      [CSV_COL.mortality]: "",
      [CSV_COL.feeding]: "",
      [CSV_COL.exchange]: "",
    }
  }

  function buildCsvRows(): Record<string, unknown>[] {
    if (showingExample) {
      return EXAMPLE_FARM_ROWS.map(row => ({
        ...csvBlankRow(t.reports.farmSummary),
        [CSV_COL.farm]: t.reportsX[row.nameKey],
        [CSV_COL.tankCount]: row.tankCount,
        [CSV_COL.shrimpCount]: row.shrimpCount,
        [CSV_COL.normal]: row.normal,
        [CSV_COL.warning]: row.warning,
        [CSV_COL.danger]: row.danger,
        [CSV_COL.mortality]: row.mortality,
      }))
    }
    // 양식장별 운영 요약 — 화면 표와 같은 계산이다.
    const summaryRows = farms.map(farm => {
      const farmTanks = tanks.filter(tk => tk.farm_id === farm.id)
      const farmJournals = csvJournals.filter(j => farmTanks.some(tk => tk.id === j.tank_id))
      return {
        ...csvBlankRow(t.reports.farmSummary),
        [CSV_COL.farm]: farm.name,
        [CSV_COL.tankCount]: farmTanks.length,
        [CSV_COL.shrimpCount]: farmTanks.reduce((sum, tk) => sum + tk.shrimp_count, 0),
        [CSV_COL.normal]: farmTanks.filter(tk => tk.status === "active").length,
        [CSV_COL.warning]: farmTanks.filter(tk => tk.status === "warning").length,
        [CSV_COL.danger]: farmTanks.filter(tk => tk.status === "danger").length,
        [CSV_COL.mortality]: farmJournals.reduce((sum, j) => sum + j.mortality_count, 0),
        [CSV_COL.feeding]: +farmJournals.reduce((sum, j) => sum + j.feeding_amount, 0).toFixed(1),
      }
    })
    // 일지 상세 — 같은 파일 아래쪽에 붙인다.
    const journalRows = csvJournals.map(j => {
      const tank = tanks.find(tk => tk.id === j.tank_id)
      const farm = farms.find(f => f.id === tank?.farm_id)
      return {
        ...csvBlankRow(t.reports.journalSummary),
        [CSV_COL.date]: j.date,
        [CSV_COL.farm]: farm?.name ?? "",
        [CSV_COL.tank]: j.tank_name,
        [CSV_COL.mortality]: j.mortality_count,
        [CSV_COL.feeding]: j.feeding_amount,
        [CSV_COL.exchange]: j.water_exchange_rate,
      }
    })
    return [...summaryRows, ...journalRows]
  }

  function handleCsv() {
    const rows = buildCsvRows()
    if (rows.length === 0) return
    // 파일명은 로케일과 무관하게 ISO 날짜로 고정한다.
    const period = periodDays === 7 ? "weekly" : `${periodDays}d`
    exportToCsv(rows, `${period}-report_${new Date().toISOString().split("T")[0]}`)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-foreground">{t.reports.title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{dateRange} · {t.reports.issuedAt}: {issuedAt}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 bg-muted border border-border rounded-xl p-1">
            <Calendar className="w-4 h-4 text-muted-foreground mx-2 shrink-0" />
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => handlePeriodChange(opt.days)}
                aria-label={t.reportsX.selectPeriodAria.replace("{{period}}", t.reports[opt.labelKey])}
                aria-pressed={periodDays === opt.days}
                className={`text-xs px-3 min-h-[44px] rounded-lg transition-colors flex items-center gap-1 ${
                  periodDays === opt.days
                    ? "bg-ocean-500/30 text-ocean-500 font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.reports[opt.labelKey]}
              </button>
            ))}
          </div>
          {(hasData || showExample) && (
            <>
              <Button
                variant="outline"
                className="border-border text-foreground/80 hover:text-foreground hover:bg-accent min-h-[44px]"
                onClick={handlePdf}
                title={t.reports.printSaveHint}
                aria-label={t.reports.printSave}
              >
                <Download className="w-4 h-4 mr-2" aria-hidden="true" />{t.reports.printSave}
              </Button>
              <Button
                variant="outline"
                className="border-border text-foreground/80 hover:text-foreground hover:bg-accent min-h-[44px]"
                onClick={handleCsv}
                disabled={!canExportCsv}
                title={t.reports.csvExport}
                aria-label={t.reports.csvExport}
              >
                <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                <span className="hidden sm:inline">{t.reports.csvExport}</span>
                <span className="sm:hidden">CSV</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Real user with no data: show empty state + example toggle */}
      {!isMock && !hasData ? (
        <div className="space-y-4">
          <Card className="bg-muted border-border border-dashed">
            <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-background flex items-center justify-center">
                <BarChart3 className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-foreground font-semibold text-lg mb-1">{t.reports.noData}</p>
                <p className="text-muted-foreground text-sm max-w-sm">
                  {t.reports.noDataMsg}
                </p>
              </div>
              <div className="flex gap-3">
                <a href="/farms">
                  <Button className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2">
                    {t.dashboard.goToFarms}
                  </Button>
                </a>
                <Button
                  variant="outline"
                  className="border-border text-foreground/80 hover:bg-accent gap-2"
                  onClick={() => setShowExample(v => !v)}
                >
                  <BookOpen className="w-4 h-4" />
                  {t.reports.viewExample}
                  {showExample ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {showExample && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ocean-500 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> {t.reports.exampleNote}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-foreground/80 hover:bg-accent"
                  onClick={handlePdf}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />{t.reports.printSave}
                </Button>
              </div>
              <ExampleReport printMeta={printMeta} />
            </div>
          )}
        </div>
      ) : isMock ? (
        /* Test accounts: always show example report */
        <ExampleReport printMeta={printMeta} />
      ) : (
        /* Real users with data: show real report */
        <RealReport farms={farms} tanks={tanks} journals={journals} periodDays={periodDays} printMeta={printMeta} />
      )}
    </div>
  )
}
