"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { getFarms, getAllTanks, getAlerts, getDiagnoses, getWaterQuality } from "@/lib/db"
import { MOCK_FARMS, MOCK_TANKS, MOCK_ALERTS, MOCK_DIAGNOSES, MOCK_WATER_QUALITY, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { Farm, Tank, Alert, DiagnosisResult, WaterQualityReading } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Building2, Layers, AlertTriangle, ThermometerSun,
  Droplets, Wind, FlaskConical, ArrowRight,
  CheckCircle2, AlertCircle, XCircle, Activity
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"

const TANK_STATUS_META = {
  active:   { label: "정상", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  warning:  { label: "주의", color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   dot: "bg-amber-400" },
  danger:   { label: "위험", color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",       dot: "bg-red-400" },
  inactive: { label: "비가동", color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20",   dot: "bg-slate-400" },
}

const ALERT_ICONS = {
  danger:  <XCircle className="w-4 h-4 text-red-400" />,
  warning: <AlertCircle className="w-4 h-4 text-amber-400" />,
  info:    <CheckCircle2 className="w-4 h-4 text-ocean-400" />,
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card className="bg-slate-800/50 border-white/5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-400 mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          </div>
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color.replace("text-", "bg-").replace("400", "500/20")}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [farms, setFarms]       = useState<Farm[]>([])
  const [tanks, setTanks]       = useState<Tank[]>([])
  const [alerts, setAlerts]     = useState<Alert[]>([])
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [wqData, setWqData]     = useState<WaterQualityReading[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const mock = isTestAccount(user?.email)
      try {
        const [f, t, a, d] = await Promise.all([
          getFarms(), getAllTanks(), getAlerts(true), getDiagnoses()
        ])
        setFarms(f.length ? f : (mock ? MOCK_FARMS : []))
        setTanks(t.length ? t : (mock ? MOCK_TANKS : []))
        setAlerts(a.length ? a : (mock ? MOCK_ALERTS.filter(x => !x.resolved) : []))
        setDiagnoses(d.length ? d : (mock ? MOCK_DIAGNOSES : []))

        const firstTank = t.length ? t[0] : (mock ? MOCK_TANKS[0] : null)
        if (firstTank) {
          const wq = await getWaterQuality(firstTank.id, 24)
          setWqData(wq.length ? wq : (mock ? (MOCK_WATER_QUALITY[firstTank.id] || []) : []))
        }
      } catch {
        if (mock) {
          setFarms(MOCK_FARMS)
          setTanks(MOCK_TANKS)
          setAlerts(MOCK_ALERTS.filter(x => !x.resolved))
          setDiagnoses(MOCK_DIAGNOSES)
          setWqData(MOCK_WATER_QUALITY["tank-1"] || [])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  const statusCounts = {
    active:  tanks.filter(t => t.status === "active").length,
    warning: tanks.filter(t => t.status === "warning").length,
    danger:  tanks.filter(t => t.status === "danger").length,
  }

  const chartData = wqData
    .filter((_, i) => i % 4 === 0)
    .slice(-24)
    .map(r => ({
      time: new Date(r.recorded_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      수온: +r.temperature.toFixed(1),
      DO:   +r.do_level.toFixed(1),
      pH:   +r.ph.toFixed(2),
    }))

  const latestWq = wqData[wqData.length - 1]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (farms.length === 0 && !isTestAccount(user?.email)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-ocean-500/20 flex items-center justify-center">
          <Building2 className="w-8 h-8 text-ocean-400" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">양식장을 등록해주세요</h2>
          <p className="text-slate-400 text-sm max-w-sm">
            양식장과 수조를 등록하면 수질 모니터링, 일지 관리, 질병 진단 등 모든 기능을 사용할 수 있습니다.
          </p>
        </div>
        <Link href="/farms">
          <Button className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2">
            <Building2 className="w-4 h-4" /> 양식장 등록하기
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Alert Banner */}
      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-300">{alerts.length}건의 미처리 알림</p>
            <p className="text-xs text-red-400/70 mt-0.5">
              {alerts.map(a => a.tank_name).join(", ")} — 즉시 확인이 필요합니다
            </p>
          </div>
          <Link href="/water-quality">
            <Button size="sm" variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/20 text-xs h-8">
              확인하기
            </Button>
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Building2 className="w-5 h-5 text-ocean-400" />} label="운영 양식장" value={farms.length} sub={`총 ${tanks.length}개 수조`} color="text-ocean-400" />
        <StatCard icon={<Layers className="w-5 h-5 text-teal-400" />} label="가동 수조" value={statusCounts.active} sub={`주의 ${statusCounts.warning} / 위험 ${statusCounts.danger}`} color="text-teal-400" />
        <StatCard icon={<AlertTriangle className="w-5 h-5 text-amber-400" />} label="활성 알림" value={alerts.length} sub="즉시 대응 필요" color="text-amber-400" />
        <StatCard icon={<FlaskConical className="w-5 h-5 text-purple-400" />} label="최근 진단" value={diagnoses[0]?.test_type || "—"} sub={diagnoses[0] ? `${diagnoses[0].tank_name} · ${diagnoses[0].result}` : "진단 없음"} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="xl:col-span-2">
          <Card className="bg-slate-800/50 border-white/5 h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-base">{tanks[0]?.name ?? "수조"} 수질 추이 (24시간)</CardTitle>
                <Link href="/water-quality" className="text-xs text-ocean-400 hover:text-ocean-300 flex items-center gap-1">
                  전체 보기 <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                    <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} interval={5} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={35} />
                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }} labelStyle={{ color: "#94a3b8" }} />
                    <Legend wrapperStyle={{ fontSize: "12px", color: "#64748b" }} />
                    <Line type="monotone" dataKey="수온" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="DO"   stroke="#14b8a6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="pH"   stroke="#a78bfa" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-slate-500 text-sm">
                  수질 데이터가 없습니다. 수질 모니터링 페이지에서 데이터를 입력하세요.
                </div>
              )}

              {latestWq && (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {[
                    { label: "수온", value: latestWq.temperature.toFixed(1), unit: "°C", icon: <ThermometerSun className="w-4 h-4" />, ok: latestWq.temperature >= 25 && latestWq.temperature <= 32 },
                    { label: "DO",   value: latestWq.do_level.toFixed(1),    unit: "mg/L", icon: <Wind className="w-4 h-4" />,           ok: latestWq.do_level >= 5 },
                    { label: "pH",   value: latestWq.ph.toFixed(2),          unit: "",     icon: <Droplets className="w-4 h-4" />,         ok: latestWq.ph >= 7.5 && latestWq.ph <= 8.5 },
                  ].map(item => (
                    <div key={item.label} className={`flex items-center gap-2 p-3 rounded-xl border ${item.ok ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                      <span className={item.ok ? "text-emerald-400" : "text-red-400"}>{item.icon}</span>
                      <div>
                        <p className="text-xs text-slate-400">{item.label}</p>
                        <p className={`text-sm font-bold ${item.ok ? "text-emerald-300" : "text-red-300"}`}>{item.value}{item.unit}</p>
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
          <Card className="bg-slate-800/50 border-white/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-base">수조 현황</CardTitle>
                <Link href="/farms" className="text-xs text-ocean-400 hover:text-ocean-300 flex items-center gap-1">전체 <ArrowRight className="w-3 h-3" /></Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {tanks.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">등록된 수조가 없습니다</p>
              ) : tanks.slice(0, 6).map(tank => {
                const meta = TANK_STATUS_META[tank.status] || TANK_STATUS_META.inactive
                return (
                  <div key={tank.id} className={`flex items-center justify-between p-3 rounded-xl border ${meta.bg}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${meta.dot} ${tank.status !== "active" ? "animate-pulse" : ""}`} />
                      <div>
                        <p className="text-sm font-medium text-white">{tank.name}</p>
                        <p className="text-xs text-slate-500">{tank.cycle_day}일차</p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-amber-400" /> 최근 알림
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">활성 알림 없음</p>
              ) : alerts.slice(0, 3).map(alert => (
                <div key={alert.id} className={`flex items-start gap-2.5 p-3 rounded-xl border ${
                  alert.type === "danger" ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"
                }`}>
                  {ALERT_ICONS[alert.type]}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{alert.tank_name}</p>
                    <p className="text-xs text-slate-400 truncate">{alert.message}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDateTime(alert.created_at)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Diagnoses table */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-base">최근 진단 결과</CardTitle>
            <Link href="/diagnosis" className="text-xs text-ocean-400 hover:text-ocean-300 flex items-center gap-1">전체 <ArrowRight className="w-3 h-3" /></Link>
          </div>
        </CardHeader>
        <CardContent>
          {diagnoses.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">진단 결과가 없습니다</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-white/5">
                    <th className="text-left pb-2 font-medium">수조</th>
                    <th className="text-left pb-2 font-medium">검사 항목</th>
                    <th className="text-left pb-2 font-medium">결과</th>
                    <th className="text-right pb-2 font-medium">비브리오</th>
                    <th className="text-right pb-2 font-medium">위험도</th>
                    <th className="text-right pb-2 font-medium">검사일시</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {diagnoses.slice(0, 5).map(d => (
                    <tr key={d.id} className="hover:bg-white/2">
                      <td className="py-3 text-white font-medium">{d.tank_name}</td>
                      <td className="py-3 text-slate-300">{d.test_type}</td>
                      <td className="py-3"><Badge variant={d.result === "양성" ? "danger" : d.result === "의심" ? "warning" : "success"}>{d.result}</Badge></td>
                      <td className="py-3 text-right text-slate-300">{d.vibrio_count.toLocaleString()} CFU/mL</td>
                      <td className="py-3 text-right">
                        <Badge variant={d.risk_level === "high" || d.risk_level === "critical" ? "danger" : d.risk_level === "medium" ? "warning" : "success"}>
                          {d.risk_level === "low" ? "낮음" : d.risk_level === "medium" ? "보통" : d.risk_level === "high" ? "높음" : "긴급"}
                        </Badge>
                      </td>
                      <td className="py-3 text-right text-slate-500 text-xs">{formatDateTime(d.tested_at)}</td>
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
