"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { Fish, Minus, TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getCameras, getCountHistory } from "@/lib/vision"
import type { VisionCamera } from "@/types"

// 리포트에 들어가는 개체수 절.
//
// 원본(ShrimpVision)에는 자체 PDF 리포트 서비스가 따로 있었다. 여기서는
// 만들지 않는다 — shrimp365 리포트 화면이 이미 인쇄를 전제로 짜여 있고,
// 리포트를 두 벌로 두면 사용자가 어느 쪽을 봐야 할지 알 수 없다.
// 대신 이 절을 기존 리포트에 얹어 수질·폐사·사료와 한 장에 나오게 한다.
//
// 카메라가 없으면 아무것도 그리지 않는다(null 반환). 카메라를 안 쓰는 농장의
// 리포트에 빈 칸이 생기면 안 된다.

/** 카메라가 많으면 선이 뒤엉킨다. 개체수가 많은 순으로 이만큼만 그린다. */
const MAX_LINES = 5

const LINE_COLORS = ["#14b8a6", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899"]

interface Row {
  day: string
  [cameraName: string]: string | number | null
}

interface Summary {
  camera: VisionCamera
  first: number | null
  last: number | null
  changePct: number | null
}

export function ReportCountSection({ periodDays }: { periodDays: number }) {
  const [cameras, setCameras] = useState<VisionCamera[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const cameraRows = await getCameras()
      if (cancelled) return
      setCameras(cameraRows)
      if (cameraRows.length === 0) {
        setRows([])
        setSummaries([])
        return
      }

      const end = new Date()
      const start = new Date(end.getTime() - periodDays * 86400_000)
      // 하루 단위로 묶는다 — 리포트는 기간 흐름을 보는 문서라 분 단위가 필요 없다.
      const histories = await Promise.all(
        cameraRows.map(camera =>
          getCountHistory(camera.id, start, end, 86400)
            .then(buckets => ({ camera, buckets }))
            // 한 대가 실패해도 나머지 절은 나와야 한다.
            .catch(() => ({ camera, buckets: [] }))
        )
      )
      if (cancelled) return

      const stats: Summary[] = histories.map(({ camera, buckets }) => ({
        camera,
        first: buckets[0]?.avg_count ?? null,
        last: buckets[buckets.length - 1]?.avg_count ?? null,
        changePct:
          buckets.length >= 2 && buckets[0].avg_count > 0
            ? ((buckets[buckets.length - 1].avg_count - buckets[0].avg_count) /
                buckets[0].avg_count) * 100
            : null,
      }))
      setSummaries(stats.filter(s => s.last !== null))

      const shown = histories
        .filter(h => h.buckets.length > 0)
        .sort((a, b) => (b.buckets.at(-1)?.avg_count ?? 0) - (a.buckets.at(-1)?.avg_count ?? 0))
        .slice(0, MAX_LINES)

      // 날짜를 축으로 모은다. 카메라마다 기록이 시작된 날이 달라 합집합을 쓴다.
      const byDay = new Map<string, Row>()
      for (const { camera, buckets } of shown) {
        for (const bucket of buckets) {
          const date = new Date(bucket.bucket)
          const day = `${date.getMonth() + 1}/${date.getDate()}`
          const row = byDay.get(day) ?? { day }
          row[camera.name] = bucket.avg_count
          byDay.set(day, row)
        }
      }
      setRows(
        [...byDay.values()].sort(
          (a, b) => Number(a.day.split("/")[0]) * 100 + Number(a.day.split("/")[1])
                  - (Number(b.day.split("/")[0]) * 100 + Number(b.day.split("/")[1]))
        )
      )
    }

    load()
      .catch(() => { /* 개체수 절만 빠진다 — 리포트 전체를 막지 않는다 */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [periodDays])

  const lineNames = useMemo(
    () => [...new Set(rows.flatMap(r => Object.keys(r).filter(k => k !== "day")))],
    [rows]
  )

  // 카메라를 안 쓰는 농장에는 이 절 자체가 없어야 한다.
  if (loading || cameras.length === 0 || summaries.length === 0) return null

  return (
    <Card className="bg-card border-border print:break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-foreground flex items-center gap-2">
          <Fish className="w-4 h-4 text-teal-500" />
          개체수 추이 (카메라 분석)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length >= 2 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" width={52} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value, name) =>
                    [typeof value === "number" ? `${value.toLocaleString()}마리` : String(value ?? "—"), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {lineNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    // 기록이 없는 날은 잇지 않는다 — 이으면 없던 값이 생긴다.
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            추이를 그리기에는 기록이 부족합니다. 아래는 마지막으로 측정된 값입니다.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 font-medium">카메라</th>
                <th className="py-2 font-medium">수조</th>
                <th className="py-2 font-medium text-right">기간 초</th>
                <th className="py-2 font-medium text-right">기간 말</th>
                <th className="py-2 font-medium text-right">증감</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(({ camera, first, last, changePct }) => {
                const down = changePct !== null && changePct < -5
                const up = changePct !== null && changePct > 5
                return (
                  <tr key={camera.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2">{camera.name}</td>
                    <td className="py-2 text-muted-foreground">{camera.tank_name ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {first !== null ? first.toLocaleString() : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {last !== null ? last.toLocaleString() : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {changePct === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 tabular-nums ${
                            down ? "text-red-500" : up ? "text-emerald-500" : "text-muted-foreground"
                          }`}
                        >
                          {down ? <TrendingDown className="w-3.5 h-3.5" />
                            : up ? <TrendingUp className="w-3.5 h-3.5" />
                            : <Minus className="w-3.5 h-3.5" />}
                          {changePct > 0 ? "+" : ""}{changePct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          카메라에 잡힌 수를 센 값입니다. 수조 전체 마릿수가 아니라 화면에 보이는 범위의
          값이므로, 절대량보다 <strong>기간 안에서의 증감</strong>을 보는 데 쓰세요.
        </p>
      </CardContent>
    </Card>
  )
}
