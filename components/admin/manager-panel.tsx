"use client"

// 매니저 관리 — 옛 관제센터 하단의 ManagerPanel 을 그대로 옮겼다(설계서 admin-console.md
// 5·6장). 선임·해임 권한은 서버(api/control/managers → lib/control-auth.ts)가 이메일로 판정한다.
import { useCallback, useEffect, useState } from "react"
import { ShieldCheck, UserPlus, UserMinus, Loader2, Crown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { LoadProblemView, StatsLoading, problemOf, type LoadProblem } from "@/components/admin/stats-status"

type ManagedUser = {
  id: string; email: string; name: string; role: string
  is_super_admin: boolean; created_at: string
}

// ── 역할 배지 ─────────────────────────────────────────────────────────────────
// 콘솔 중립색 규칙 — 색 대신 채움으로 구분한다. 총관리자만 뒤집힌(진한) 배지.
function RoleBadge({ u }: { u: ManagedUser }) {
  const base = "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
  if (u.is_super_admin) {
    return <span className={`${base} font-semibold bg-foreground text-background border-foreground`}><Crown className="w-3 h-3" aria-hidden="true" /> 총관리자</span>
  }
  if (u.role === "admin") return <span className={`${base} font-semibold bg-muted text-foreground border-foreground/40`}>관리자</span>
  if (u.role === "manager") return <span className={`${base} font-semibold bg-muted text-foreground border-border`}>매니저</span>
  return <span className={`${base} font-medium text-muted-foreground border-border`}>일반</span>
}

// ── 매니저 선임 ───────────────────────────────────────────────────────────────
export function ManagerPanel() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [problem, setProblem] = useState<LoadProblem | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/control/managers", { cache: "no-store" })
      if (res.ok) {
        setUsers((await res.json()).users ?? [])
        setProblem(null)
      } else {
        // 관제센터 안에 있을 때는 서버가 super_admin 이라 답한 뒤에만 이 패널을 그렸다.
        // 단독 화면이 된 지금은 거절도 받을 수 있으니, "불러오는 중"에 멈춰 있지 않게 알린다.
        setProblem(problemOf(res.status))
      }
    } catch {
      setProblem("failed")
    }
  }, [])
  useEffect(() => {
    const t = setTimeout(() => { load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  async function retry() {
    setRetrying(true)
    await load()
    setRetrying(false)
  }

  async function toggle(u: ManagedUser, manager: boolean) {
    // 해임은 되돌리기 전에 한 번 묻는다(선임은 바로).
    if (!manager && !window.confirm(`${u.name || u.email} 님을 매니저에서 해임할까요?`)) return
    setBusyId(u.id)
    setError(null)
    try {
      const res = await fetch("/api/control/managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: u.id, manager }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "변경하지 못했습니다.")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "변경하지 못했습니다.")
    } finally {
      setBusyId(null)
    }
  }

  // 동작 버튼 — 모바일 카드에서는 전폭, 표에서는 내용 폭. 높이는 둘 다 44px.
  function renderAction(u: ManagedUser, full = false) {
    if (u.is_super_admin || u.role === "admin") {
      return full ? null : <span className="text-xs text-muted-foreground">—</span>
    }
    const busy = busyId === u.id
    const isManager = u.role === "manager"
    return (
      <button
        type="button"
        onClick={() => toggle(u, !isManager)}
        disabled={busy}
        className={cn(
          "text-sm px-3 min-h-[44px] rounded-lg border transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
          full && "w-full",
          isManager
            ? "border-border text-muted-foreground hover:text-red-600 hover:border-red-500/40 dark:hover:text-red-400"
            : "border-foreground/30 text-foreground hover:bg-accent",
        )}
      >
        {busy
          ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          : isManager ? <UserMinus className="w-4 h-4" aria-hidden="true" /> : <UserPlus className="w-4 h-4" aria-hidden="true" />}
        {isManager ? "해임" : "매니저 선임"}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* 셸 머리(h1 "매니저 관리")와 같은 이름이라 데스크톱에서는 제목 줄을 숨긴다. */}
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-foreground lg:sr-only">매니저 관리</h2>
        <p className="text-sm text-muted-foreground mt-0.5 lg:mt-0">
          매니저는 관제센터를 볼 수 있습니다. 선임과 해임은 총관리자만 할 수 있습니다.
        </p>
      </div>

      {problem ? (
        <LoadProblemView
          problem={problem}
          onRetry={retry}
          retrying={retrying}
          body={problem === "forbidden" ? "매니저 관리는 총관리자만 할 수 있습니다." : undefined}
        />
      ) : (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" aria-hidden="true" /> 계정 목록
              {users && <span className="text-xs text-muted-foreground font-normal tabular-nums">({users.length})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2" role="alert">{error}</p>}
            {!users ? (
              <StatsLoading label="계정 목록 불러오는 중" />
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">표시할 계정이 없습니다</p>
            ) : (
              <>
                {/* 모바일 — 카드 목록 */}
                <ul className="sm:hidden divide-y divide-border">
                  {users.map(u => (
                    <li key={u.id} className="py-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-foreground font-medium break-words">{u.name || "이름 없음"}</span>
                        <RoleBadge u={u} />
                      </div>
                      <p className="text-xs text-muted-foreground break-all">{u.email}</p>
                      {renderAction(u, true)}
                    </li>
                  ))}
                </ul>

                {/* sm 이상 — 표 */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 font-semibold whitespace-nowrap">이름</th>
                        <th className="py-2 pr-3 font-semibold">이메일</th>
                        <th className="py-2 pr-3 font-semibold whitespace-nowrap">역할</th>
                        <th className="py-2 font-semibold text-right whitespace-nowrap">동작</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 text-foreground font-medium whitespace-nowrap">{u.name || "—"}</td>
                          <td className="py-2 pr-3 text-muted-foreground break-all">{u.email}</td>
                          <td className="py-2 pr-3 whitespace-nowrap"><RoleBadge u={u} /></td>
                          <td className="py-2 text-right whitespace-nowrap">{renderAction(u)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
