"use client"

// 스마트팜 홈 `/daumlabs/home` — 수아 시안 mode-split-ui.md 5-1.
//
// 인사 → 오늘 베드 현황(위험/주의/정상 + 미처리 알림 링크) → 기록하기·현황 보기 카드.
// 데이터는 lib/db 함수만 쓰고, 뷰 안에서 `farm_type === "agriculture"` 로 거른다 —
// 혼합 계정에서 다른 유형 농장의 위험을 세지 않게. 이 뷰는 /daumlabs/home 에서만 렌더되므로
// ui_mode 교정 로직이 없다(그 일은 새우 홈이 한다). 전체 농장이 0개면 기존처럼 온보딩.
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useAgriT } from "@/lib/i18n-context"
import { getFarms, getAllTanks, getAlerts } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { AdSlot } from "@/components/ads/ad-slot"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { AgriSpinner, AgriLoadError } from "@/components/agri/agri-load-state"
import { Building2, ClipboardList, BarChart3, AlertTriangle, CheckCircle2, Activity } from "lucide-react"
import type { Tank, Alert } from "@/types"

const isAgri = (x: { farm_type?: string }) => x.farm_type === "agriculture"

interface HomeData {
  /** 계정에 농장이 하나라도 있는가(유형 무관). 없으면 온보딩으로. */
  hasAnyFarm: boolean
  agriFarmCount: number
  tanks: Tank[]
  alerts: Alert[]
}

const EMPTY: HomeData = { hasAnyFarm: true, agriFarmCount: 0, tanks: [], alerts: [] }

// 테스트 계정은 목데이터가 전부 새우라 농업 화면에서는 빈 상태가 정상이다 —
// 농업 목데이터를 만들지 않는다. 농업 농장이 없으면 베드·알림 조회도 건너뛴다.
async function loadHome(mock: boolean): Promise<HomeData> {
  if (mock) return EMPTY
  const farms = await getFarms()
  if (farms.length === 0) return { ...EMPTY, hasAnyFarm: false }
  const agriFarmCount = farms.filter(isAgri).length
  if (agriFarmCount === 0) return EMPTY
  const [tanks, alerts] = await Promise.all([getAllTanks(), getAlerts(true)])
  return {
    hasAnyFarm: true,
    agriFarmCount,
    tanks: tanks.filter(isAgri),
    alerts: alerts.filter(a => isAgri(a) && !a.resolved),
  }
}

export function AgriHomeView() {
  const { user } = useAuth()
  const { common, home } = useAgriT()
  const router = useRouter()
  const userEmail = user?.email
  const ready = !!user
  const mock = isTestAccount(userEmail)

  const [data, setData] = useState<HomeData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!ready) return
    let alive = true
    loadHome(mock)
      .then(d => {
        if (!alive) return
        if (!d.hasAnyFarm) { router.replace("/onboarding"); return }
        setData(d)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      })
    return () => { alive = false }
  }, [ready, mock, router, retry])

  // 베드 상태와 알림은 1분마다 다시 불러온다. 첫 화면에서 위험 베드를 보고
  // 움직이는 경우가 많은데, 열어 둔 채 두면 옛 상태가 그대로 남는다.
  const reload = useCallback(async () => {
    const d = await loadHome(mock)
    if (d.hasAnyFarm) setData(d)
  }, [mock])
  useAutoRefresh(reload, 60, !loading && !loadError)

  if (loading) return <AgriSpinner label={home.loadingAria} />
  if (loadError) {
    return <AgriLoadError onRetry={() => { setLoadError(false); setLoading(true); setRetry(n => n + 1) }} />
  }

  const greeting = home.greeting.replace("{{name}}", user?.name?.split(" ")[0] || "")
  const { tanks, alerts } = data
  const dangerCount = tanks.filter(tk => tk.status === "danger").length
  const warningCount = tanks.filter(tk => tk.status === "warning").length
  const normalCount = tanks.filter(tk => tk.status === "active").length

  return (
    <div className="flex flex-col items-center min-h-[60vh] py-8 px-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{greeting}</h1>
          <p className="text-muted-foreground text-sm sm:text-base">{home.greetingSubtitle}</p>
        </div>

        {data.agriFarmCount === 0 ? (
          <AgriEmptyState
            icon={Building2}
            title={common.noFarmsTitle}
            description={common.noFarmsMsg}
            ctaLabel={common.registerFarm}
            ctaHref="/daumlabs/farms"
          />
        ) : tanks.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center shadow-sm" role="status" aria-label={home.noBedsAria}>
            <p className="text-muted-foreground text-sm">{home.noBeds}</p>
            <Link
              href="/daumlabs/farms"
              className="inline-flex items-center justify-center min-h-[44px] mt-3 px-5 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors duration-200"
            >
              {common.registerFarm}
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm" role="region" aria-label={home.bedsToday}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{home.bedsToday}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className={`flex flex-col items-center gap-1 rounded-xl p-3 ${dangerCount > 0 ? "bg-red-500/10 border border-red-500/20" : "bg-muted/50"}`}>
                <AlertTriangle className={`w-5 h-5 ${dangerCount > 0 ? "text-red-500" : "text-muted-foreground/40"}`} aria-hidden="true" />
                <span className={`text-xl font-bold font-mono tabular-nums ${dangerCount > 0 ? "text-red-500" : "text-muted-foreground"}`}>{dangerCount}</span>
                <span className="text-[11px] text-muted-foreground">{common.status.danger}</span>
              </div>
              <div className={`flex flex-col items-center gap-1 rounded-xl p-3 ${warningCount > 0 ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/50"}`}>
                <Activity className={`w-5 h-5 ${warningCount > 0 ? "text-amber-500" : "text-muted-foreground/40"}`} aria-hidden="true" />
                <span className={`text-xl font-bold font-mono tabular-nums ${warningCount > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{warningCount}</span>
                <span className="text-[11px] text-muted-foreground">{common.status.warning}</span>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-xl p-3 bg-muted/50">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                <span className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{normalCount}</span>
                <span className="text-[11px] text-muted-foreground">{common.status.normal}</span>
              </div>
            </div>
            {alerts.length > 0 && (
              <Link
                href="/daumlabs/dashboard"
                aria-label={home.unresolvedAlertsAria.replace("{{count}}", String(alerts.length))}
                className="flex items-center gap-2 mt-3 pt-3 border-t border-border text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 min-h-[44px]"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  <strong>{home.unresolvedAlerts.replace("{{count}}", String(alerts.length))}</strong> {home.unresolvedAlertsCta}
                </span>
              </Link>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/daumlabs/record"
            aria-label={home.recordCardAria}
            className="group flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card hover:border-brand hover:bg-brand-a4 transition-colors duration-200 py-8 sm:py-10 px-6 min-h-[44px] text-center"
          >
            <div className="w-14 h-14 rounded-xl bg-brand flex items-center justify-center text-white" aria-hidden="true">
              <ClipboardList className="w-7 h-7" />
            </div>
            <div>
              <p className="text-lg sm:text-xl font-bold text-foreground">{home.recordCard}</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{home.recordCardSub}</p>
            </div>
          </Link>

          <Link
            href="/daumlabs/dashboard"
            aria-label={home.monitorCardAria}
            className="group flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card hover:border-amber-600 hover:bg-amber-600/[0.05] transition-colors duration-200 py-8 sm:py-10 px-6 min-h-[44px] text-center"
          >
            <div className="w-14 h-14 rounded-xl bg-amber-600 flex items-center justify-center text-white" aria-hidden="true">
              <BarChart3 className="w-7 h-7" />
            </div>
            <div>
              <p className="text-lg sm:text-xl font-bold text-foreground">{home.monitorCard}</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{home.monitorCardSub}</p>
            </div>
          </Link>
        </div>

        {/* 광고 — NEXT_PUBLIC_ADSENSE_CLIENT 가 설정된 환경에서만 렌더된다 */}
        <AdSlot slot="YOUR_SLOT_ID_HOME" className="mt-4 w-full" />
      </div>
    </div>
  )
}
