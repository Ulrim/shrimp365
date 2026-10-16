"use client"

// 사용자 — 옛 시스템 모니터링의 "사용자" 탭을 그대로 옮기고, 검색(이름·이메일)과
// 역할 필터를 더했다(설계서 admin-console.md 3장). 필터는 받은 목록 안에서만 거른다.
import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Users, RefreshCw, Crown, Search } from "lucide-react"
import { useAdminStats } from "@/components/admin/admin-stats"
import { StatsLoading, ServiceKeyMissing } from "@/components/admin/stats-status"

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
  if (role === "manager") return <span className="text-xs text-ocean-500 font-medium">매니저</span>
  if (role === "farmer") return <span className="text-xs text-emerald-500 font-medium">양식어가</span>
  if (role === "operator") return <span className="text-xs text-muted-foreground">운영자</span>
  return <span className="text-xs text-muted-foreground">뷰어</span>
}

function formatLastLogin(iso: string | null | undefined) {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return "방금 전"
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}일 전`
  return new Date(iso).toLocaleDateString("ko-KR")
}

// roleBadge 와 같은 분류. 목록에 없는 role 은 roleBadge 처럼 "뷰어"로 묶는다.
const ROLE_FILTERS = [
  { value: "all",      label: "전체 역할" },
  { value: "admin",    label: "관리자" },
  { value: "manager",  label: "매니저" },
  { value: "farmer",   label: "양식어가" },
  { value: "operator", label: "운영자" },
  { value: "viewer",   label: "뷰어" },
] as const
type RoleFilter = (typeof ROLE_FILTERS)[number]["value"]
const NAMED_ROLES = new Set(["admin", "manager", "farmer", "operator"])

function roleGroup(role: string): RoleFilter {
  return NAMED_ROLES.has(role) ? (role as RoleFilter) : "viewer"
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function AdminUsersView() {
  const { stats, loading, error, refreshing, refresh } = useAdminStats()
  const [query, setQuery] = useState("")
  const [role, setRole] = useState<RoleFilter>("all")

  const rows = useMemo(() => {
    if (!stats) return []
    const q = query.trim().toLowerCase()
    return stats.users.filter(u =>
      (role === "all" || roleGroup(u.role) === role) &&
      (!q || (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q)),
    )
  }, [stats, query, role])

  if (loading) return <StatsLoading />
  if (error === "SERVICE_KEY_MISSING") return <ServiceKeyMissing />
  if (!stats) return null

  const totalUsers = stats.users.length
  const filtered = rows.length !== totalUsers

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-foreground" /> 사용자
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered ? `${rows.length}명 표시 · 전체 ${totalUsers}명` : `전체 ${totalUsers}명`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          aria-label="사용자 목록 새로고침"
          className="border-border text-muted-foreground hover:text-foreground gap-2 min-h-[44px]"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          새로고침
        </Button>
      </div>

      {/* 검색·역할 필터 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="이름·이메일 검색"
            aria-label="이름 또는 이메일로 검색"
            className="pl-9"
          />
        </div>
        <select
          value={role}
          onChange={e => setRole(e.target.value as RoleFilter)}
          aria-label="역할 필터"
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
        >
          {ROLE_FILTERS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-ocean-500" /> 사용자 현황
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">조건에 맞는 사용자가 없습니다</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b border-border">
                    <th className="text-left pb-3 font-medium">이름 / 이메일</th>
                    <th className="text-left pb-3 font-medium">역할</th>
                    <th className="text-center pb-3 font-medium">플랜</th>
                    <th className="text-center pb-3 font-medium">양식장</th>
                    <th className="text-center pb-3 font-medium">수조 (가동)</th>
                    <th className="text-center pb-3 font-medium">활성 알림</th>
                    <th className="text-right pb-3 font-medium">최근 접속</th>
                    <th className="text-right pb-3 font-medium">가입일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(u => (
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
                        {formatLastLogin(u.last_login)}
                      </td>
                      <td className="py-3 text-right text-xs text-muted-foreground">
                        {new Date(u.joined_at).toLocaleDateString("ko-KR")}
                      </td>
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
