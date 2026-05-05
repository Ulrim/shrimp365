"use client"

import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell, ReferenceLine,
} from "recharts"
import { MOCK_TANKS, MOCK_WATER_QUALITY, MOCK_FARMS } from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Download, TrendingUp, TrendingDown, Minus, BarChart3, Fish, Droplets, AlertTriangle } from "lucide-react"

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

const weeklyFeed = WEEK_LABELS.map((day, i) => ({
  day,
  급이량: +(98 + Math.sin(i) * 5).toFixed(1),
}))

const tankStatusData = [
  { name: "정상", value: 5, color: "#10b981" },
  { name: "주의", value: 1, color: "#f59e0b" },
  { name: "위험", value: 2, color: "#ef4444" },
]

const kpis = [
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

export default function ReportsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">주간 리포트</h2>
          <p className="text-sm text-slate-400 mt-0.5">2026년 5월 28일 ~ 6월 3일</p>
        </div>
        <Button variant="outline" className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5">
          <Download className="w-4 h-4 mr-2" />PDF 다운로드
        </Button>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(kpi => (
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
        {/* DO Trend */}
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
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "12px" }}
                    labelStyle={{ color: "#94a3b8" }}
                  />
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

        {/* Tank Status Pie */}
        <Card className="bg-slate-800/50 border-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-ocean-400" />수조 상태 분포
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
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
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Mortality Chart */}
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

        {/* Weekly Action Log */}
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

      {/* Farm Summary Table */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-white">양식장별 운영 현황</CardTitle>
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
                    <span className="text-emerald-400">5</span>
                    <span className="text-slate-500"> / </span>
                    <span className="text-amber-400">1</span>
                    <span className="text-slate-500"> / </span>
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
                    <span className="text-emerald-400">5</span>
                    <span className="text-slate-500"> / </span>
                    <span className="text-amber-400">0</span>
                    <span className="text-slate-500"> / </span>
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
