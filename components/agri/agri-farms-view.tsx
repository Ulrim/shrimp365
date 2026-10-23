"use client"

// 농장·기기 관리(농업 전용 화면, /daumlabs/farms) — 설계서 mode-split.md 5장, 수아 시안 5-8.
//
// 농업 농장(`farm_type === "agriculture"`)만 다룬다. 새우 농장은 보이지 않고 교차 링크도
// 없다(화면 전환은 헤더 스위치가 한다). 데이터는 lib/db 함수만 쓰고, 조각은
// components/agri/farms/* 에 있다. 지도·좌표 입력·기기 연결은 기존 조각을 import 하고,
// 조각 안의 한국어 문구는 labels props 로 농업 사전(4개 언어)을 넘긴다.
import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Building2, MapPin, Ruler, Sprout, UserRound } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { AgriPageHeader } from "@/components/agri/agri-page-header"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { FarmMap } from "@/components/farms/farm-map"
import { useAuth } from "@/lib/auth-context"
import { getAllTanks, getFarms } from "@/lib/db"
import { useAgriT } from "@/lib/i18n-context"
import { isTestAccount, MOCK_FARMS, MOCK_TANKS } from "@/lib/mock-data"
import { cn, formatDate } from "@/lib/utils"
import type { Farm, Tank } from "@/types"
import { FarmCard } from "./farms/farm-card"
import { AddFarmDialog, DeleteFarmDialog, EditFarmDialog } from "./farms/farm-dialogs"
import { BedCard } from "./farms/bed-card"
import { AddBedDialog } from "./farms/bed-dialogs"
import { fill } from "./farms/form-styles"

/** 이 화면의 데이터 필터 한 줄 — 농업 농장(과 그 베드)만. */
const isAgri = (x: { farm_type?: "shrimp" | "agriculture" }) => x.farm_type === "agriculture"

interface Loaded { farms: Farm[]; tanks: Tank[] }

async function loadAll(mock: boolean): Promise<Loaded> {
  if (mock) {
    return { farms: MOCK_FARMS.filter(isAgri), tanks: MOCK_TANKS.filter(isAgri) }
  }
  // 베드는 getAllTanks 한 번으로 받는다 — farms 조인이 farm_type 을 실어 주고,
  // 왼쪽 농장 카드의 상태 요약과 지도 마커가 펼치지 않은 농장의 베드도 필요로 한다.
  const [farms, tanks] = await Promise.all([getFarms(), getAllTanks()])
  return { farms: farms.filter(isAgri), tanks: tanks.filter(isAgri) }
}

function Skeleton({ className }: { className: string }) {
  return <div className={cn("animate-pulse motion-reduce:animate-none bg-muted rounded-xl", className)} aria-hidden="true" />
}

export function AgriFarmsView() {
  const { user } = useAuth()
  const d = useAgriT()
  const mock = isTestAccount(user?.email)

  const [farms, setFarms] = useState<Farm[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [selectedFarmId, setSelectedFarmId] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 첫 로드·다시 시도. 로딩 플래그는 다시 시도 버튼(이벤트)에서 올린다.
  useEffect(() => {
    let alive = true
    loadAll(mock)
      .then(res => {
        if (!alive) return
        setFarms(res.farms)
        setTanks(res.tanks)
        setLoadError(false)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      })
    return () => { alive = false }
  }, [mock, retry])

  // 배포된 최신 수집기 버전 — 정적 파일이라 한 번만 받아 베드 카드 전부에 내려준다.
  useEffect(() => {
    let alive = true
    fetch("/updates/manifest.json")
      .then(r => (r.ok ? r.json() : null))
      .then(m => { if (alive) setLatestVersion(typeof m?.latest === "string" ? m.latest : "") })
      .catch(() => { if (alive) setLatestVersion("") })
    return () => { alive = false }
  }, [])

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  /** 저장·삭제 뒤 재조회. 낙관적 갱신은 하지 않는다(createTank 가 반환이 없다). */
  const refresh = useCallback(async (message?: string) => {
    try {
      const res = await loadAll(mock)
      setFarms(res.farms)
      setTanks(res.tanks)
    } catch { /* 목록은 다음 조회에서 맞춰진다 — 토스트는 그대로 띄운다 */ }
    if (message) showToast(message)
  }, [mock, showToast])

  // 선택 농장은 파생값이다 — 삭제·유형 변경으로 목록에서 빠지면 첫 농장으로 돌아간다.
  const selectedFarm = farms.find(f => f.id === selectedFarmId) ?? farms[0]
  const selectedBeds = selectedFarm ? tanks.filter(tk => tk.farm_id === selectedFarm.id) : []
  const located = farms.filter(f => f.latitude !== null && f.longitude !== null)

  return (
    <div className="space-y-6 animate-fade-in">
      <AgriPageHeader
        icon={Building2}
        title={d.farms.title}
        subtitle={d.farms.subtitle}
        actions={!loading && !loadError && farms.length > 0 && (
          <AddFarmDialog onSuccess={() => refresh(d.farms.farmCreated)} />
        )}
      />

      {loading ? (
        <div className="flex flex-col lg:flex-row gap-5 items-start" role="status" aria-label={d.common.loading}>
          <div className="w-full lg:w-72 lg:shrink-0 space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : loadError ? (
        <div role="alert" className="flex flex-col items-center justify-center text-center gap-3 py-16 px-4">
          <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
          <p className="text-lg font-semibold text-foreground">{d.common.loadErrorTitle}</p>
          <p className="text-sm text-muted-foreground max-w-sm">{d.common.loadErrorMsg}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); setLoadError(false); setRetry(n => n + 1) }}
            className="mt-1 inline-flex items-center justify-center min-h-[44px] px-6 rounded-xl bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
          >
            {d.common.retry}
          </button>
        </div>
      ) : farms.length === 0 ? (
        <AgriEmptyState icon={Building2} title={d.farms.noFarms} description={d.farms.noFarmsMsg}>
          <AddFarmDialog variant="cta" onSuccess={() => refresh(d.farms.farmCreated)} />
        </AgriEmptyState>
      ) : (
        <>
          {/* 농장 위치 — 좌표를 넣은 농장이 하나라도 있을 때만. 지도 조각은 그대로 import. */}
          {located.length > 0 && (
            <section aria-label={d.farms.mapAria}>
              <FarmMap
                farms={farms}
                tanks={tanks}
                farmsHref="/daumlabs/farms"
                labels={{
                  title: d.farms.mapTitle,
                  tankCountN: d.farms.mapBedCountN,
                  danger: d.common.status.danger,
                  warning: d.common.status.warning,
                  noCoordsMsg: d.farms.mapNoCoordsMsg,
                  mapAria: d.farms.mapAria,
                  locatedN: d.farms.mapLocatedN,
                  missingN: d.farms.mapMissingN,
                  addCoords: d.farms.mapAddCoords,
                }}
              />
            </section>
          )}

          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* ── 왼쪽: 농장 목록 + 선택 농장 정보 ── */}
            <div className="w-full lg:w-72 lg:shrink-0 space-y-3">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider px-1 tabular-nums">
                {d.farms.farmsHeading} ({farms.length})
              </p>
              {farms.map(farm => (
                <FarmCard
                  key={farm.id}
                  farm={farm}
                  tanks={tanks.filter(tk => tk.farm_id === farm.id)}
                  selected={selectedFarm?.id === farm.id}
                  onSelect={() => setSelectedFarmId(farm.id)}
                />
              ))}

              {selectedFarm && (
                <Card className="bg-card border-border mt-2">
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{d.farms.farmInfo}</p>
                      <div className="flex items-center gap-0.5">
                        <EditFarmDialog
                          farm={selectedFarm}
                          onSuccess={({ movedOut }) => refresh(movedOut ? d.farms.farmMoved : d.farms.farmUpdated)}
                        />
                        <DeleteFarmDialog farm={selectedFarm} onSuccess={() => refresh(d.farms.farmDeleted)} />
                      </div>
                    </div>
                    <dl className="space-y-2 text-xs">
                      <div className="flex items-start gap-2">
                        <dt className="text-muted-foreground shrink-0 flex items-center gap-1 min-w-[4.5rem]">
                          <MapPin className="w-3 h-3" aria-hidden="true" /> {d.farms.address}
                        </dt>
                        <dd className="text-foreground font-medium min-w-0 break-words">{selectedFarm.location || "—"}</dd>
                      </div>
                      <div className="flex items-start gap-2">
                        <dt className="text-muted-foreground shrink-0 flex items-center gap-1 min-w-[4.5rem]">
                          <UserRound className="w-3 h-3" aria-hidden="true" /> {d.farms.owner}
                        </dt>
                        <dd className="text-foreground font-medium min-w-0 truncate">{selectedFarm.owner_name || "—"}</dd>
                      </div>
                      <div className="flex items-start gap-2">
                        <dt className="text-muted-foreground shrink-0 flex items-center gap-1 min-w-[4.5rem]">
                          <Ruler className="w-3 h-3" aria-hidden="true" /> {d.farms.area}
                        </dt>
                        <dd className="text-foreground font-medium tabular-nums">
                          {selectedFarm.area > 0 ? selectedFarm.area.toLocaleString() : "—"}
                        </dd>
                      </div>
                      <div className="flex items-start gap-2">
                        <dt className="text-muted-foreground shrink-0 min-w-[4.5rem]">{d.farms.registered}</dt>
                        <dd className="text-foreground font-medium tabular-nums">{formatDate(selectedFarm.created_at)}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── 오른쪽: 베드 그리드 ── */}
            {selectedFarm && (
              <div className="flex-1 min-w-0 w-full space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-foreground font-semibold flex items-center gap-1.5 min-w-0">
                    <Sprout className="w-4 h-4 text-brand-fg shrink-0" aria-hidden="true" />
                    <span className="truncate">{fill(d.farms.bedsHeading, { name: selectedFarm.name })}</span>
                    <span className="text-muted-foreground text-sm font-normal tabular-nums shrink-0">({selectedBeds.length})</span>
                  </h2>
                  {selectedBeds.length > 0 && (
                    <AddBedDialog farm={selectedFarm} onSuccess={() => refresh(d.farms.bedCreated)} />
                  )}
                </div>

                {selectedBeds.length === 0 ? (
                  <AgriEmptyState icon={Sprout} title={d.farms.noBeds} description={d.farms.noBedsMsg}>
                    <AddBedDialog variant="cta" farm={selectedFarm} onSuccess={() => refresh(d.farms.bedCreated)} />
                  </AgriEmptyState>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedBeds.map(tank => (
                      <BedCard key={tank.id} tank={tank} latestVersion={latestVersion} onChanged={msg => refresh(msg)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* 저장·삭제 결과 토스트 — 3초 뒤 사라진다. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 sm:bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <div className="pointer-events-auto rounded-xl border border-border bg-card text-foreground text-sm font-medium shadow-lg px-4 py-3 animate-fade-in">
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
