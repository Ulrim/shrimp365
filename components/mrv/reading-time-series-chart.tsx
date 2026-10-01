"use client"

/**
 * 계측값 시계열 차트 — 전력·DO·수온·pH·ORP·EC 공용.
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/PowerTimeSeriesChart.tsx
 *       + components/chartOption.ts
 *
 * 원본(과 1차 이식본)은 전력 전용이었다. MASTER 4장 화면 #3 이 요구하는 지표는 전력 외에
 * DO·수온·pH 까지이고 데이터·API 는 이미 6종을 주므로, 타입을 받는 하나의 차트로 일반화했다.
 *
 * **지표마다 차트를 따로 그리는 이유**: 단위가 kWh·mg/L·degC·pH·mV·mS/cm 로 전부 달라
 * 한 Y축에 겹치면 눈금이 무의미해지고, 두 축으로도 셋 이상은 읽을 수 없다.
 *
 * ★ 그 대신 **X축을 실제로 공유해야** "전력이 치솟은 그때 DO 가 떨어졌다" 는 판독이
 *   성립한다. 그래서 X축을 카테고리 축이 아니라 **시간 축**(`type="number"` + domain
 *   `[from, to]`)으로 둔다. 카테고리 축으로 두면 차트마다 자기 응답의 버킷으로만 눈금을
 *   만들어, 전력 30버킷 · DO 22버킷이면 **같은 가로 위치가 서로 다른 시각**이 된다.
 *   세로로 정렬돼 보이므로 오히려 틀린 상관 판독을 부른다 — 차트를 나란히 쌓는 뜻이
 *   거기서 사라진다.
 *
 * 원본은 ECharts 를 썼다. 이식본은 shrimp365 가 이미 쓰는 Recharts 로 그린다 —
 * 차트 라이브러리를 하나 더 들이면 번들이 두 배로 무거워지고, 이 화면이 필요로 하는 것은
 * 다중 라인 + 품질 표시 정도라 Recharts 로 충분하다.
 *
 * ★ 표시 규칙은 원본 그대로다. 특히 품질이 'bad' 인 점은 숨기지 않고 눈에 띄게 표시한다 —
 * 조용히 지우면 그래프가 실제보다 매끈해 보여 판단을 그르친다. 같은 이유로 **결측 구간을
 * 선으로 잇지 않는다**(`connectNulls` 없음) — 센서가 멈춘 시간대를 직선으로 이으면
 * "그 시간에도 DO 가 정상이었다" 로 읽힌다. 상태량(DO·수온·pH)에서 특히 위험하다.
 *
 * ★ 값은 서버 응답을 그대로 그린다. 단위도 서버가 준 것을 쓴다(화면 재계산·재단위 금지).
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
import { READING_TYPE_META, describeAggregation } from "@/lib/mrv/ui/reading-meta"
import type { ReadingMeterType, ReadingQualityFlag } from "@/lib/mrv/api-types"

/** 여러 series 를 구분하는 색. shrimp365 의 블루 듀오톤 계열에서 골랐다. */
const SERIES_COLORS = ["#1d4ed8", "#0ea5e9", "#7c3aed", "#0f766e", "#b45309", "#be123c"]
const BAD_COLOR = "#dc2626"
/**
 * 축 눈금·선 색. 예전 값(#94a3b8)은 흰 배경에서 약 2.6:1 로 AA(4.5:1) 미달이었다.
 * 한 화면에 차트가 최대 6장 깔리는 지금은 더 눈에 띈다. `--mrv-muted`(#666D7A 계열)와
 * 같은 밝기로 올렸다.
 */
const AXIS_COLOR = "#666d7a"
const GRID_COLOR = "#e2e8f0"

type Row = Record<string, string | number | null | undefined>

function formatTick(value: number, granularity: "hourly" | "daily"): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return granularity === "hourly"
    ? d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit" })
    : d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })
}

const QUALITY_SUFFIX: Record<ReadingQualityFlag, string> = {
  ok: "",
  suspect: " (품질 의심 데이터)",
  bad: " (품질 불량 데이터)",
}

export type ReadingTimeSeriesChartProps = {
  siteId: string | null
  /** 그릴 계측 타입. 제목·집계 문구가 여기서 나온다. */
  type: ReadingMeterType
  from: string
  to: string
  granularity: "hourly" | "daily"
  targets: UseSiteReadingsTarget[]
  /**
   * 사이트에 이 타입 계측기가 아예 없을 때 쓰는 문구. 빈 차트와 "계측기 없음" 은
   * 운영자에게 전혀 다른 뜻이라(기간을 바꿔 볼 일인가, 센서를 달 일인가) 구분해 준다.
   */
  noMeterNotice?: string
}

export function ReadingTimeSeriesChart({
  siteId,
  type,
  from,
  to,
  granularity,
  targets,
  noMeterNotice,
}: ReadingTimeSeriesChartProps) {
  const { series, isLoading, isError, isEmpty } = useSiteReadings({
    siteId,
    targets,
    from,
    to,
    granularity,
  })

  const meta = READING_TYPE_META[type]

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
      // `t` 는 X축이 읽는 **숫자 시각**이다. 카테고리 라벨(`tick`)을 쓰던 자리를 대신한다 —
      // 라벨로 두면 차트마다 눈금 집합이 달라져 가로 위치가 서로 다른 시각을 가리킨다.
      const row: Row = { ts, t: Date.parse(ts) }
      for (const [groupKey, g] of groups) {
        const point = g.points.get(ts)
        row[groupKey] = point?.value ?? null
        // 품질 플래그를 같은 행에 실어 툴팁이 값과 함께 읽을 수 있게 한다.
        row[`${groupKey}__flag`] = point?.flag ?? null
      }
      return row
    })

    return { rows: builtRows, seriesKeys: keys, unit: firstUnit }
  }, [series])

  const hasAnyData = seriesKeys.length > 0
  // 조회할 대상이 아예 없는 것(계측기 미등록)과 조회했더니 비어 있는 것은 다르게 안내한다.
  const hasNoTarget = targets.length === 0
  // 점진적 렌더: 일부가 아직 로딩 중이어도 이미 도착한 데이터는 바로 보여 준다.
  const showSkeleton = isLoading && !hasAnyData
  const showError = isError && !hasAnyData
  const showEmpty = !hasNoTarget && !isLoading && !isError && isEmpty && !hasAnyData

  // 표시 단위는 서버가 준 값이 우선이고, 아직 응답이 없을 때만 메타의 참조 단위를 쓴다.
  const displayUnit = unit || meta.unit

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
      aria-label={`${meta.label} 시계열 차트`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold text-mrv-fg">{meta.label}</h3>
          {/* 같은 '일별'이 전력은 합계, 나머지는 평균이다 — 그 차이를 제목에 적는다. */}
          <span className="text-[11px] text-mrv-muted">
            {describeAggregation(type, granularity)} · {displayUnit}
          </span>
        </div>
        {isLoading && hasAnyData && (
          <span className="text-[11px] text-mrv-muted" role="status">
            일부 데이터를 불러오는 중…
          </span>
        )}
      </header>

      {hasNoTarget && (
        <div className="flex h-64 items-center justify-center px-4 text-center text-sm text-mrv-muted" role="status">
          {noMeterNotice ?? `${meta.label} 계측기가 등록되어 있지 않습니다.`}
        </div>
      )}

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
          선택한 기간에 표시할 {meta.label} 데이터가 없습니다.
        </div>
      )}

      {hasAnyData && (
        <div className="h-64 w-full" aria-label={`${meta.label} 시계열 라인 차트`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              {/*
                시간 축. domain 을 선택 기간 [from, to] 으로 **고정**해, 이 화면에 깔린
                모든 지표 차트의 가로 위치가 같은 시각을 가리키게 한다. 데이터에서 축을
                뽑으면 지표마다 버킷 수가 달라 정렬이 깨진다.
              */}
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[Date.parse(from), Date.parse(to)]}
                tickFormatter={(v) => formatTick(Number(v), granularity)}
                tick={{ fontSize: 11 }}
                stroke={AXIS_COLOR}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke={AXIS_COLOR}
                // 0 이 뜻을 가지는 지표(전력 = 누적량)는 0 을 포함한다. pH·수온·ORP 처럼
                // 0 에서 먼 구간을 쓰는 상태량은 0 기준으로 그리면 변화가 납작해진다.
                domain={meta.zeroBaseline ? [0, "auto"] : ["auto", "auto"]}
                label={{
                  value: displayUnit,
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 11,
                }}
              />
              <Tooltip
                formatter={(value, name, item) => {
                  const key = String(item?.dataKey ?? "")
                  const payload = item?.payload as Row | undefined
                  const flag = payload?.[`${key}__flag`] as ReadingQualityFlag | null
                  const suffix = flag ? QUALITY_SUFFIX[flag] : ""
                  const label =
                    seriesKeys.find((s) => s.dataKey === key)?.label ?? String(name)
                  return [`${value} ${displayUnit}${suffix}`, label]
                }}
                labelFormatter={(label) => formatTick(Number(label), granularity)}
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
                  // connectNulls 를 쓰지 않는다 — 결측 구간을 직선으로 이으면 센서가 멈춘
                  // 시간대가 '정상값이 있었던 것'으로 읽힌다(위 머리말 참고).
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
