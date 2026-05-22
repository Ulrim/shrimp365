"use client"

import Link from "next/link"
import { Mail, RefreshCw, ArrowLeft, AlertCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { useState, useEffect, useCallback } from "react"

const RESEND_COOLDOWN = 60 // seconds

export default function VerifyEmailPage() {
  const { resendVerification } = useAuth()
  const { t } = useT()
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState("")
  const [cooldown, setCooldown] = useState(0)

  const email = typeof window !== "undefined"
    ? sessionStorage.getItem("pendingVerifyEmail") ?? ""
    : ""

  // Cooldown tick
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResend = useCallback(async () => {
    if (!email || cooldown > 0) return
    setResending(true)
    setResendError("")
    const result = await resendVerification(email)
    if (result.success) {
      setResent(true)
      setCooldown(RESEND_COOLDOWN)
    } else {
      setResendError(result.error ?? "재발송에 실패했습니다.")
    }
    setResending(false)
  }, [email, cooldown, resendVerification])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-ocean-100 rounded-full blur-3xl opacity-50 pointer-events-none" />

      <div className="max-w-md w-full text-center space-y-8 relative z-10">
        {/* Logo */}
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="text-2xl">🦐</span>
          <span className="text-foreground text-xl font-bold">Shrimp365</span>
        </Link>

        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-ocean-50 border-2 border-ocean-200 flex items-center justify-center">
            <Mail className="w-10 h-10 text-ocean-500" aria-hidden="true" />
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-8 text-left space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-2">{t.auth.verifyTitle}</h1>
            <p className="text-muted-foreground text-sm">
              {email
                ? <><span className="text-foreground font-medium">{email}</span>으로</>
                : "입력하신 이메일 주소로"}
              {" "}{t.auth.verifyMsg}
            </p>
          </div>

          {/* Steps */}
          <div className="bg-ocean-50 border border-ocean-100 rounded-xl p-4 space-y-3">
            {[
              { n: "1", text: t.auth.verifyStepCheck },
              { n: "2", text: t.auth.verifyStepSpam },
              { n: "3", text: t.auth.verifyStepClick },
              { n: "4", text: "인증 후 로그인 페이지에서 로그인해 주세요." },
            ].map(step => (
              <div key={step.n} className="flex items-start gap-3">
                <span
                  className="w-6 h-6 rounded-full bg-ocean-500 text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  {step.n}
                </span>
                <p className="text-sm text-foreground">{step.text}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            {email && !resent && (
              <Button
                variant="outline"
                className="w-full gap-2 min-h-[44px]"
                onClick={handleResend}
                disabled={resending || cooldown > 0}
                aria-label={cooldown > 0 ? `재발송 대기 중 (${cooldown}초)` : t.auth.verifyResend}
              >
                {resending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                    {t.auth.verifyResending}
                  </>
                ) : cooldown > 0 ? (
                  <>
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    재발송 대기 ({cooldown}초)
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    {t.auth.verifyResend}
                  </>
                )}
              </Button>
            )}
            {resent && cooldown > 0 && (
              <Button
                variant="outline"
                className="w-full gap-2 min-h-[44px]"
                disabled
                aria-label={`재발송 대기 중 (${cooldown}초)`}
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                재발송 대기 ({cooldown}초)
              </Button>
            )}
            {resent && (
              <div
                role="status"
                className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg px-3 py-2 text-sm"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t.auth.verifyResent}
              </div>
            )}
            {resendError && (
              <div
                role="alert"
                className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-3 py-2 text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {resendError}
              </div>
            )}

            <Link href="/login">
              <Button
                variant="ghost"
                className="w-full gap-2 min-h-[44px] text-muted-foreground hover:text-foreground"
                aria-label={t.auth.goLogin}
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                {t.auth.goLogin}
              </Button>
            </Link>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">© 2026 CULIVER INC. All rights reserved.</p>
      </div>
    </div>
  )
}
