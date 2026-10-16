"use client"

// 관제센터 — 옛 app/(dashboard)/control/page.tsx 를 그대로 옮겼다(설계서 admin-console.md
// 5·6장). 매니저 선임 패널만 /admin/managers(components/admin/manager-panel.tsx)로 뗐다.
// 지도 표시 필터·위치 미확인 목록은 docs/plans/control-map-farms.md 2-5·2-7.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Building2, Layers, Cpu, AlertTriangle, WifiOff,
  Crown, Maximize2, Square, SquareCheck, MapPinOff,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/lib/auth-context"
import { useAutoRefresh, sinceLabel } from "@/lib/use-auto-refresh"
import {
  ControlMap, countMarkers, isLocated,
  type ControlFarm, type DeviceMarker, type MapFilter, type MapTypeFilter, type MapView,
} from "@/components/control/control-map"
import { formatDateTime } from "@/lib/utils"
import { LoadProblemView, StatsLoading, problemOf, type LoadProblem } from "@/components/admin/stats-status"

// ── 응답 형태 ────────────────────────────────────────────────────────────────
type Overview = {
  role: "super_admin" | "manager"
  stats: {
    farms: number
    tanks: number
    tank_status: { active: number; warning: number; danger: number; inactive: number }
    devices: number
    devices_online: number
    open_alerts: number
    farms_located?: number
  }
  farms: ControlFarm[]
  device_markers?: DeviceMarker[]
  offline_devices: { id: string; name: string; serial: string | null; version: string | null; last_seen_at: string | null }[]
  alerts: { id: string; type: string; parameter: string | null; value: number | null; message: string; created_at: string; tank_name: string; farm_name: string }[]
}

function StatTile({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "danger" | "warn"
}) {
  return (
    <Card className={`bg-card border ${tone === "danger" ? "border-red-500/40" : tone === "warn" ? "border-amber-500/40" : "border-border"}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">{icon}{label}</div>
        <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ── 지도 표시 필터 ↔ URL 쿼리(?view=farms&type=shrimp&issues=1) ────────────────
const VIEW_OPTIONS: { key: MapView; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "farms", label: "농장만" },
  { key: "sensors", label: "수질센서만" },
]
const TYPE_OPTIONS: { key: MapTypeFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "shrimp", label: "양식장" },
  { key: "agriculture", label: "스마트팜" },
]

/** 쿼리 → 필터. 모르는 값은 기본값으로(화이트리스트). */
function parseFilter(sp: { get(name: string): string | null }): MapFilter {
  const v = sp.get("view")
  const t = sp.get("type")
  return {
    view: v === "farms" || v === "sensors" ? v : "all",
    type: t === "shrimp" || t === "agriculture" ? t : "all",
    issuesOnly: sp.get("issues") === "1",
  }
}

const sameFilter = (a: MapFilter, b: MapFilter) =>
  a.view === b.view && a.type === b.type && a.issuesOnly === b.issuesOnly

const SEG_BASE = "min-h-[36px] px-3 rounded-md text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
const SEG_ON = "bg-foreground text-background"
const SEG_OFF = "text-muted-foreground hover:text-foreground hover:bg-accent"

function Segmented<K extends string>({ label, options, value, counts, onChange }: {
  label: string
  options: { key: K; label: string }[]
  value: K
  counts?: Partial<Record<K, number>>
  onChange: (k: K) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-lg border border-border p-0.5">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`${SEG_BASE} ${value === o.key ? SEG_ON : SEG_OFF}`}
        >
          {o.label}
          {counts?.[o.key] !== undefined && <span className="tabular-nums opacity-80">{counts[o.key]}</span>}
        </button>
      ))}
    </div>
  )
}

function Spinner() {
  return <StatsLoading label="관제센터 불러오는 중" />
}

/** 불러오기 실패 — 문제 종류(500·503)를 실어 던진다. 자동갱신 중의 일시 실패는
 *  useAutoRefresh 가 삼키고 이전 화면을 유지한다. */
function loadError(problem: LoadProblem) {
  return Object.assign(new Error(problem), { problem })
}
const problemFromError = (e: unknown): LoadProblem =>
  (e as { problem?: LoadProblem } | null)?.problem ?? "failed"

/** `useSearchParams` 는 Suspense 경계가 필요하다(Next 문서 — 없으면 프로덕션 빌드가
 *  실패한다). 페이지 래퍼(app/(admin)/admin/control/page.tsx)는 그대로 두고 여기서 감싼다. */
export function ControlCenterView() {
  return (
    <Suspense fallback={<Spinner />}>
      <ControlCenterInner />
    </Suspense>
  )
}

function ControlCenterInner() {
  const { loading: authLoading } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [problem, setProblem] = useState<LoadProblem | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)

  // 필터는 URL 이 원본이다(새로고침·공유해도 유지). router.replace 가 반영되기 전
  // 잠깐은 누른 값(pending)을 먼저 보여 준다 — 버튼이 한 박자 늦게 바뀌지 않게.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlFilter = useMemo(() => parseFilter(searchParams), [searchParams])
  const [pending, setPending] = useState<MapFilter | null>(null)
  if (pending && sameFilter(pending, urlFilter)) setPending(null)   // URL 이 따라잡음
  const filter = pending ?? urlFilter
  const [fitSignal, setFitSignal] = useState(0)

  const setFilter = (patch: Partial<MapFilter>) => {
    const next = { ...filter, ...patch }
    setPending(next)
    const qs = new URLSearchParams(searchParams.toString())
    if (next.view === "all") qs.delete("view"); else qs.set("view", next.view)
    if (next.type === "all") qs.delete("type"); else qs.set("type", next.type)
    if (next.issuesOnly) qs.set("issues", "1"); else qs.delete("issues")
    const q = qs.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/control/overview", { cache: "no-store" })
    if (!res.ok) {
      const p = problemOf(res.status)
      // 권한 거절은 자동갱신 중이라도 곧바로 보여 준다(선임 해제 등).
      if (p === "forbidden") { setProblem(p); setLoading(false); return }
      throw loadError(p)
    }
    setData(await res.json())
    setProblem(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authLoading) return
    let alive = true
    // setState 가 effect 본문에서 동기로 불리지 않도록 한 틱 미룬다.
    const t = setTimeout(() => {
      load().catch(e => { if (alive) { setProblem(problemFromError(e)); setLoading(false) } })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [authLoading, load])

  async function retry() {
    setRetrying(true)
    try { await load() } catch (e) { setProblem(problemFromError(e)) }
    setRetrying(false)
  }

  // 관제 화면은 계속 켜 두고 보는 화면이다. 측정 주기에 맞춰 1분마다 따라간다.
  const { lastRefreshed } = useAutoRefresh(load, 60, !problem && !loading)

  if (loading || authLoading) return <Spinner />

  // 권한 판별은 서버가 한다. 이 화면은 결과를 보여 줄 뿐이다.
  if (problem || !data) {
    return (
      <LoadProblemView
        problem={problem ?? "failed"}
        onRetry={retry}
        retrying={retrying}
        body={problem === "forbidden"
          ? "관제센터는 관리자와 매니저만 볼 수 있습니다. 필요하면 총관리자에게 선임을 요청하세요."
          : problem === "failed" || !problem ? "관제 현황을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." : undefined}
      />
    )
  }

  const s = data.stats
  const markers = data.device_markers ?? []
  const counts = countMarkers(data.farms, markers, filter)
  const unlocated = data.farms.filter(f => !isLocated(f))

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      {/* 셸 머리(h1 "관제센터")와 같은 이름이라 데스크톱에서는 제목만 숨긴다. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground lg:sr-only">관제센터</h2>
          <p className="text-muted-foreground text-sm mt-0.5 lg:mt-0 flex flex-wrap items-center gap-2">
            플랫폼 전체 농장·수조·기기 현황
            {data.role === "super_admin" && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-foreground text-background inline-flex items-center gap-1">
                <Crown className="w-3 h-3" aria-hidden="true" /> 총관리자
              </span>
            )}
          </p>
        </div>
        {lastRefreshed && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            1분마다 자동갱신 · 마지막 {sinceLabel(lastRefreshed)}
          </p>
        )}
      </div>

      {/* 요약 — 급한 것부터 색으로 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<Building2 className="w-4 h-4" />} label="농장" value={s.farms}
          sub={`수조 ${s.tanks}개${s.farms_located !== undefined ? ` · 지도 ${s.farms_located}곳` : ""}`}
        />
        <StatTile
          icon={<Layers className="w-4 h-4" />} label="수조 상태"
          value={<span>
            <span className="text-emerald-500">{s.tank_status.active}</span>
            <span className="text-muted-foreground text-base font-medium"> / </span>
            <span className="text-amber-500">{s.tank_status.warning}</span>
            <span className="text-muted-foreground text-base font-medium"> / </span>
            <span className="text-red-500">{s.tank_status.danger}</span>
          </span>}
          sub="정상 / 주의 / 위험"
          tone={s.tank_status.danger > 0 ? "danger" : s.tank_status.warning > 0 ? "warn" : undefined}
        />
        <StatTile
          icon={<Cpu className="w-4 h-4" />} label="기기"
          value={`${s.devices_online}/${s.devices}`} sub="온라인 / 활성"
          tone={s.devices - s.devices_online > 0 ? "warn" : undefined}
        />
        <StatTile
          icon={<AlertTriangle className="w-4 h-4" />} label="미해결 알림"
          value={s.open_alerts} sub={s.open_alerts ? "확인이 필요합니다" : "없음"}
          tone={s.open_alerts > 0 ? "danger" : undefined}
        />
      </div>

      {/* 지도 — 관제의 중심 */}
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-3 space-y-3">
          {/* 표시 필터 — 바꿔도 지도를 다시 만들지 않는다(확대 유지). 숫자는 지금의
              유형·문제 필터 기준으로 지도에 찍히는 표식 수. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Segmented
              label="보기" options={VIEW_OPTIONS} value={filter.view}
              counts={{ all: counts.all, farms: counts.farms, sensors: counts.sensors }}
              onChange={view => setFilter({ view })}
            />
            <div className="inline-flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">유형</span>
              <Segmented label="농장 유형" options={TYPE_OPTIONS} value={filter.type} onChange={type => setFilter({ type })} />
            </div>
            <button
              type="button"
              aria-pressed={filter.issuesOnly}
              onClick={() => setFilter({ issuesOnly: !filter.issuesOnly })}
              className={`${SEG_BASE} border border-border ${filter.issuesOnly ? SEG_ON : SEG_OFF}`}
            >
              {filter.issuesOnly
                ? <SquareCheck className="w-4 h-4" aria-hidden="true" />
                : <Square className="w-4 h-4" aria-hidden="true" />}
              문제 있는 곳만
            </button>
            <button
              type="button"
              onClick={() => setFitSignal(n => n + 1)}
              className={`${SEG_BASE} border border-border ${SEG_OFF} sm:ml-auto`}
            >
              <Maximize2 className="w-4 h-4" aria-hidden="true" /> 전체 맞춤
            </button>
          </div>

          <ControlMap
            farms={data.farms} deviceMarkers={markers} height={420}
            view={filter.view} type={filter.type} issuesOnly={filter.issuesOnly} fitSignal={fitSignal}
          />

          {/* 위치 미확인 농장 — 관리자가 농가에 좌표·주소 입력을 안내할 수 있게. */}
          {unlocated.length > 0 && (
            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer select-none min-h-[36px] px-3 py-2 text-sm text-foreground flex items-center gap-2">
                <MapPinOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                위치 미확인 농장 <span className="tabular-nums">{unlocated.length}</span>곳
              </summary>
              <ul className="max-h-[280px] overflow-y-auto divide-y divide-border border-t border-border">
                {unlocated.map(f => (
                  <li key={f.id} className="px-3 py-2 text-sm min-w-0">
                    <p className="text-foreground font-medium truncate">
                      {f.name} <span className="text-muted-foreground font-normal">· {f.owner}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{f.location?.trim() ? f.location : "주소 미입력"}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* 끊긴 기기 — 값이 안 오는 농장은 사고를 볼 수 없다 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-base flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-red-500" /> 끊긴 기기
              <span className="text-xs text-muted-foreground font-normal">({data.offline_devices.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.offline_devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">모든 기기가 정상 수신 중입니다.</p>
            ) : data.offline_devices.map(d => (
              <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg border border-red-500/25 bg-red-500/5">
                <div className="min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{d.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">
                    {d.serial ?? "시리얼 없음"}{d.version ? ` · v${d.version}` : ""}
                  </p>
                </div>
                <span className="text-xs text-red-500 shrink-0 ml-2">
                  {d.last_seen_at ? `마지막 ${formatDateTime(d.last_seen_at)}` : "수신 기록 없음"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 알림 스트림 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-foreground text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> 미해결 알림
              <span className="text-xs text-muted-foreground font-normal">({data.alerts.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[340px] overflow-y-auto">
            {data.alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">미해결 알림이 없습니다.</p>
            ) : data.alerts.map(a => (
              <div key={a.id} className={`p-2.5 rounded-lg border text-sm ${
                a.type === "danger" ? "border-red-500/25 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5"
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-foreground font-medium truncate" title={a.message}>{a.message}</p>
                  <span className="text-[11px] text-muted-foreground shrink-0">{formatDateTime(a.created_at)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{a.farm_name} · {a.tank_name}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
