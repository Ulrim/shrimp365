"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { isMonitorAccount, isTestAccount, MOCK_ADMIN_STATS, MOCK_ALERTS, type AdminUserRow } from "@/lib/mock-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Users, Building2, AlertTriangle, ShieldCheck,
  RefreshCw, XCircle, AlertCircle, Info, TrendingUp,
  Crown, CheckCircle2, Activity, Fish,
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  users: AdminUserRow[]
  total_farms: number
  total_tanks: number
  total_active_alerts: number
  tanks_by_status: { active: number; warning: number; danger: number; inactive: number }
  plan_distribution: { free: number; basic: number; pro: number; enterprise: number }
  recent_alerts: AdminAlert[]
  recent_diagnoses: AdminDiagnosis[]
}

interface AdminAlert {
  id: string
  tank_id: string
  type: "danger" | "warning" | "info"
  parameter: string | null
  value: number | null
  threshold: number | null
  message: string
  created_at: string
  tank?: { name: string; farm?: { user_id: string; name: string } }
}

interface AdminDiagnosis {
  id: string
  tank_id: string
  test_type: string
  result: string
  risk_level: string
  tested_at: string
  tank?: { name: string; farm?: { user_id: string; name: string } }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function planBadge(plan: string) {
  const labels: Record<string, string> = { free: "Free", basic: "Basic", pro: "Pro", enterprise: "Enterprise" }
  const colors: Record<string, string> = {
    free: "bg-muted text-muted-foreground border-border",
    basic: "bg-sky-500/20 text-sky-600 border-sky-500/40",
    pro: "bg-ocean-500/20 text-ocean-600 border-ocean-500/40",
    enterprise: "bg-purple-500/20 text-purple-600 border-purple-500/40",
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors[plan] ?? colors.free}`}>
      {labels[plan] ?? plan}
    </span>
  )
}

function roleBadge(role: string) {
  if (role === "admin") return <span className="text-xs text-amber-500 font-semibold flex items-center gap-1"><Crown className="w-3 h-3" />관리자</span>
  if (role === "operator") return <span className="text-xs text-muted-foreground">운영자</span>
  return <span className="text-xs text-muted-foreground">뷰어</span>
}

function alertTypeIcon(type: string) {
  if (type === "danger")  return <XCircle    className="w-4 h-4 text-red-500 shrink-0" />
  if (type === "warning") return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
  return <Info className="w-4 h-4 text-ocean-500 shrink-0" />
}

function riskBadge(level: string) {
  if (level === "critical") return <Badge variant="danger">긴급</Badge>
  if (level === "high")     return <Badge variant="danger">높음</Badge>
  if (level === "medium")   return <Badge variant="warning">보통</Badge>
  return <Badge variant="success">낮음</Badge>
}

// ─── Mock data builder for monitor account ────────────────────────────────────

function buildMockStats(): AdminStats {
  const mockAlerts: AdminAlert[] = MOCK_ALERTS.filter(a => !a.resolved).map(a => ({
    ...a,
    tank: { name: a.tank_name, farm: { user_id: "mock-user-1", name: "제1양식장" } },
  }))
  const mockDiagnoses: AdminDiagnosis[] = [
    { id: "diag-1", tank_id: "tank-4", test_type: "AHPND",    result: "양성", risk_level: "high",   tested_at: new Date(Date.now() - 86400000).toISOString(),     tank: { name: "B-2조", farm: { user_id: "mock-user-1", name: "제1양식장" } } },
    { id: "diag-2", tank_id: "tank-6", test_type: "총비브리오", result: "의심", risk_level: "medium", tested_at: new Date(Date.now() - 86400000).toISOString(),     tank: { name: "C-2조", farm: { user_id: "mock-user-1", name: "제1양식장" } } },
    { id: "diag-3", tank_id: "tank-1", test_type: "총비브리오", result: "음성", risk_level: "low",    tested_at: new Date(Date.now() - 86400000 * 3).toISOString(), tank: { name: "A-1조", farm: { user_id: "mock-user-1", name: "제1양식장" } } },
    { id: "diag-4", tank_id: "tank-4", test_type: "EHP",       result: "음성", risk_level: "low",    tested_at: new Date(Date.now() - 86400000 * 5).toISOString(), tank: { name: "F-1조", farm: { user_id: "mock-user-2", name: "제2양식장" } } },
  ]
  return {
    ...MOCK_ADMIN_STATS,
    recent_alerts: mockAlerts,
    recent_diagnoses: mockDiagnoses,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<"users" | "alerts" | "diagnoses">("users")

  const isMock = isMonitorAccount(user?.email) || isTestAccount(user?.email)

  async function loadStats() {
    if (isMock) {
      setStats(buildMockStats())
      setLoading(false)
      return
    }
    try {
      const res = await fetch("/api/admin/stats")
      if (res.status === 403) { router.replace("/dashboard"); return }
      if (res.status === 503) { setError("SERVICE_KEY_MISSING"); setLoading(false); return }
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setStats(data)
    } catch {
      setError("fetch_error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return
    // 권한 없는 일반 사용자는 대시보드로
    if (!isTestAccount(user.email) && user.role !== "admin") {
      router.replace("/dashboard")
      return
    }
    loadStats()
  }, [user])

  async function handleRefresh() {
    setRefreshing(true)
    await loadStats()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-ocean-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error === "SERVICE_KEY_MISSING") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
        <ShieldCheck className="w-12 h-12 text-amber-500" />
        <p className="text-foreground font-semibold">서비스 롤 키 미설정</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          서버에 <code className="bg-muted px-1 rounded text-ocean-500">SUPABASE_SERVICE_ROLE_KEY</code> 환경변수가 설정되지 않아 관리자 데이터를 조회할 수 없습니다.
        </p>
      </div>
    )
  }

  if (!stats) return null

  const totalUsers = stats.users.length
  const dangerCount = stats.tanks_by_status.danger
  const warningCount = stats.tanks_by_status.warning

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-ocean-500" /> 시스템 모니터링
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">전체 사용자·양식장·수질 현황 통합 뷰</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="border-border text-muted-foreground hover:text-foreground gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          새로고침
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <Users className="w-5 h-5 text-ocean-500" />, label: "등록 사용자", value: totalUsers, sub: `Pro ${stats.plan_distribution.pro} / Basic ${stats.plan_distribution.basic} / Free ${stats.plan_distribution.free}`, color: "text-ocean-500", bg: "bg-ocean-500/10" },
          { icon: <Building2 className="w-5 h-5 text-teal-500" />, label: "전체 양식장", value: stats.total_farms, sub: `수조 ${stats.total_tanks}개`, color: "text-teal-500", bg: "bg-teal-500/10" },
          { icon: <Fish className="w-5 h-5 text-emerald-500" />, label: "가동 수조", value: stats.tanks_by_status.active, sub: `주의 ${warningCount} / 위험 ${dangerCount}`, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { icon: <AlertTriangle className="w-5 h-5 text-red-500" />, label: "활성 알림", value: stats.total_active_alerts, sub: `위험 ${stats.recent_alerts.filter(a => a.type === "danger").length}건 포함`, color: "text-red-500", bg: "bg-red-500/10" },
        ].map(card => (
          <Card key={card.label} className="bg-card border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
                  <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                </div>
                <div className={`w-11 h-11 rounded-xl ${card.bg} flex items-center justify-center`}>{card.icon}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tank status bar */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-3 font-medium">수조 상태 분포</p>
          <div className="flex gap-4 flex-wrap">
            {[
              { label: "정상", count: stats.tanks_by_status.active,   color: "bg-emerald-500", text: "text-emerald-500" },
              { label: "주의", count: stats.tanks_by_status.warning,  color: "bg-amber-500",   text: "text-amber-500" },
              { label: "위험", count: stats.tanks_by_status.danger,   color: "bg-red-500",     text: "text-red-500" },
              { label: "비가동", count: stats.tanks_by_status.inactive, color: "bg-muted-foreground", text: "text-muted-foreground" },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className={`text-sm font-bold ${s.text}`}>{s.count}</span>
              </div>
            ))}
            {/* Visual bar */}
            <div className="flex-1 min-w-40 h-2 rounded-full bg-muted overflow-hidden flex ml-2">
              {(() => {
                const total = stats.total_tanks || 1
                return [
                  { count: stats.tanks_by_status.active,   color: "bg-emerald-500" },
                  { count: stats.tanks_by_status.warning,  color: "bg-amber-500" },
                  { count: stats.tanks_by_status.danger,   color: "bg-red-500" },
                  { count: stats.tanks_by_status.inactive, color: "bg-muted-foreground" },
                ].map(s => (
                  <div key={s.color} style={{ width: `${(s.count / total) * 100}%` }} className={`h-full ${s.color}`} />
                ))
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted border border-border rounded-xl p-1 w-fit">
        {([
          { key: "users",    label: `사용자 (${totalUsers})` },
          { key: "alerts",   label: `활성 알림 (${stats.recent_alerts.length})` },
          { key: "diagnoses", label: `최근 진단 (${stats.recent_diagnoses.length})` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? "bg-ocean-500/20 text-ocean-500 border border-ocean-500/30" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Users tab */}
      {tab === "users" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-ocean-500" /> 사용자 현황
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b border-border">
                    <th className="text-left pb-3 font-medium">이름 / 이메일</th>
                    <th className="text-left pb-3 font-medium">역할</th>
                    <th className="text-center pb-3 font-medium">플랜</th>
                    <th className="text-center pb-3 font-medium">양식장</th>
                    <th className="text-center pb-3 font-medium">수조 (가동)</th>
                    <th className="text-center pb-3 font-medium">활성 알림</th>
                    <th className="text-right pb-3 font-medium">가입일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.users.map(u => (
                    <tr key={u.id} className="hover:bg-accent transition-colors">
                      <td className="py-3">
                        <p className="text-foreground font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="py-3">{roleBadge(u.role)}</td>
                      <td className="py-3 text-center">{planBadge(u.plan)}</td>
                      <td className="py-3 text-center text-foreground/80">{u.farm_count}</td>
                      <td className="py-3 text-center">
                        <span className="text-emerald-500 font-medium">{u.active_tanks}</span>
                        <span className="text-muted-foreground">/{u.tank_count}</span>
                      </td>
                      <td className="py-3 text-center">
                        {u.alert_count > 0
                          ? <span className="text-red-500 font-semibold">{u.alert_count}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">
                        {new Date(u.joined_at).toLocaleDateString("ko-KR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts tab */}
      {tab === "alerts" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-red-500" /> 전체 활성 알림
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recent_alerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                <p className="text-sm text-muted-foreground">활성 알림이 없습니다</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.recent_alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border ${
                      alert.type === "danger"
                        ? "bg-red-500/5 border-red-500/20"
                        : alert.type === "warning"
                        ? "bg-amber-500/5 border-amber-500/20"
                        : "bg-ocean-500/5 border-ocean-500/20"
                    }`}
                  >
                    <div className="mt-0.5">{alertTypeIcon(alert.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {alert.tank?.name ?? alert.tank_id}
                        </span>
                        {alert.tank?.farm?.name && (
                          <span className="text-xs text-muted-foreground">{alert.tank.farm.name}</span>
                        )}
                        {alert.parameter && (
                          <span className="text-xs text-muted-foreground">· {alert.parameter}</span>
                        )}
                      </div>
                      <p className="text-xs text-foreground/80">{alert.message}</p>
                      {alert.value != null && alert.threshold != null && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          측정값: <span className="text-foreground">{alert.value}</span> / 기준: {alert.threshold}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0 mt-0.5">{formatDateTime(alert.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Diagnoses tab */}
      {tab === "diagnoses" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-500" /> 최근 질병 진단
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recent_diagnoses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">진단 기록이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b border-border">
                      <th className="text-left pb-3 font-medium">수조 / 양식장</th>
                      <th className="text-left pb-3 font-medium">검사 종류</th>
                      <th className="text-center pb-3 font-medium">결과</th>
                      <th className="text-center pb-3 font-medium">위험도</th>
                      <th className="text-right pb-3 font-medium">검사일시</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.recent_diagnoses.map(d => (
                      <tr key={d.id} className="hover:bg-accent">
                        <td className="py-3">
                          <p className="text-foreground font-medium">{d.tank?.name ?? d.tank_id}</p>
                          {d.tank?.farm?.name && <p className="text-xs text-muted-foreground">{d.tank.farm.name}</p>}
                        </td>
                        <td className="py-3 text-foreground/80">{d.test_type}</td>
                        <td className="py-3 text-center">
                          <Badge variant={d.result === "양성" ? "danger" : d.result === "의심" ? "warning" : "success"}>
                            {d.result}
                          </Badge>
                        </td>
                        <td className="py-3 text-center">{riskBadge(d.risk_level)}</td>
                        <td className="py-3 text-right text-xs text-muted-foreground">{formatDateTime(d.tested_at)}</td>
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
