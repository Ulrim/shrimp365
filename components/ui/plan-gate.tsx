"use client"

import Link from "next/link"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Plan } from "@/lib/plans"

interface PlanGateProps {
  requiredPlan: "pro" | "enterprise"
  currentPlan: Plan | undefined
  children: React.ReactNode
  featureLabel?: string
}

export function PlanGate({ requiredPlan, currentPlan, children, featureLabel }: PlanGateProps) {
  const planRank: Record<Plan, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 }
  const required = planRank[requiredPlan]
  const current = planRank[currentPlan ?? "free"]

  if (current >= required) return <>{children}</>

  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-40 blur-[1px]">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/70 rounded-lg backdrop-blur-[2px] z-10">
        <Lock className="w-5 h-5 text-ocean-400 mb-2" />
        {featureLabel && <p className="text-xs text-slate-300 mb-3 text-center px-4">{featureLabel}은(는) {requiredPlan === "pro" ? "Pro" : "Enterprise"} 플랜 전용입니다.</p>}
        <Link href="/pricing">
          <Button size="sm" className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white text-xs">
            업그레이드
          </Button>
        </Link>
      </div>
    </div>
  )
}
