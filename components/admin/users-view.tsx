"use client"

// 사용자 — 옛 시스템 모니터링의 "사용자" 탭을 그대로 옮기고, 검색(이름·이메일)과
// 역할 필터를 더했다(설계서 admin-console.md 3장). 필터는 받은 목록 안에서만 거른다.
import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Users, RefreshCw, Crown, Search, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAdminStats } from "@/components/admin/admin-stats"
import { StatsLoading, LoadProblemView } from "@/components/admin/stats-status"

// ─── Helpers ──────────────────────────────────────────────────────────────────

// 콘솔 중립색 규칙 — 요금제는 색이 아니라 채움·굵기로 구분한다(사용자 상세의
// NeutralBadge 와 같은 틀). Pro·Enterprise 는 굵게, Enterprise 는 테두리를 진하게.
const PLAN_LABELS: Record<string, string> = { free: "Free", basic: "Basic", pro: "Pro", enterprise: "Enterprise" }
function planBadge(plan: string) {
  const strong = plan === "pro" || plan === "enterprise"
  return (
    <span
      className={cn(
        "inline-flex items-center text-xs px-2 py-0.5 rounded-full border bg-muted text-foreground whitespace-nowrap",
        strong ? "font-semibold" : "font-medium",
        plan === "enterprise" ? "border-foreground/60" : "border-border",
      )}
    >
      {PLAN_LABELS[plan] ?? plan}
    </span>
  )
}

function roleBadge(role: string) {
  if (role === "admin") return <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold inline-flex items-center gap-1 whitespace-nowrap"><Crown className="w-3 h-3" aria-hidden="true" />관리자</span>
  if (role === "manager") return <span className="text-xs text-foreground font-semibold whitespace-nowrap">매니저</span>
  if (role === "farmer") return <span className="text-xs text-foreground font-medium whitespace-nowrap">양식어가</span>
  if (role === "operator") return <span className="text-xs text-muted-foreground whitespace-nowrap">운영자</span>
  return <span className="text-xs text-muted-foreground whitespace-nowrap">뷰어</span>
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

  if (loading) return <StatsLoading label="사용자 목록 불러오는 중" />
  if (error || !stats) return <LoadProblemView problem={error ?? "failed"} onRetry={refresh} retrying={refreshing} />

  const totalUsers = stats.users.length
  const filtered = rows.length !== totalUsers

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      {/* 셸 머리(h1 "사용자")와 같은 이름이라 데스크톱에서는 제목 줄을 숨긴다. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground lg:sr-only">사용자</h2>
          <p className="text-sm text-muted-foreground mt-0.5 lg:mt-0 tabular-nums">
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
            <Users className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> 사용자 현황
          </CardTitle>
        </CardHeader>
        <CardContent>
          {totalUsers === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">등록된 사용자가 없습니다</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">조건에 맞는 사용자가 없습니다</p>
          ) : (
            <>
              {/* 모바일 — 카드 목록. 표를 가로로 밀어 보는 대신 한 사람씩 쌓는다. */}
              <ul className="sm:hidden divide-y divide-border -mx-2">
                {rows.map(u => (
                  <li key={u.id}>
                    <Link
                      href={`/admin/users/${encodeURIComponent(u.id)}`}
                      className="flex items-start gap-2 px-2 py-3 rounded-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-foreground font-medium underline-offset-2 break-words">{u.name || "이름 없음"}</span>
                          {roleBadge(u.role)}
                          {planBadge(u.plan)}
                        </div>
                        <p className="text-xs text-muted-foreground break-all">{u.email}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          농장 <span className="text-foreground">{u.farm_count}</span>
                          {" · "}수조 <span className="text-foreground">{u.active_tanks}</span>/{u.tank_count}
                          {u.alert_count > 0 && <> · 알림 <span className="text-red-600 dark:text-red-400 font-semibold">{u.alert_count}</span></>}
                          {" · "}최근 접속 {formatLastLogin(u.last_login)}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0 mt-1 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>

              {/* sm 이상 — 표. 이메일만 줄바꿈하고 나머지 열은 접지 않는다. */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b border-border">
                      <th className="text-left pb-3 pr-3 font-medium">이름 / 이메일</th>
                      <th className="text-left pb-3 pr-3 font-medium whitespace-nowrap">역할</th>
                      <th className="text-left pb-3 pr-3 font-medium whitespace-nowrap">요금제</th>
                      <th className="text-right pb-3 pr-3 font-medium whitespace-nowrap">양식장</th>
                      <th className="text-right pb-3 pr-3 font-medium whitespace-nowrap">수조(가동)</th>
                      <th className="text-right pb-3 pr-3 font-medium whitespace-nowrap">활성 알림</th>
                      <th className="text-right pb-3 pr-3 font-medium whitespace-nowrap">최근 접속</th>
                      <th className="text-right pb-3 font-medium whitespace-nowrap">가입일</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(u => (
                      <tr key={u.id} className="group hover:bg-accent transition-colors">
                        <td className="py-1.5 pr-3 min-w-[12rem]">
                          {/* 상세(/admin/users/<id>)로 — 이름 칸 전체가 링크다. */}
                          <Link
                            href={`/admin/users/${encodeURIComponent(u.id)}`}
                            className="flex items-center gap-1 py-1.5 pr-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="min-w-0">
                              <span className="block text-foreground font-medium group-hover:underline underline-offset-2">{u.name || "이름 없음"}</span>
                              <span className="block text-xs text-muted-foreground break-all">{u.email}</span>
                            </span>
                            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                          </Link>
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap">{roleBadge(u.role)}</td>
                        <td className="py-3 pr-3 whitespace-nowrap">{planBadge(u.plan)}</td>
                        <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap text-foreground/80">{u.farm_count}</td>
                        <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
                          <span className="text-foreground font-medium">{u.active_tanks}</span>
                          <span className="text-muted-foreground">/{u.tank_count}</span>
                        </td>
                        <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">
                          {u.alert_count > 0
                            ? <span className="text-red-600 dark:text-red-400 font-semibold">{u.alert_count}</span>
                            : <span className="text-muted-foreground">—</span>
                          }
                        </td>
                        <td className="py-3 pr-3 text-right text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatLastLogin(u.last_login)}
                        </td>
                        <td className="py-3 text-right text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {new Date(u.joined_at).toLocaleDateString("ko-KR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
