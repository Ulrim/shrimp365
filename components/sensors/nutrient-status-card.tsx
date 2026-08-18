"use client"

// 양액 상태 카드 (농업 모드 전용).
//
// 계산의 진실은 장비, 웹은 표시 — 장비(shrimp365_sensor.py)의 nutrient_plan
// 결과가 업로드 payload 의 nut_* 키로 실려 sensor_devices.last_payload 에
// 남는다(교정값이 장비에만 있어 서버는 계산하지 않는다). 이 카드는 그 값으로
// "지금 뭘 해야 하나"를 원시 수치보다 먼저 보여 준다(수아 시안 4장).
//
// 렌더 조건: 농업 UI 모드 그리고 활성 기기 payload 에 nut_percent 가 숫자로
// 존재. 조건 미충족이면 null — 새우 모드 diff 없음.

import { Card, CardContent } from "@/components/ui/card"
import { FlaskConical } from "lucide-react"
import { useT } from "@/lib/i18n-context"
import { useFarmMode } from "@/lib/farm-mode-context"
import type { SensorDevice, Tank } from "@/types"
import type { Dict } from "@/lib/i18n"

type Verdict = "ok" | "low" | "high"

function seenLabel(t: Dict, iso: string | null): string {
  if (!iso) return t.waterQualityX.noValuesYet
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return t.time.justNow
  if (mins < 60) return t.time.minutesAgo.replace("{{n}}", String(mins))
  const h = Math.floor(mins / 60)
  if (h < 24) return t.time.hoursAgo.replace("{{n}}", String(h))
  return t.time.daysAgo.replace("{{n}}", String(Math.floor(h / 24)))
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useT()
  // 설계 확정: ok=녹색, low/high=주황. 색+텍스트 병기(색만으로 의미 전달 금지).
  const styles: Record<Verdict, { cls: string; label: string }> = {
    ok:   { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/25", label: t.agri.verdictOk },
    low:  { cls: "bg-amber-500/10 text-amber-600 border-amber-500/25",       label: t.agri.verdictLow },
    high: { cls: "bg-amber-500/10 text-amber-600 border-amber-500/25",       label: t.agri.verdictHigh },
  }
  const s = styles[verdict]
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1.5 ${s.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {s.label}
    </span>
  )
}

export function NutrientStatusCard({ devices, tank }: { devices: SensorDevice[]; tank?: Tank | null }) {
  const { t } = useT()
  const { isAgriMode } = useFarmMode()

  const withNutrient = devices.filter(
    d => d.active && typeof d.last_payload?.nut_percent === "number"
  )
  if (!isAgriMode || withNutrient.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {withNutrient.map(dev => {
        const p = dev.last_payload ?? {}
        const percent = p.nut_percent as number
        const rawVerdict = p.nut_verdict
        const verdict: Verdict = rawVerdict === "low" || rawVerdict === "high" ? rawVerdict : "ok"
        const targetEc = typeof p.nut_target_ec === "number" ? p.nut_target_ec : null // µS/cm
        const doseA = typeof p.nut_dose_a_ml === "number" ? p.nut_dose_a_ml : null
        const doseB = typeof p.nut_dose_b_ml === "number" ? p.nut_dose_b_ml : null
        const exchangeL = typeof p.nut_exchange_l === "number" ? p.nut_exchange_l : null
        const uncalibrated = p.nut_calibrated === false

        return (
          <Card key={dev.id} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 min-w-0">
                  <FlaskConical className="w-3.5 h-3.5 text-ocean-600 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.agri.nutrientTitle} · {dev.name}</span>
                </p>
                {uncalibrated && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                    {t.agri.uncalibratedBadge}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <div>
                  <p className="text-3xl font-bold text-foreground tabular-nums">
                    {percent}
                    <span className="text-base font-semibold text-muted-foreground ml-0.5">%</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{t.agri.currentStrength}</p>
                </div>
                <VerdictBadge verdict={verdict} />
                {targetEc != null && (
                  <div className="text-sm text-muted-foreground tabular-nums">
                    {t.agri.targetShort}{" "}
                    <span className="text-foreground font-semibold">{(targetEc / 1000).toFixed(2)}</span> mS/cm
                    {tank?.target_ec != null && (
                      <span className="text-xs text-muted-foreground ml-1">
                        (±{((tank.ec_tolerance ?? 100) / 1000).toFixed(2)})
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-border text-sm tabular-nums">
                {verdict === "ok" && (
                  <p className="text-muted-foreground">{t.agri.noActionNeeded}</p>
                )}
                {verdict === "low" && (
                  <p className="text-muted-foreground">
                    {t.agri.doseA} <span className="text-foreground font-semibold">{doseA ?? "—"} mL</span>
                    {" · "}
                    {t.agri.doseB} <span className="text-foreground font-semibold">{doseB ?? "—"} mL</span>
                    {" "}{t.agri.doseSuffix}
                  </p>
                )}
                {verdict === "high" && (
                  <p className="text-muted-foreground">
                    {t.agri.exchangePrefix} <span className="text-foreground font-semibold">{exchangeL ?? "—"} L</span>
                    {" "}{t.agri.exchangeSuffix}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">{seenLabel(t, dev.last_seen_at)}</p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
