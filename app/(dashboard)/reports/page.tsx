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
import { Download, TrendingUp, TrendingDown, Minus, BarChart3, Fish, Droplets, AlertTriangle, BookOpen, ChevronDown, ChevronUp, Calendar } from "lucide-react"
import type { Farm, Tank, JournalEntry } from "@/types"

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

const exampleTankStatusData = [
  { name: "정상", value: 5, color: "#10b981" },
  { name: "주의", value: 1, color: "#f59e0b" },
  { name: "위험", value: 2, color: "#ef4444" },
]

const exampleKpis = [
  { label: "평균 수온", value: "28.5°C", prev: "28.1°C", trend: "up", bad: true },
  { label: "평균 DO", value: "6.2 mg/L", prev: "6.5 mg/L", trend: "down", bad: true },
  { label: "총 폐사량", value: "1,250마리", prev: "980마리", trend: "up", bad: true },
  { label: "평균 탁도", value: "9.8 NTU", prev: "7.2 NTU", trend: "up", bad: true },
  { label: "알림 발생", value: "7건", prev: "3건", trend: "up", bad: true },
  { label: "정상 수조", value: "5개", prev: "6개", trend: "down", bad: true },
]

function TrendIcon({ trend, bad }: { trend: string; bad: boolean }) {
  const isGood = (trend === "up" && !bad) || (trend === "down" && bad)
  if (trend === "up") return <TrendingUp className={`w-4 h-4 ${isGood ? "text-emerald-400" : "text-red-400"}`} />
  if (trend === "down") return <TrendingDown className={`w-4 h-4 ${isGood ? "text-emerald-400" : "text-red-400"}`} />
  return <Minus className="w-4 h-4 text-slate-400" />
}

// ─── Example Report (mock) ────────────────────────────────────────────────────

function ExampleReport() {
  return (
    <div id="print-report" className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {exampleKpis.map(kpi => (
          <Card key={kpi.label} className="bg-slate-800/50 border-white/5">
            <CardContent className="p-4">
              <p className="text-xs text-slate-400 mb-2">{kpi.label}</p>
              <p className="text-xl font-bold text-white mb-1">{kpi.value}</p>
              <div className="flex items-center gap-1">
                <TrendIcon trend={kpi.trend} bad={kpi.bad} />
                <span className="text-xs text-slate-500">지난주 {kpi.prev}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <Card className="bg-slate-800/50 border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Droplets className="w-4 h-4 text-teal-400" />수조별 DO 주간 추이
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={weeklyDo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} domain={[3.5, 8]} width={35} />
                  <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }} labelStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "#64748b" }} />
                  <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "기준", fill: "#ef4444", fontSize: 10, position: "right" }} />
                  <Line type="monotone" dataKey="A-1조" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="B-2조" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="C-2조" stroke="#a78bfa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-800/50 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-400" />수조 상태 분포
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={exampleTankStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {exampleTankStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              {exampleTankStatusData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="bg-slate-800/50 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Fish className="w-4 h-4 text-amber-400" />일별 폐사량 비교
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeklyMortality} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }} />
                <Legend wrapperStyle={{ fontSize: "12px", color: "#64748b" }} />
                <Bar dataKey="폐사량" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="이전주" fill="#334155" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />주요 이슈 및 조치 이력
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
              <div key={i} className="flex items-start gap-3 p-3 bg-slate-700/30 rounded-xl border border-white/5">
                <div className="text-xs text-slate-500 w-10 shrink-0 pt-0.5">{item.date}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm text-white font-medium">{item.tank}</span>
                    <Badge variant={item.badge} className="text-xs h-4 px-1.5">
                      {item.badge === "danger" ? "위험" : item.badge === "warning" ? "주의" : "정상"}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400">{item.issue}</p>
                  <p className="text-xs text-ocean-400 mt-0.5">→ {item.action}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-white">양식장별 운영 현황 (예시)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-white/5">
                  <th className="text-left pb-3 font-medium">양식장</th>
                  <th className="text-center pb-3 font-medium">수조</th>
                  <th className="text-center pb-3 font-medium">입식 마리수</th>
                  <th className="text-center pb-3 font-medium">정상/주의/위험</th>
                  <th className="text-center pb-3 font-medium">이번 주 폐사</th>
                  <th className="text-right pb-3 font-medium">위험도</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr className="hover:bg-white/2">
                  <td className="py-3 text-white font-medium">제1양식장</td>
                  <td className="py-3 text-center text-slate-300">8개</td>
                  <td className="py-3 text-center text-slate-300">476,500마리</td>
                  <td className="py-3 text-center">
                    <span className="text-emerald-400">5</span><span className="text-slate-500"> / </span>
                    <span className="text-amber-400">1</span><span className="text-slate-500"> / </span>
                    <span className="text-red-400">2</span>
                  </td>
                  <td className="py-3 text-center text-amber-400">1,250마리</td>
                  <td className="py-3 text-right"><Badge variant="warning">보통</Badge></td>
                </tr>
                <tr className="hover:bg-white/2">
                  <td className="py-3 text-white font-medium">제2양식장</td>
                  <td className="py-3 text-center text-slate-300">5개</td>
                  <td className="py-3 text-center text-slate-300">312,000마리</td>
                  <td className="py-3 text-center">
                    <span className="text-emerald-400">5</span><span className="text-slate-500"> / </span>
                    <span className="text-amber-400">0</span><span className="text-slate-500"> / </span>
                    <span className="text-red-400">0</span>
                  </td>
                  <td className="py-3 text-center text-slate-300">230마리</td>
                  <td className="py-3 text-right"><Badge variant="success">낮음</Badge></td>
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
    { name: "정상", value: statusCounts.active, color: "#10b981" },
    { name: "주의", value: statusCounts.warning, color: "#f59e0b" },
    { name: "위험", value: statusCounts.danger, color: "#ef4444" },
  ].filter(d => d.value > 0)

  const chartDays = Math.min(periodDays, 30)
  const dailyMortality = Array.from({ length: chartDays }, (_, i) => {
    const d = new Date(Date.now() - (chartDays - 1 - i) * 86400000)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    const dateStr = d.toISOString().split("T")[0]
    const dayJournals = journals.filter(j => j.date === dateStr)
    return {
      day: label,
      폐사량: dayJournals.reduce((s, j) => s + j.mortality_count, 0),
    }
  })

  return (
    <div id="print-report" className="space-y-6">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "운영 양식장", value: `${farms.length}개` },
          { label: "총 수조", value: `${tanks.length}개` },
          { label: "이번 주 폐사", value: `${totalMortality.toLocaleString()}마리` },
          { label: "이번 주 급이", value: `${totalFeeding.toFixed(1)}kg` },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-slate-800/50 border-white/5">
            <CardContent className="p-4">
              <p className="text-xs text-slate-400 mb-2">{kpi.label}</p>
              <p className="text-xl font-bold text-white">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Mortality chart */}
        <div className="xl:col-span-2">
          <Card className="bg-slate-800/50 border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Fish className="w-4 h-4 text-amber-400" />일별 폐사량 (최근 7일)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyMortality.some(d => d.폐사량 > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dailyMortality} barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                    <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }} />
                    <Bar dataKey="폐사량" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-slate-500 text-sm">
                  이번 주 폐사 기록이 없습니다
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tank status */}
        <Card className="bg-slate-800/50 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-400" />수조 상태 분포
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
                    <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  {tankStatusData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">수조 없음</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Farm summary table */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-white">양식장별 운영 현황</CardTitle>
        </CardHeader>
        <CardContent>
          {farms.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">등록된 양식장이 없습니다</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-white/5">
                    <th className="text-left pb-3 font-medium">양식장</th>
                    <th className="text-center pb-3 font-medium">수조</th>
                    <th className="text-center pb-3 font-medium">입식 마리수</th>
                    <th className="text-center pb-3 font-medium">정상/주의/위험</th>
                    <th className="text-center pb-3 font-medium">이번 주 폐사</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {farms.map(farm => {
                    const farmTanks = tanks.filter(t => t.farm_id === farm.id)
                    const farmJournals = weekJournals.filter(j => farmTanks.some(t => t.id === j.tank_id))
                    const farmMortality = farmJournals.reduce((s, j) => s + j.mortality_count, 0)
                    const active = farmTanks.filter(t => t.status === "active").length
                    const warning = farmTanks.filter(t => t.status === "warning").length
                    const danger = farmTanks.filter(t => t.status === "danger").length
                    return (
                      <tr key={farm.id} className="hover:bg-white/2">
                        <td className="py-3 text-white font-medium">{farm.name}</td>
                        <td className="py-3 text-center text-slate-300">{farmTanks.length}개</td>
                        <td className="py-3 text-center text-slate-300">{farmTanks.reduce((s, t) => s + t.shrimp_count, 0).toLocaleString()}마리</td>
                        <td className="py-3 text-center">
                          <span className="text-emerald-400">{active}</span>
                          <span className="text-slate-500"> / </span>
                          <span className="text-amber-400">{warning}</span>
                          <span className="text-slate-500"> / </span>
                          <span className="text-red-400">{danger}</span>
                        </td>
                        <td className="py-3 text-center text-slate-300">{farmMortality.toLocaleString()}마리</td>
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
        <Card className="bg-slate-800/50 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-ocean-400" />이번 주 일지 요약
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekJournals.slice(0, 10).map(j => (
              <div key={j.id} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-xl text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 text-xs w-16 shrink-0">{j.date}</span>
                  <span className="text-white font-medium">{j.tank_name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>급이 {j.feeding_amount}kg</span>
                  <span className={j.mortality_count > 0 ? "text-amber-400" : "text-slate-500"}>폐사 {j.mortality_count}마리</span>
                  <span>환수 {j.water_exchange_rate}%</span>
                </div>
              </div>
            ))}
            {weekJournals.length > 10 && (
              <a href="/journal" className="block text-center text-xs text-ocean-400 hover:text-ocean-300 transition-colors pt-1">
                전체 일지 보기 ({weekJournals.length}건) →
              </a>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "이번 주 (7일)", days: 7 },
  { label: "이번 달 (30일)", days: 30 },
  { label: "최근 3개월 (90일)", days: 90 },
]

export default function ReportsPage() {
  const { user } = useAuth()
  const [farms, setFarms] = useState<Farm[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showExample, setShowExample] = useState(false)
  const [periodDays, setPeriodDays] = useState(7)

  const isMock = isTestAccount(user?.email)

  async function loadData(days: number) {
    setLoading(true)
    try {
      const from = new Date(Date.now() - days * 86400000).toISOString().split("T")[0]
      const [f, t, j] = await Promise.all([getFarms(), getAllTanks(), getJournalEntries(undefined, 500, from)])
      setFarms(f.length ? f : (isMock ? MOCK_FARMS : []))
      setTanks(t.length ? t : (isMock ? MOCK_TANKS : []))
      setJournals(j)
    } catch {
      if (isMock) {
        setFarms(MOCK_FARMS)
        setTanks(MOCK_TANKS)
      }
    } finally {
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
          <h2 className="text-xl font-bold text-white">운영 리포트</h2>
          <p className="text-sm text-slate-400 mt-0.5">{dateRange}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800/60 border border-white/5 rounded-xl p-1">
            <Calendar className="w-4 h-4 text-slate-400 mx-2" />
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => handlePeriodChange(opt.days)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                  periodDays === opt.days
                    ? "bg-ocean-500/30 text-ocean-300 font-medium"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {(hasData || showExample) && (
            <Button
              variant="outline"
              className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
              onClick={handlePdf}
            >
              <Download className="w-4 h-4 mr-2" />PDF 저장
            </Button>
          )}
        </div>
      </div>

      {/* Real user with no data: show empty state + example toggle */}
      {!isMock && !hasData ? (
        <div className="space-y-4">
          <Card className="bg-slate-800/30 border-white/5 border-dashed">
            <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-700/60 flex items-center justify-center">
                <BarChart3 className="w-8 h-8 text-slate-500" />
              </div>
              <div>
                <p className="text-white font-semibold text-lg mb-1">아직 데이터가 없습니다</p>
                <p className="text-slate-400 text-sm max-w-sm">
                  양식장·수조를 등록하고 양식일지를 기록하면 자동으로 주간 리포트가 생성됩니다.
                </p>
              </div>
              <div className="flex gap-3">
                <a href="/farms">
                  <Button className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2">
                    양식장 등록하기
                  </Button>
                </a>
                <Button
                  variant="outline"
                  className="border-white/10 text-slate-300 hover:bg-white/5 gap-2"
                  onClick={() => setShowExample(v => !v)}
                >
                  <BookOpen className="w-4 h-4" />
                  예시 보고서 보기
                  {showExample ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {showExample && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ocean-400 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> 예시 보고서 — 실제 데이터 입력 후 이런 형태로 자동 생성됩니다
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 text-slate-300 hover:bg-white/5"
                  onClick={handlePdf}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />PDF 저장
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
