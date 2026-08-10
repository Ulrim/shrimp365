"use client"

import { useEffect, useState } from "react"
import { CloudRain, Wind, AlertTriangle, MapPin, Sun, Cloud, CloudDrizzle, CloudLightning } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { useT } from "@/lib/i18n-context"
import type { Dict, Locale } from "@/lib/i18n"

type Day = {
  date: string
  rain_mm: number
  wind_ms: number
  temp_max: number | null
  temp_min: number | null
  code: number | null
  rain_level: "none" | "watch" | "warn" | "danger"
  wind_level: "none" | "watch" | "warn" | "danger"
}
type Warning = { date: string; kind: "rain" | "wind"; level: string; detail: string }
type Weather = { current: { temperature: number | null; wind_ms: number | null; code: number | null }; days: Day[]; warnings: Warning[] }

/** WMO 날씨 코드를 아이콘으로. 세세한 구분보다 "비가 오나" 가 중요하다. */
function icon(code: number | null) {
  if (code === null) return <Cloud className="w-4 h-4" />
  if (code >= 95) return <CloudLightning className="w-4 h-4 text-amber-500" />
  if (code >= 80) return <CloudRain className="w-4 h-4 text-ocean-500" />
  if (code >= 61) return <CloudRain className="w-4 h-4 text-ocean-500" />
  if (code >= 51) return <CloudDrizzle className="w-4 h-4 text-ocean-500" />
  if (code >= 2) return <Cloud className="w-4 h-4 text-muted-foreground" />
  return <Sun className="w-4 h-4 text-amber-500" />
}

function dayLabel(t: Dict, locale: Locale, date: string, index: number): string {
  if (index === 0) return t.weather.today
  if (index === 1) return t.weather.tomorrow
  const d = new Date(date + "T00:00:00")
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)
  return `${d.getMonth() + 1}/${d.getDate()}(${weekday})`
}

/** 양식장 좌표로 날씨를 보여 주고, 대비가 필요한 날을 짚는다.
 *
 *  폭우는 표층 염도를 떨어뜨리고, 흐린 날이 이어지면 새벽 용존산소가 낮아진다.
 *  둘 다 미리 알면 환수·산소 공급을 준비할 수 있다.
 */
export function WeatherCard({
  latitude, longitude, farmName,
}: {
  latitude: number | null
  longitude: number | null
  farmName?: string
}) {
  const { t, locale } = useT()
  const [data, setData] = useState<Weather | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (latitude === null || longitude === null) return
    let alive = true
    fetch(`/api/weather?lat=${latitude}&lon=${longitude}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (alive) { setData(d); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [latitude, longitude])

  // 좌표가 없으면 안내만. 이 카드 때문에 화면이 비어 보이면 안 된다.
  if (latitude === null || longitude === null) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <CloudRain className="w-4 h-4 text-ocean-500" /> {t.weather.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t.weather.noCoordsMsg}
          </p>
          <Link
            href="/farms"
            className="inline-flex items-center gap-1.5 mt-3 text-sm text-ocean-500 hover:underline"
          >
            <MapPin className="w-3.5 h-3.5" /> {t.weather.setCoordsLink}
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (failed || !data) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <CloudRain className="w-4 h-4 text-ocean-500" /> {t.weather.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {failed ? t.weather.fetchFailed : t.weather.loading}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <CloudRain className="w-4 h-4 text-ocean-500" /> {t.weather.title}
          </CardTitle>
          {farmName && <span className="text-xs text-muted-foreground truncate">{farmName}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 대비가 필요한 날 — 가장 먼저 보여야 한다 */}
        {data.warnings.length > 0 && (
          <div className="space-y-1.5">
            {data.warnings.slice(0, 3).map((w, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs leading-relaxed ${
                  w.level === "danger"
                    ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
                }`}
              >
                {w.kind === "rain"
                  ? <CloudRain className="w-4 h-4 shrink-0 mt-0.5" />
                  : <Wind className="w-4 h-4 shrink-0 mt-0.5" />}
                <span><b>{w.date.slice(5).replace("-", "/")}</b> {w.detail}</span>
              </div>
            ))}
          </div>
        )}

        {/* 현재 */}
        <div className="flex items-center gap-3 pb-1">
          {icon(data.current.code)}
          <span className="text-2xl font-bold text-foreground tabular-nums">
            {data.current.temperature !== null ? `${data.current.temperature.toFixed(1)}°` : "—"}
          </span>
          {data.current.wind_ms !== null && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Wind className="w-3 h-3" /> {data.current.wind_ms.toFixed(1)}m/s
            </span>
          )}
        </div>

        {/* 며칠치 */}
        <div className="grid grid-cols-4 gap-1.5">
          {data.days.slice(0, 4).map((d, i) => (
            <div
              key={d.date}
              className={`rounded-lg border p-2 text-center ${
                d.rain_level === "danger" || d.wind_level === "danger"
                  ? "border-red-500/40 bg-red-500/5"
                  : d.rain_level === "warn" || d.wind_level === "warn"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-border"
              }`}
            >
              <p className="text-[10px] text-muted-foreground mb-1">{dayLabel(t, locale, d.date, i)}</p>
              <div className="flex justify-center mb-1">{icon(d.code)}</div>
              <p className="text-[11px] text-foreground tabular-nums">
                {d.temp_max !== null ? Math.round(d.temp_max) : "—"}°
                <span className="text-muted-foreground">/{d.temp_min !== null ? Math.round(d.temp_min) : "—"}°</span>
              </p>
              {d.rain_mm > 0 && (
                <p className="text-[10px] text-ocean-500 tabular-nums mt-0.5">{d.rain_mm}mm</p>
              )}
            </div>
          ))}
        </div>

        {data.warnings.length === 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 opacity-50" />
            {t.weather.noWarnings}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
