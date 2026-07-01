"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react"
import { SocialLogin } from "@/components/auth/social-login"

export default function SignupPage() {
  const router = useRouter()
  const { signup, user } = useAuth()
  const { t } = useT()

  // 이미 로그인된 사용자는 홈으로 리다이렉트
  useEffect(() => {
    if (user) {
      router.replace("/")
    }
  }, [user, router])
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const passwordStrength = () => {
    if (!password) return 0
    let score = 0
    if (password.length >= 10) score++
    if (/[0-9]/.test(password)) score++
    if (/[a-zA-Z]/.test(password)) score++
    if (/[^a-zA-Z0-9]/.test(password)) score++
    return score
  }

  const strengthLabel = ["", "약함", "보통", "강함", "매우 강함"]
  const strengthColor = ["", "bg-red-500", "bg-amber-500", "bg-ocean-500", "bg-emerald-500"]
  const strength = passwordStrength()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name.trim()) { setError("이름을 입력해주세요."); return }
    if (password !== confirmPassword) { setError(t.auth.resetPasswordMismatch); return }
    if (password.length < 8) { setError("비밀번호는 최소 8자 이상이어야 합니다."); return }

    setLoading(true)
    const result = await signup(email, password, name)
    setLoading(false)
    if (result.success) {
      sessionStorage.setItem("pendingVerifyEmail", email)
      router.replace("/verify-email")
    } else {
      setError(result.error || t.auth.loginFailed)
    }
  }

  return (
    <div className="bg-background min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Glow decoration */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-ocean-100 rounded-full blur-3xl opacity-60 pointer-events-none" />

      <div className="max-w-md w-full space-y-8 relative z-10">
        {/* Header / Logo */}
        <div className="flex flex-col items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">🦐</span>
            <span className="text-foreground text-xl font-bold">Shrimp365</span>
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-2">회원가입</h1>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground text-sm font-medium">{t.auth.nameLabel}</Label>
              <Input
                id="name"
                type="text"
                placeholder={t.auth.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="min-h-[44px]"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground text-sm font-medium">{t.auth.emailLabel}</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="min-h-[44px]"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground text-sm font-medium">{t.auth.passwordLabel}</Label>
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
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all ${i <= strength ? strengthColor[strength] : "bg-muted"}`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${strength <= 1 ? "text-red-500" : strength === 2 ? "text-amber-500" : "text-emerald-600"}`}>
                    {strengthLabel[strength]}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-foreground text-sm font-medium">{t.auth.resetConfirmPassword}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t.auth.resetConfirmPasswordPlaceholder}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10 min-h-[44px]"
                  required
                />
                {confirmPassword && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {password === confirmPassword
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : <AlertCircle className="w-4 h-4 text-red-500" />
                    }
                  </span>
                )}
              </div>
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
                  {t.auth.signupLoading}
                </span>
              ) : t.auth.signupButton}
            </Button>
          </form>

          <div className="mt-4">
            <SocialLogin />
          </div>
        </div>

        {/* Login link */}
        <p className="text-center text-sm text-muted-foreground">
          {t.auth.hasAccount}{" "}
          <Link href="/login" className="text-ocean-600 hover:text-ocean-700 font-medium transition-colors">
            {t.auth.goLogin}
          </Link>
        </p>
      </div>
    </div>
  )
}
