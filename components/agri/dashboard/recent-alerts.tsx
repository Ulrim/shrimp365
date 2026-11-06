"use client"

// 최근 알림 목록(최대 5건) — 수아 시안 mode-split-ui.md 5-5.
// 메시지는 `alertDisplayLabel(parameter, "agriculture")` 로 농업 이름표를 붙이고, "처리"
// 는 양액 관리 알림 목록과 같은 db 함수(resolveAlert)를 부모가 호출한다.
import Link from "next/link"
import { AlertTriangle, Activity, CheckCircle2, Bell, ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useT, useAgriT } from "@/lib/i18n-context"
import { alertDisplayLabel } from "@/lib/thresholds"
import { agoLabel } from "./time-ago"
import type { Alert } from "@/types"

const MAX_ROWS = 5

interface RecentAlertsProps {
  alerts: Alert[]
  onResolve: (id: string) => void
  resolvingId: string | null
  error: string | null
}

export function RecentAlerts({ alerts, onResolve, resolvingId, error }: RecentAlertsProps) {
  const { t } = useT()
  const { dashboard: dd } = useAgriT()
  const rows = alerts.slice(0, MAX_ROWS)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-foreground text-sm flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-amber-500" aria-hidden="true" />
            {dd.recentAlerts}
          </CardTitle>
          {alerts.length > MAX_ROWS && (
            <Link href="/daumlabs/water-quality#alerts" className="text-xs text-brand-fg font-medium inline-flex items-center gap-1 min-h-[44px] hover:underline">
              {dd.viewAllAlerts} <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 py-3" role="status">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
            {dd.noAlerts}
          </p>
        ) : rows.map(a => {
          const danger = a.type === "danger"
          const Icon = danger ? AlertTriangle : a.type === "warning" ? Activity : CheckCircle2
          const iconColor = danger ? "text-red-500" : a.type === "warning" ? "text-amber-500" : "text-brand-fg"
          const label = alertDisplayLabel(a.parameter, "agriculture")
          return (
            <div
              key={a.id}
              className={`flex items-start gap-2.5 p-3 rounded-xl border flex-wrap sm:flex-nowrap ${danger ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"}`}
            >
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-medium truncate">
                  {a.tank_name}{label && <span className="text-muted-foreground font-normal"> · {label}</span>}
                </p>
                <p className="text-xs text-muted-foreground break-words">{a.message}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{agoLabel(t.time, a.created_at)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px] shrink-0 w-full sm:w-auto"
                disabled={resolvingId === a.id}
                onClick={() => onResolve(a.id)}
                aria-label={dd.resolveAria.replace("{{name}}", a.tank_name)}
              >
                {dd.resolve}
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
