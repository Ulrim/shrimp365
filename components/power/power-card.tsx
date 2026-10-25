"use client"

// 전력 카드 — 고른 수조·베드에 물린 분전반 회로의 지금 전력·오늘 사용량·차단기 온도.
//
// 양식장(Shrimp365)·스마트팜(Farm365) 대시보드가 같은 카드를 쓴다. 값은 장비가 올린
// power_readings(최근 24시간)를 카드가 직접 읽는다 — 수질 그래프 로더와 묶지 않아야
// power_readings.sql 을 아직 안 돌린 DB 에서도 다른 카드가 그대로 뜬다.
// 24시간 동안 한 줄도 없으면 카드 자체를 그리지 않는다(분전반 계측을 안 단 곳은 화면이 그대로다).
//
// 켜고 끄기·예약(2026-10-25 결정) — 장비가 제어 상태를 올린 회로에만 단추가 나온다(circuit-control.tsx).
// 명령은 장비가 15초마다 가져가 실행한다. power_remote.sql 전이거나 장비가 옛 판이면 단추 없이 그린다.
import { useEffect, useRef, useState } from "react"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import {
  Zap, Wind, RefreshCw, Droplets, Flame, Fan, Snowflake, Lightbulb, Sparkles, FlaskConical, Fish, Plug,
  AlertTriangle, type LucideIcon,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n-context"
import { powerDict } from "@/lib/i18n/power"
import { powerControlDict } from "@/lib/i18n/power-control"
import { POWER_TYPES, breakerLevel, summarizePower, type PowerType } from "@/lib/power"
import { getPowerReadings, getPowerControl } from "@/lib/db"
import { CONTROL_STALE_MS, type ControlStateRow } from "@/lib/power-remote"
import { CircuitControlBar } from "@/components/power/circuit-control"
import { agoLabel } from "@/components/agri/dashboard/time-ago"
import type { PowerReading } from "@/types"

const ICON: Record<PowerType, LucideIcon> = {
  main: Zap, aerator: Wind, circulation_pump: RefreshCw, irrigation_pump: Droplets, heater: Flame,
  ventilation: Fan, cooling: Snowflake, lighting: Lightbulb, uv: Sparkles, dosing: FlaskConical,
  feeder: Fish, other: Plug,
}
/** 이보다 오래되면 끊긴 것으로 본다 — 환경 카드·장비 stale_minutes 와 같다. */
const STALE_MIN = 30

const asType = (s: string): PowerType => (POWER_TYPES as readonly string[]).includes(s) ? s as PowerType : "other"
const fmtW = (w: number) => w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`
const fmtKwh = (k: number) => `${k < 10 ? k.toFixed(2) : k.toFixed(1)} kWh`

/**
 * tankId — 고른 수조·베드. mock 이면(데모 계정) 읽지 않는다.
 * now — 대시보드가 마지막으로 다시 불러온 시각. 바뀔 때마다 다시 읽고, 끊김 판정에도 쓴다
 * (렌더 중에 시계를 읽지 않으려고 받는다 — react-hooks/purity).
 */
export function PowerCard({ tankId, tankName, now, mock = false }: {
  tankId: string
  tankName: string
  now: Date | null
  mock?: boolean
}) {
  const { t, locale } = useT()
  const pd = powerDict[locale]
  const pcd = powerControlDict[locale]
  // 어느 수조의 값인지 같이 둔다 — 수조를 바꾼 직후 이전 수조 값이 잠깐 보이지 않게.
  const [data, setData] = useState<{ tankId: string; rows: PowerReading[]; control: ControlStateRow[]; at: number } | null>(null)
  // 명령이 실행되면 올린다 — 제어 상태와 값을 바로 다시 읽는다.
  const [bump, setBump] = useState(0)

  useEffect(() => {
    if (mock || !tankId) return
    let alive = true
    Promise.all([getPowerReadings(tankId, 24), getPowerControl(tankId)]).then(([rows, control]) => {
      if (alive) setData({ tankId, rows, control, at: Date.now() })
    })
    return () => { alive = false }
  }, [tankId, now, mock, bump])

  // 실행 직후 차단기 상태가 값에 실리기까지 한 측정이 걸린다 — 20초 뒤 한 번 더 읽는다.
  const later = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (later.current) clearTimeout(later.current) }, [])
  const changed = () => {
    setBump(b => b + 1)
    if (later.current) clearTimeout(later.current)
    later.current = setTimeout(() => setBump(b => b + 1), 20_000)
  }

  const rows = data && data.tankId === tankId ? data.rows : []
  // 회로 이름(대문자) → 그 회로를 제어하는 장비의 상태. 장비가 여럿이면 가장 최근 것.
  const controls = new Map<string, { deviceId: string; online: boolean; clockOk: boolean; ctl: ControlStateRow["control"]["circuits"][string] }>()
  if (data && data.tankId === tankId) {
    for (const st of [...data.control].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
      const online = data.at - new Date(st.updated_at).getTime() < CONTROL_STALE_MS
      for (const [cid, ctl] of Object.entries(st.control?.circuits ?? {})) {
        controls.set(cid.toUpperCase(), { deviceId: st.device_id, online, clockOk: st.control.clock_ok !== false, ctl })
      }
    }
  }
  if (mock || rows.length === 0) return null
  const s = summarizePower(rows)
  if (s.circuits.length === 0) return null

  const stale = now != null && s.newest != null && now.getTime() - s.newest > STALE_MIN * 60_000
  // 장비 전체가 자정 전에 끊겼으면 마지막 "오늘 사용량" 은 어제 것이다.
  const sameDay = now == null || s.newest == null || new Date(s.newest).toDateString() === now.toDateString()
  const todayKwh = sameDay ? s.todayKwh : null
  const hot = s.circuits
    .filter(c => !c.lost)
    .map(c => ({ c, level: breakerLevel(c.device_temp) }))
    .filter(h => h.level !== "")
    .sort((a, b) => (b.c.device_temp ?? 0) - (a.c.device_temp ?? 0))
  const title = pd.titleFor.replace("{{name}}", tankName)
  const label = (type: string) => pd.type[asType(type)]

  return (
    <section aria-label={title}>
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <CardTitle className="text-foreground text-sm flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-500" aria-hidden="true" />
              {title}
            </CardTitle>
            {s.newest != null && (
              <p className={`text-xs tabular-nums ${stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {pd.updated.replace("{{ago}}", agoLabel(t.time, new Date(s.newest).toISOString()))}
              </p>
            )}
          </div>
          {stale && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" role="status">{pd.stale}</p>}
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {hot.length > 0 && (
            <div role="alert" className={`rounded-xl border p-3 flex gap-2 ${
              hot[0].level === "crit" ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"
            }`}>
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${hot[0].level === "crit" ? "text-red-500" : "text-amber-500"}`} aria-hidden="true" />
              <div className="min-w-0 text-sm">
                {hot.map(({ c, level }) => (
                  <p key={c.circuit_id} className="font-medium text-foreground">
                    {(level === "crit" ? pd.hotCrit : pd.hotWarn)
                      .replace("{{name}}", `${label(c.circuit_type)} (${c.circuit_id})`)
                      .replace("{{t}}", (c.device_temp as number).toFixed(0))}
                  </p>
                ))}
                <p className="text-xs text-muted-foreground mt-0.5">{pd.hotDo}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-3 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{s.partial ? pd.nowPartial : pd.now}</p>
              <p className="text-xl font-bold text-foreground tabular-nums mt-1">{s.totalW != null ? fmtW(s.totalW) : "—"}</p>
              {s.series.length >= 2 && (
                <div aria-hidden="true">
                  <ResponsiveContainer width="100%" height={32}>
                    <LineChart data={s.series.map((p, i) => ({ i, v: p.w }))}>
                      <Line type="monotone" dataKey="v" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-border p-3 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{pd.today}</p>
              <p className="text-xl font-bold text-foreground tabular-nums mt-1">{todayKwh != null ? fmtKwh(todayKwh) : "—"}</p>
            </div>
          </div>

          <ul className="divide-y divide-border rounded-xl border border-border">
            {s.circuits.map(c => {
              const type = asType(c.circuit_type)
              const Icon = ICON[type]
              const lvl = c.lost ? "" : breakerLevel(c.device_temp)
              const state = c.lost ? null : c.state
              const st = state === 1 ? pd.on : state === 0 ? pd.off : pd.lost
              const cc = controls.get(c.circuit_id.toUpperCase())
              return (
                <li key={c.circuit_id}>
                <div className={`flex items-center gap-2 px-3 py-2 text-sm min-w-0 ${c.lost ? "opacity-60" : ""}`}>
                  <Icon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate">{label(type)}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.circuit_id}</p>
                  </div>
                  <span className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${
                    state === 1 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : state === 0 ? "bg-muted text-muted-foreground"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  }`}>{st}</span>
                  <div className="text-right tabular-nums shrink-0 w-[4.5rem]" title={pd.colPower}>
                    <p className="text-foreground">{c.power_w != null ? fmtW(c.power_w) : "—"}</p>
                    <p className="text-xs text-muted-foreground" title={pd.colToday}>
                      {c.energy_today_kwh != null ? fmtKwh(c.energy_today_kwh) : ""}
                    </p>
                  </div>
                  <span title={pd.colTemp} className={`text-xs tabular-nums shrink-0 w-10 text-right ${
                    lvl === "crit" ? "text-red-600 dark:text-red-400 font-semibold"
                    : lvl === "warn" ? "text-amber-600 dark:text-amber-400 font-semibold"
                    : "text-muted-foreground"
                  }`}>
                    {c.device_temp != null ? `${c.device_temp.toFixed(0)}℃` : ""}
                  </span>
                </div>
                {cc && cc.ctl.can && (
                  <>
                    {!cc.online && <p className="px-3 pb-1 text-xs text-amber-600 dark:text-amber-400">{pcd.offline}</p>}
                    <CircuitControlBar tankId={tankId} deviceId={cc.deviceId} circuitId={c.circuit_id.toUpperCase()}
                      ctl={cc.ctl} online={cc.online} clockOk={cc.clockOk} onChanged={changed} />
                  </>
                )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
