"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Radar, Building2, Layers, Cpu, AlertTriangle, WifiOff,
  ShieldCheck, UserPlus, UserMinus, Loader2, Crown,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/lib/auth-context"
import { useAutoRefresh, sinceLabel } from "@/lib/use-auto-refresh"
import { ControlMap, type ControlFarm } from "@/components/control/control-map"
import { formatDateTime } from "@/lib/utils"

// ── 응답 형태 ────────────────────────────────────────────────────────────────
type Overview = {
  role: "super_admin" | "manager"
  stats: {
    farms: number
    tanks: number
    tank_status: { active: number; warning: number; danger: number; inactive: number }
    devices: number
    devices_online: number
    open_alerts: number
  }
  farms: ControlFarm[]
  offline_devices: { id: string; name: string; serial: string | null; version: string | null; last_seen_at: string | null }[]
  alerts: { id: string; type: string; parameter: string | null; value: number | null; message: string; created_at: string; tank_name: string; farm_name: string }[]
}
type ManagedUser = {
  id: string; email: string; name: string; role: string
  is_super_admin: boolean; created_at: string
}

function StatTile({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "danger" | "warn"
}) {
  return (
    <Card className={`bg-card border ${tone === "danger" ? "border-red-500/40" : tone === "warn" ? "border-amber-500/40" : "border-border"}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">{icon}{label}</div>
        <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function ControlCenterPage() {
  const { loading: authLoading } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch("/api/control/overview", { cache: "no-store" })
    if (res.status === 401 || res.status === 403) {
      setDenied(true)
      setLoading(false)
      return
    }
    if (!res.ok) throw new Error()
    setData(await res.json())
    setDenied(false)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authLoading) return
    let alive = true
    // setState 가 effect 본문에서 동기로 불리지 않도록 한 틱 미룬다.
    const t = setTimeout(() => { load().catch(() => { if (alive) setLoading(false) }) }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [authLoading, load])

  // 관제 화면은 계속 켜 두고 보는 화면이다. 측정 주기에 맞춰 1분마다 따라간다.
  const { lastRefreshed } = useAutoRefresh(load, 60, !denied && !loading)

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label="관제센터 불러오는 중">
        <div className="w-8 h-8 border-4 border-[#1E40AF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // 권한 판별은 서버가 한다. 이 화면은 결과를 보여 줄 뿐이다.
  if (denied || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4 text-center" role="alert">
        <ShieldCheck className="w-10 h-10 text-muted-foreground" />
        <p className="text-foreground font-semibold text-lg">관제센터 접근 권한이 없습니다</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          관제센터는 관리자와 매니저만 볼 수 있습니다. 필요하시면 총 관리자에게 선임을 요청하세요.
        </p>
      </div>
    )
  }

  const s = data.stats

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Radar className="w-5 h-5 text-ocean-500" /> 관제센터
            {data.role === "super_admin" && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                <Crown className="w-3 h-3" /> 총 관리자
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">플랫폼 전체 농장·수조·기기 현황</p>
        </div>
        {lastRefreshed && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            1분마다 자동갱신 · 마지막 {sinceLabel(lastRefreshed)}
          </p>
        )}
      </div>

      {/* 요약 — 급한 것부터 색으로 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Building2 className="w-4 h-4" />} label="농장" value={s.farms} sub={`수조 ${s.tanks}개`} />
        <StatTile
          icon={<Layers className="w-4 h-4" />} label="수조 상태"
          value={<span>
            <span className="text-emerald-500">{s.tank_status.active}</span>
            <span className="text-muted-foreground text-base font-medium"> / </span>
            <span className="text-amber-500">{s.tank_status.warning}</span>
            <span className="text-muted-foreground text-base font-medium"> / </span>
            <span className="text-red-500">{s.tank_status.danger}</span>
          </span>}
          sub="정상 / 주의 / 위험"
          tone={s.tank_status.danger > 0 ? "danger" : s.tank_status.warning > 0 ? "warn" : undefined}
        />
        <StatTile
          icon={<Cpu className="w-4 h-4" />} label="기기"
          value={`${s.devices_online}/${s.devices}`} sub="온라인 / 활성"
          tone={s.devices - s.devices_online > 0 ? "warn" : undefined}
        />
        <StatTile
          icon={<AlertTriangle className="w-4 h-4" />} label="미해결 알림"
          value={s.open_alerts} sub={s.open_alerts ? "확인이 필요합니다" : "없음"}
          tone={s.open_alerts > 0 ? "danger" : undefined}
        />
      </div>

      {/* 지도 — 관제의 중심 */}
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-3">
          <ControlMap farms={data.farms} height={420} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* 끊긴 기기 — 값이 안 오는 농장은 사고를 볼 수 없다 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-base flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-red-500" /> 끊긴 기기
              <span className="text-xs text-muted-foreground font-normal">({data.offline_devices.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.offline_devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">모든 기기가 정상 수신 중입니다.</p>
            ) : data.offline_devices.map(d => (
              <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg border border-red-500/25 bg-red-500/5">
                <div className="min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{d.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">
                    {d.serial ?? "시리얼 없음"}{d.version ? ` · v${d.version}` : ""}
                  </p>
                </div>
                <span className="text-xs text-red-500 shrink-0 ml-2">
                  {d.last_seen_at ? `마지막 ${formatDateTime(d.last_seen_at)}` : "수신 기록 없음"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 알림 스트림 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> 미해결 알림
              <span className="text-xs text-muted-foreground font-normal">({data.alerts.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[340px] overflow-y-auto">
            {data.alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">미해결 알림이 없습니다.</p>
            ) : data.alerts.map(a => (
              <div key={a.id} className={`p-2.5 rounded-lg border text-sm ${
                a.type === "danger" ? "border-red-500/25 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5"
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-foreground font-medium truncate">{a.message}</p>
                  <span className="text-[11px] text-muted-foreground shrink-0">{formatDateTime(a.created_at)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{a.farm_name} · {a.tank_name}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 매니저 관리 — 총 관리자에게만 */}
      {data.role === "super_admin" && <ManagerPanel />}
    </div>
  )
}

// ── 매니저 선임 ───────────────────────────────────────────────────────────────
function ManagerPanel() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch("/api/control/managers", { cache: "no-store" })
    if (res.ok) setUsers((await res.json()).users)
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
