"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Waves, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react"

export default function ResetPasswordPage() {
  const router = useRouter()
  const { t } = useT()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase sends the recovery token in the URL hash.
    // onAuthStateChange fires with event=PASSWORD_RECOVERY when the hash is processed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password.length < 6) {
      setError(t.auth.resetPasswordShort)
      return
    }
    if (password !== confirm) {
      setError(t.auth.resetPasswordMismatch)
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(t.auth.resetExpiredLink)
    } else {
      setDone(true)
      setTimeout(() => router.replace("/login"), 3000)
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
            <CardTitle className="text-2xl font-bold text-white">{t.auth.resetTitle}</CardTitle>
            <CardDescription className="text-ocean-300">
              {done ? t.auth.resetSuccess : t.auth.resetSubtitle}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3">
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">{t.auth.resetSuccess}</p>
                    <p className="text-xs text-emerald-400/80 mt-1">{t.auth.resetSuccessMsg}</p>
                  </div>
                </div>
                <Link href="/login">
                  <Button className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 text-white">
                    {t.auth.resetGoLogin}
                  </Button>
                </Link>
              </div>
            ) : !ready ? (
              <div className="text-center py-8">
                <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-slate-400 text-sm">재설정 링크를 확인 중...</p>
                <p className="text-slate-500 text-xs mt-2">링크가 유효하지 않으면 <Link href="/forgot-password" className="text-ocean-400 hover:text-white">여기</Link>에서 다시 요청하세요.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-ocean-100">{t.auth.resetNewPassword}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t.auth.resetNewPasswordPlaceholder}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-ocean-100">{t.auth.resetConfirmPassword}</Label>
                  <Input
                    id="confirm"
                    type="password"
                    placeholder={t.auth.resetConfirmPasswordPlaceholder}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
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
                      {t.auth.resetLoading}
                    </span>
                  ) : t.auth.resetButton}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
