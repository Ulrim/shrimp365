"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, Zap, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { PLAN_LABELS } from "@/lib/plans"

export default function TossSuccessPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshProfile } = useAuth()
  const [status, setStatus] = useState<"confirming" | "ok" | "error">("confirming")
  const [plan, setPlan] = useState<"basic" | "pro">("basic")
  const [errorMsg, setErrorMsg] = useState("")
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    const paymentKey = searchParams.get("paymentKey")
    const orderId    = searchParams.get("orderId")
    const amount     = searchParams.get("amount")

    if (!paymentKey || !orderId || !amount) {
      setErrorMsg("결제 정보가 올바르지 않습니다.")
      setStatus("error")
      return
    }

    // orderId = toss_{plan}_{ts}
    const planMatch = orderId.match(/^toss_(basic|pro)_\d+$/)
    if (planMatch) setPlan(planMatch[1] as "basic" | "pro")

    fetch("/api/toss/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setStatus("ok")
          refreshProfile?.()
        } else {
          setErrorMsg(data.error ?? "결제 확인 실패")
          setStatus("error")
        }
      })
      .catch(() => {
        setErrorMsg("네트워크 오류가 발생했습니다.")
        setStatus("error")
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 자동 이동 카운트다운
  useEffect(() => {
    if (status !== "ok") return
    const iv = setInterval(() => {
      setCountdown((v) => {
        if (v <= 1) { clearInterval(iv); router.replace("/home"); return 0 }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [status, router])

  /* ── Confirming ─────────────────────────────────────── */
  if (status === "confirming") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4" role="status" aria-live="polite">
          <div className="w-12 h-12 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin mx-auto" aria-hidden="true" />
          <p className="text-muted-foreground">결제를 확인하는 중입니다…</p>
        </div>
      </div>
    )
  }

  /* ── Error ──────────────────────────────────────────── */
  if (status === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6" role="alert">
          <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
            <XCircle aria-hidden="true" className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">결제 처리 실패</h1>
          <p className="text-muted-foreground">{errorMsg}</p>
          <Link href="/pricing">
            <Button className="min-h-[44px] bg-gradient-to-r from-ocean-500 to-teal-500 text-white">요금제로 돌아가기</Button>
          </Link>
        </div>
      </div>
    )
  }

  /* ── Success ─────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 aria-hidden="true" className="w-12 h-12 text-emerald-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-r from-ocean-500 to-teal-500 flex items-center justify-center">
              <Zap aria-hidden="true" className="w-4 h-4 text-white" />
            </div>
          </div>
        </div>

        <div role="status">
          <h1 className="text-3xl font-bold text-foreground mb-2">결제 완료!</h1>
          <p className="text-muted-foreground text-lg">
            <span className="text-ocean-300 font-semibold">{PLAN_LABELS[plan]}</span> 플랜이 활성화되었습니다.
          </p>
        </div>

        <div className="bg-card border border-ocean-500/20 rounded-2xl p-5 text-sm text-foreground text-left space-y-2">
          <p className="text-ocean-300 font-semibold mb-3">결제 정보</p>
          <div className="flex justify-between">
            <span className="text-muted-foreground">결제 수단</span>
            <span className="font-medium text-foreground">토스페이</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">플랜</span>
            <span className="font-medium text-foreground">{PLAN_LABELS[plan]}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">금액</span>
            <span className="font-medium text-foreground">
              {plan === "basic" ? "₩19,900" : "₩39,900"}/월
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Link href="/home">
            <Button className="w-full min-h-[44px] bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-medium">
              대시보드로 이동
            </Button>
          </Link>
          <p className="text-muted-foreground text-xs">{countdown}초 후 자동으로 이동합니다</p>
        </div>

        <div className="text-muted-foreground text-sm">Shrimp365</div>
      </div>
    </div>
  )
}
