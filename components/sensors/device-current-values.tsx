"use client"

// 센서(기기)별 마지막 수신값 요약 카드.
// 수조에 붙은 각 센서가 마지막으로 보낸 값을 센서 이름과 함께 보여 준다.
// 대시보드처럼 "지금 어느 센서가 얼마인가" 만 빠르게 확인하는 자리에 쓴다.

import { Card, CardContent } from "@/components/ui/card"
import { useT } from "@/lib/i18n-context"
import type { SensorDevice } from "@/types"
import type { Dict } from "@/lib/i18n"

function payloadLabels(t: Dict): Record<string, { label: string; unit?: string }> {
  return {
    temperature:   { label: t.waterQuality.temperature, unit: "°C" },
    ph:            { label: "pH" },
    do_level:      { label: t.waterQualityX.dissolvedOxygen, unit: "ppm" },
    salinity:      { label: t.waterQuality.salinity, unit: "‰" },
    conductivity:  { label: t.waterQualityX.conductivity, unit: "µS/cm" },
    tds:           { label: "TDS", unit: "ppm" },
    do_saturation: { label: t.waterQualityX.doSaturation, unit: "%" },
    orp:           { label: "ORP", unit: "mV" },
    // 유량·차압 — 새우 모드에서도 무해(장비가 안 보내면 안 보임).
    flow_rate:     { label: t.waterQualityX.flowRate, unit: "L/min" },
    diff_pressure: { label: t.waterQualityX.diffPressure, unit: "kPa" },
  }
}

function seenLabel(t: Dict, iso: string | null): string {
  if (!iso) return t.waterQualityX.noValuesYet
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return t.time.justNow
  if (mins < 60) return t.time.minutesAgo.replace("{{n}}", String(mins))
  const h = Math.floor(mins / 60)
  if (h < 24) return t.time.hoursAgo.replace("{{n}}", String(h))
  return t.time.daysAgo.replace("{{n}}", String(Math.floor(h / 24)))
}

export function DeviceCurrentValues({ devices }: { devices: SensorDevice[] }) {
  const { t } = useT()
  const active = devices.filter(d => d.active)
  if (active.length === 0) return null
  const labels = payloadLabels(t)

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-3 font-medium">
          {t.waterQualityX.sensorCurrentN.replace("{{n}}", String(active.length))}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.map(dev => {
            const payload = dev.last_payload ?? {}
            const measured = Object.entries(payload).filter(
              ([k, v]) => typeof v === "number" && k in labels
            ) as [string, number][]
            return (
              <div key={dev.id} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-foreground truncate" title={dev.name}>{dev.name}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">{seenLabel(t, dev.last_seen_at)}</span>
                </div>
                {measured.length > 0 ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {measured.map(([k, v]) => {
                      const m = labels[k]
                      return (
                        <span key={k} className="text-xs text-muted-foreground tabular-nums">
                          {m.label} <span className="text-foreground font-semibold">{v}</span>
                          {m.unit && <span className="opacity-70">{m.unit}</span>}
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60">{t.waterQualityX.noValuesYet}</p>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
