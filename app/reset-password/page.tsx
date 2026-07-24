"use client"

import { BrandMark } from "@/components/ui/brand-mark"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, CheckCircle2, Eye, EyeOff, ArrowLeft } from "lucide-react"

export default function ResetPasswordPage() {
  const router = useRouter()
  const { t } = useT()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password.length < 6) { setError(t.auth.resetPasswordShort); return }
    if (password !== confirm) { setError(t.auth.resetPasswordMismatch); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) setError(t.auth.resetExpiredLink)
    else { setDone(true); setTimeout(() => router.replace("/login"), 3000) }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-ocean-100 rounded-full blur-3xl opacity-50 pointer-events-none" />

      <div className="max-w-md w-full space-y-8 relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark size={32} icon={16} />
            <span className="text-foreground text-xl font-bold">Shrimp365</span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-2">{t.auth.resetTitle}</h1>
          <p className="text-muted-foreground text-sm">{done ? t.auth.resetSuccess : t.auth.resetSubtitle}</p>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          {done ? (
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-medium text-sm">{t.auth.resetSuccess}</p>
                  <p className="text-xs text-emerald-600 mt-1">{t.auth.resetSuccessMsg}</p>
                </div>
              </div>
              <Link href="/login">
                <Button
                  className="w-full bg-ocean-600 hover:bg-ocean-700 text-white font-semibold min-h-[44px]"
                  aria-label={t.auth.resetGoLogin}
                >
                  {t.auth.resetGoLogin}
                </Button>
              </Link>
            </div>
          ) : !ready ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin mx-auto" aria-hidden="true" />
              <p className="text-muted-foreground text-sm">재설정 링크를 확인 중...</p>
              <p className="text-muted-foreground text-xs">
                링크가 유효하지 않으면{" "}
                <Link href="/forgot-password" className="text-ocean-600 hover:text-ocean-700 underline">여기</Link>
                에서 다시 요청하세요.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground font-medium">{t.auth.resetNewPassword}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t.auth.resetNewPasswordPlaceholder}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10 min-h-[44px]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-foreground font-medium">{t.auth.resetConfirmPassword}</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    placeholder={t.auth.resetConfirmPasswordPlaceholder}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10 min-h-[44px]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-3 py-2 text-sm"
                  role="alert"
                  aria-live="assertive"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-ocean-600 hover:bg-ocean-700 text-white font-semibold min-h-[44px]"
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                    {t.auth.resetLoading}
                  </span>
                ) : t.auth.resetButton}
              </Button>

              <Link href="/login">
                <Button variant="ghost" className="w-full gap-2 min-h-[44px] text-muted-foreground hover:text-foreground" aria-label="로그인으로 돌아가기">
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  로그인으로 돌아가기
                </Button>
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
