"use client"

// 환경·기상 카드 — 고른 베드의 지그비 온습도·토양 센서와 기상센서 값(최근 24시간).
//
// 스마트팜 장비가 수질 값과 같은 줄로 올린 칸(lib/env-params.ts)을 읽는다. 받은 칸만
// 보인다 — 지온 센서가 없는 농장에 빈 칸을 늘 두지 않는다. 24시간 동안 하나도 없으면
// 카드 자체를 그리지 않는다(환경 센서를 안 단 대부분의 베드는 화면이 그대로다).
//
// 판정 색은 없다. 작물·생육 단계마다 적정값이 달라 값과 추세만 보여 준다. 풍향·돌풍은
// 풍속 칸에, 강우강도는 오늘 강수 칸에 접어 칸 수를 줄였다.
//
// 같은 칸에 센서가 2대 이상이면 칸에는 평균을 두고 "평균 · N대" 를 붙인다. 칸을 누르면
// 센서마다 한 줄씩 24시간 그래프와 마지막 값을 펼친다(env_sensors — 장비 화면의 같은 칸을
// 눌렀을 때와 같다). 센서 색은 이름순 자리로 정해 목록의 점과 그래프 선이 같은 색이다.
import { useEffect, useState } from "react"
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT, useAgriT } from "@/lib/i18n-context"
import { Droplet } from "lucide-react"
import { ENV_PARAMS, compassIndex, dewPoint, type EnvParam, type EnvParamKey, type EnvEach } from "@/lib/env-params"
import { getEnvSensorSeries } from "@/lib/db"
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
export function EnvironmentCard({ readings, tankId, tankName, now, mock = false }: {
  readings: WaterQualityReading[]
  tankId: string
  tankName: string
  now: Date | null
  /** 데모 계정 — 센서별 값을 읽지 않는다. */
  mock?: boolean
}) {
  const { t } = useT()
  const { environment: ed } = useAgriT()
  // 어느 베드의 값인지 같이 둔다 — 베드를 바꾼 직후 이전 베드의 센서 목록이 보이지 않게.
  const [eachData, setEachData] = useState<{ tankId: string; rows: { each: EnvEach; recorded_at: string }[] } | null>(null)
  const [open, setOpen] = useState<{ tankId: string; key: EnvParamKey } | null>(null)

  useEffect(() => {
    if (mock || !tankId) return
    let alive = true
    getEnvSensorSeries(tankId).then(rows => { if (alive) setEachData({ tankId, rows }) })
    return () => { alive = false }
  }, [tankId, now, mock])

  const eachRows = eachData && eachData.tankId === tankId ? eachData.rows : []
  const lastEach = eachRows.length ? eachRows[eachRows.length - 1] : null
  const each = lastEach ? lastEach.each : {}
  const eachOf = (k: EnvParamKey) => {
    const list = (each as Record<string, { id: string; v: number }[] | undefined>)[k]
    return list && list.length >= 2 ? list : null
  }
  const openKey = open && open.tankId === tankId ? open.key : null

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
  // 풍향·돌풍·강우강도만 왔으면(접어서 보이는 칸뿐) 그릴 칸이 없다 — 빈 카드를 띄우지 않는다.
  if (shown.length === 0) return null
  // 이슬점 — 기온·습도가 같은 줄에 있을 때 계산한다(DB 칸 없음). 2m 기온이 있으면 그것으로,
  // 없으면 기온 칸(초관부 온도)으로. 같은 줄의 값끼리만 짝지어 24시간 추세도 그린다.
  const dewSeries = readings
    .map(r => (typeof r.air_temp === "number" && typeof r.humidity === "number") ? dewPoint(r.air_temp, r.humidity) : null)
    .filter((v): v is number => v !== null)
  const airNow = latest.get("air_temp")
  const dewNow = dewSeries.length ? dewSeries[dewSeries.length - 1] : null
  const dewGap = dewNow !== null && airNow ? airNow.value - dewNow : null
  const cols = COLS[Math.min(shown.length + (dewNow !== null ? 1 : 0), COLS.length - 1)]

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
                  const many = eachOf(p.key)
                  // 누르면 펼친다 — 센서가 여럿이면 센서별, 한 대면 24시간 추세 그래프(강수·풍속·토양수분 등).
                  const tappable = !!many || series.length >= 2
                  const Tile = tappable ? "button" : "div"
                  return (
                    <Tile key={p.key}
                      {...(tappable ? {
                        type: "button" as const,
                        "aria-expanded": openKey === p.key,
                        onClick: () => setOpen(openKey === p.key ? null : { tankId, key: p.key }),
                      } : {})}
                      className={`rounded-xl border p-3 min-w-0 text-left ${
                        openKey === p.key ? "border-primary ring-1 ring-primary/40" : "border-border"
                      } ${tappable ? "hover:bg-muted/50 transition-colors cursor-pointer" : ""}`}>
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
                      {many && (
                        <p className="text-xs font-medium text-primary tabular-nums truncate">
                          {ed.avgOf.replace("{{n}}", String(many.length))}
                        </p>
                      )}
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
                    </Tile>
                  )
                })}
                {dewNow !== null && (
                  <div className={`rounded-xl border p-3 min-w-0 ${dewGap !== null && dewGap < 2 ? "border-sky-500/50 bg-sky-500/5" : "border-border"}`}>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                      <span className="inline-flex shrink-0 text-sky-500" aria-hidden="true"><Droplet className="w-3.5 h-3.5" /></span>
                      {ed.dewPoint}
                    </p>
                    <p className="text-xl font-bold text-foreground tabular-nums mt-1">
                      {dewNow.toFixed(1)}<span className="text-xs font-medium text-muted-foreground ml-1">°C</span>
                    </p>
                    {dewGap !== null && (
                      <p className={`text-xs tabular-nums truncate ${dewGap < 2 ? "text-sky-700 dark:text-sky-400 font-medium" : "text-muted-foreground"}`}>
                        {(dewGap < 2 ? ed.dewNear : ed.dewGap).replace("{{v}}", Math.max(0, dewGap).toFixed(1))}
                      </p>
                    )}
                    {dewSeries.length >= 2 && (
                      <div aria-hidden="true">
                        <ResponsiveContainer width="100%" height={32}>
                          <LineChart data={dewSeries.map((v, i) => ({ i, v }))}>
                            <Line type="monotone" dataKey="v" stroke="#0ea5e9" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {openKey && lastEach && eachOf(openKey) ? (
                <EachList param={param(openKey)} label={ed.param[openKey]} rows={eachOf(openKey)!}
                  history={eachRows} at={agoLabel(t.time, lastEach.recorded_at)} ed={ed} onClose={() => setOpen(null)} />
              ) : openKey && (
                <TrendPanel param={param(openKey)} label={ed.param[openKey]} readings={readings} ed={ed}
                  overlay={openKey === "wind_speed" ? { param: param("wind_gust"), label: ed.param.wind_gust }
                    : openKey === "air_temp" ? { param: param("canopy_temp"), label: ed.param.canopy_temp } : null}
                  onClose={() => setOpen(null)} />
              )}
        </CardContent>
      </Card>
    </section>
  )
}

/** 한 칸의 24시간 추세(센서가 한 대일 때) — 강수는 누계라 계단, 풍속은 돌풍을 점선으로 겹친다. */
function TrendPanel({ param, label, readings, overlay, ed, onClose }: {
  param: EnvParam
  label: string
  readings: WaterQualityReading[]
  overlay: { param: EnvParam; label: string } | null
  ed: ReturnType<typeof useAgriT>["environment"]
  onClose: () => void
}) {
  const data = readings
    .filter(r => typeof r[param.key] === "number")
    .map(r => ({
      t: new Date(r.recorded_at).getTime(),
      v: r[param.key] as number,
      ...(overlay && typeof r[overlay.param.key] === "number" ? { o: r[overlay.param.key] as number } : {}),
    }))
  const hasOverlay = !!overlay && data.some(d => "o" in d)
  const hhmm = (ms: number) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  const vals = data.map(d => d.v)
  const fmt = (v: number) => v.toFixed(param.digits)
  return (
    <div className="mt-3 rounded-xl border border-border p-3" role="region" aria-label={ed.trendTitle.replace("{{param}}", label)}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-foreground">{ed.trendTitle.replace("{{param}}", label)}</p>
        <div className="flex items-baseline gap-3">
          {vals.length > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {ed.range24h.replace("{{min}}", fmt(Math.min(...vals))).replace("{{max}}", fmt(Math.max(...vals)))} {param.unit}
            </p>
          )}
          <button type="button" onClick={onClose} className="text-xs text-primary hover:underline">{ed.close}</button>
        </div>
      </div>
      <div className="h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={hhmm}
              tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" minTickGap={40} />
            <YAxis domain={param.key === "rain_day" || param.key === "wind_speed" ? [0, "auto"] : ["auto", "auto"]}
              tick={{ fontSize: 11 }} width={44} stroke="currentColor" className="text-muted-foreground"
              tickFormatter={(v: number) => v.toFixed(param.digits)} />
            <Tooltip labelFormatter={v => hhmm(Number(v))}
              formatter={(v, name) => [`${Number(v).toFixed(param.digits)} ${param.unit}`, name === "o" && overlay ? overlay.label : label]} />
            <Line type={param.key === "rain_day" ? "stepAfter" : "monotone"} dataKey="v" stroke={param.color}
              strokeWidth={2} dot={false} isAnimationActive={false} />
            {hasOverlay && (
              <Line type="monotone" dataKey="o" stroke={overlay!.param.color} strokeWidth={1.5} strokeDasharray="4 3"
                dot={false} isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasOverlay && (
        <p className="text-xs text-muted-foreground mt-1">{ed.overlayNote.replace("{{name}}", overlay!.label)}</p>
      )}
    </div>
  )
}

/** 센서 색 — 밝은·어두운 화면 모두에서 읽히는 진한 색. 이름순 자리로 고른다(장비 화면과 같은 규칙). */
const SENSOR_COLORS = ["#0284c7", "#db2777", "#65a30d", "#d97706", "#9333ea", "#0d9488", "#ea580c", "#dc2626",
  "#2563eb", "#c026d3", "#16a34a", "#ca8a04"]

/** 펼친 센서별 그래프와 목록 — 이름순. 가장 높은·낮은 센서에 표시를 붙여 튀는 센서를 바로 찾게. */
function EachList({ param, label, rows, history, at, ed, onClose }: {
  param: EnvParam
  label: string
  rows: { id: string; v: number }[]
  history: { each: EnvEach; recorded_at: string }[]
  at: string
  ed: ReturnType<typeof useAgriT>["environment"]
  onClose: () => void
}) {
  const key = param.key as keyof EnvEach
  // 그래프에는 지금은 끊겼어도 24시간 안에 값을 보낸 센서까지 그린다 — 언제 끊겼는지 보이게.
  const ids = Array.from(new Set([...rows.map(r => r.id), ...history.flatMap(h => (h.each[key] ?? []).map(r => r.id))])).sort()
  const color = (id: string) => SENSOR_COLORS[ids.indexOf(id) % SENSOR_COLORS.length]
  const data = history
    .filter(h => h.each[key]?.length)
    .map(h => ({ t: new Date(h.recorded_at).getTime(), ...Object.fromEntries(h.each[key]!.map(r => [r.id, r.v])) }))
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  // 24시간 안에 값을 보냈지만 마지막 수신에는 없는 센서 — 평균에서 빠진 센서를 찾게.
  const lost = ids.filter(id => !rows.some(r => r.id === id))
  const hi = Math.max(...rows.map(r => r.v)), lo = Math.min(...rows.map(r => r.v))
  const spread = hi !== lo
  const fmt = (v: number) => v.toFixed(param.digits)
  const hhmm = (ms: number) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  return (
    <div className="mt-3 rounded-xl border border-border p-3" role="region"
      aria-label={ed.eachTitle.replace("{{param}}", label)}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-foreground">{ed.eachTitle.replace("{{param}}", label)}</p>
        <div className="flex items-baseline gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">{ed.eachAt.replace("{{ago}}", at)}</p>
          <button type="button" onClick={onClose} className="text-xs text-primary hover:underline">{ed.close}</button>
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-3">
        {data.length >= 2 && (
          <div className="md:flex-1 min-w-0 h-48" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={hhmm}
                  tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" minTickGap={40} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={44} stroke="currentColor"
                  className="text-muted-foreground" tickFormatter={(v: number) => v.toFixed(param.digits)} />
                <Tooltip labelFormatter={v => hhmm(Number(v))}
                  formatter={(v, name) => [`${Number(v).toFixed(param.digits)} ${param.unit}`, String(name)]} />
                {ids.map(id => (
                  <Line key={id} type="monotone" dataKey={id} stroke={color(id)} strokeWidth={1.75}
                    dot={false} connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <ul className="divide-y divide-border md:w-56 shrink-0">
          {sorted.map(r => (
            <li key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color(r.id) }} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-foreground">{r.id}</span>
              {spread && r.v === hi && <span className="text-xs text-orange-600 dark:text-orange-400">{ed.highest}</span>}
              {spread && r.v === lo && <span className="text-xs text-sky-600 dark:text-sky-400">{ed.lowest}</span>}
              <span className="tabular-nums font-semibold text-foreground w-20 text-right">
                {fmt(r.v)}{param.unit && <span className="text-xs font-medium text-muted-foreground ml-1">{param.unit}</span>}
              </span>
            </li>
          ))}
          {lost.map(id => (
            <li key={id} className="flex items-center gap-2 py-1.5 text-sm opacity-60">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color(id) }} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-foreground">{id}</span>
              <span className="text-xs text-muted-foreground">{ed.lost}</span>
              <span className="tabular-nums text-muted-foreground w-20 text-right">—</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
