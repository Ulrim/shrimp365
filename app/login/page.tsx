"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Eye, EyeOff, AlertCircle, ShieldCheck } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const { t } = useT()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    const result = await login(email, password)
    setLoading(false)
    if (result.success) {
      router.replace("/dashboard")
    } else {
      setError(result.error || t.auth.loginFailed)
    }
  }

  const fillTestAccount = (type: "admin" | "operator" | "monitor") => {
    if (type === "admin") setEmail("admin@shrimp365.com")
    else if (type === "operator") setEmail("operator@shrimp365.com")
    else setEmail("monitor@shrimp365.com")
    setPassword("")
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-ocean-600/20 to-teal-600/20" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-ocean-500/10 rounded-full blur-3xl" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center text-xl leading-none">
            🦐
          </div>
          <span className="text-white text-xl font-bold">Shrimp365</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-5xl font-bold text-white leading-tight mb-6">
            스마트 양식 관리의<br />
            <span className="bg-gradient-to-r from-ocean-300 to-teal-300 bg-clip-text text-transparent">
              새로운 기준
            </span>
          </h1>
          <p className="text-ocean-200 text-lg leading-relaxed mb-8">
            AI 기반 수질 모니터링, 생육 관리, 질병 진단을 하나의 플랫폼에서.
            흰다리새우 양식의 수익성과 안정성을 동시에 높이세요.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: "📡", label: "실시간 수질 모니터링" },
              { icon: "🤖", label: "AI 운영 권고" },
              { icon: "🦠", label: "질병 진단 연계" },
              { icon: "📊", label: "자동 리포트 생성" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 bg-white/5 rounded-xl p-3 backdrop-blur-sm border border-white/10">
                <span className="text-2xl">{item.icon}</span>
                <span className="text-sm text-ocean-100">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-6 text-ocean-400 text-sm">
          <span>© 2026 CULIVER INC. All rights reserved.</span>
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center text-xl leading-none">
              🦐
            </div>
            <span className="text-white text-xl font-bold">Shrimp365</span>
          </div>

          <Card className="bg-white/5 border-white/10 backdrop-blur-md shadow-2xl">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl font-bold text-white">{t.auth.loginTitle}</CardTitle>
              <CardDescription className="text-ocean-300">
                {t.auth.loginSubtitle}
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-ocean-100">{t.auth.passwordLabel}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t.auth.passwordPlaceholder}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
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
                      {t.auth.loginLoading}
                    </span>
                  ) : t.auth.loginButton}
                </Button>
              </form>

              {process.env.NEXT_PUBLIC_SHOW_TEST_ACCOUNTS === "true" && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-center text-xs text-ocean-400 mb-3 flex items-center gap-2 justify-center">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {t.auth.testAccounts}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => fillTestAccount("admin")}
                      className="text-xs bg-ocean-500/20 hover:bg-ocean-500/30 text-ocean-300 border border-ocean-500/30 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <div className="font-medium">관리자</div>
                      <div className="text-ocean-400 mt-0.5 truncate">admin@</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => fillTestAccount("operator")}
                      className="text-xs bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/30 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <div className="font-medium">운영자</div>
                      <div className="text-teal-400 mt-0.5 truncate">operator@</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => fillTestAccount("monitor")}
                      className="text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <div className="font-medium">모니터링</div>
                      <div className="text-purple-400 mt-0.5 truncate">monitor@</div>
                    </button>
                  </div>
                  <p className="text-center text-xs text-ocean-500 mt-2">{t.auth.testAccountHint}</p>
                </div>
              )}

              <div className="text-center mt-4 space-y-2">
                <p className="text-sm text-ocean-400">
                  {t.auth.noAccount}{" "}
                  <Link href="/signup" className="text-ocean-300 hover:text-white font-medium transition-colors">
                    {t.auth.goSignup}
                  </Link>
                </p>
                <p className="text-sm text-ocean-400">
                  <Link href="/forgot-password" className="text-ocean-300 hover:text-white font-medium transition-colors">
                    {t.auth.forgotPassword}
                  </Link>
                </p>
                <p className="text-sm text-ocean-500">
                  처음 사용하시나요?{" "}
                  <Link href="/guide" className="text-ocean-400 hover:text-ocean-300 font-medium transition-colors">
                    📖 사용 가이드 보기
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
