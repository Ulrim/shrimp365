"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, Waves, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

export default function PaymentSuccessPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshProfile } = useAuth()
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    // Refresh the user profile so plan badge updates immediately
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
  }, [])

  const sessionId = searchParams.get("session_id")

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
          <h1 className="text-3xl font-bold text-white mb-3">결제 완료!</h1>
          <p className="text-slate-400 text-lg">
            Pro 플랜이 활성화되었습니다.
          </p>
          <p className="text-slate-500 text-sm mt-2">
            이제 양식장 5개, 수조 50개, AI 어드바이저 30회/일 등 Pro 기능을 사용할 수 있습니다.
          </p>
        </div>

        {/* Features unlocked */}
        <div className="bg-slate-800/40 border border-ocean-500/20 rounded-2xl p-6 text-left space-y-3">
          <p className="text-ocean-300 text-sm font-semibold mb-3">잠금 해제된 기능</p>
          {[
            "양식장 최대 5개",
            "수조 50개/양식장",
            "AI 어드바이저 30회/일",
            "IoT 센서 기기 5개",
            "수질 자동 새로고침 (60초)",
            "CSV/PDF 내보내기",
            "7일·30일·90일 리포트",
            "이메일 지원",
          ].map((feature, i) => (
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
              대시보드로 이동
            </Button>
          </Link>
          <p className="text-slate-500 text-xs">
            {countdown > 0 ? `${countdown}초 후 자동으로 이동합니다` : "이동 중..."}
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
