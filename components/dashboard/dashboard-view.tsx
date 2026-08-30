"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { getFarms, getAllTanks, getAlerts, getDiagnoses, getWaterQuality, getInventoryItems, getSensorDevices } from "@/lib/db"
import { MOCK_FARMS, MOCK_TANKS, MOCK_ALERTS, MOCK_DIAGNOSES, MOCK_WATER_QUALITY, MOCK_INVENTORY_ITEMS, MOCK_SENSOR_DEVICES, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { Farm, Tank, Alert, DiagnosisResult, WaterQualityReading, InventoryItem, SensorDevice } from "@/types"
import { DeviceCurrentValues } from "@/components/sensors/device-current-values"
import { NutrientStatusCard } from "@/components/sensors/nutrient-status-card"
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
import { useAgriRoute } from "@/lib/agri-route"
import { useAutoRefresh, sinceLabel } from "@/lib/use-auto-refresh"
import { WeatherCard } from "@/components/weather/weather-card"

function StatCard({ icon, label, value, sub, color, iconBg }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string; iconBg: string }) {
  // iconBg 는 정적 Tailwind 클래스로 받는다. 예전엔 color 문자열을 치환해
  // 배경을 만들었는데, '-500' 색은 치환이 안 먹어 아이콘이 같은 색 배경에
  // 묻혀 안 보였다(그리고 런타임 생성 클래스는 JIT 가 못 잡는다).
  return (
    <Card className="bg-muted border-border min-w-0 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground mb-1 truncate">{label}</p>
            <p className={`text-2xl sm:text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
          </div>
          <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardView() {
  const { user } = useAuth()
  const router = useRouter()
  const { t, locale } = useT()
  const { isAgri, href: withAgri } = useAgriRoute()
  const [farms, setFarms]       = useState<Farm[]>([])
  const [tanks, setTanks]       = useState<Tank[]>([])
  const [alerts, setAlerts]     = useState<Alert[]>([])
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [wqData, setWqData]         = useState<WaterQualityReading[]>([])
  const [selectedTankId, setSelectedTankId] = useState<string>("")
  // 선택한 수조의 센서(기기)들 — 센서별 마지막 수신값 요약에 쓴다.
  const [tankDevices, setTankDevices] = useState<SensorDevice[]>([])
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

  // 센서가 1분마다 값을 올리므로 화면도 그 주기로 다시 불러온다.
  // 첫 로딩과 같은 일을 하되, 이미 뜬 화면을 비우지 않도록 loading 은 건드리지 않는다.
  const reload = useCallback(async () => {
    if (isTestAccount(user?.email)) return   // 데모 계정은 고정 데이터
    const [f, tk, a, d, inv] = await Promise.all([
      getFarms(), getAllTanks(), getAlerts(true), getDiagnoses(), getInventoryItems()
    ])
    setFarms(f)
    setTanks(tk)
    setAlerts(a.filter(x => !x.resolved))
    setDiagnoses(d)
    setLowStockItems(inv.filter(i => i.reorder_level > 0 && i.current_stock <= i.reorder_level))
    if (selectedTankId) {
      setWqData(await getWaterQuality(selectedTankId, 24))
      try { setTankDevices(await getSensorDevices(selectedTankId)) } catch { }
    }
  }, [user?.email, selectedTankId])

  const { lastRefreshed } = useAutoRefresh(reload, 60, !loading)

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
      setTankDevices(MOCK_SENSOR_DEVICES.filter(d => d.tank_id === selectedTankId))
      return
    }
    async function reloadWq() {
      try {
        const wq = await getWaterQuality(selectedTankId, 24)
        setWqData(wq)
      } catch { }
      try { setTankDevices(await getSensorDevices(selectedTankId)) } catch { setTankDevices([]) }
    }
    reloadWq()
  }, [selectedTankId])

  const statusCounts = {
    active:  tanks.filter(tk => tk.status === "active").length,
    warning: tanks.filter(tk => tk.status === "warning").length,
    danger:  tanks.filter(tk => tk.status === "danger").length,
  }

  const localeStr = locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"

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
      <div className="flex items-center justify-center h-64" role="status" aria-label={t.common.loading}>
        <div className="w-8 h-8 border-4 border-ocean-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Alert Banner */}
      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3" role="alert" aria-label={`${t.a11y.unresolvedAlerts} ${alerts.length}${t.a11y.unitCase}`}>
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">{alerts.length} {t.dashboard.alertsToday}</p>
            <p className="text-xs text-red-600/80 mt-0.5">
              {alerts.map(a => a.tank_name).join(", ")} — {t.dashboard.alertsNone}
            </p>
          </div>
          <Link href={withAgri("/water-quality")} className="shrink-0">
            <Button size="sm" variant="outline" aria-label={t.dashboard.viewAllAlerts} className="border-red-500/40 text-red-700 hover:bg-red-500/20 text-xs h-8 min-h-[44px]">
              {t.dashboard.viewAllAlerts}
            </Button>
          </Link>
        </div>
      )}

      {/* Low Stock Warning */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3" role="alert" aria-label={`${t.inventory.lowStockItems} ${lowStockItems.length}${t.common.unit.pcs}`}>
          <Package className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700">{t.inventory.lowStockItems} {lowStockItems.length}{t.common.unit.pcs}</p>
            <p className="text-xs text-amber-600/80 mt-0.5">
              {lowStockItems.slice(0, 3).map(i => i.name).join(", ")}
              {lowStockItems.length > 3 ? ` +${lowStockItems.length - 3}` : ""}
            </p>
          </div>
          {/* /daumlabs 아래에 재고 페이지가 없다 — 접두사를 붙일 수 없어 죽은
              링크가 되므로 농업 화면에서는 바로가기를 렌더하지 않는다(설계서 4-3). */}
          {!isAgri && (
            <Link href="/inventory" className="shrink-0">
              <Button size="sm" variant="outline" aria-label={t.a11y.goToInventory} className="border-amber-500/40 text-amber-700 hover:bg-amber-500/20 text-xs h-8 min-h-[44px]">
                {t.nav.inventory}
              </Button>
            </Link>
          )}
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
            // AI 어드바이저·재고는 /daumlabs 아래에 없다 — 위 저재고 바로가기와 같은 이유.
            ].filter(item => !isAgri || !["/ai-advisor", "/inventory"].includes(item.href)).map(item => (
              <Link key={item.href} href={withAgri(item.href)} aria-label={item.label}>
                <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-muted border border-border hover:border-ocean-500/30 hover:bg-ocean-500/5 transition-all cursor-pointer w-32 sm:w-auto min-h-[44px]">
                  <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center`} aria-hidden="true">{item.icon}</div>
                  <span className="text-xs text-foreground/80 text-center font-medium">{item.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 자동갱신 표시 — 돌고 있는지 사람이 알 수 있어야 믿고 볼 수 있다 */}
      {lastRefreshed && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          1분마다 자동갱신 · 마지막 {sinceLabel(lastRefreshed)}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={<Building2 className="w-5 h-5 text-ocean-500" />} label={t.dashboard.activeFarms} value={farms.length} sub={`${t.common.total} ${tanks.length}`} color="text-ocean-500" iconBg="bg-ocean-500/20" />
        <StatCard icon={<Layers className="w-5 h-5 text-teal-500" />} label={t.dashboard.activeTanks} value={statusCounts.active} sub={`${t.dashboard.warning} ${statusCounts.warning} / ${t.dashboard.danger} ${statusCounts.danger}`} color="text-teal-500" iconBg="bg-teal-500/20" />
        <StatCard icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} label={t.dashboard.alertsToday} value={alerts.length} sub={t.dashboard.alertsNone} color="text-amber-500" iconBg="bg-amber-500/20" />
        <StatCard icon={<FlaskConical className="w-5 h-5 text-purple-400" />} label={t.dashboard.positiveTests} value={diagnoses[0]?.test_type || "—"} sub={diagnoses[0] ? `${diagnoses[0].tank_name} · ${diagnoses[0].result}` : t.dashboard.noJournal} color="text-purple-400" iconBg="bg-purple-500/20" />
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
                    aria-label={t.reports.selectTank}
                    className="bg-muted border border-border rounded-lg px-2 py-1 text-foreground text-sm focus:outline-none focus:border-ocean-500 max-w-[180px] sm:max-w-none"
                  >
                    {tanks.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
                  </select>
                  <span className="text-muted-foreground text-xs">({t.waterQuality?.period24h ?? "24h"})</span>
                </div>
                <Link href={withAgri("/water-quality")} aria-label={t.a11y.viewAllWaterQuality} className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">
                  {t.dashboard.viewAll} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <div role="img" aria-label={t.a11y.wqChart}>
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
                <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm" role="status" aria-label={t.waterQuality.noData}>
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
                <Link href={withAgri("/farms")} aria-label={t.a11y.viewAllTanks} className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">{t.dashboard.viewAll} <ArrowRight className="w-3 h-3" aria-hidden="true" /></Link>
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

          <WeatherCard
            latitude={farms[0]?.latitude ?? null}
            longitude={farms[0]?.longitude ?? null}
            farmName={farms[0]?.name}
          />

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

      {/* 양액 상태 — "지금 뭘 해야 하나"가 원시 수치보다 먼저 온다.
          농업 모드 + payload 에 nut_* 가 있을 때만 렌더(새우 모드 diff 없음). */}
      <NutrientStatusCard devices={tankDevices} tank={tanks.find(tk => tk.id === selectedTankId) ?? null} />

      {/* 선택한 수조의 센서별 마지막 수신값 — 센서가 있을 때만 보인다 */}
      <DeviceCurrentValues devices={tankDevices} />

      {/* Diagnoses table — 비브리오 진단은 새우 전용 내용이고 /daumlabs 아래에
          진단 페이지가 없다. 농업 화면에서는 카드째 렌더하지 않는다(설계서 7-A 9). */}
      {!isAgri && (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-foreground text-base">{t.dashboard.recentJournal}</CardTitle>
            <Link href="/diagnosis" aria-label={t.a11y.viewAllDiagnoses} className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">{t.dashboard.viewAll} <ArrowRight className="w-3 h-3" aria-hidden="true" /></Link>
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
      )}
    </div>
  )
}
