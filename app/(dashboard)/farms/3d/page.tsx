"use client"

import { useState, useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  Box, Building2, Eye, EyeOff, Layers, Ruler, Droplets,
  Thermometer, Wind, AlertTriangle, Info, Compass,
} from "lucide-react"
import { MOCK_FARMS, MOCK_TANKS, MOCK_WATER_QUALITY, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getFarms, getTanksByFarm, getLatestWaterQuality } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MUAN_LAYOUT, polygonArea, spansToPositions, tankArea, tankVolume } from "@/lib/farm3d/layout"
import type { ViewKey } from "@/components/farm3d/farm-3d-viewer"
import { STATUS_COLOR } from "@/components/farm3d/scene"
import type { Farm, Tank, WaterQualityReading } from "@/types"

// three.js 는 window 를 직접 만지므로 서버에서 부르면 터진다. 이 페이지가
// 클라이언트 컴포넌트라서 ssr:false 를 쓸 수 있다 (서버 컴포넌트에서는 금지).
// 덤으로 3D 번들이 다른 화면의 첫 로딩에 끼어들지 않는다.
const Farm3DViewer = dynamic(() => import("@/components/farm3d/farm-3d-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-500/30 border-t-ocean-500" />
        <p className="text-sm text-slate-400">3D 도면 불러오는 중…</p>
      </div>
    </div>
  ),
})

const VIEW_LABEL: Record<ViewKey, string> = {
  overview: "전체",
  top: "위에서",
  front: "정면",
}

const STATUS_LABEL: Record<Tank["status"], string> = {
  active: "정상",
  warning: "주의",
  danger: "위험",
  inactive: "비어 있음",
}

const STATUS_BADGE: Record<Tank["status"], "success" | "warning" | "danger" | "secondary"> = {
  active: "success",
  warning: "warning",
  danger: "danger",
  inactive: "secondary",
}

/** DB 수조를 3D 자리에 붙인다.
 *
 *  지금은 이름순으로 1번·2번 자리에 차례로 넣는다. 수조마다 자리를 지정하는
 *  필드를 두는 게 맞지만, 그 전까지는 순서 매핑이 가장 덜 틀린다. 자리보다
 *  수조가 많으면 남는 수조는 3D 에 안 나오므로 화면에서 그 수를 알려 준다. */
function mapTanksToSlots(slots: string[], tanks: Tank[]): Record<string, Tank> {
  const sorted = [...tanks].sort((a, b) => a.name.localeCompare(b.name, "ko"))
  const out: Record<string, Tank> = {}
  slots.forEach((slot, i) => {
    if (sorted[i]) out[slot] = sorted[i]
  })
  return out
}

export default function Farm3DPage() {
  const { user } = useAuth()
  const layout = MUAN_LAYOUT

  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showRoof, setShowRoof] = useState(true)
  const [view, setView] = useState<ViewKey>("overview")

  // ─── 데이터 ────────────────────────────────────────────────────────────────
  //
  // 테스트 계정은 목 데이터를 쓰므로 서버를 부를 일이 없다. 그런 값을 상태에
  // 담아 두면 이펙트가 렌더를 한 번 더 돌리게 되므로, 목은 렌더 중에 정하고
  // 상태에는 실제로 서버에서 받아온 것만 담는다.
  const mock = isTestAccount(user?.email)

  const [remoteFarms, setRemoteFarms] = useState<Farm[] | null>(null)
  // 어느 양식장 것인지 같이 들고 있어야, 양식장을 바꾼 직후 이전 수조가
  // 잠깐 남아 보이는 일이 없다.
  const [remoteTanks, setRemoteTanks] = useState<{ farmId: string; rows: Tank[] } | null>(null)
  const [remoteWq, setRemoteWq] = useState<{ tankId: string; row: WaterQualityReading | null } | null>(null)
  const [pickedFarmId, setPickedFarmId] = useState("")

  const farms = mock ? MOCK_FARMS : remoteFarms ?? []
  const loading = !mock && remoteFarms === null
  // 아직 안 고른 상태면 첫 양식장을 본다.
  const farmId = pickedFarmId || farms[0]?.id || ""

  const tanks = useMemo(
    () => mock
      ? MOCK_TANKS.filter(t => t.farm_id === farmId)
      : remoteTanks?.farmId === farmId ? remoteTanks.rows : [],
    [mock, farmId, remoteTanks],
  )

  useEffect(() => {
    if (mock) return
    let alive = true
    getFarms()
      .then(rows => { if (alive) setRemoteFarms(rows) })
      .catch(() => { if (alive) setRemoteFarms([]) })
    return () => { alive = false }
  }, [mock])

  useEffect(() => {
    if (mock || !farmId) return
    let alive = true
    getTanksByFarm(farmId)
      .then(rows => { if (alive) setRemoteTanks({ farmId, rows }) })
      .catch(() => { if (alive) setRemoteTanks({ farmId, rows: [] }) })
    return () => { alive = false }
  }, [mock, farmId])

  const slotNames = useMemo(() => layout.tanks.map(t => t.slot), [layout.tanks])
  const tankBySlot = useMemo(() => mapTanksToSlots(slotNames, tanks), [slotNames, tanks])

  const selectedSpec = layout.tanks.find(t => t.slot === selected) ?? null
  const selectedTank = selected ? tankBySlot[selected] ?? null : null
  const selectedTankId = selectedTank?.id ?? null

  // 선택한 수조의 최근 수질. 고를 때마다 한 건만 읽는다.
  useEffect(() => {
    if (mock || !selectedTankId) return
    let alive = true
    getLatestWaterQuality(selectedTankId)
      .then(row => { if (alive) setRemoteWq({ tankId: selectedTankId, row }) })
      .catch(() => { if (alive) setRemoteWq({ tankId: selectedTankId, row: null }) })
    return () => { alive = false }
  }, [mock, selectedTankId])

  const latest: WaterQualityReading | null = !selectedTankId
    ? null
    : mock
      ? (MOCK_WATER_QUALITY[selectedTankId]?.slice(-1)[0] ?? null)
      : remoteWq?.tankId === selectedTankId ? remoteWq.row : null

  // ─── 도면 요약 ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const area = polygonArea(layout.building.footprint)
    const water = layout.tanks.reduce((sum, t) => sum + tankVolume(t), 0)
    return {
      site: `${layout.site.width} × ${layout.site.depth} m`,
      area,
      areaMatchesDrawing: Math.abs(area - layout.building.floorAreaFromDrawing) < 0.05,
      columns: spansToPositions(layout.columns.xSpans).length,
      tankCount: layout.tanks.length,
      tankArea: layout.tanks.reduce((sum, t) => sum + tankArea(t), 0),
      water,
    }
  }, [layout])

  const unplaced = Math.max(0, tanks.length - layout.tanks.length)

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-500/30 border-t-ocean-500" />
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Box className="h-5 w-5 shrink-0 text-ocean-500" />
            <span className="truncate">{layout.name} 3D 도면</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            가설건축물(새우양식장) 지상 1층 평면도를 그대로 세운 모형입니다. 수조를 누르면 상태와 수질이 나옵니다.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/farms">
            <Building2 className="mr-1.5 h-4 w-4" /> 양식장 관리
          </Link>
        </Button>
      </div>

      {/* 도면 요약 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={<Ruler className="h-4 w-4" />} label="대지" value={stats.site} sub="도면 63,000 × 27,000" />
        <SummaryCard
          icon={<Layers className="h-4 w-4" />}
          label="연면적"
          value={`${stats.area.toLocaleString("ko-KR")} m²`}
          sub={stats.areaMatchesDrawing ? "도면 산식과 일치" : "⚠ 도면 산식과 불일치"}
        />
        <SummaryCard icon={<Compass className="h-4 w-4" />} label="기둥 열" value={`X ${stats.columns}열`} sub="4.0 + 3.0×18 + 1.0 + 4.0" />
        <SummaryCard
          icon={<Droplets className="h-4 w-4" />}
          label="사각 수조"
          value={`${stats.tankCount}기 · ${stats.tankArea.toLocaleString("ko-KR")} m²`}
          sub={`담수 약 ${Math.round(stats.water).toLocaleString("ko-KR")} m³`}
        />
      </div>

      {/* 3D + 상세 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden border-border bg-card">
          {/* 툴바 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              {farms.length > 0 && (
                <Select value={farmId} onValueChange={setPickedFarmId}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue placeholder="양식장 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {farms.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant={showRoof ? "secondary" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => setShowRoof(v => !v)}
              >
                {showRoof ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
                지붕
              </Button>
            </div>

            <div className="flex items-center gap-1">
              {(Object.keys(VIEW_LABEL) as ViewKey[]).map(k => (
                <Button
                  key={k}
                  variant={view === k ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setView(k)}
                >
                  {VIEW_LABEL[k]}
                </Button>
              ))}
            </div>
          </div>

          {/* 캔버스 */}
          <div className="h-[420px] w-full bg-slate-950 sm:h-[520px] lg:h-[600px]">
            <Farm3DViewer
              layout={layout}
              tankBySlot={tankBySlot}
              selected={selected}
              hovered={hovered}
              onSelect={setSelected}
              onHover={setHovered}
              showRoof={showRoof}
              view={view}
            />
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {(Object.keys(STATUS_LABEL) as Tank["status"][]).map(s => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="ml-auto">드래그 회전 · 휠 확대 · 수조 클릭</span>
          </div>
        </Card>

        {/* 상세 패널 */}
        <div className="space-y-3">
          {selectedSpec ? (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate text-base text-foreground">
                    {selectedTank?.name ?? selectedSpec.label}
                  </CardTitle>
                  <Badge variant={STATUS_BADGE[selectedTank?.status ?? "inactive"]}>
                    {STATUS_LABEL[selectedTank?.status ?? "inactive"]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Row
                  label="수조 면적"
                  value={`${tankArea(selectedSpec).toLocaleString("ko-KR")} m² (도면 ${selectedSpec.areaFromDrawing})`}
                />
                <Row label="수심 · 벽 높이" value={`${selectedSpec.waterDepth} m · ${selectedSpec.wallHeight} m`} />
                <Row label="담수량" value={`약 ${Math.round(tankVolume(selectedSpec)).toLocaleString("ko-KR")} m³`} />

                {selectedTank ? (
                  <>
                    <div className="border-t border-border pt-3">
                      <Row label="사육일차" value={`${selectedTank.cycle_day}일차`} />
                      <Row label="사육 마릿수" value={`${selectedTank.shrimp_count.toLocaleString("ko-KR")} 마리`} />
                      <Row label="수용밀도" value={`${selectedTank.stocking_density} 마리/m³`} />
                    </div>

                    <div className="border-t border-border pt-3">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">최근 수질</p>
                      {latest ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Metric icon={<Thermometer className="h-3.5 w-3.5" />} label="수온" value={`${latest.temperature.toFixed(1)}°C`} />
                          <Metric icon={<Droplets className="h-3.5 w-3.5" />} label="pH" value={latest.ph.toFixed(2)} />
                          <Metric icon={<Wind className="h-3.5 w-3.5" />} label="DO" value={`${latest.do_level.toFixed(1)} mg/L`} />
                          <Metric icon={<AlertTriangle className="h-3.5 w-3.5" />} label="암모니아" value={`${latest.ammonia.toFixed(2)} mg/L`} />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">측정 기록이 없습니다.</p>
                      )}
                    </div>

                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link href="/water-quality">수질 상세 보기</Link>
                    </Button>
                  </>
                ) : (
                  <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                    이 자리에 연결된 수조가 아직 없습니다.{" "}
                    <Link href="/farms" className="text-ocean-500 hover:underline">양식장 관리</Link>
                    에서 수조를 추가하면 여기에 붙습니다.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border bg-card">
              <CardContent className="py-8 text-center">
                <Box className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">수조를 누르면 상세가 나옵니다.</p>
              </CardContent>
            </Card>
          )}

          {/* 도면에서 못 읽은 값 고지 */}
          <Card className="border-amber-500/25 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm text-foreground">
                <Info className="h-4 w-4 text-amber-500" /> 확인이 필요한 값
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                {layout.assumptions.map((a, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-amber-500">·</span>
                    <span>{a}</span>
                  </li>
                ))}
                {unplaced > 0 && (
                  <li className="flex gap-1.5">
                    <span className="text-amber-500">·</span>
                    <span>등록된 수조 {tanks.length}기 중 {unplaced}기는 3D 자리가 모자라 표시되지 않습니다.</span>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── 작은 조각들 ──────────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3.5">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-ocean-500">{icon}</span>
          {label}
        </div>
        <p className="text-lg font-bold leading-tight text-foreground">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</p>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium text-foreground">{value}</span>
    </div>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="text-ocean-500">{icon}</span>
        {label}
      </div>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}
