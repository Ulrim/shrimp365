"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  Activity, AlertTriangle, Camera as CameraIcon, Download, Fish, Radio, Video,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { StreamView } from "@/components/vision/stream-view"
import { CountWaterQualityAnalysis } from "@/components/vision/count-wq-analysis"
import { CameraSettings } from "@/components/vision/camera-settings"
import { useVisionLive } from "@/lib/use-vision-live"
import {
  getAlertConfigs, getCameras, getCountHistory, getCountRecords, getLatestCounts,
} from "@/lib/vision"
import { getAllTanks } from "@/lib/db"
import { exportToCsv } from "@/lib/export"
import { formatDateTime } from "@/lib/utils"
import type {
  CountBucket, CountRecord, Tank, VisionAlertConfig, VisionCamera,
} from "@/types"

// 개체수 모니터링 화면.
//
// 원본(ShrimpVision)은 6개 화면이 따로 있었다. 여기서는 탭 하나로 묶는다 —
// 양식장 관리는 이미 /farms 에 있고, 경보 이력은 헤더 알림함에 들어가므로
// 그 둘을 빼면 남는 것이 한 화면에 들어간다. 사용자가 오갈 곳이 줄어든다.

const HISTORY_RANGES = [
  { label: "24시간", hours: 24,  bucketSeconds: 900 },
  { label: "7일",    hours: 168, bucketSeconds: 3600 * 3 },
  { label: "30일",   hours: 720, bucketSeconds: 86400 },
] as const

function StatCard({
  icon, label, value, sub, color, iconBg,
}: {
  icon: React.ReactNode; label: string; value: string | number
  sub?: string; color: string; iconBg: string
}) {
  return (
    <Card className="bg-muted border-border min-w-0 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm text-muted-foreground mb-1 truncate">{label}</p>
            <p className={`text-2xl sm:text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
          </div>
          <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function VisionView() {
  const [tanks, setTanks] = useState<Tank[]>([])
  const [cameras, setCameras] = useState<VisionCamera[]>([])
  const [configs, setConfigs] = useState<VisionAlertConfig[]>([])
  const [stored, setStored] = useState<Record<string, CountRecord>>({})
  const [loading, setLoading] = useState(true)

  const [selectedCameraId, setSelectedCameraId] = useState("")
  const [showBoxes, setShowBoxes] = useState(true)

  const [range, setRange] = useState<(typeof HISTORY_RANGES)[number]>(HISTORY_RANGES[0])
  const [history, setHistory] = useState<CountBucket[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const live = useVisionLive(!loading)

  const load = useCallback(async () => {
    const [tankRows, cameraRows] = await Promise.all([getAllTanks(), getCameras()])
    setTanks(tankRows)
    setCameras(cameraRows)
    // 경보 설정은 없어도 화면이 성립한다. 실패해도 나머지를 막지 않는다.
    try { setConfigs(await getAlertConfigs()) } catch { setConfigs([]) }
    if (cameraRows.length) {
      setStored(await getLatestCounts(cameraRows.map(c => c.id)))
    } else {
      setStored({})
    }
    return cameraRows
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const rows = await load()
        if (!cancelled) setSelectedCameraId(prev => prev || rows[0]?.id || "")
      } catch {
        // 빈 화면 + 안내로 떨어진다.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [load])

  const selectedCamera = useMemo(
    () => cameras.find(c => c.id === selectedCameraId) ?? cameras[0],
    [cameras, selectedCameraId]
  )
  const selectedTank = useMemo(
    () => tanks.find(t => t.id === selectedCamera?.tank_id),
    [tanks, selectedCamera]
  )

  // 이력 차트 — 선택한 카메라·기간이 바뀔 때만 다시 부른다.
  useEffect(() => {
    if (!selectedCamera) return
    const cameraId = selectedCamera.id
    let cancelled = false
    const end = new Date()
    const start = new Date(end.getTime() - range.hours * 3600_000)

    async function load() {
      setHistoryLoading(true)
      try {
        const rows = await getCountHistory(cameraId, start, end, range.bucketSeconds)
        if (!cancelled) setHistory(rows)
      } catch {
        if (!cancelled) setHistory([])
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }
    load()

    return () => { cancelled = true }
  }, [selectedCamera, range])

  /** 카메라의 현재 개체수 — 실시간 값이 있으면 그것을, 없으면 DB 마지막 값을 쓴다. */
  const countOf = useCallback(
    (cameraId: string): number | null =>
      live.latest[cameraId]?.count ?? stored[cameraId]?.count ?? null,
    [live.latest, stored]
  )

  const totalCount = useMemo(
    () => cameras.reduce((sum, c) => sum + (countOf(c.id) ?? 0), 0),
    [cameras, countOf]
  )
  const runningCount = useMemo(
    () => cameras.filter(c => live.statuses[c.id] === "running").length,
    [cameras, live.statuses]
  )

  const chartData = useMemo(
    () => history.map(b => ({
      ...b,
      label: range.hours > 24
        ? new Date(b.bucket).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })
        : new Date(b.bucket).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    })),
    [history, range.hours]
  )

  async function handleExport() {
    if (!selectedCamera) return
    setExporting(true)
    try {
      // 원본 기록을 그대로 내보낸다 — 집계값이 아니라 잰 값이 있어야
      // 받는 쪽에서 다시 따져 볼 수 있다.
      const rows = await getCountRecords(selectedCamera.id, range.hours)
      if (rows.length === 0) {
        alert("이 기간에 내보낼 기록이 없습니다.")
        return
      }
      exportToCsv(
        rows.map(r => ({
          측정시각: r.time,
          카메라: selectedCamera.name,
          수조: selectedCamera.tank_name ?? "",
          개체수: r.count,
          평균신뢰도: r.confidence_avg ?? "",
          모델: r.model_version ?? "",
          추론시간ms: r.inference_ms ?? "",
        })),
        `개체수_${selectedCamera.name}_${range.label}`
      )
    } catch {
      alert("내보내기에 실패했습니다.")
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
  }

  // 카메라가 하나도 없으면 설정으로 곧장 안내한다. 빈 대시보드를 보여 줘도
  // 무엇을 해야 할지 알 수 없다.
  const empty = cameras.length === 0

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Fish className="w-6 h-6 text-teal-500" />
            개체수 모니터링
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            카메라 영상에서 흰다리새우를 세어 수질과 함께 봅니다.
          </p>
        </div>
        <Badge variant={live.wsState === "open" ? "success" : live.wsState === "connecting" ? "warning" : "secondary"}>
          <Radio className="w-3 h-3 mr-1" />
          {live.wsState === "open" ? "실시간 연결됨"
            : live.wsState === "connecting" ? "연결 중…"
            : live.wsState === "disabled" ? "실시간 꺼짐"
            : "연결 끊김"}
        </Badge>
      </div>

      {empty ? (
        <Card className="bg-muted border-border">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <CameraIcon className="w-10 h-10 text-muted-foreground" />
            <div>
              <p className="font-medium">아직 등록된 카메라가 없습니다</p>
              <p className="text-sm text-muted-foreground mt-1">
                수조에 카메라를 달면 개체수가 자동으로 기록됩니다.
                {tanks.length === 0 && " 먼저 양식장과 수조를 등록하세요."}
              </p>
            </div>
            {tanks.length === 0 && (
              <Button variant="ocean" asChild><Link href="/farms">양식장 등록하러 가기</Link></Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue={empty ? "settings" : "overview"} className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">개요</TabsTrigger>
          <TabsTrigger value="monitor">실시간</TabsTrigger>
          <TabsTrigger value="history">이력</TabsTrigger>
          <TabsTrigger value="analysis">통합 분석</TabsTrigger>
          <TabsTrigger value="settings">설정</TabsTrigger>
        </TabsList>

        {/* ── 개요 ─────────────────────────── */}
        <TabsContent value="overview" className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              icon={<Fish className="w-5 h-5 text-teal-500" />}
              label="전체 개체수" value={totalCount.toLocaleString()}
              sub={`카메라 ${cameras.length}대 합계`}
              color="text-teal-500" iconBg="bg-teal-500/10"
            />
            <StatCard
              icon={<Video className="w-5 h-5 text-emerald-500" />}
              label="분석 중" value={`${runningCount} / ${cameras.length}`}
              sub="실행 중인 카메라"
              color="text-emerald-500" iconBg="bg-emerald-500/10"
            />
            <StatCard
              icon={<Activity className="w-5 h-5 text-ocean-500" />}
              label="감시 중인 수조"
              value={new Set(cameras.map(c => c.tank_id)).size}
              sub={`전체 수조 ${tanks.length}개 중`}
              color="text-ocean-500" iconBg="bg-ocean-500/10"
            />
            <StatCard
              icon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
              label="방금 올라온 경보" value={live.alerts.length}
              sub="자세한 내용은 알림함"
              color="text-amber-500" iconBg="bg-amber-500/10"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cameras.map(camera => {
              const count = countOf(camera.id)
              const status = live.statuses[camera.id]
              const record = stored[camera.id]
              return (
                <Card key={camera.id} className="bg-muted border-border">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm truncate">{camera.name}</CardTitle>
                      <Badge variant={status === "running" ? "success" : "secondary"}>
                        {status === "running" ? "분석 중" : "중지됨"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {camera.farm_name ? `${camera.farm_name} · ` : ""}{camera.tank_name ?? "수조"}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-teal-500 tabular-nums">
                      {count !== null ? count.toLocaleString() : "—"}
                      <span className="text-sm font-normal text-muted-foreground ml-1">마리</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {live.latest[camera.id]
                        ? "실시간"
                        : record
                          ? `마지막 측정 ${formatDateTime(record.time)}`
                          : "아직 측정된 값이 없습니다"}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {live.alerts.length > 0 && (
            <Card className="bg-muted border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">방금 올라온 경보</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {live.alerts.slice(0, 5).map((alert, i) => (
                  <div key={`${alert.timestamp}-${i}`} className="flex items-start gap-2 text-sm">
                    <AlertTriangle
                      className={`w-4 h-4 mt-0.5 shrink-0 ${alert.severity === "danger" ? "text-red-500" : "text-amber-500"}`}
                    />
                    <div className="min-w-0">
                      <p className="truncate">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(alert.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── 실시간 ─────────────────────────── */}
        <TabsContent value="monitor" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={selectedCamera?.id ?? ""} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="w-[240px]"><SelectValue placeholder="카메라 선택" /></SelectTrigger>
              <SelectContent>
                {cameras.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={showBoxes ? "ocean" : "outline"}
              onClick={() => setShowBoxes(v => !v)}
            >
              탐지 박스 {showBoxes ? "켜짐" : "꺼짐"}
            </Button>
          </div>

          {selectedCamera && (
            <StreamView
              key={selectedCamera.id}
              camera={selectedCamera}
              live={live.latest[selectedCamera.id]}
              status={live.statuses[selectedCamera.id]}
              showBoxes={showBoxes}
              stream={live.stream}
            />
          )}

          {cameras.length > 1 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cameras.filter(c => c.id !== selectedCamera?.id).map(camera => (
                <button
                  key={camera.id}
                  onClick={() => setSelectedCameraId(camera.id)}
                  className="text-left"
                >
                  <StreamView
                    key={camera.id}
                    camera={camera}
                    live={live.latest[camera.id]}
                    status={live.statuses[camera.id]}
                    showBoxes={false}
                    stream={live.stream}
                  />
                  <p className="text-xs text-muted-foreground mt-1 truncate px-0.5">{camera.name}</p>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── 이력 ─────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={selectedCamera?.id ?? ""} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="w-[240px]"><SelectValue placeholder="카메라 선택" /></SelectTrigger>
              <SelectContent>
                {cameras.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1.5">
              {HISTORY_RANGES.map(rg => (
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
            <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
              <Download className="w-3.5 h-3.5" /> CSV 내보내기
            </Button>
          </div>

          <Card className="bg-muted border-border">
            <CardContent className="pt-5">
              {historyLoading ? (
                <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
                  불러오는 중…
                </div>
              ) : chartData.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
                  이 기간에 쌓인 기록이 없습니다.
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <defs>
                        <linearGradient id="countFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" width={52} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(value) =>
                          [typeof value === "number" ? `${value.toLocaleString()}마리` : String(value ?? "—"), "평균 개체수"]}
                      />
                      <Area
                        type="monotone" dataKey="avg_count" name="평균 개체수"
                        stroke="#14b8a6" strokeWidth={2} fill="url(#countFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 통합 분석 ─────────────────────────── */}
        <TabsContent value="analysis" className="space-y-4">
          <Select
            value={selectedTank?.id ?? ""}
            onValueChange={id => {
              // 수조를 고르면 그 수조의 카메라로 선택을 옮긴다 — 다른 탭으로
              // 넘어갔을 때 보고 있던 수조와 어긋나지 않게 한다.
              const camera = cameras.find(c => c.tank_id === id)
              if (camera) setSelectedCameraId(camera.id)
            }}
          >
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="수조 선택" /></SelectTrigger>
            <SelectContent>
              {tanks
                .filter(t => cameras.some(c => c.tank_id === t.id))
                .map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {selectedTank ? (
            <CountWaterQualityAnalysis tank={selectedTank} />
          ) : (
            <Card className="bg-muted border-border">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                카메라가 달린 수조가 없습니다.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── 설정 ─────────────────────────── */}
        <TabsContent value="settings">
          <CameraSettings
            tanks={tanks}
            cameras={cameras}
            statuses={live.statuses}
            configs={configs}
            onChanged={() => { load().catch(() => {}) }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
