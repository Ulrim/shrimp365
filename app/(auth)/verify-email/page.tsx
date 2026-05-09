"use client"

import Link from "next/link"
import { Mail, Waves, RefreshCw, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { useState } from "react"

export default function VerifyEmailPage() {
  const { resendVerification } = useAuth()
  const { t } = useT()
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState("")

  // Extract email from sessionStorage set by signup page
  const email = typeof window !== "undefined"
    ? sessionStorage.getItem("pendingVerifyEmail") ?? ""
    : ""

  async function handleResend() {
    if (!email) return
    setResending(true)
    setResendError("")
    const result = await resendVerification(email)
    if (result.success) {
      setResent(true)
    } else {
      setResendError(result.error ?? "재발송에 실패했습니다.")
    }
    setResending(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-ocean-500/10 border border-ocean-500/30 flex items-center justify-center">
            <Mail className="w-10 h-10 text-ocean-400" />
          </div>
        </div>

        {/* Message */}
        <div>
          <h1 className="text-2xl font-bold text-white mb-3">{t.auth.verifyTitle}</h1>
          <p className="text-slate-400">
            {email
              ? <><span className="text-white font-medium">{email}</span>으로</>
              : "입력하신 이메일 주소로"}
            {" "}{t.auth.verifyMsg}
          </p>
          <p className="text-slate-500 text-sm mt-2">
            링크를 클릭하면 계정 활성화가 완료됩니다.
          </p>
        </div>

        {/* Steps */}
        <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-6 text-left space-y-4">
          {[
            { n: "1", text: t.auth.verifyStepCheck },
            { n: "2", text: t.auth.verifyStepSpam },
            { n: "3", text: t.auth.verifyStepClick },
          ].map(step => (
            <div key={step.n} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-ocean-500/20 border border-ocean-500/30 text-ocean-400 text-xs font-bold flex items-center justify-center shrink-0">
                {step.n}
              </span>
              <p className="text-sm text-slate-300">{step.text}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {email && !resent && (
            <Button
              variant="outline"
              className="w-full border-white/10 text-slate-300 hover:bg-white/5 gap-2"
              onClick={handleResend}
              disabled={resending}
            >
              {resending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />{t.auth.verifyResending}</>
                : <><RefreshCw className="w-4 h-4" />{t.auth.verifyResend}</>}
            </Button>
          )}
          {resent && (
            <p className="text-emerald-400 text-sm">{t.auth.verifyResent}</p>
          )}
          {resendError && (
            <p className="text-red-400 text-sm">{resendError}</p>
          )}

          <Link href="/login">
            <Button variant="outline" className="w-full border-white/10 text-slate-400 hover:bg-white/5 gap-2">
              <ArrowLeft className="w-4 h-4" />{t.auth.goLogin}
            </Button>
          </Link>
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
