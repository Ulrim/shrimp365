"use client"

// 모니터링 `/daumlabs/dashboard` — 수아 시안 mode-split-ui.md 5-5.
//
// 헤더 → 알림 배너 → 통계 4칸 → 베드 현황(카드) → 양액 상태·차압 추세 → 센서별 현재값 →
// 최근 알림. 데이터는 lib/db 함수만 쓰고, 뷰 안에서 `farm_type === "agriculture"` 로
// 거른다. 농업 농장이 0개면 빈 상태 + "농장 등록하기", 베드 0개면 "베드 추가하기".
//
// 선택 베드(베드 카드 button)가 양액 상태·차압·센서 구역을 바꾼다. 선택값은 상태에
// 두되 실제 쓰는 id 는 목록에서 파생시킨다 — 베드가 사라지면 첫 베드로 떨어진다.
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT, useAgriT } from "@/lib/i18n-context"
import { getFarms, getAllTanks, getAlerts, getLatestWaterQuality, getWaterQuality, getSensorDevices, getFieldRiskLatest, resolveAlert } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { Button } from "@/components/ui/button"
import { AgriPageHeader } from "@/components/agri/agri-page-header"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { AgriLoadError } from "@/components/agri/agri-load-state"
import { NutrientStatusCard } from "@/components/sensors/nutrient-status-card"
import { DeviceCurrentValues } from "@/components/sensors/device-current-values"
import { StatCard } from "@/components/agri/dashboard/stat-card"
import { BedCard } from "@/components/agri/dashboard/bed-card"
import { DpTrendCard } from "@/components/agri/dashboard/dp-trend-card"
import { EnvironmentCard } from "@/components/agri/dashboard/environment-card"
import { RecentAlerts } from "@/components/agri/dashboard/recent-alerts"
import { agoLabel } from "@/components/agri/dashboard/time-ago"
import { FieldRiskCard } from "@/components/agri/openfield/field-risk-card"
import { isFieldAlert, fieldAlertLabel } from "@/components/agri/openfield/field-alert-label"
import { LayoutDashboard, Building2, Sprout, AlertTriangle, FlaskConical, ArrowRight, ClipboardList } from "lucide-react"
import type { Farm, Tank, Alert, WaterQualityReading, SensorDevice, FieldRiskJudgement } from "@/types"

const isAgri = (x: { farm_type?: string }) => x.farm_type === "agriculture"

/** 베드가 이 수를 넘으면 카드별 최신값 조회를 생략한다(조회 폭주 방지). */
const MAX_LATEST_LOOKUPS = 12
/** 알림 배너에 적는 베드 이름 최대 개수. */
const BANNER_NAMES = 3

interface BaseData {
  farms: Farm[]
  tanks: Tank[]
  alerts: Alert[]
  /** 베드별 최신 측정. 베드가 MAX_LATEST_LOOKUPS 를 넘으면 null(조회 안 함). */
  latest: Record<string, WaterQualityReading | null> | null
}

const EMPTY: BaseData = { farms: [], tanks: [], alerts: [], latest: {} }

// 테스트 계정은 목데이터가 전부 새우라 농업 화면에서는 빈 상태가 정상이다.
async function loadBase(mock: boolean): Promise<BaseData> {
  if (mock) return EMPTY
  const [f, tk, al] = await Promise.all([getFarms(), getAllTanks(), getAlerts(true)])
  const farms = f.filter(isAgri)
  const tanks = tk.filter(isAgri)
  const alerts = al.filter(a => isAgri(a) && !a.resolved)
  let latest: BaseData["latest"] = null
  if (tanks.length <= MAX_LATEST_LOOKUPS) {
    const rows = await Promise.all(tanks.map(t => getLatestWaterQuality(t.id).catch(() => null)))
    latest = Object.fromEntries(tanks.map((t, i) => [t.id, rows[i]]))
  }
  return { farms, tanks, alerts, latest }
}

interface TankDetail {
  wq: WaterQualityReading[]
  devices: SensorDevice[]
  /** 노지 재해위험 판단(risk × horizon 별 최신). 노지 베드가 아니면 조회하지 않는다. */
  fieldRisk: FieldRiskJudgement[]
}

// 노지 판단은 노지 베드에서만 묻는다 — 수경재배 베드는 조회 0회, 화면도 무변(openfield-merge.md 6장).
async function loadTankDetail(tankId: string, isField: boolean): Promise<TankDetail> {
  const [wq, devices, fieldRisk] = await Promise.all([
    getWaterQuality(tankId, 24).catch(() => [] as WaterQualityReading[]),
    getSensorDevices(tankId).catch(() => [] as SensorDevice[]),
    isField ? getFieldRiskLatest(tankId).catch(() => [] as FieldRiskJudgement[]) : Promise.resolve([] as FieldRiskJudgement[]),
  ])
  return { wq, devices, fieldRisk }
}

export function AgriDashboardView() {
  const { user } = useAuth()
  const { t } = useT()
  const { common, dashboard: dd, openfield: of } = useAgriT()
  const ready = !!user
  const mock = isTestAccount(user?.email)

  const [base, setBase] = useState<BaseData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [pickedTankId, setPickedTankId] = useState("")
  const [tankWq, setTankWq] = useState<WaterQualityReading[]>([])
  const [tankDevices, setTankDevices] = useState<SensorDevice[]>([])
  const [tankFieldRisk, setTankFieldRisk] = useState<FieldRiskJudgement[]>([])

  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const { farms, tanks, alerts, latest } = base

  // 고른 베드가 목록에 없으면 첫 베드로 떨어진다. 상태를 고쳐 쓰지 않고 파생시킨다.
  const selectedTankId = useMemo(() => {
    if (!tanks.length) return ""
    return tanks.some(tk => tk.id === pickedTankId) ? pickedTankId : tanks[0].id
  }, [tanks, pickedTankId])
  const selectedTank = tanks.find(tk => tk.id === selectedTankId) ?? null
  const selectedIsField = selectedTank?.tank_type === "노지"
  // 베드가 하나도 없으면 상세 상태에 남은 직전 값을 그리지 않는다.
  const visibleWq = selectedTankId ? tankWq : []
  const visibleDevices = selectedTankId ? tankDevices : []
  const visibleFieldRisk = selectedTankId && selectedIsField ? tankFieldRisk : []

  useEffect(() => {
    if (!ready) return
    let alive = true
    loadBase(mock)
      .then(d => {
        if (!alive) return
        setBase(d)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      })
    return () => { alive = false }
  }, [ready, mock, retry])

  useEffect(() => {
    if (!selectedTankId || mock) return
    let alive = true
    loadTankDetail(selectedTankId, selectedIsField).then(({ wq, devices, fieldRisk }) => {
      if (!alive) return
      setTankWq(wq)
      setTankDevices(devices)
      setTankFieldRisk(fieldRisk)
    })
    return () => { alive = false }
  }, [selectedTankId, selectedIsField, mock])

  // 센서가 1분마다 값을 올리므로 화면도 그 주기로 다시 불러온다. 이미 뜬 화면을
  // 비우지 않도록 loading 은 건드리지 않는다.
  const reload = useCallback(async () => {
    if (mock) return
    const d = await loadBase(mock)
    setBase(d)
    if (selectedTankId) {
      const { wq, devices, fieldRisk } = await loadTankDetail(selectedTankId, selectedIsField)
      setTankWq(wq)
      setTankDevices(devices)
      setTankFieldRisk(fieldRisk)
    }
  }, [mock, selectedTankId, selectedIsField])
  const { lastRefreshed } = useAutoRefresh(reload, 60, !loading && !loadError)

  const handleResolve = async (id: string) => {
    setResolveError(null)
    setResolvingId(id)
    try {
      await resolveAlert(id)
      setBase(b => ({ ...b, alerts: b.alerts.filter(a => a.id !== id) }))
    } catch {
      setResolveError(dd.resolveFailed)
    } finally {
      setResolvingId(null)
    }
  }

  const header = (
    <AgriPageHeader
      icon={LayoutDashboard}
      title={dd.title}
      subtitle={dd.subtitle}
      actions={
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button asChild variant="outline" className="min-h-[44px] flex-1 sm:flex-none">
            <Link href="/daumlabs/record/water-quality">
              <ClipboardList className="w-4 h-4" aria-hidden="true" />
              {dd.actionRecord}
            </Link>
          </Button>
          <Button asChild className="min-h-[44px] flex-1 sm:flex-none bg-brand text-white hover:bg-brand-hover">
            <Link href="/daumlabs/water-quality">
              {dd.actionNutrient}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      }
    />
  )

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in" role="status" aria-label={common.loading}>
        {header}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="h-44 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />)}
        </div>
        <div className="h-40 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriLoadError onRetry={() => { setLoadError(false); setLoading(true); setRetry(n => n + 1) }} />
      </div>
    )
  }

  if (farms.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriEmptyState icon={Building2} title={common.noFarmsTitle} description={common.noFarmsMsg} ctaLabel={common.registerFarm} ctaHref="/daumlabs/farms" />
      </div>
    )
  }

  if (tanks.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriEmptyState icon={Sprout} title={dd.noBedsTitle} description={dd.noBedsMsg} ctaLabel={dd.addBedCta} ctaHref="/daumlabs/farms" />
      </div>
    )
  }

  const counts = {
    ok: tanks.filter(tk => tk.status === "active").length,
    warn: tanks.filter(tk => tk.status === "warning").length,
    danger: tanks.filter(tk => tk.status === "danger").length,
  }
  const ecDeviations = alerts.filter(a => a.parameter === "EC").length
  const bannerNames = Array.from(new Set(alerts.map(a => a.tank_name).filter(Boolean)))
  const hasNutrient = visibleDevices.some(dv => dv.active && typeof dv.last_payload?.nut_percent === "number")
  const hasDp = visibleWq.some(r => typeof r.diff_pressure === "number")
  // 노지 재해위험 알림은 parameter 가 키("field:frost")라 alertDisplayLabel 이 모른다. 목록에 넘기기
  // 전에 **표시용 사본**의 parameter 만 농가 말로 바꾼다 — alertDisplayLabel 은 모르는 이름을
  // 그대로 돌려주므로 그 말이 이름표가 된다. 원본(처리 id·EC 집계)은 건드리지 않는다.
  const shownAlerts = alerts.map(a => isFieldAlert(a.parameter) ? { ...a, parameter: fieldAlertLabel(a.parameter, of) } : a)

  return (
    <div className="space-y-6 animate-fade-in">
      {header}

      {alerts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3 flex-wrap sm:flex-nowrap" role="alert">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">{dd.alertBanner.replace("{{count}}", String(alerts.length))}</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5 break-words">
              {bannerNames.slice(0, BANNER_NAMES).join(", ")}
              {bannerNames.length > BANNER_NAMES && ` ${dd.alertBannerMore.replace("{{n}}", String(bannerNames.length - BANNER_NAMES))}`}
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/20 text-xs min-h-[44px] w-full sm:w-auto">
            <Link href="/daumlabs/water-quality#alerts">{dd.viewAlerts}</Link>
          </Button>
        </div>
      )}

      {/* 자동갱신 표시 — 돌고 있는지 사람이 알 수 있어야 믿고 볼 수 있다 */}
      {lastRefreshed && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5" role="status">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
          {dd.autoRefresh.replace("{{ago}}", agoLabel(t.time, lastRefreshed.toISOString()))}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Building2} label={dd.statFarms} value={farms.length} sub={dd.statFarmsSub.replace("{{n}}", String(tanks.length))} />
        <StatCard
          icon={Sprout}
          label={dd.statBeds}
          value={tanks.length}
          sub={dd.statBedsSub.replace("{{ok}}", String(counts.ok)).replace("{{warn}}", String(counts.warn)).replace("{{danger}}", String(counts.danger))}
        />
        <StatCard icon={AlertTriangle} label={dd.statAlerts} value={alerts.length} sub={dd.statAlertsSub} iconColor="text-amber-500" iconBg="bg-amber-500/10" />
        {/* checkRecipe 가 parameter:"EC" 를 넣는다(lib/thresholds.ts) → 추가 조회 0회 */}
        <StatCard icon={FlaskConical} label={dd.statEcDeviation} value={ecDeviations} sub={dd.statEcDeviationSub} />
      </div>

      <section aria-label={dd.bedsHeading} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{dd.bedsHeading}</h2>
          <Link href="/daumlabs/farms" className="text-xs text-brand-fg font-medium inline-flex items-center gap-1 min-h-[44px] hover:underline">
            {dd.bedDetail} <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {tanks.map(tk => (
            <BedCard
              key={tk.id}
              tank={tk}
              latest={latest ? latest[tk.id] ?? null : undefined}
              selected={tk.id === selectedTankId}
              onSelect={() => setPickedTankId(tk.id)}
            />
          ))}
        </div>
      </section>

      {/* 노지 재해위험 — 노지 베드이고 판단이 있을 때만. 수경재배 베드에는 아무것도 안 보인다 */}
      {selectedIsField && selectedTank && visibleFieldRisk.length > 0 && (
        <FieldRiskCard judgements={visibleFieldRisk} tankName={selectedTank.name} />
      )}

      {/* 환경·기상 — 장비가 지그비·기상센서 값을 올린 베드만. 없으면 카드가 그려지지 않는다 */}
      {selectedTank && <EnvironmentCard readings={visibleWq} tankName={selectedTank.name} now={lastRefreshed} />}

      {hasNutrient || hasDp ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {hasNutrient && selectedTank && (
            <section className="lg:col-span-2 space-y-2" aria-label={dd.nutrientHeading.replace("{{name}}", selectedTank.name)}>
              <h2 className="text-sm font-semibold text-foreground">{dd.nutrientHeading.replace("{{name}}", selectedTank.name)}</h2>
              <NutrientStatusCard devices={visibleDevices} tank={selectedTank} />
            </section>
          )}
          <div className={hasNutrient ? "" : "lg:col-span-3"}>
            <DpTrendCard readings={visibleWq} />
          </div>
        </div>
      ) : (
        <AgriEmptyState
          icon={FlaskConical}
          title={common.noData}
          description={dd.noDataCompact}
          ctaLabel={dd.actionRecord}
          ctaHref="/daumlabs/record/water-quality"
          className="py-8"
        />
      )}

      {/* 센서별 마지막 수신값 — 기기 raw 그대로(수정 없이 import). 센서가 있을 때만 보인다 */}
      <DeviceCurrentValues devices={visibleDevices} />

      <RecentAlerts alerts={shownAlerts} onResolve={handleResolve} resolvingId={resolvingId} error={resolveError} />
    </div>
  )
}
