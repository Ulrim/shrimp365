"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getFarms, getAllTanks, getAlerts } from "@/lib/db"
import { isTestAccount, MOCK_TANKS, MOCK_ALERTS } from "@/lib/mock-data"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { AGRI_PREFIX } from "@/lib/agri-route"
import { ClipboardList, BarChart3, AlertTriangle, CheckCircle2, Activity } from "lucide-react"
import { AdSlot } from "@/components/ads/ad-slot"
import { Tank, Alert } from "@/types"

export function HomeView() {
  const { user } = useAuth()
  const { t } = useT()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [allTanks, setAllTanks] = useState<Tank[]>([])
  const [allAlerts, setAllAlerts] = useState<Alert[]>([])

  // 이 화면은 새우 전용이다(농업 홈은 components/agri/agri-home-view.tsx). 혼합
  // 계정에서 안 거르면 새우 홈이 수경재배 베드의 위험을 세고, 알림 링크가 이
  // 화면에서는 고를 수도 없는 베드를 가리킨다. 값이 없으면 새우로 본다.
  const tanks = useMemo(
    () => allTanks.filter(tk => (tk.farm_type ?? "shrimp") !== "agriculture"),
    [allTanks],
  )
  const alerts = useMemo(
    () => allAlerts.filter(a => (a.farm_type ?? "shrimp") !== "agriculture"),
    [allAlerts],
  )

  useEffect(() => {
    if (!user) return
    const mock = isTestAccount(user.email)
    if (mock) {
      setAllTanks(MOCK_TANKS)
      setAllAlerts(MOCK_ALERTS.filter(a => !a.resolved))
      setChecking(false)
      return
    }
    getFarms()
      .then(farms => {
        if (farms.length === 0) { router.replace("/onboarding"); return }
        // 계정 기본 모드가 스마트팜이면 농업 홈으로 넘긴다(설계서 mode-split.md 2-2).
        // 로그인·소셜 콜백·북마크 등 모든 진입 경로가 결국 /home 을 거치므로 교정은
        // 여기 한 곳이면 된다. 판정은 profiles.ui_mode 하나다 — 전환 스위치가 저장한
        // 값이고, 온보딩에서 농업 유형을 고르면 함께 저장된다. 혼합 계정도 자기 뜻대로
        // 정할 수 있다. 역방향(/daumlabs/home → /home) 자동 이동은 하지 않는다.
        // 이 뷰는 새우 경로(/home)에서만 렌더되므로 URL 조건은 필요 없다.
        if (user.ui_mode === "agriculture") {
          router.replace(`${AGRI_PREFIX}/home`)
          return
        }
        return Promise.all([getAllTanks(), getAlerts(true)] as const)
      })
      .then(result => {
        if (!result) return
        const [tankList, alertList] = result
        setAllTanks(tankList)
        setAllAlerts(alertList.filter((a: Alert) => !a.resolved))
        setChecking(false)
      })
      .catch(() => { setLoadError(true); setChecking(false) })
  }, [user, router, retry])

  // 수조 상태와 알림은 1분마다 다시 불러온다. 첫 화면에서 위험 수조를 보고
  // 움직이는 경우가 많은데, 열어 둔 채 두면 옛 상태가 그대로 남는다.
  const reload = useCallback(async () => {
    if (!user || isTestAccount(user.email)) return
    const [tankList, alertList] = await Promise.all([getAllTanks(), getAlerts(true)])
    setAllTanks(tankList)
    setAllAlerts(alertList.filter((a: Alert) => !a.resolved))
  }, [user])

  useAutoRefresh(reload, 60, !checking && !loadError)

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" aria-label={t.homeHub.loadingAria} role="status">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4" role="alert">
        <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
        <p className="text-foreground font-semibold text-lg">{t.homeHub.loadErrorTitle}</p>
        <p className="text-muted-foreground text-sm text-center">{t.homeHub.loadErrorMsg}</p>
        <button
          onClick={() => { setLoadError(false); setChecking(true); setRetry(n => n + 1) }}
          className="min-h-[44px] px-6 py-2 rounded-xl bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
          aria-label={t.homeHub.retryAria}
        >
          {t.homeHub.retry}
        </button>
      </div>
    )
  }

  const greeting = t.hub.greeting.replace("{{name}}", user?.name?.split(" ")[0] || "")
  const dangerTanks = tanks.filter(t => t.status === "danger").length
  const warningTanks = tanks.filter(t => t.status === "warning").length
  const activeTanks = tanks.filter(t => t.status === "active").length

  return (
    <div className="flex flex-col items-center min-h-[60vh] py-8 px-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Greeting */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{greeting}</h1>
          <p className="text-muted-foreground text-sm sm:text-base">{t.homeHub.greetingSubtitle}</p>
        </div>

        {/* At-a-glance status */}
        {tanks.length > 0 ? (
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm" role="region" aria-label={t.homeHub.tanksToday}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t.homeHub.tanksToday}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className={`flex flex-col items-center gap-1 rounded-xl p-3 ${dangerTanks > 0 ? "bg-red-500/10 border border-red-500/20" : "bg-muted/50"}`}>
                <AlertTriangle className={`w-5 h-5 ${dangerTanks > 0 ? "text-red-500" : "text-muted-foreground/40"}`} aria-hidden="true" />
                <span className={`text-xl font-bold font-mono tabular-nums ${dangerTanks > 0 ? "text-red-500" : "text-muted-foreground"}`}>{dangerTanks}</span>
                <span className="text-[11px] text-muted-foreground">{t.dashboard.danger}</span>
              </div>
              <div className={`flex flex-col items-center gap-1 rounded-xl p-3 ${warningTanks > 0 ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/50"}`}>
                <Activity className={`w-5 h-5 ${warningTanks > 0 ? "text-amber-500" : "text-muted-foreground/40"}`} aria-hidden="true" />
                <span className={`text-xl font-bold font-mono tabular-nums ${warningTanks > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{warningTanks}</span>
                <span className="text-[11px] text-muted-foreground">{t.dashboard.warning}</span>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-xl p-3 bg-muted/50">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                <span className="text-xl font-bold font-mono tabular-nums text-emerald-600">{activeTanks}</span>
                <span className="text-[11px] text-muted-foreground">{t.dashboard.normal}</span>
              </div>
            </div>
            {alerts.length > 0 && (
              <Link
                href="/dashboard"
                aria-label={t.homeHub.unresolvedAlertsAria.replace("{{count}}", String(alerts.length))}
                className="flex items-center gap-2 mt-3 pt-3 border-t border-border text-sm text-amber-600 hover:text-amber-700"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{t.homeHub.unresolvedAlertsPrefix} <strong>{t.homeHub.unresolvedAlertsCount.replace("{{count}}", String(alerts.length))}</strong> {t.homeHub.unresolvedAlertsCta}</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-6 text-center shadow-sm" role="status" aria-label={t.homeHub.noTanksAria}>
            <p className="text-muted-foreground text-sm">{t.homeHub.noTanks}</p>
            <Link
              href="/onboarding"
              aria-label={t.homeHub.registerFarmAria}
              className="inline-flex items-center justify-center min-h-[44px] mt-3 px-5 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
            >
              {t.dashboard.goToFarms}
            </Link>
          </div>
        )}

        {/* Two big action cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/record"
            aria-label={t.homeHub.recordCardAria}
            className="group flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card hover:border-brand hover:bg-brand-a4 transition-colors duration-200 py-10 px-6 min-h-[44px] text-center"
          >
            <div className="w-14 h-14 rounded-xl bg-brand flex items-center justify-center text-white" aria-hidden="true">
              <ClipboardList className="w-7 h-7" />
            </div>
            <div>
              <p className="text-lg sm:text-xl font-bold text-foreground">{t.hub.recordButton}</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t.homeHub.recordCardSubtitle}</p>
            </div>
          </Link>

          <Link
            href="/dashboard"
            aria-label={t.homeHub.monitorCardAria}
            className="group flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card hover:border-[#D97706] hover:bg-[#D97706]/[0.05] transition-colors duration-200 py-10 px-6 min-h-[44px] text-center"
          >
            <div className="w-14 h-14 rounded-xl bg-[#D97706] flex items-center justify-center text-white" aria-hidden="true">
              <BarChart3 className="w-7 h-7" />
            </div>
            <div>
              <p className="text-lg sm:text-xl font-bold text-foreground">{t.hub.monitorButton}</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t.homeHub.monitorCardSubtitle}</p>
            </div>
          </Link>
        </div>

        {/* Ad slot — only renders when NEXT_PUBLIC_ADSENSE_CLIENT is configured */}
        <AdSlot slot="YOUR_SLOT_ID_HOME" className="mt-4 w-full" />
      </div>
    </div>
  )
}
