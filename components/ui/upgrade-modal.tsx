"use client"

import { useRouter } from "next/navigation"
import { X, TrendingUp, Building2, Droplets, BrainCircuit, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PLAN_LIMITS, PLAN_LABELS, PLAN_PRICES, nextPlan, type Plan } from "@/lib/plans"

export type LimitType = "farm" | "tank" | "ai" | "sensor" | "diag"

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  currentPlan: Plan
  limitType: LimitType
}

const LIMIT_META: Record<LimitType, { icon: React.ElementType; title: string; currentKey: keyof typeof PLAN_LIMITS.free; unit: string }> = {
  farm:   { icon: Building2,   title: "양식장 추가 한도에 도달했습니다",    currentKey: "farms",        unit: "개" },
  tank:   { icon: Droplets,    title: "수조 추가 한도에 도달했습니다",       currentKey: "tanksPerFarm", unit: "개/양식장" },
  ai:     { icon: BrainCircuit,title: "오늘 AI 질문 한도에 도달했습니다",   currentKey: "aiPerDay",     unit: "회/일" },
  sensor: { icon: Wifi,        title: "IoT 센서 등록 한도에 도달했습니다",  currentKey: "sensors",      unit: "개" },
  diag:   { icon: TrendingUp,  title: "이달 질병 진단 한도에 도달했습니다", currentKey: "diagPerMonth", unit: "회/월" },
}

function formatLimit(val: number, unit: string) {
  return val === Infinity ? `무제한` : `${val}${unit}`
}

export function UpgradeModal({ open, onClose, currentPlan, limitType }: UpgradeModalProps) {
  const router = useRouter()
  if (!open) return null

  const target = nextPlan(currentPlan)
  const meta = LIMIT_META[limitType]
  const Icon = meta.icon

  const currentLimit = PLAN_LIMITS[currentPlan][meta.currentKey] as number
  const targetLimit = target ? (PLAN_LIMITS[target][meta.currentKey] as number) : Infinity

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="text-white font-semibold">{meta.title}</p>
            <p className="text-slate-400 text-sm">
              현재 플랜({PLAN_LABELS[currentPlan]})의 한도는 <span className="text-white font-medium">{formatLimit(currentLimit, meta.unit)}</span>입니다.
            </p>
          </div>
        </div>

        {/* Comparison */}
        {target && (
          <div className="bg-slate-800/60 border border-white/5 rounded-xl p-4 space-y-3">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">플랜 비교</p>
            <div className="grid grid-cols-2 gap-3">
              {/* Current */}
              <div className="space-y-1">
                <p className="text-xs text-slate-500">{PLAN_LABELS[currentPlan]} (현재)</p>
                <p className="text-2xl font-bold text-slate-400">{formatLimit(currentLimit, "")}</p>
                <p className="text-xs text-slate-500">{meta.unit}</p>
              </div>
              {/* Next */}
              <div className="space-y-1">
                <p className="text-xs text-ocean-400 font-medium">{PLAN_LABELS[target]} (업그레이드)</p>
                <p className="text-2xl font-bold text-white">{formatLimit(targetLimit, "")}</p>
                <p className="text-xs text-slate-400">{meta.unit}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
              <span className="text-xs text-slate-500">{PLAN_LABELS[target]} 플랜</span>
              <span className="text-sm font-semibold text-white">{PLAN_PRICES[target]}/월</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1 border-white/10 text-slate-300 hover:bg-white/5">
            나중에
          </Button>
          <Button
            onClick={() => { onClose(); router.push("/pricing") }}
            className="flex-1 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-medium"
          >
            업그레이드하기
          </Button>
        </div>
      </div>
    </div>
  )
}
