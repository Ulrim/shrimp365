"use client"

// 차압 추세 카드 — 최근 24시간 스파크라인(수아 시안 mode-split-ui.md 5-5).
//
// 필터 막힘·UV 오염은 수경재배의 핵심 고장 모드다. 상승 판정은 **표시용 휴리스틱**이다
// — 알림을 만들지 않는다. 차압 절대 기준은 없고(베드마다 다르다), 두 조건 AND
// (≥2 kPa 그리고 ≥20% 상승)는 오탐을 줄이기 위한 장치일 뿐이다.
//
// 표본이 6개 미만이면 앞 3개와 뒤 3개가 겹친다. 그러면 8 → 20 → 34 kPa 로 오르는
// 베드가 "변화 없음"으로 뜬다 — 가장 위험한 신호를 정반대로 읽는 것이다. 겹치지 않을
// 만큼 쌓이기 전에는 **추세를 아예 말하지 않는다.** 없는 판정이 틀린 판정보다 낫다.
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAgriT } from "@/lib/i18n-context"
import { agriParam, agriFormat } from "@/lib/agri-params"
import type { WaterQualityReading } from "@/types"

const DP_WINDOW = 3

export function DpTrendCard({ readings }: { readings: WaterQualityReading[] }) {
  const { dashboard: dd } = useAgriT()
  const dp = agriParam("diff_pressure")
  const Icon = dp.icon

  const series = readings
    .map(r => (typeof r.diff_pressure === "number" ? r.diff_pressure : null))
    .filter((v): v is number => v != null)
  const last = series.length ? series[series.length - 1] : null
  const comparable = series.length >= DP_WINDOW * 2
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const head = series.slice(0, DP_WINDOW)
  const tail = series.slice(-DP_WINDOW)
  const delta = comparable ? avg(tail) - avg(head) : null
  const rising = delta != null && delta >= 2 && avg(head) > 0 && delta / avg(head) >= 0.2
  const chartData = series.map((v, i) => ({ i, v }))

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="pb-2 p-4">
        <CardTitle className="text-foreground text-sm flex items-center gap-1.5">
          {/* 아이콘 색 = 스파크라인 색(AGRI_PARAMS.diff_pressure.color). IconComponent 는
              className 만 받으므로 색은 감싸는 span 에 두고 currentColor 로 내려보낸다. */}
          <span className="inline-flex shrink-0" style={{ color: dp.color }} aria-hidden="true">
            <Icon className="w-4 h-4" />
          </span>
          {dd.dpTrendTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        {last == null ? (
          <p className="text-xs text-muted-foreground" role="status">{dd.dpNoData}</p>
        ) : (<>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {agriFormat("diff_pressure", last)}
              <span className="text-sm font-medium text-muted-foreground ml-1">{dp.unit}</span>
            </p>
            {delta != null && (
              <p className={`text-xs tabular-nums ${rising ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {delta >= 0 ? "▲" : "▼"} {dd.dpDelta.replace("{{v}}", Math.abs(delta).toFixed(1))}
              </p>
            )}
          </div>
          <ResponsiveContainer width="100%" height={48}>
            <LineChart data={chartData}>
              <Line type="monotone" dataKey="v" stroke={dp.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {!comparable ? dd.dpNeedMore : rising ? dd.dpRisingHint : dd.dpSteadyHint}
          </p>
        </>)}
      </CardContent>
    </Card>
  )
}
