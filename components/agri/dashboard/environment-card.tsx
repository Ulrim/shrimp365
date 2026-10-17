"use client"

// 환경·기상 카드 — 고른 베드의 지그비 온습도·토양 센서와 기상센서 값(최근 24시간).
//
// 스마트팜 장비가 수질 값과 같은 줄로 올린 칸(lib/env-params.ts)을 읽는다. 받은 칸만
// 보인다 — 지온 센서가 없는 농장에 빈 칸을 늘 두지 않는다. 24시간 동안 하나도 없으면
// 카드 자체를 그리지 않는다(환경 센서를 안 단 대부분의 베드는 화면이 그대로다).
//
// 판정 색은 없다. 작물·생육 단계마다 적정값이 달라 값과 추세만 보여 준다. 풍향·돌풍은
// 풍속 칸에, 강우강도는 오늘 강수 칸에 접어 칸 수를 줄였다.
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT, useAgriT } from "@/lib/i18n-context"
import { ENV_PARAMS, compassIndex, type EnvParam, type EnvParamKey } from "@/lib/env-params"
import { agoLabel } from "@/components/agri/dashboard/time-ago"
import type { WaterQualityReading } from "@/types"

/** 칸으로 따로 띄우지 않고 다른 칸의 보조 줄로 접는 항목. */
const FOLDED: ReadonlySet<EnvParamKey> = new Set(["wind_gust", "wind_dir", "rain_rate"])
/** 칸 수 → 열 수(정적 클래스여야 Tailwind 가 잡는다). 휴대폰은 늘 2열. */
const COLS = [
  "", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4", "sm:grid-cols-3",
  "sm:grid-cols-3", "sm:grid-cols-4", "sm:grid-cols-4", "sm:grid-cols-3",
] as const
/** 이보다 오래되면 끊긴 것으로 본다 — 장비의 stale_minutes 기본값과 같다. */
const STALE_MIN = 30

interface Latest { value: number; at: string }

function latestOf(readings: WaterQualityReading[], key: EnvParamKey): Latest | null {
  for (let i = readings.length - 1; i >= 0; i--) {
    const v = readings[i][key]
    if (typeof v === "number") return { value: v, at: readings[i].recorded_at }
  }
  return null
}

/** now — 대시보드가 마지막으로 다시 불러온 시각. 렌더 중에 시계를 읽지 않으려고 받는다(react-hooks/purity). */
export function EnvironmentCard({ readings, tankName, now }: {
  readings: WaterQualityReading[]
  tankName: string
  now: Date | null
}) {
  const { t } = useT()
  const { environment: ed } = useAgriT()

  const latest = new Map<EnvParamKey, Latest>()
  for (const p of ENV_PARAMS) {
    const l = latestOf(readings, p.key)
    if (l) latest.set(p.key, l)
  }
  if (latest.size === 0) return null

  const newest = Math.max(...Array.from(latest.values(), l => new Date(l.at).getTime()))
  const stale = now != null && now.getTime() - newest > STALE_MIN * 60_000
  // 온습도·토양 → 기상 순(ENV_PARAMS 순서). 칸 수에 맞춰 열 수를 골라 한 줄에 한 칸만
  // 남는 일을 줄인다 — 지그비만 단 농장(3~4칸)과 기상센서까지 단 농장(9칸)이 다 맞게.
  const shown = ENV_PARAMS.filter(p => latest.has(p.key) && !FOLDED.has(p.key))
  const cols = COLS[Math.min(shown.length, COLS.length - 1)]

  const fmt = (p: EnvParam, v: number) => v.toFixed(p.digits)
  const param = (k: EnvParamKey) => ENV_PARAMS.find(p => p.key === k)!

  function sub(p: EnvParam, series: number[]): string {
    if (p.key === "wind_speed") {
      const gust = latest.get("wind_gust")
      const dir = latest.get("wind_dir")
      if (gust || dir) {
        return ed.windSub
          .replace("{{v}}", gust ? fmt(param("wind_gust"), gust.value) : "—")
          .replace("{{dir}}", dir ? ed.compass[compassIndex(dir.value)] : "—")
      }
    }
    if (p.key === "rain_day") {
      const rate = latest.get("rain_rate")
      return rate && rate.value > 0 ? ed.rainNow.replace("{{v}}", fmt(param("rain_rate"), rate.value)) : ed.noRain
    }
    const lo = Math.min(...series), hi = Math.max(...series)
    if (series.length < 2 || fmt(p, lo) === fmt(p, hi)) return ""
    return ed.range24h
      .replace("{{min}}", fmt(p, lo))
      .replace("{{max}}", fmt(p, hi))
  }

  return (
    <section aria-label={ed.title.replace("{{name}}", tankName)}>
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <CardTitle className="text-foreground text-sm">{ed.title.replace("{{name}}", tankName)}</CardTitle>
            <p className={`text-xs tabular-nums ${stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
              {ed.updated.replace("{{ago}}", agoLabel(t.time, new Date(newest).toISOString()))}
            </p>
          </div>
          {stale && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" role="status">{ed.stale}</p>}
        </CardHeader>
        <CardContent className="p-4 pt-0">
              <div className={`grid grid-cols-2 ${cols} gap-3`}>
                {shown.map(p => {
                  const l = latest.get(p.key)!
                  const series = readings
                    .map(r => r[p.key])
                    .filter((v): v is number => typeof v === "number")
                  const Icon = p.icon
                  const subText = sub(p, series)
                  return (
                    <div key={p.key} className="rounded-xl border border-border p-3 min-w-0">
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate"
                        title={p.key === "air_temp" ? ed.airTempHint : undefined}>
                        <span className="inline-flex shrink-0" style={{ color: p.color }} aria-hidden="true">
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        {ed.param[p.key]}
                      </p>
                      <p className="text-xl font-bold text-foreground tabular-nums mt-1">
                        {fmt(p, l.value)}
                        {p.unit && <span className="text-xs font-medium text-muted-foreground ml-1">{p.unit}</span>}
                      </p>
                      {subText && <p className="text-xs text-muted-foreground tabular-nums truncate">{subText}</p>}
                      {series.length >= 2 && (
                        <div aria-hidden="true">
                          <ResponsiveContainer width="100%" height={32}>
                            <LineChart data={series.map((v, i) => ({ i, v }))}>
                              <Line type="monotone" dataKey="v" stroke={p.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
        </CardContent>
      </Card>
    </section>
  )
}
