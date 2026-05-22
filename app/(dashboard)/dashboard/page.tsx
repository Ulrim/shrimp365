"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { getFarms, getAllTanks, getAlerts, getDiagnoses, getWaterQuality, getInventoryItems } from "@/lib/db"
import { MOCK_FARMS, MOCK_TANKS, MOCK_ALERTS, MOCK_DIAGNOSES, MOCK_WATER_QUALITY, MOCK_INVENTORY_ITEMS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { Farm, Tank, Alert, DiagnosisResult, WaterQualityReading, InventoryItem } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Building2, Layers, AlertTriangle, ThermometerSun,
  Droplets, Wind, FlaskConical, ArrowRight,
  CheckCircle2, AlertCircle, XCircle, Activity,
  BookOpen, Bot, Package
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { useT } from "@/lib/i18n-context"

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card className="bg-muted border-border min-w-0 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground mb-1 truncate">{label}</p>
            <p className={`text-2xl sm:text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
          </div>
          <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${color.replace("text-", "bg-").replace("400", "500/20")}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { t, locale } = useT()
  const [farms, setFarms]       = useState<Farm[]>([])
  const [tanks, setTanks]       = useState<Tank[]>([])
  const [alerts, setAlerts]     = useState<Alert[]>([])
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [wqData, setWqData]         = useState<WaterQualityReading[]>([])
  const [selectedTankId, setSelectedTankId] = useState<string>("")
  const [lowStockItems, setLowStockItems]   = useState<InventoryItem[]>([])
  const [loading, setLoading]       = useState(true)

  const TANK_STATUS_META = {
    active:   { label: t.dashboard.normal,  color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
    warning:  { label: t.dashboard.warning, color: "text-amber-500",   bg: "bg-amber-500/10 border-amber-500/20",   dot: "bg-amber-400" },
    danger:   { label: t.dashboard.danger,  color: "text-red-500",     bg: "bg-red-500/10 border-red-500/20",       dot: "bg-red-400" },
    inactive: { label: t.dashboard.normal,  color: "text-muted-foreground",   bg: "bg-muted/50 border-border",             dot: "bg-muted-foreground/40" },
  }

  const ALERT_ICONS = {
    danger:  <XCircle className="w-4 h-4 text-red-500" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-500" />,
    info:    <CheckCircle2 className="w-4 h-4 text-ocean-500" />,
  }

  useEffect(() => {
    async function load() {
      const mock = isTestAccount(user?.email)
      if (mock) {
        setFarms(MOCK_FARMS)
        setTanks(MOCK_TANKS)
        setAlerts(MOCK_ALERTS.filter(x => !x.resolved))
        setDiagnoses(MOCK_DIAGNOSES)
        setLowStockItems(MOCK_INVENTORY_ITEMS.filter(i => i.reorder_level > 0 && i.current_stock <= i.reorder_level))
        setSelectedTankId("tank-1")
        setWqData(MOCK_WATER_QUALITY["tank-1"] || [])
        setLoading(false)
        return
      }
      try {
        const [f, tk, a, d, inv] = await Promise.all([
          getFarms(), getAllTanks(), getAlerts(true), getDiagnoses(), getInventoryItems()
        ])
        setFarms(f)
        setTanks(tk)
        setAlerts(a.filter(x => !x.resolved))
        setDiagnoses(d)
        setLowStockItems(inv.filter(i => i.reorder_level > 0 && i.current_stock <= i.reorder_level))

        const firstTank = tk[0] ?? null
        if (firstTank) {
          setSelectedTankId(firstTank.id)
          const wq = await getWaterQuality(firstTank.id, 24)
          setWqData(wq)
        }

        if (!f.length) router.replace("/onboarding")
      } catch { } finally {
        setLoading(false)
      }
    }
    load()
  }, [user, router])

  useEffect(() => {
    if (!selectedTankId || loading) return
    const mock = isTestAccount(user?.email)
    if (mock) {
      setWqData(MOCK_WATER_QUALITY[selectedTankId] || [])
      return
    }
    async function reloadWq() {
      try {
        const wq = await getWaterQuality(selectedTankId, 24)
        setWqData(wq)
      } catch { }
    }
    reloadWq()
  }, [selectedTankId])

  const statusCounts = {
    active:  tanks.filter(tk => tk.status === "active").length,
    warning: tanks.filter(tk => tk.status === "warning").length,
    danger:  tanks.filter(tk => tk.status === "danger").length,
  }

  const localeStr = locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : "en-US"

  const chartData = wqData
    .filter((_, i) => i % 4 === 0)
    .slice(-24)
    .map(r => ({
      time: new Date(r.recorded_at).toLocaleTimeString(localeStr, { hour: "2-digit", minute: "2-digit" }),
      [t.waterQuality.temperature]: +r.temperature.toFixed(1),
      DO:   +r.do_level.toFixed(1),
      pH:   +r.ph.toFixed(2),
    }))

  const latestWq = wqData[wqData.length - 1]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label="데이터 불러오는 중">
        <div className="w-8 h-8 border-4 border-ocean-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Alert Banner */}
      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3" role="alert" aria-label={`미해결 알림 ${alerts.length}건`}>
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">{alerts.length} {t.dashboard.alertsToday}</p>
            <p className="text-xs text-red-600/80 mt-0.5">
              {alerts.map(a => a.tank_name).join(", ")} — {t.dashboard.alertsNone}
            </p>
          </div>
          <Link href="/water-quality" className="shrink-0">
            <Button size="sm" variant="outline" aria-label="알림 전체 보기" className="border-red-500/40 text-red-700 hover:bg-red-500/20 text-xs h-8 min-h-[44px]">
              {t.dashboard.viewAllAlerts}
            </Button>
          </Link>
        </div>
      )}

      {/* Low Stock Warning */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3" role="alert" aria-label={`재고 부족 ${lowStockItems.length}개`}>
          <Package className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700">{t.inventory.lowStockItems} {lowStockItems.length}{locale === "ko" ? "개" : ""}</p>
            <p className="text-xs text-amber-600/80 mt-0.5">
              {lowStockItems.slice(0, 3).map(i => i.name).join(", ")}
              {lowStockItems.length > 3 ? ` +${lowStockItems.length - 3}` : ""}
            </p>
          </div>
          <Link href="/inventory" className="shrink-0">
            <Button size="sm" variant="outline" aria-label="재고 관리 페이지로 이동" className="border-amber-500/40 text-amber-700 hover:bg-amber-500/20 text-xs h-8 min-h-[44px]">
              {t.nav.inventory}
            </Button>
          </Link>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <p className="text-xs text-muted-foreground mb-3 font-medium">{t.dashboard.quickActions}</p>
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="flex gap-3 pb-1 min-w-max sm:min-w-0 sm:grid sm:grid-cols-4">
            {[
              { href: "/water-quality", icon: <Droplets className="w-5 h-5 text-ocean-500" />, bg: "bg-ocean-500/20", label: t.dashboard.addWaterQuality },
              { href: "/journal",       icon: <BookOpen  className="w-5 h-5 text-teal-500"  />, bg: "bg-teal-500/20",  label: t.nav.journal },
              { href: "/ai-advisor",    icon: <Bot       className="w-5 h-5 text-purple-400"/>, bg: "bg-purple-500/20",label: t.nav.aiAdvisor },
              { href: "/inventory",     icon: <Package   className="w-5 h-5 text-amber-500" />, bg: "bg-amber-500/20", label: t.nav.inventory },
            ].map(item => (
              <Link key={item.href} href={item.href} aria-label={item.label}>
                <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-muted border border-border hover:border-ocean-500/30 hover:bg-ocean-500/5 transition-all cursor-pointer w-32 sm:w-auto min-h-[44px]">
                  <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center`} aria-hidden="true">{item.icon}</div>
                  <span className="text-xs text-foreground/80 text-center font-medium">{item.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={<Building2 className="w-5 h-5 text-ocean-500" />} label={t.dashboard.activeFarms} value={farms.length} sub={`${t.common.total} ${tanks.length}`} color="text-ocean-500" />
        <StatCard icon={<Layers className="w-5 h-5 text-teal-500" />} label={t.dashboard.activeTanks} value={statusCounts.active} sub={`${t.dashboard.warning} ${statusCounts.warning} / ${t.dashboard.danger} ${statusCounts.danger}`} color="text-teal-500" />
        <StatCard icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} label={t.dashboard.alertsToday} value={alerts.length} sub={t.dashboard.alertsNone} color="text-amber-500" />
        <StatCard icon={<FlaskConical className="w-5 h-5 text-purple-400" />} label={t.dashboard.positiveTests} value={diagnoses[0]?.test_type || "—"} sub={diagnoses[0] ? `${diagnoses[0].tank_name} · ${diagnoses[0].result}` : t.dashboard.noJournal} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="xl:col-span-2">
          <Card className="bg-card border-border h-full">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={selectedTankId}
                    onChange={e => setSelectedTankId(e.target.value)}
                    className="bg-muted border border-border rounded-lg px-2 py-1 text-foreground text-sm focus:outline-none focus:border-ocean-500 max-w-[180px] sm:max-w-none"
                  >
                    {tanks.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
                  </select>
                  <span className="text-muted-foreground text-xs">({t.waterQuality?.period24h ?? "24h"})</span>
                </div>
                <Link href="/water-quality" aria-label="수질 기록 전체 보기" className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">
                  {t.dashboard.viewAll} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <div role="img" aria-label="수질 데이터 추이 차트 (온도, DO, pH)">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} interval={5} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={35} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} labelStyle={{ color: "hsl(var(--muted-foreground))" }} />
                    <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
                    <Line type="monotone" dataKey={t.waterQuality.temperature} stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="DO"   stroke="#14b8a6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="pH"   stroke="#a78bfa" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm" role="status" aria-label="수질 데이터 없음">
                  <Droplets className="w-8 h-8 text-muted-foreground/30" aria-hidden="true" />
                  {t.dashboard.noFarmsMsg}
                </div>
              )}

              {latestWq && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: t.waterQuality.temperature, value: latestWq.temperature.toFixed(1), unit: "°C", icon: <ThermometerSun className="w-4 h-4" />, ok: latestWq.temperature >= 25 && latestWq.temperature <= 32 },
                    { label: t.waterQuality.do_,         value: latestWq.do_level.toFixed(1),    unit: "mg/L", icon: <Wind className="w-4 h-4" />,           ok: latestWq.do_level >= 5 },
                    { label: t.waterQuality.ph,          value: latestWq.ph.toFixed(2),          unit: "",     icon: <Droplets className="w-4 h-4" />,         ok: latestWq.ph >= 7.5 && latestWq.ph <= 8.5 },
                  ].map(item => (
                    <div key={item.label} className={`flex items-center gap-2 p-3 rounded-xl border ${item.ok ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                      <span className={item.ok ? "text-emerald-500" : "text-red-500"}>{item.icon}</span>
                      <div>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`text-sm font-bold ${item.ok ? "text-emerald-500" : "text-red-500"}`}>{item.value}{item.unit}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-foreground text-base">{t.dashboard.activeTanks}</CardTitle>
                <Link href="/farms" aria-label="수조 전체 보기" className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">{t.dashboard.viewAll} <ArrowRight className="w-3 h-3" aria-hidden="true" /></Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {tanks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">{t.dashboard.noFarmsTitle}</p>
              ) : tanks.slice(0, 6).map(tank => {
                const meta = TANK_STATUS_META[tank.status] || TANK_STATUS_META.inactive
                return (
                  <div key={tank.id} className={`flex items-center justify-between p-3 rounded-xl border ${meta.bg}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${meta.dot} ${tank.status !== "active" ? "animate-pulse" : ""}`} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{tank.name}</p>
                        <p className="text-xs text-muted-foreground">{tank.cycle_day}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-500" /> {t.dashboard.recentAlerts}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">{t.dashboard.noAlerts}</p>
              ) : alerts.slice(0, 3).map(alert => (
                <div key={alert.id} className={`flex items-start gap-2.5 p-3 rounded-xl border ${
                  alert.type === "danger" ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"
                }`}>
                  {ALERT_ICONS[alert.type]}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium truncate">{alert.tank_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(alert.created_at)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Diagnoses table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-foreground text-base">{t.dashboard.recentJournal}</CardTitle>
            <Link href="/diagnosis" aria-label="진단 기록 전체 보기" className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">{t.dashboard.viewAll} <ArrowRight className="w-3 h-3" aria-hidden="true" /></Link>
          </div>
        </CardHeader>
        <CardContent>
          {diagnoses.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t.dashboard.noJournal}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b border-border">
                    <th className="text-left pb-2 font-medium">{t.diagnosis.tank}</th>
                    <th className="text-left pb-2 font-medium">{t.diagnosis.testType}</th>
                    <th className="text-left pb-2 font-medium">{t.diagnosis.result}</th>
                    <th className="text-right pb-2 font-medium">{t.diagnosis.resultPositive}</th>
                    <th className="text-right pb-2 font-medium">{t.common.status}</th>
                    <th className="text-right pb-2 font-medium">{t.diagnosis.testedAt}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {diagnoses.slice(0, 5).map(d => (
                    <tr key={d.id} className="hover:bg-accent">
                      <td className="py-3 text-foreground font-medium">{d.tank_name}</td>
                      <td className="py-3 text-foreground/80">{d.test_type}</td>
                      <td className="py-3"><Badge variant={d.result === t.diagnosis.resultPositive ? "danger" : d.result === t.diagnosis.resultSuspected ? "warning" : "success"}>{d.result}</Badge></td>
                      <td className="py-3 text-right text-foreground/80">{d.vibrio_count.toLocaleString()} CFU/mL</td>
                      <td className="py-3 text-right">
                        <Badge variant={d.risk_level === "high" || d.risk_level === "critical" ? "danger" : d.risk_level === "medium" ? "warning" : "success"}>
                          {d.risk_level === "low" ? t.reports.normalDays : d.risk_level === "medium" ? t.reports.warningDays : d.risk_level === "high" ? t.reports.dangerDays : t.diagnosis.urgentAction}
                        </Badge>
                      </td>
                      <td className="py-3 text-right text-muted-foreground text-xs">{formatDateTime(d.tested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
