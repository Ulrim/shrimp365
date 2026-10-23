"use client"

// 센서별 비교 차트 — 한 항목을 센서(기기)마다 한 선으로(시안 5-6).
//
// device_id 가 있는 기록만 쓴다(수기·구기록은 센서 구분이 없어 제외). 선 색은
// 새 팔레트를 만들지 않고 `AGRI_PARAMS[].color` 여섯 색을 순서대로 돌려 쓴다.
// y 값은 `agriScaled`(EC 는 mS/cm) — 같은 페이지의 카드·추세·CSV 와 단위를 맞춘다.
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import { AGRI_PARAMS, agriScaled, type AgriParam, type AgriParamKey } from "@/lib/agri-params"
import type { WaterQualityReading } from "@/types"
import {
  GRID_STROKE, TICK_FILL, CHART_HEIGHT, sizing,
  tooltipContentStyle, tooltipLabelStyle, tooltipItemStyle, timeLabel, spansMultipleDays,
} from "./chart-theme"

/** 비교 대상 항목 — 유량·차압은 배관 위치마다 달라 센서 간 비교가 뜻이 없다. */
export const COMPARE_KEYS: readonly AgriParamKey[] = ["conductivity", "ph", "temperature", "do_level"]

export type ComparePoint = Record<string, number | string | null>

const SERIES_COLORS = AGRI_PARAMS.map(p => p.color)

/** 측정 목록 → 센서별 선 데이터. 키는 센서 이름, 값은 환산된 수치(미측정 null). */
export function buildCompareData(
  readings: WaterQualityReading[],
  deviceNameById: Map<string, string>,
  key: AgriParamKey,
  locale: string,
): ComparePoint[] {
  const tagged = readings.filter(r => r.device_id && deviceNameById.has(r.device_id))
  const multiDay = spansMultipleDays(tagged[0]?.recorded_at, tagged[tagged.length - 1]?.recorded_at)
  return tagged
    .map(r => {
      const d = new Date(r.recorded_at)
      return {
        t: d.getTime(),
        time: timeLabel(d, multiDay, locale),
        [deviceNameById.get(r.device_id!)!]: agriScaled(key, r[key] as number | null | undefined),
      } as ComparePoint
    })
    .sort((a, b) => (a.t as number) - (b.t as number))
}

interface SensorCompareChartProps {
  data: ComparePoint[]
  /** 선 이름 = 센서 이름. 순서대로 색을 받는다. */
  names: string[]
  param: AgriParam
  fill?: boolean
  big?: boolean
  height?: number
}

export function SensorCompareChart({ data, names, param, fill = false, big = false, height = CHART_HEIGHT }: SensorCompareChartProps) {
  const s = sizing(big)
  const unitSuffix = param.unit ? ` ${param.unit}` : ""
  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="time" tick={{ fill: TICK_FILL, fontSize: s.tick }} tickLine={false} axisLine={false}
          interval="preserveStartEnd" minTickGap={s.minTickGap} />
        <YAxis tick={{ fill: TICK_FILL, fontSize: s.tick }} tickLine={false} axisLine={false} width={s.yWidth}
          tickFormatter={(v: number) => Number(v).toFixed(param.digits)} />
        <Tooltip
          contentStyle={tooltipContentStyle(big)} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
          formatter={(v, name) => [`${Number(v).toFixed(param.digits)}${unitSuffix}`, name]}
        />
        <Legend wrapperStyle={{ fontSize: s.legend, color: TICK_FILL }} />
        {names.map((n, i) => (
          <Line key={n} type="monotone" dataKey={n} stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={s.stroke} dot={false} connectNulls activeDot={{ r: s.activeDot }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
