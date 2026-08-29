"use client"

/**
 * 전력 시계열 차트.
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/PowerTimeSeriesChart.tsx
 *       + components/chartOption.ts
 *
 * 원본은 ECharts 를 썼다. 이식본은 shrimp365 가 이미 쓰는 Recharts 로 그린다 —
 * 차트 라이브러리를 하나 더 들이면 번들이 두 배로 무거워지고, 이 화면이 필요로 하는 것은
 * 다중 라인 + 품질 표시 정도라 Recharts 로 충분하다.
 *
 * ★ 표시 규칙은 원본 그대로다. 특히 품질이 'bad' 인 점은 숨기지 않고 눈에 띄게 표시한다 —
 * 조용히 지우면 그래프가 실제보다 매끈해 보여 판단을 그르친다.
 */

import { useMemo } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  useSiteReadings,
  type UseSiteReadingsTarget,
} from "@/lib/mrv/ui/use-site-readings"
import type { ReadingQualityFlag } from "@/lib/mrv/api-types"

/** 여러 series 를 구분하는 색. shrimp365 의 블루 듀오톤 계열에서 골랐다. */
const SERIES_COLORS = ["#1d4ed8", "#0ea5e9", "#7c3aed", "#0f766e", "#b45309", "#be123c"]
const BAD_COLOR = "#dc2626"

type Row = Record<string, string | number | null | undefined>

function formatTick(ts: string, granularity: "hourly" | "daily"): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return granularity === "hourly"
    ? d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit" })
    : d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })
}

const QUALITY_SUFFIX: Record<ReadingQualityFlag, string> = {
  ok: "",
  suspect: " (품질 의심 데이터)",
  bad: " (품질 불량 데이터)",
}

export type PowerTimeSeriesChartProps = {
  siteId: string | null
  from: string
  to: string
  granularity: "hourly" | "daily"
  targets: UseSiteReadingsTarget[]
}

export function PowerTimeSeriesChart({
  siteId,
  from,
  to,
  granularity,
  targets,
}: PowerTimeSeriesChartProps) {
  const { series, isLoading, isError, isEmpty } = useSiteReadings({
    siteId,
    targets,
    from,
    to,
    granularity,
  })

  const { rows, seriesKeys, unit } = useMemo(() => {
    // 계측기 단위로 series 를 나눈다. tank_id+type 조회는 한 응답에 여러 계측기가 섞여
    // 올 수 있으므로 point.meterId 를, 없으면 응답의 meterId 를, 그마저 없으면 target.key 를 쓴다.
    const groups = new Map<
      string,
      { label: string; points: Map<string, { value: number; flag: ReadingQualityFlag }> }
    >()
    let firstUnit = ""

    for (const s of series) {
      if (!s.data) continue
      if (!firstUnit) firstUnit = s.data.unit
      const targetLabel = s.label ?? s.target.tankId ?? s.target.meterId ?? s.key
      for (const p of s.data.points) {
        const meterKey = p.meterId ?? s.data.meterId ?? s.key
        const groupKey = `${s.key}::${meterKey}`
        const label =
          meterKey && meterKey !== s.key ? `${targetLabel} · ${meterKey}` : targetLabel
        if (!groups.has(groupKey)) groups.set(groupKey, { label, points: new Map() })
        groups.get(groupKey)!.points.set(p.ts, { value: p.value, flag: p.qualityFlag })
      }
    }

    const timestamps = Array.from(
      new Set(Array.from(groups.values()).flatMap((g) => Array.from(g.points.keys()))),
    ).sort()

    const keys = Array.from(groups.entries()).map(([groupKey, g]) => ({
      dataKey: groupKey,
      label: g.label,
    }))

    const builtRows: Row[] = timestamps.map((ts) => {
      const row: Row = { ts, tick: formatTick(ts, granularity) }
      for (const [groupKey, g] of groups) {
        const point = g.points.get(ts)
        row[groupKey] = point?.value ?? null
        // 품질 플래그를 같은 행에 실어 툴팁이 값과 함께 읽을 수 있게 한다.
        row[`${groupKey}__flag`] = point?.flag ?? null
      }
      return row
    })

    return { rows: builtRows, seriesKeys: keys, unit: firstUnit }
  }, [series, granularity])

  const hasAnyData = seriesKeys.length > 0
  // 점진적 렌더: 일부가 아직 로딩 중이어도 이미 도착한 데이터는 바로 보여 준다.
  const showSkeleton = isLoading && !hasAnyData
  const showError = isError && !hasAnyData
  const showEmpty = !isLoading && !isError && isEmpty && !hasAnyData

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
      aria-label="시계열 차트"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-mrv-fg">
          전력 사용량 시계열 ({granularity === "hourly" ? "시간별" : "일별"})
        </h3>
        {isLoading && hasAnyData && (
          <span className="text-[11px] text-mrv-muted" role="status">
            일부 데이터를 불러오는 중…
          </span>
        )}
      </header>

      {showSkeleton && (
        <div className="flex h-64 items-center justify-center text-sm text-mrv-muted" role="status">
          차트 데이터를 불러오는 중…
        </div>
      )}

      {showError && (
        <div className="flex h-64 items-center justify-center text-sm" role="alert">
          <p className="text-mrv-red">차트 데이터를 불러오지 못했습니다.</p>
        </div>
      )}

      {showEmpty && (
        <div className="flex h-64 items-center justify-center text-sm text-mrv-muted" role="status">
          표시할 시계열 데이터가 없습니다.
        </div>
      )}

      {hasAnyData && (
        <div className="h-64 w-full" aria-label="전력 사용량 시계열 라인 차트">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="tick" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#94a3b8"
                label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <Tooltip
                formatter={(value, name, item) => {
                  const key = String(item?.dataKey ?? "")
                  const payload = item?.payload as Row | undefined
                  const flag = payload?.[`${key}__flag`] as ReadingQualityFlag | null
                  const suffix = flag ? QUALITY_SUFFIX[flag] : ""
                  const label =
                    seriesKeys.find((s) => s.dataKey === key)?.label ?? String(name)
                  return [`${value} ${unit}${suffix}`, label]
                }}
                labelFormatter={(label) => String(label)}
              />
              <Legend
                formatter={(value) =>
                  seriesKeys.find((s) => s.dataKey === value)?.label ?? String(value)
                }
                wrapperStyle={{ fontSize: 11 }}
              />
              {seriesKeys.map((s, i) => (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.dataKey}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  connectNulls
                  dot={(props) => {
                    const { cx, cy, index } = props as {
                      cx?: number
                      cy?: number
                      index: number
                    }
                    if (cx === undefined || cy === undefined) {
                      return <g key={`${s.dataKey}-${index}`} />
                    }
                    const flag = rows[index]?.[`${s.dataKey}__flag`] as
                      | ReadingQualityFlag
                      | null
                    // 불량 데이터는 크고 붉은 점으로 드러낸다(색만으로 구분되지 않게 크기도 다르다).
                    const isBad = flag === "bad"
                    return (
                      <circle
                        key={`${s.dataKey}-${index}`}
                        cx={cx}
                        cy={cy}
                        r={isBad ? 5 : 2}
                        fill={isBad ? BAD_COLOR : SERIES_COLORS[i % SERIES_COLORS.length]}
                        stroke={isBad ? "#7f1d1d" : "none"}
                        strokeWidth={isBad ? 1.5 : 0}
                      />
                    )
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
