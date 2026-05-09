"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, Waves, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { PLAN_LABELS, PLAN_LIMITS } from "@/lib/plans"
import { useT } from "@/lib/i18n-context"

export default function PaymentSuccessPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshProfile } = useAuth()
  const { t } = useT()
  const [countdown, setCountdown] = useState(5)

  const rawPlan = searchParams.get("plan")
  const activatedPlan: "basic" | "pro" = rawPlan === "basic" ? "basic" : "pro"
  const planLabel = PLAN_LABELS[activatedPlan]

  useEffect(() => {
    refreshProfile?.()

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          router.replace("/dashboard")
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-r from-ocean-500 to-teal-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
          </div>
        </div>

        {/* Message */}
        <div>
          <h1 className="text-3xl font-bold text-white mb-3">{t.payment.successTitle}</h1>
          <p className="text-slate-400 text-lg">
            {planLabel} {t.payment.activated}
          </p>
        </div>

        {/* Features unlocked */}
        <div className="bg-slate-800/40 border border-ocean-500/20 rounded-2xl p-6 text-left space-y-3">
          <p className="text-ocean-300 text-sm font-semibold mb-3">{t.payment.features}</p>
          {(activatedPlan === "basic" ? [
            `${t.pricing.features.farms} 2`,
            `${t.pricing.features.tanksPerFarm} 15`,
            `${t.pricing.features.aiPerDay} 15${t.common.unit.timesPerDay}`,
            `${t.pricing.features.sensors} 1`,
            `${t.pricing.features.autoRefresh} (5${t.common.unit.minutes})`,
            `${t.pricing.features.diagPerMonth} 10${t.common.unit.timesPerMonth}`,
            `${t.pricing.features.reportPeriods} 7/30`,
            `${t.pricing.features.support}: ${t.pricing.features.supportEmail}`,
          ] : [
            `${t.pricing.features.farms} 5`,
            `${t.pricing.features.tanksPerFarm} 50`,
            `${t.pricing.features.aiPerDay} 30${t.common.unit.timesPerDay}`,
            `${t.pricing.features.sensors} 5`,
            `${t.pricing.features.autoRefresh} (1${t.common.unit.minutes})`,
            `${t.pricing.features.csvExport}`,
            `${t.pricing.features.diagPerMonth} ${t.common.unit.unlimited}`,
            `${t.pricing.features.reportPeriods} 7/30/90`,
            `${t.pricing.features.support}: ${t.pricing.features.supportPriority}`,
          ]).map((feature, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-slate-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              {feature}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <Link href="/dashboard">
            <Button className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-medium">
              {t.payment.goDashboard}
            </Button>
          </Link>
          <p className="text-slate-500 text-xs">
            {countdown > 0 ? `${countdown}s` : t.common.loading}
          </p>
        </div>

        {/* Branding */}
        <div className="flex items-center justify-center gap-2 text-slate-600">
          <Waves className="w-4 h-4" />
          <span className="text-sm">Shrimp365</span>
        </div>
      </div>
    </div>
  )
}
