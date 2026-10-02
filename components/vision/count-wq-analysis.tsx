"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { correlation, correlationLabel, getCountWaterQualitySeries } from "@/lib/vision"
import type { CountWaterQualityPoint, Tank } from "@/types"

// 수질 ↔ 개체수 통합 분석.
//
// 이 화면이 통합의 실익이다. 개체수만 보면 "줄었다"까지밖에 모르고, 수질만
// 보면 "용존산소가 떨어졌다"까지밖에 모른다. 겹쳐 놓아야 "산소가 떨어지자
// 개체수가 따라 줄었다"가 보인다.
//
// 두 데이터는 측정 주기가 다르다(수질 분 단위, 개체수 초 단위). 그래서 같은
// 시간 버킷으로 맞춘 뒤 겹친다 — 그 일은 DB 함수 vision_count_wq_series() 가
// 한다. 한쪽만 측정된 구간은 그 축만 끊어져 보이고, 상관 계산에서는 빠진다.

const RANGES = [
  { label: "24시간", hours: 24,  bucketSeconds: 3600 },
  { label: "7일",    hours: 168, bucketSeconds: 3600 * 6 },
  { label: "30일",   hours: 720, bucketSeconds: 86400 },
] as const

/** 수질 항목별 축 설정. 개체수와 견줄 값들만 올린다. */
const METRICS = [
  { key: "avg_do" as const,          label: "용존산소",  unit: "mg/L", color: "#0ea5e9" },
  { key: "avg_temperature" as const, label: "수온",      unit: "°C",   color: "#f59e0b" },
  { key: "avg_ph" as const,          label: "pH",        unit: "",     color: "#8b5cf6" },
]

const COUNT_COLOR = "#14b8a6"

interface Props {
  tank: Tank
}

export function CountWaterQualityAnalysis({ tank }: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0])
  const [metric, setMetric] = useState<(typeof METRICS)[number]>(METRICS[0])
  const [series, setSeries] = useState<CountWaterQualityPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const end = new Date()
    const start = new Date(end.getTime() - range.hours * 3600_000)

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const rows = await getCountWaterQualitySeries(tank.id, start, end, range.bucketSeconds)
        if (!cancelled) setSeries(rows)
      } catch {
        if (!cancelled) setError("통합 데이터를 불러오지 못했습니다.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    return () => { cancelled = true }
  }, [tank.id, range])

  const chartData = useMemo(
    () => series.map(p => ({
      ...p,
      // 축 라벨. 하루 이상 보면 날짜가, 하루 안이면 시각이 필요하다.
      label: range.hours > 24
        ? new Date(p.bucket).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })
        : new Date(p.bucket).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    })),
    [series, range.hours]
  )

  const r = useMemo(
    () => correlation(series.map(p => [p.avg_count, p[metric.key]] as [number | null, number | null])),
    [series, metric.key]
  )

  // 상관을 실제로 계산할 수 있었던 구간 수. 표본이 적으면 숫자를 믿으면 안 된다.
  const pairedBuckets = useMemo(
    () => series.filter(p => p.avg_count !== null && p[metric.key] !== null).length,
    [series, metric.key]
  )

  return (
    <Card className="bg-muted border-border">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">수질 · 개체수 통합 분석</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {METRICS.map(m => (
              <button
                key={m.key}
                onClick={() => setMetric(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  metric.key === m.key
                    ? "bg-[#1E40AF]/10 text-[#1E40AF] border border-[#1E40AF]/25"
                    : "text-muted-foreground hover:bg-accent border border-transparent"
                }`}
              >
                {m.label}
              </button>
            ))}
            <span className="w-px h-4 bg-border mx-1" />
            {RANGES.map(rg => (
              <button
                key={rg.label}
                onClick={() => setRange(rg)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  range.label === rg.label
                    ? "bg-[#1E40AF]/10 text-[#1E40AF] border border-[#1E40AF]/25"
                    : "text-muted-foreground hover:bg-accent border border-transparent"
                }`}
              >
                {rg.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="h-72 flex items-center justify-center text-sm text-red-500">{error}</div>
        ) : chartData.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            <p>이 기간에 쌓인 데이터가 없습니다.</p>
            <p className="text-xs">카메라를 시작하면 개체수가 기록됩니다.</p>
          </div>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis
                    yAxisId="count"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    width={52}
                  />
                  <YAxis
                    yAxisId="wq"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    width={44}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value, name) =>
                      typeof value === "number"
                        ? [name === "개체수" ? `${value.toLocaleString()}마리`
                                             : `${value.toFixed(2)}${metric.unit}`, name]
                        : [String(value ?? "—"), name]
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    yAxisId="count"
                    type="monotone"
                    dataKey="avg_count"
                    name="개체수"
                    stroke={COUNT_COLOR}
                    strokeWidth={2}
                    dot={false}
                    // 측정이 없는 구간은 잇지 않는다 — 이으면 없던 값이 생긴다.
                    connectNulls={false}
                  />
                  <Line
                    yAxisId="wq"
                    type="monotone"
                    dataKey={metric.key}
                    name={metric.label}
                    stroke={metric.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">개체수 ↔ {metric.label}</span>
                <Badge variant={r === null ? "secondary" : Math.abs(r) >= 0.4 ? "warning" : "outline"}>
                  {correlationLabel(r)}
                  {r !== null && ` (r = ${r.toFixed(2)})`}
                </Badge>
              </div>
              <span className="text-[11px] text-muted-foreground">
                두 값이 모두 측정된 구간 {pairedBuckets}개 기준
              </span>
              {r !== null && Math.abs(r) >= 0.4 && (
                <span className="text-[11px] text-amber-600">
                  {r > 0
                    ? `${metric.label}이(가) 낮아질 때 개체수도 함께 줄어드는 흐름입니다.`
                    : `${metric.label}이(가) 높아질 때 개체수가 줄어드는 흐름입니다.`}
                </span>
              )}
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground/80 leading-relaxed">
              상관은 두 값이 같이 움직였다는 뜻이지 한쪽이 다른 쪽의 원인이라는 뜻은 아닙니다.
              사료 급여·환수처럼 둘 다에 영향을 주는 다른 요인이 있을 수 있으니, 양식일지와 함께 보세요.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
