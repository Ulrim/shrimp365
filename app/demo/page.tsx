"use client"

import { useState } from "react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import {
  MOCK_FARMS, MOCK_TANKS, MOCK_ALERTS, MOCK_DIAGNOSES,
  MOCK_WATER_QUALITY, MOCK_INVENTORY_ITEMS,
} from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Building2, Layers, AlertTriangle, ThermometerSun,
  Droplets, Wind, FlaskConical, ArrowRight,
  CheckCircle2, AlertCircle, XCircle, Activity,
  BookOpen, Bot, Package, Fish, X, LogIn,
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"

// ── Static mock helpers ──────────────────────────────────────────────────────

const farms    = MOCK_FARMS
const tanks    = MOCK_TANKS
const alerts   = MOCK_ALERTS.filter(a => !a.resolved)
const diagnoses = MOCK_DIAGNOSES
const lowStock  = MOCK_INVENTORY_ITEMS.filter(i => i.reorder_level > 0 && i.current_stock <= i.reorder_level)

const TANK_STATUS_META = {
  active:   { label: "정상",  color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  warning:  { label: "주의",  color: "text-amber-500",   bg: "bg-amber-500/10 border-amber-500/20",     dot: "bg-amber-400" },
  danger:   { label: "위험",  color: "text-red-500",     bg: "bg-red-500/10 border-red-500/20",         dot: "bg-red-400" },
  inactive: { label: "비가동", color: "text-muted-foreground", bg: "bg-muted/50 border-border",          dot: "bg-muted-foreground/40" },
} as const

const ALERT_ICONS = {
  danger:  <XCircle className="w-4 h-4 text-red-500" />,
  warning: <AlertCircle className="w-4 h-4 text-amber-500" />,
  info:    <CheckCircle2 className="w-4 h-4 text-ocean-500" />,
}

function buildChartData(tankId: string) {
  const wq = MOCK_WATER_QUALITY[tankId] ?? []
  return wq
    .filter((_, i) => i % 4 === 0)
    .slice(-24)
    .map(r => ({
      time: new Date(r.recorded_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      "수온(°C)": +r.temperature.toFixed(1),
      DO: +r.do_level.toFixed(1),
      pH: +r.ph.toFixed(2),
    }))
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card className="bg-muted border-border">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl sm:text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${color.replace("text-", "bg-").replace("400", "500/20")}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [selectedTankId, setSelectedTankId] = useState("tank-1")
  const [bannerVisible, setBannerVisible]   = useState(true)

  const statusCounts = {
    active:  tanks.filter(t => t.status === "active").length,
    warning: tanks.filter(t => t.status === "warning").length,
    danger:  tanks.filter(t => t.status === "danger").length,
  }

  const chartData  = buildChartData(selectedTankId)
  const latestWq   = (MOCK_WATER_QUALITY[selectedTankId] ?? []).at(-1)

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Demo Banner ──────────────────────────────────────────────────── */}
      {bannerVisible && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-ocean-600 to-teal-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2 text-sm">
            <Fish className="w-4 h-4 shrink-0" />
            <span className="font-medium">데모 모드 — 실제 데이터가 아닙니다</span>
            <span className="hidden sm:inline text-white/80">| 실제 양식장에서 사용하려면</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/signup"
              className="flex items-center gap-1.5 bg-white text-ocean-700 px-3 py-1 rounded-lg text-xs font-semibold hover:bg-ocean-50 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" /> 무료 시작
            </Link>
            <button onClick={() => setBannerVisible(false)} className="text-white/70 hover:text-white transition-colors" aria-label="배너 닫기">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Top Nav ──────────────────────────────────────────────────────── */}
      <header className={`sticky ${bannerVisible ? "top-10" : "top-0"} z-40 bg-background/90 backdrop-blur border-b border-border`}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-ocean-500 to-teal-500 flex items-center justify-center">
              <Fish className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-foreground">Shrimp365</span>
            <span className="ml-1 text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-medium">DEMO</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login"  className="text-sm text-muted-foreground hover:text-foreground transition-colors">로그인</Link>
            <Link href="/signup" className="text-sm bg-ocean-600 text-white px-4 py-1.5 rounded-lg font-medium hover:opacity-90 transition-opacity">
              무료 시작
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className={`max-w-7xl mx-auto px-4 py-6 space-y-6 ${bannerVisible ? "pt-[4.5rem]" : "pt-6"}`}>

        {/* Alert Banner */}
        {alerts.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3" role="alert">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-700">{alerts.length}건의 미해결 알림</p>
              <p className="text-xs text-red-600/80 mt-0.5">
                {alerts.map(a => a.tank_name).join(", ")} — 즉시 조치 권장
              </p>
            </div>
          </div>
        )}

        {/* Low Stock Warning */}
        {lowStock.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3" role="alert">
            <Package className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700">재고 부족 {lowStock.length}개</p>
              <p className="text-xs text-amber-600/80 mt-0.5">
                {lowStock.slice(0, 3).map(i => i.name).join(", ")}
              </p>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <p className="text-xs text-muted-foreground mb-3 font-medium">빠른 메뉴</p>
          <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-4">
            {[
              { icon: <Droplets className="w-5 h-5 text-ocean-500" />,  bg: "bg-ocean-500/20",  label: "수질 기록" },
              { icon: <BookOpen  className="w-5 h-5 text-teal-500"  />, bg: "bg-teal-500/20",   label: "양식 일지" },
              { icon: <Bot       className="w-5 h-5 text-purple-400"/>, bg: "bg-purple-500/20", label: "AI 어드바이저" },
              { icon: <Package   className="w-5 h-5 text-amber-500" />, bg: "bg-amber-500/20",  label: "재고 관리" },
            ].map(item => (
              <Link key={item.label} href="/signup" aria-label={item.label + " — 가입 후 이용 가능"}>
                <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-muted border border-border hover:border-ocean-500/30 hover:bg-ocean-500/5 transition-all cursor-pointer w-32 sm:w-auto min-h-[44px]">
                  <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center`}>{item.icon}</div>
                  <span className="text-xs text-foreground/80 text-center font-medium">{item.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard icon={<Building2 className="w-5 h-5 text-ocean-500" />} label="양식장" value={farms.length} sub={`전체 수조 ${tanks.length}개`} color="text-ocean-500" />
          <StatCard icon={<Layers className="w-5 h-5 text-teal-500" />} label="가동 수조" value={statusCounts.active} sub={`주의 ${statusCounts.warning} / 위험 ${statusCounts.danger}`} color="text-teal-500" />
          <StatCard icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} label="미해결 알림" value={alerts.length} color="text-amber-500" />
          <StatCard icon={<FlaskConical className="w-5 h-5 text-purple-400" />} label="최근 진단" value={diagnoses[0]?.test_type || "—"} sub={diagnoses[0] ? `${diagnoses[0].tank_name} · ${diagnoses[0].result}` : "없음"} color="text-purple-400" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Main Chart */}
          <div className="xl:col-span-2">
            <Card className="bg-card border-border h-full">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedTankId}
                      onChange={e => setSelectedTankId(e.target.value)}
                      className="bg-muted border border-border rounded-lg px-2 py-1 text-foreground text-sm focus:outline-none focus:border-ocean-500"
                    >
                      {tanks.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
                    </select>
                    <span className="text-muted-foreground text-xs">(24시간)</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} interval={5} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={35} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px" }} />
                      <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
                      <Line type="monotone" dataKey="수온(°C)" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="DO"        stroke="#14b8a6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="pH"        stroke="#a78bfa" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                    데이터 없음
                  </div>
                )}

                {latestWq && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                    {[
                      { label: "수온", value: latestWq.temperature.toFixed(1), unit: "°C",   icon: <ThermometerSun className="w-4 h-4" />, ok: latestWq.temperature >= 25 && latestWq.temperature <= 32 },
                      { label: "DO",   value: latestWq.do_level.toFixed(1),    unit: "mg/L", icon: <Wind className="w-4 h-4" />,           ok: latestWq.do_level >= 5 },
                      { label: "pH",   value: latestWq.ph.toFixed(2),          unit: "",     icon: <Droplets className="w-4 h-4" />,         ok: latestWq.ph >= 7.5 && latestWq.ph <= 8.5 },
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
                  <CardTitle className="text-foreground text-base">수조 현황</CardTitle>
                  <Link href="/signup" className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">
                    전체보기 <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {tanks.slice(0, 6).map(tank => {
                  const meta = TANK_STATUS_META[tank.status] ?? TANK_STATUS_META.inactive
                  return (
                    <div key={tank.id} className={`flex items-center justify-between p-3 rounded-xl border ${meta.bg}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${meta.dot} ${tank.status !== "active" ? "animate-pulse" : ""}`} />
                        <div>
                          <p className="text-sm font-medium text-foreground">{tank.name}</p>
                          <p className="text-xs text-muted-foreground">DOC {tank.cycle_day}일</p>
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
                  <Activity className="w-4 h-4 text-amber-500" /> 최근 알림
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">알림 없음</p>
                ) : alerts.slice(0, 3).map(alert => (
                  <div key={alert.id} className={`flex items-start gap-2.5 p-3 rounded-xl border ${
                    alert.type === "danger" ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"
                  }`}>
                    {ALERT_ICONS[alert.type as keyof typeof ALERT_ICONS]}
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
              <CardTitle className="text-foreground text-base">최근 질병 진단</CardTitle>
              <Link href="/signup" className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center gap-1">전체보기 <ArrowRight className="w-3 h-3" /></Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b border-border">
                    <th className="text-left pb-2 font-medium">수조</th>
                    <th className="text-left pb-2 font-medium">검사 종류</th>
                    <th className="text-left pb-2 font-medium">결과</th>
                    <th className="text-right pb-2 font-medium">비브리오 수</th>
                    <th className="text-right pb-2 font-medium">위험도</th>
                    <th className="text-right pb-2 font-medium">검사일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {diagnoses.slice(0, 5).map(d => (
                    <tr key={d.id} className="hover:bg-accent">
                      <td className="py-3 text-foreground font-medium">{d.tank_name}</td>
                      <td className="py-3 text-foreground/80">{d.test_type}</td>
                      <td className="py-3">
                        <Badge variant={d.result === "양성" ? "danger" : d.result === "의심" ? "warning" : "success"}>{d.result}</Badge>
                      </td>
                      <td className="py-3 text-right text-foreground/80">{d.vibrio_count.toLocaleString()} CFU/mL</td>
                      <td className="py-3 text-right">
                        <Badge variant={d.risk_level === "high" || d.risk_level === "critical" ? "danger" : d.risk_level === "medium" ? "warning" : "success"}>
                          {d.risk_level === "low" ? "정상" : d.risk_level === "medium" ? "주의" : d.risk_level === "high" ? "위험" : "긴급"}
                        </Badge>
                      </td>
                      <td className="py-3 text-right text-muted-foreground text-xs">{formatDateTime(d.tested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* CTA footer */}
        <div className="rounded-2xl bg-gradient-to-r from-ocean-500 to-teal-500 p-8 text-center text-white space-y-4">
          <h2 className="text-2xl font-bold">지금 무료로 시작하세요</h2>
          <p className="text-white/80 text-sm">가입 즉시 모든 기능을 무료로 이용할 수 있습니다.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-white text-ocean-700 px-8 py-3 rounded-xl font-semibold hover:bg-ocean-50 transition-colors"
            >
              무료 계정 만들기 <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 border border-white/40 text-white px-8 py-3 rounded-xl font-medium hover:bg-white/10 transition-colors"
            >
              서비스 소개 보기
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
