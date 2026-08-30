"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getFarms, getAllTanks, getAlerts } from "@/lib/db"
import { isTestAccount, MOCK_TANKS, MOCK_ALERTS } from "@/lib/mock-data"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { AGRI_PREFIX, belongsToAgriScreen, useAgriRoute } from "@/lib/agri-route"
import { ClipboardList, BarChart3, AlertTriangle, CheckCircle2, Activity } from "lucide-react"
import { AdSlot } from "@/components/ads/ad-slot"
import { Tank, Alert } from "@/types"

export function HomeView() {
  const { user } = useAuth()
  const { t } = useT()
  const { isAgri, href: withAgri } = useAgriRoute()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [allTanks, setAllTanks] = useState<Tank[]>([])
  const [allAlerts, setAllAlerts] = useState<Alert[]>([])

  // 홈이 세는 것도 이 화면 몫이어야 한다(설계서 3장). 혼합 계정에서 안 거르면
  // 농업 홈이 새우 수조의 위험을 세고, 알림 링크가 이 화면에서는 갈 수도 없는
  // 반대 축 수조를 가리킨다(그 반대도 같다).
  const tanks = useMemo(
    () => allTanks.filter(tk => belongsToAgriScreen(tk.farm_type, isAgri)),
    [allTanks, isAgri],
  )
  const alerts = useMemo(
    () => allAlerts.filter(a => belongsToAgriScreen(a.farm_type, isAgri)),
    [allAlerts, isAgri],
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
        // 전 농장이 수경재배면 농업 화면으로 넘긴다(설계서 5-2). 로그인·소셜
        // 콜백·북마크 등 모든 진입 경로가 결국 /home 을 거치므로 교정은 여기
        // 한 곳이면 된다. 이미 부른 getFarms() 결과를 쓰므로 추가 조회 0회다.
        // 역방향(/daumlabs/home → /home) 자동 이동은 하지 않는다.
        if (!isAgri && farms.every(f => (f.farm_type ?? "shrimp") === "agriculture")) {
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
  }, [user, router, retry, isAgri])

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
        <div className="w-8 h-8 border-4 border-[#1E40AF] border-t-transparent rounded-full animate-spin" />
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
          className="min-h-[44px] px-6 py-2 rounded-xl bg-[#1E40AF] text-white font-medium hover:bg-[#3B82F6] transition-colors"
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
                href={withAgri("/dashboard")}
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
              className="inline-flex items-center justify-center min-h-[44px] mt-3 px-5 py-2 rounded-xl bg-[#1E40AF] text-white text-sm font-medium hover:bg-[#3B82F6] transition-colors"
            >
              {t.dashboard.goToFarms}
            </Link>
          </div>
        )}

        {/* Two big action cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href={withAgri("/record")}
            aria-label={t.homeHub.recordCardAria}
            className="group flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card hover:border-[#1E40AF] hover:bg-[#1E40AF]/[0.04] transition-colors duration-200 py-10 px-6 min-h-[44px] text-center"
          >
            <div className="w-14 h-14 rounded-xl bg-[#1E40AF] flex items-center justify-center text-white" aria-hidden="true">
              <ClipboardList className="w-7 h-7" />
            </div>
            <div>
              <p className="text-lg sm:text-xl font-bold text-foreground">{t.hub.recordButton}</p>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t.homeHub.recordCardSubtitle}</p>
            </div>
          </Link>

          <Link
            href={withAgri("/dashboard")}
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
