"use client"

// 관수 카드 — 고른 수조·베드에 물린 지그비 관수 밸브(+ 유량계)의 열림·닫힘, 지금 유량, 오늘 사용량.
//
// 값은 장비가 올린 irrigation_readings(최근 24시간)를 카드가 직접 읽는다 — 다른 카드 로더와 묶지 않아야
// irrigation_readings.sql 을 아직 안 돌린 DB 에서도 다른 카드가 그대로 뜬다. 24시간 동안 한 줄도 없으면
// 카드를 그리지 않는다. 켤 때만 흐르는 라인이라 유량 0 은 경보가 아니다(lib/irrigation.ts).
import { useEffect, useState } from "react"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Droplets } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n-context"
import { irrigationDict } from "@/lib/i18n/irrigation"
import { getIrrigationReadings } from "@/lib/db"
import { summarizeIrrigation, type IrrigationReading } from "@/lib/irrigation"
import { agoLabel } from "@/components/agri/dashboard/time-ago"

const fmtL = (l: number) => l >= 1000 ? `${(l / 1000).toFixed(2)} m³` : `${Math.round(l)} L`
const fmtLpm = (v: number) => `${v.toFixed(1)} L/min`

export function IrrigationCard({ tankId, tankName, now, mock = false }: {
  tankId: string
  tankName: string
  now: Date | null
  mock?: boolean
}) {
  const { t, locale } = useT()
  const d = irrigationDict[locale]
  const [data, setData] = useState<{ tankId: string; rows: IrrigationReading[] } | null>(null)

  useEffect(() => {
    if (mock || !tankId) return
    let alive = true
    getIrrigationReadings(tankId, 24).then(rows => { if (alive) setData({ tankId, rows }) })
    return () => { alive = false }
  }, [tankId, now, mock])

  const rows = data && data.tankId === tankId ? data.rows : []
  if (mock || rows.length === 0) return null
  const s = summarizeIrrigation(rows)
  if (s.valves.length === 0) return null

  // 장비 전체가 자정 전에 끊겼으면 마지막 '오늘 사용량' 은 어제 것이다.
  const sameDay = (at: number) => now == null || new Date(at).toDateString() === now.toDateString()
  const todays = s.valves.filter(v => v.volume_today_l != null && sameDay(v.at))
  const total = todays.length ? todays.reduce((a, v) => a + (v.volume_today_l as number), 0) : null
  const live = s.valves.filter(v => !v.lost && v.flow_lpm != null)
  const flowNow = live.length ? live.reduce((a, v) => a + (v.flow_lpm as number), 0) : null
  const title = d.titleFor.replace("{{name}}", tankName)

  return (
    <section aria-label={title}>
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <CardTitle className="text-foreground text-sm flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-sky-500" aria-hidden="true" />
              {title}
            </CardTitle>
            {s.newest != null && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {d.updated.replace("{{ago}}", agoLabel(t.time, new Date(s.newest).toISOString()))}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-3 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{d.today}</p>
              <p className="text-xl font-bold text-foreground tabular-nums mt-1">{total != null ? fmtL(total) : "—"}</p>
            </div>
            <div className="rounded-xl border border-border p-3 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{d.flowNow}</p>
              <p className="text-xl font-bold text-foreground tabular-nums mt-1">{flowNow != null ? fmtLpm(flowNow) : "—"}</p>
              {s.series.length >= 2 && (
                <div aria-hidden="true">
                  <ResponsiveContainer width="100%" height={32}>
                    <LineChart data={s.series.map((p, i) => ({ i, v: p.lpm }))}>
                      <Line type="stepAfter" dataKey="v" stroke="#0ea5e9" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <ul className="divide-y divide-border rounded-xl border border-border">
            {s.valves.map(v => {
              const state = v.lost ? null : v.state
              const st = v.lost ? d.lost : state === 1 ? d.open : state === 0 ? d.closed : ""
              return (
                <li key={v.valve_id} className={`flex items-center gap-2 px-3 py-2 text-sm min-w-0 ${v.lost ? "opacity-60" : ""}`}>
                  <Droplets className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-foreground truncate">{v.valve_id}</p>
                  {st && (
                    <span className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${
                      state === 1 ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                      : v.lost ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-muted text-muted-foreground"
                    }`}>{st}</span>
                  )}
                  <div className="text-right tabular-nums shrink-0 w-[5.5rem]">
                    <p className="text-foreground">{!v.lost && v.flow_lpm != null ? fmtLpm(v.flow_lpm) : "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.volume_today_l != null && sameDay(v.at) ? fmtL(v.volume_today_l) : ""}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{d.note}</p>
        </CardContent>
      </Card>
    </section>
  )
}
