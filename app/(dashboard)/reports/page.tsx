"use client"

import { useState, useEffect } from "react"
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell, ReferenceLine,
} from "recharts"
import { MOCK_TANKS, MOCK_WATER_QUALITY, MOCK_FARMS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getFarms, getAllTanks, getJournalEntries } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Download, TrendingUp, TrendingDown, Minus, BarChart3, Fish, Droplets, AlertTriangle, BookOpen, ChevronDown, ChevronUp, Calendar, Lock } from "lucide-react"
import type { Farm, Tank, JournalEntry } from "@/types"
import { PLAN_LIMITS, hasExport, type Plan } from "@/lib/plans"
import Link from "next/link"
import { useT } from "@/lib/i18n-context"

const WEEK_LABELS = ["5/28", "5/29", "5/30", "5/31", "6/1", "6/2", "6/3"]

const weeklyDo = WEEK_LABELS.map((day, i) => ({
  day,
  "A-1조": +(6.2 + Math.sin(i) * 0.3).toFixed(2),
  "B-2조": +(4.8 + Math.sin(i + 1) * 0.5).toFixed(2),
  "C-2조": +(5.5 + Math.sin(i + 2) * 0.4).toFixed(2),
  기준선: 5.0,
}))

const weeklyMortality = WEEK_LABELS.map((day, i) => ({
  day,
  폐사량: Math.round(150 + i * 30 + Math.random() * 50),
  이전주: Math.round(120 + i * 20 + Math.random() * 40),
}))


function TrendIcon({ trend, bad }: { trend: string; bad: boolean }) {
  const isGood = (trend === "up" && !bad) || (trend === "down" && bad)
  if (trend === "up") return <TrendingUp className={`w-4 h-4 ${isGood ? "text-emerald-500" : "text-red-500"}`} />
  if (trend === "down") return <TrendingDown className={`w-4 h-4 ${isGood ? "text-emerald-500" : "text-red-500"}`} />
  return <Minus className="w-4 h-4 text-muted-foreground" />
}

// ─── Example Report (mock) ────────────────────────────────────────────────────

function ExampleReport() {
  const { t } = useT()

  const exampleTankStatusData = [
    { name: t.reports.normalDays, value: 5, color: "#10b981" },
    { name: t.reports.warningDays, value: 1, color: "#f59e0b" },
    { name: t.reports.dangerDays, value: 2, color: "#ef4444" },
  ]

  const exampleKpis = [
    { label: t.reports.avgTemperature, value: "28.5°C", prev: "28.1°C", trend: "up", bad: true },
    { label: t.reports.avgDo, value: "6.2 mg/L", prev: "6.5 mg/L", trend: "down", bad: true },
    { label: t.reports.totalMortality, value: "1,250마리", prev: "980마리", trend: "up", bad: true },
    { label: t.reports.avgTurbidity, value: "9.8 NTU", prev: "7.2 NTU", trend: "up", bad: true },
    { label: t.reports.alertsCount, value: "7건", prev: "3건", trend: "up", bad: true },
    { label: t.reports.normalTanks, value: "5개", prev: "6개", trend: "down", bad: true },
  ]

  return (
    <div id="print-report" className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {exampleKpis.map(kpi => (
          <Card key={kpi.label} className="bg-card border-border">
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
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-foreground flex items-center gap-2">
                <Droplets className="w-4 h-4 text-teal-500" />{t.reports.doWeeklyTrend}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={weeklyDo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} domain={[3.5, 8]} width={35} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} labelStyle={{ color: "hsl(var(--muted-foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
                  <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: t.reports.baseline, fill: "#ef4444", fontSize: 10, position: "right" }} />
                  <Line type="monotone" dataKey="A-1조" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="B-2조" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="C-2조" stroke="#a78bfa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-500" />{t.reports.tankStatusDist}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={exampleTankStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {exampleTankStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
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
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <Fish className="w-4 h-4 text-amber-500" />{t.reports.mortalityComparison}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyMortality} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
                <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
                <Bar dataKey="폐사량" name={t.reports.mortality} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="이전주" name={t.reports.prevWeek} fill="hsl(var(--card))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />{t.reports.issueHistory}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { date: "06/03", tank: "C-2조", issue: "탁도 32.5 NTU 위험", action: "30% 환수, 여과 점검", badge: "danger" as const },
              { date: "06/02", tank: "B-2조", issue: "AHPND 양성 진단", action: "격리·투약 조치 시작", badge: "danger" as const },
              { date: "06/01", tank: "B-2조", issue: "DO 4.2 mg/L 저하", action: "폭기 증가, 급이 감소", badge: "warning" as const },
              { date: "05/31", tank: "B-1조", issue: "암모니아 0.62 mg/L", action: "바실러스균 투입", badge: "warning" as const },
              { date: "05/29", tank: "전체", issue: "정기 수질 점검", action: "이상 없음 확인", badge: "success" as const },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-muted rounded-xl border border-border">
                <div className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5">{item.date}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm text-foreground font-medium">{item.tank}</span>
                    <Badge variant={item.badge} className="text-xs h-4 px-1.5">
                      {item.badge === "danger" ? t.dashboard.danger : item.badge === "warning" ? t.dashboard.warning : t.dashboard.normal}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.issue}</p>
                  <p className="text-xs text-ocean-500 mt-0.5">→ {item.action}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-foreground">{t.reports.farmSummaryExample}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                <tr className="hover:bg-accent">
                  <td className="py-3 text-foreground font-medium">제1양식장</td>
                  <td className="py-3 text-center text-foreground/80">8개</td>
                  <td className="py-3 text-center text-foreground/80">476,500마리</td>
                  <td className="py-3 text-center">
                    <span className="text-emerald-500">5</span><span className="text-muted-foreground"> / </span>
                    <span className="text-amber-500">1</span><span className="text-muted-foreground"> / </span>
                    <span className="text-red-500">2</span>
                  </td>
                  <td className="py-3 text-center text-amber-500">1,250마리</td>
                  <td className="py-3 text-right"><Badge variant="warning">{t.reports.riskMedium}</Badge></td>
                </tr>
                <tr className="hover:bg-accent">
                  <td className="py-3 text-foreground font-medium">제2양식장</td>
                  <td className="py-3 text-center text-foreground/80">5개</td>
                  <td className="py-3 text-center text-foreground/80">312,000마리</td>
                  <td className="py-3 text-center">
                    <span className="text-emerald-500">5</span><span className="text-muted-foreground"> / </span>
                    <span className="text-amber-500">0</span><span className="text-muted-foreground"> / </span>
                    <span className="text-red-500">0</span>
                  </td>
                  <td className="py-3 text-center text-foreground/80">230마리</td>
                  <td className="py-3 text-right"><Badge variant="success">{t.reports.riskLow}</Badge></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Real Report ──────────────────────────────────────────────────────────────

function RealReport({ farms, tanks, journals, periodDays }: { farms: Farm[]; tanks: Tank[]; journals: JournalEntry[]; periodDays: number }) {
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
      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t.reports.activeFarms, value: `${farms.length}개` },
          { label: t.reports.totalTanks, value: `${tanks.length}개` },
          { label: t.reports.periodMortality, value: `${totalMortality.toLocaleString()}마리` },
          { label: t.reports.periodFeeding, value: `${totalFeeding.toFixed(1)}kg` },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-card border-border">
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
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-foreground flex items-center gap-2">
                <Fish className="w-4 h-4 text-amber-500" />{t.reports.dailyMortality}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyMortality.some(d => (d[t.reports.mortality] as number) > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dailyMortality} barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                    <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
                    <Bar dataKey={t.reports.mortality} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                  {t.reports.noMortalityRecord}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tank status */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-500" />수조 상태 분포
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {tankStatusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={tankStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                      {tankStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
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
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-foreground">{t.reports.farmSummary}</CardTitle>
        </CardHeader>
        <CardContent>
          {farms.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">{t.reports.noFarms}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                        <td className="py-3 text-center text-foreground/80">{farmTanks.length}개</td>
                        <td className="py-3 text-center text-foreground/80">{farmTanks.reduce((s, t) => s + t.shrimp_count, 0).toLocaleString()}마리</td>
                        <td className="py-3 text-center">
                          <span className="text-emerald-500">{active}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-amber-500">{warning}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-red-500">{danger}</span>
                        </td>
                        <td className="py-3 text-center text-foreground/80">{farmMortality.toLocaleString()}마리</td>
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
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-ocean-500" />{t.reports.journalSummary}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekJournals.slice(0, 10).map(j => (
              <div key={j.id} className="flex items-center justify-between p-3 bg-muted rounded-xl text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-xs w-16 shrink-0">{j.date}</span>
                  <span className="text-foreground font-medium">{j.tank_name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{t.reports.feeding} {j.feeding_amount}kg</span>
                  <span className={j.mortality_count > 0 ? "text-amber-500" : "text-muted-foreground"}>{t.reports.mortality} {j.mortality_count}마리</span>
                  <span>{t.reports.waterExchange} {j.water_exchange_rate}%</span>
                </div>
              </div>
            ))}
            {weekJournals.length > 10 && (
              <a href="/journal" className="block text-center text-xs text-ocean-500 hover:text-ocean-400 transition-colors pt-1">
                {t.reports.viewAllJournals} ({weekJournals.length}건) →
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
  const { t } = useT()

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
  const dateRange = `${periodStart.getFullYear()}년 ${periodStart.getMonth() + 1}월 ${periodStart.getDate()}일 ~ ${now.getMonth() + 1}월 ${now.getDate()}일`

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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">{t.reports.title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{dateRange}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-1">
            <Calendar className="w-4 h-4 text-muted-foreground mx-2" />
            {PERIOD_OPTIONS.map(opt => {
              const currentPlan = (user?.plan ?? "free") as Plan
              const allowedPeriods = PLAN_LIMITS[currentPlan].reportPeriods as number[]
              const locked = !allowedPeriods.includes(opt.days)
              return (
                <button
                  key={opt.days}
                  onClick={() => locked ? null : handlePeriodChange(opt.days)}
                  title={locked ? t.reports.periodLocked : undefined}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
                    locked
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : periodDays === opt.days
                      ? "bg-ocean-500/30 text-ocean-500 font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {locked && <Lock className="w-3 h-3" />}
                  {t.reports[opt.labelKey]}
                </button>
              )
            })}
          </div>
          {(hasData || showExample) && (
            hasExport((user?.plan ?? "free") as Plan) ? (
              <Button
                variant="outline"
                className="border-border text-foreground/80 hover:text-foreground hover:bg-accent"
                onClick={handlePdf}
                title={t.reports.printSaveHint}
              >
                <Download className="w-4 h-4 mr-2" />{t.reports.printSave}
              </Button>
            ) : (
              <Link href="/pricing">
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  title={t.reports.csvProOnly}
                >
                  <Lock className="w-4 h-4 mr-2" />{t.reports.printSave}
                </Button>
              </Link>
            )
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
              <ExampleReport />
            </div>
          )}
        </div>
      ) : isMock ? (
        /* Test accounts: always show example report */
        <ExampleReport />
      ) : (
        /* Real users with data: show real report */
        <RealReport farms={farms} tanks={tanks} journals={journals} periodDays={periodDays} />
      )}
    </div>
  )
}
