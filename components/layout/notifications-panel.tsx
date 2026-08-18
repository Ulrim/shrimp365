"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Bell, X, CheckCircle2, AlertCircle, XCircle, Info, CheckCheck, RefreshCw, ArrowRight } from "lucide-react"
import { getAlerts, resolveAlert } from "@/lib/db"
import { MOCK_ALERTS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { formatDateTime } from "@/lib/utils"
import { useAgriRoute } from "@/lib/agri-route"
import type { Alert } from "@/types"

interface NotificationsPanelProps {
  open: boolean
  onClose: () => void
  onCountChange?: (count: number) => void
}

const TYPE_ICON: Record<Alert["type"], React.ReactNode> = {
  danger:  <XCircle className="w-4 h-4 text-red-400 shrink-0" />,
  warning: <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />,
  info:    <Info className="w-4 h-4 text-ocean-400 shrink-0" />,
}

const TYPE_BG: Record<Alert["type"], string> = {
  danger:  "border-red-500/20 bg-red-500/5",
  warning: "border-amber-500/20 bg-amber-500/5",
  info:    "border-ocean-500/20 bg-ocean-500/5",
}

export function NotificationsPanel({ open, onClose, onCountChange }: NotificationsPanelProps) {
  const { user } = useAuth()
  const { t } = useT()
  const { href: withAgri } = useAgriRoute()
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const loadAlerts = async () => {
    setLoading(true)
    try {
      const data = await getAlerts(true)
      const mock = isTestAccount(user?.email)
      const final = data.length ? data : (mock ? MOCK_ALERTS.filter(a => !a.resolved) : [])
      setAlerts(final)
      onCountChange?.(final.length)
    } catch {
      if (isTestAccount(user?.email)) {
        const mock = MOCK_ALERTS.filter(a => !a.resolved)
        setAlerts(mock)
        onCountChange?.(mock.length)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadAlerts()
  }, [open, user?.email])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClickOutside)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClickOutside)
    }
  }, [open, onClose])

  async function handleResolve(id: string) {
    setResolvingId(id)
    try {
      await resolveAlert(id)
    } catch { /* for mock alerts, just remove locally */ }
    const updated = alerts.filter(a => a.id !== id)
    setAlerts(updated)
    onCountChange?.(updated.length)
    setResolvingId(null)
  }

  async function handleResolveAll() {
    const ids = alerts.map(a => a.id)
    for (const id of ids) {
      try { await resolveAlert(id) } catch { /* ignore */ }
    }
    setAlerts([])
    onCountChange?.(0)
  }

  if (!open) return null

  return (
    <div ref={panelRef} className="absolute right-0 top-12 w-80 sm:w-96 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-[150]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-ocean-500" />
          <span className="text-sm font-semibold text-foreground">{t.notif.title}</span>
          {alerts.length > 0 && (
            <span className="w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">
              {alerts.length > 9 ? "9+" : alerts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {alerts.length > 0 && (
            <button
              onClick={handleResolveAll}
              className="text-xs text-muted-foreground hover:text-ocean-500 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-accent transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {t.notif.resolveAll}
            </button>
          )}
          <button onClick={loadAlerts} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-accent transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alert list */}
      <div className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-ocean-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="text-sm text-foreground font-medium">{t.notif.allResolved}</p>
            <p className="text-xs text-muted-foreground">{t.notif.allResolvedMsg}</p>
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {alerts.map(alert => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-xl border ${TYPE_BG[alert.type]} group`}
              >
                <div className="mt-0.5">{TYPE_ICON[alert.type]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-sm text-foreground font-medium truncate">{alert.tank_name}</span>
                    {alert.parameter && (
                      <span className="text-xs text-muted-foreground shrink-0">{alert.parameter}</span>
                    )}
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{alert.message}</p>
                  {alert.value != null && alert.threshold != null && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.notif.measured}: <span className="text-foreground">{alert.value}</span> / {t.notif.threshold}: {alert.threshold}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{formatDateTime(alert.created_at)}</p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => { router.push(withAgri(`/water-quality?tank=${alert.tank_id}`)); onClose() }}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-ocean-500 transition-colors"
                    title={t.notif.gotoTank}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleResolve(alert.id)}
                    disabled={resolvingId === alert.id}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-emerald-500 transition-colors"
                    title={t.notif.markResolved}
                  >
                    {resolvingId === alert.id
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2">
        <a href={withAgri("/water-quality")} onClick={onClose} className="text-xs text-ocean-500 hover:text-ocean-600 flex items-center justify-center gap-1">
          {t.notif.viewMore} →
        </a>
      </div>
    </div>
  )
}
