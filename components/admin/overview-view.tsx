"use client"

// 개요(시스템 모니터링) — 옛 app/(dashboard)/admin/page.tsx 에서 사용자 표만 떼어
// /admin/users 로 보내고 나머지를 그대로 옮겼다(설계서 admin-console.md 5·6장).
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Users, Building2, AlertTriangle,
  RefreshCw, XCircle, AlertCircle, Info, TrendingUp,
  CheckCircle2, Activity, Fish,
} from "lucide-react"
import { cn, formatDateTime } from "@/lib/utils"
import { MISSING_INPUT_PARAMETER } from "@/lib/thresholds"
import { useAdminStats } from "@/components/admin/admin-stats"
import { StatsLoading, LoadProblemView } from "@/components/admin/stats-status"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function alertTypeIcon(type: string) {
  if (type === "danger")  return <XCircle    className="w-4 h-4 text-red-500 shrink-0" />
  if (type === "warning") return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
  return <Info className="w-4 h-4 text-slate-500 shrink-0" />
}

function riskBadge(level: string) {
  if (level === "critical") return <Badge variant="danger">긴급</Badge>
  if (level === "high")     return <Badge variant="danger">높음</Badge>
  if (level === "medium")   return <Badge variant="warning">보통</Badge>
  return <Badge variant="success">낮음</Badge>
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function AdminOverviewView() {
  const { stats, loading, error, refreshing, refresh } = useAdminStats()
  const [tab, setTab] = useState<"alerts" | "diagnoses">("alerts")

  if (loading) return <StatsLoading label="개요 불러오는 중" />
  if (error || !stats) return <LoadProblemView problem={error ?? "failed"} onRetry={refresh} retrying={refreshing} />

  const totalUsers = stats.users.length
  const dangerCount = stats.tanks_by_status.danger
  const warningCount = stats.tanks_by_status.warning
  const plans = stats.plan_distribution
  const planSummary = [
    ...(plans.enterprise > 0 ? [`Enterprise ${plans.enterprise}`] : []),
    `Pro ${plans.pro}`, `Basic ${plans.basic}`, `Free ${plans.free}`,
  ].join(" / ")
  const dangerAlerts = stats.recent_alerts.filter(a => a.type === "danger").length

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      {/* 셸 머리(h1 "개요")와 같은 이름이라 데스크톱에서는 제목 줄을 숨긴다. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground lg:sr-only">개요</h2>
          <p className="text-sm text-muted-foreground mt-0.5 lg:mt-0">시스템 모니터링 · 전체 사용자·양식장·수질 현황</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          aria-label="통계 새로고침"
          className="border-border text-muted-foreground hover:text-foreground gap-2 min-h-[44px]"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          새로고침
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 색은 상태색(정상 emerald·위험 red)만, 0 은 muted. 나머지는 중립. */}
        {[
          { Icon: Users, label: "등록 사용자", value: totalUsers, sub: planSummary, color: "text-foreground" },
          { Icon: Building2, label: "전체 양식장", value: stats.total_farms, sub: `수조 ${stats.total_tanks}개`, color: "text-foreground" },
          { Icon: Fish, label: "가동 수조", value: stats.tanks_by_status.active, sub: `주의 ${warningCount} / 위험 ${dangerCount}`, color: "text-emerald-600 dark:text-emerald-400" },
          { Icon: AlertTriangle, label: "활성 알림", value: stats.total_active_alerts, sub: `위험 ${dangerAlerts}건 포함`, color: "text-red-600 dark:text-red-400" },
        ].map(({ Icon, ...card }) => (
          <Card key={card.label} className="bg-card border-border">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
                  <p className={cn("text-3xl font-bold tabular-nums", card.value === 0 ? "text-muted-foreground" : card.color)}>{card.value}</p>
                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">{card.sub}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                </div>
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
                <span className={cn("text-sm font-bold tabular-nums", s.count === 0 ? "text-muted-foreground" : s.text)}>{s.count}</span>
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

      {/* Tabs — 사용자 표는 /admin/users 로 옮겼다 */}
      <div className="flex gap-1 bg-muted border border-border rounded-xl p-1 w-full overflow-x-auto sm:w-fit">
        {([
          { key: "alerts",   label: `활성 알림 (${stats.recent_alerts.length})` },
          { key: "diagnoses", label: `최근 진단 (${stats.recent_diagnoses.length})` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`shrink-0 px-4 min-h-[44px] rounded-lg text-sm font-medium transition-all ${
              tab === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Alerts tab */}
      {tab === "alerts" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> 전체 활성 알림
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
                        : "bg-slate-500/5 border-slate-500/20"
                    }`}
                  >
                    <div className="mt-0.5">{alertTypeIcon(alert.type)}</div>
                    <div className="flex-1 min-w-0">
                      {/* 좁은 화면에서는 제목 줄이 접히고 시각은 아래 줄로(sm 부터 오른쪽). */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
                        <span className="text-sm font-medium text-foreground break-words">
                          {alert.tank?.name ?? alert.tank_id}
                        </span>
                        {alert.tank?.farm?.name && (
                          <span className="text-xs text-muted-foreground">{alert.tank.farm.name}</span>
                        )}
                        {alert.parameter && (
                          <span className="text-xs text-muted-foreground">· {alert.parameter}</span>
                        )}
                      </div>
                      <p className="text-xs text-foreground/80 break-words">{alert.message}</p>
                      {/* 입력 누락은 "측정값"이 없는 알림이다 — value 는 마지막 기록
                          이후 경과 **시간**이고 기준은 72시간이다. 그대로 두면
                          "측정값 96 / 기준 72" 가 되어 수질 수치로 오해한다.
                          (water-quality-view.tsx·notifications-panel.tsx 와 같은 가드) */}
                      {alert.parameter !== MISSING_INPUT_PARAMETER && alert.value != null && alert.threshold != null && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          측정값: <span className="text-foreground">{alert.value}</span> / 기준: {alert.threshold}
                        </p>
                      )}
                      <p className="sm:hidden text-xs text-muted-foreground mt-1 tabular-nums">{formatDateTime(alert.created_at)}</p>
                    </div>
                    <p className="hidden sm:block text-xs text-muted-foreground shrink-0 mt-0.5 tabular-nums">{formatDateTime(alert.created_at)}</p>
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
              <TrendingUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> 최근 질병 진단
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recent_diagnoses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">진단 기록이 없습니다</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
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
