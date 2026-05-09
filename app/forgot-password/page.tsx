"use client"

import { useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Waves, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react"

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
    if (result.success) {
      setSent(true)
    } else {
      setError(result.error || "오류가 발생했습니다.")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950 p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">Shrimp365</span>
        </div>

        <Card className="bg-white/5 border-white/10 backdrop-blur-md shadow-2xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold text-white">{t.auth.forgotTitle}</CardTitle>
            <CardDescription className="text-ocean-300">
              {t.auth.forgotSubtitle}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">{t.auth.forgotSuccess}</p>
                    <p className="text-xs text-emerald-400/80 mt-1">
                      <span className="font-semibold">{email}</span>{t.auth.forgotSuccessMsg}
                    </p>
                  </div>
                </div>
                <Link href="/login">
                  <Button variant="outline" className="w-full border-white/10 text-slate-300 hover:text-white hover:bg-white/5">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t.auth.goLogin}
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-ocean-100">{t.auth.emailLabel}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400"
                    required
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
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
                  <Button variant="ghost" className="w-full text-ocean-400 hover:text-white">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t.auth.goLogin}
                  </Button>
                </Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
