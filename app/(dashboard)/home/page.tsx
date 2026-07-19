"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getFarms, getAllTanks, getAlerts } from "@/lib/db"
import { isTestAccount, MOCK_TANKS, MOCK_ALERTS } from "@/lib/mock-data"
import { ClipboardList, BarChart3, AlertTriangle, CheckCircle2, Activity } from "lucide-react"
import { AdSlot } from "@/components/ads/ad-slot"
import { Tank, Alert } from "@/types"

export default function HomePage() {
  const { user } = useAuth()
  const { t } = useT()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [tanks, setTanks] = useState<Tank[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    if (!user) return
    const mock = isTestAccount(user.email)
    if (mock) {
      setTanks(MOCK_TANKS)
      setAlerts(MOCK_ALERTS.filter(a => !a.resolved))
      setChecking(false)
      return
    }
    getFarms()
      .then(farms => {
        if (farms.length === 0) { router.replace("/onboarding"); return }
        return Promise.all([getAllTanks(), getAlerts(true)] as const)
      })
      .then(result => {
        if (!result) return
        const [tankList, alertList] = result
        setTanks(tankList)
        setAlerts(alertList.filter((a: Alert) => !a.resolved))
        setChecking(false)
      })
      .catch(() => { setLoadError(true); setChecking(false) })
  }, [user, router, retry])

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" aria-label={t.homeHub.loadingAria} role="status">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
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
          className="min-h-[44px] px-6 py-2 rounded-xl bg-ocean-500 text-white font-medium hover:bg-ocean-600 transition-colors"
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
                <span className={`text-xl font-bold ${dangerTanks > 0 ? "text-red-500" : "text-muted-foreground"}`}>{dangerTanks}</span>
                <span className="text-[11px] text-muted-foreground">{t.dashboard.danger}</span>
              </div>
              <div className={`flex flex-col items-center gap-1 rounded-xl p-3 ${warningTanks > 0 ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/50"}`}>
                <Activity className={`w-5 h-5 ${warningTanks > 0 ? "text-amber-500" : "text-muted-foreground/40"}`} aria-hidden="true" />
                <span className={`text-xl font-bold ${warningTanks > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{warningTanks}</span>
                <span className="text-[11px] text-muted-foreground">{t.dashboard.warning}</span>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-xl p-3 bg-muted/50">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                <span className="text-xl font-bold text-emerald-600">{activeTanks}</span>
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
              className="inline-flex items-center justify-center min-h-[44px] mt-3 px-5 py-2 rounded-xl bg-ocean-500 text-white text-sm font-medium hover:bg-ocean-600 transition-colors"
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
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-ocean-200 bg-ocean-50 hover:bg-ocean-100 hover:border-ocean-400 transition-all duration-200 py-10 px-6 min-h-[44px] text-center shadow-sm hover:shadow-md"
          >
            <div className="w-16 h-16 rounded-2xl bg-ocean-500 flex items-center justify-center text-white group-hover:scale-110 transition-transform" aria-hidden="true">
              <ClipboardList className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg sm:text-2xl font-bold text-ocean-700">📝 {t.hub.recordButton}</p>
              <p className="text-xs sm:text-sm text-ocean-500 mt-1">{t.homeHub.recordCardSubtitle}</p>
            </div>
          </Link>

          <Link
            href="/dashboard"
            aria-label={t.homeHub.monitorCardAria}
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:border-teal-400 transition-all duration-200 py-10 px-6 min-h-[44px] text-center shadow-sm hover:shadow-md"
          >
            <div className="w-16 h-16 rounded-2xl bg-teal-500 flex items-center justify-center text-white group-hover:scale-110 transition-transform" aria-hidden="true">
              <BarChart3 className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg sm:text-2xl font-bold text-teal-700">📊 {t.hub.monitorButton}</p>
              <p className="text-xs sm:text-sm text-teal-500 mt-1">{t.homeHub.monitorCardSubtitle}</p>
            </div>
          </Link>
        </div>

        {/* Ad slot — only renders when NEXT_PUBLIC_ADSENSE_CLIENT is configured */}
        <AdSlot slot="YOUR_SLOT_ID_HOME" className="mt-4 w-full" />
      </div>
    </div>
  )
}
