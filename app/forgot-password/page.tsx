"use client"

import { useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, CheckCircle2, ArrowLeft, Mail } from "lucide-react"

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const { t } = useT()
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    const result = await sendPasswordReset(email)
    setLoading(false)
    if (result.success) setSent(true)
    else setError(result.error || "오류가 발생했습니다.")
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-ocean-100 rounded-full blur-3xl opacity-50 pointer-events-none" />

      <div className="max-w-md w-full space-y-8 relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">🦐</span>
            <span className="text-foreground text-xl font-bold">Shrimp365</span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-2">{t.auth.forgotTitle}</h1>
          <p className="text-muted-foreground text-sm text-center">{t.auth.forgotSubtitle}</p>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          {sent ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
                  <Mail className="w-8 h-8 text-emerald-600" />
                </div>
              </div>
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">{t.auth.forgotSuccess}</p>
                  <p className="text-xs text-emerald-600 mt-1">
                    <span className="font-semibold">{email}</span>{t.auth.forgotSuccessMsg}
                  </p>
                </div>
              </div>
              <Link href="/login">
                <Button variant="outline" className="w-full gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  {t.auth.goLogin}
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground font-medium">{t.auth.emailLabel}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold h-11"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t.auth.verifyResending}
                  </span>
                ) : t.auth.forgotButton}
              </Button>

              <Link href="/login">
                <Button variant="ghost" className="w-full gap-2 text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-4 h-4" />
                  {t.auth.goLogin}
                </Button>
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
