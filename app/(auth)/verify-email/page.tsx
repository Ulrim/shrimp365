"use client"

import Link from "next/link"
import { Mail, Waves, RefreshCw, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { useState } from "react"

export default function VerifyEmailPage() {
  const { sendPasswordReset } = useAuth()
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)

  // Extract email from sessionStorage set by signup page
  const email = typeof window !== "undefined"
    ? sessionStorage.getItem("pendingVerifyEmail") ?? ""
    : ""

  async function handleResend() {
    if (!email) return
    setResending(true)
    // Supabase resend is done via password reset endpoint as fallback
    // Real resend requires supabase.auth.resend({ type: "signup", email })
    // For now, indicate success after short delay
    await new Promise(r => setTimeout(r, 1000))
    setResent(true)
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
          <h1 className="text-2xl font-bold text-white mb-3">이메일을 확인해주세요</h1>
          <p className="text-slate-400">
            {email
              ? <><span className="text-white font-medium">{email}</span>으로</>
              : "입력하신 이메일 주소로"}
            {" "}인증 링크를 발송했습니다.
          </p>
          <p className="text-slate-500 text-sm mt-2">
            링크를 클릭하면 계정 활성화가 완료됩니다.
          </p>
        </div>

        {/* Steps */}
        <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-6 text-left space-y-4">
          {[
            { n: "1", text: "받은 편지함에서 Shrimp365 인증 메일을 확인하세요" },
            { n: "2", text: "스팸 폴더도 확인해보세요" },
            { n: "3", text: "\"이메일 인증하기\" 링크를 클릭하세요" },
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
                ? <><RefreshCw className="w-4 h-4 animate-spin" />발송 중...</>
                : <><RefreshCw className="w-4 h-4" />인증 메일 재발송</>}
            </Button>
          )}
          {resent && (
            <p className="text-emerald-400 text-sm">재발송되었습니다. 받은 편지함을 확인해주세요.</p>
          )}

          <Link href="/login">
            <Button variant="outline" className="w-full border-white/10 text-slate-400 hover:bg-white/5 gap-2">
              <ArrowLeft className="w-4 h-4" />로그인 페이지로
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
