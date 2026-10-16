"use client"

// 매니저 관리 — 옛 관제센터 하단의 ManagerPanel 을 그대로 옮겼다(설계서 admin-console.md
// 5·6장). 선임·해임 권한은 서버(api/control/managers → lib/control-auth.ts)가 이메일로 판정한다.
import { useCallback, useEffect, useState } from "react"
import { ShieldCheck, UserPlus, UserMinus, Loader2, Crown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ManagedUser = {
  id: string; email: string; name: string; role: string
  is_super_admin: boolean; created_at: string
}

// ── 매니저 선임 ───────────────────────────────────────────────────────────────
export function ManagerPanel() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/control/managers", { cache: "no-store" })
    if (res.ok) setUsers((await res.json()).users)
    // 관제센터 안에 있을 때는 서버가 super_admin 이라 답한 뒤에만 이 패널을 그렸다.
    // 단독 화면이 된 지금은 거절도 받을 수 있으니, "불러오는 중"에 멈춰 있지 않게 알린다.
    else {
      setUsers([])
      setError(res.status === 401 || res.status === 403
        ? "매니저 관리는 총 관리자만 할 수 있습니다."
        : "목록을 불러오지 못했습니다.")
    }
  }, [])
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => { load().catch(() => { if (alive) setUsers([]) }) }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [load])

  async function toggle(u: ManagedUser, manager: boolean) {
    setBusyId(u.id)
    setError(null)
    try {
      const res = await fetch("/api/control/managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: u.id, manager }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "변경하지 못했습니다.")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "변경하지 못했습니다.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-foreground text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-ocean-500" /> 매니저 관리
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          매니저는 관제센터를 볼 수 있습니다. 선임과 해임은 총 관리자만 할 수 있습니다.
        </p>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
        {!users ? (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-semibold">이메일</th>
                  <th className="py-2 pr-3 font-semibold">이름</th>
                  <th className="py-2 pr-3 font-semibold">역할</th>
                  <th className="py-2 font-semibold text-right">동작</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-border/50">
                    <td className="py-2.5 pr-3 text-foreground">{u.email}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{u.name || "—"}</td>
                    <td className="py-2.5 pr-3">
                      {u.is_super_admin ? (
                        <span className="text-xs text-amber-500 font-semibold flex items-center gap-1"><Crown className="w-3 h-3" /> 총 관리자</span>
                      ) : u.role === "admin" ? (
                        <span className="text-xs text-amber-500">관리자</span>
                      ) : u.role === "manager" ? (
                        <span className="text-xs text-ocean-500 font-semibold">매니저</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">일반</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {u.is_super_admin || u.role === "admin" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : u.role === "manager" ? (
                        <button
                          onClick={() => toggle(u, false)}
                          disabled={busyId === u.id}
                          className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-border text-muted-foreground hover:text-red-500 hover:border-red-500/40 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {busyId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />} 해임
                        </button>
                      ) : (
                        <button
                          onClick={() => toggle(u, true)}
                          disabled={busyId === u.id}
                          className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-ocean-500/40 text-ocean-500 hover:bg-ocean-500/10 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {busyId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />} 매니저 선임
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
