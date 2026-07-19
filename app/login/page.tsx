"use client"

import { useState, Suspense } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Eye, EyeOff, AlertCircle, ShieldCheck, CheckCircle2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { SocialLogin } from "@/components/auth/social-login"

function LoginPageInner() {
  const router = useRouter()
  const { login } = useAuth()
  const { t } = useT()
  const searchParams = useSearchParams()
  const verified = searchParams.get("verified") === "1"
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
      router.replace("/home")
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
    <div className="min-h-screen flex bg-gradient-to-br from-ocean-50 to-teal-50">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden bg-white">
        <div className="absolute inset-0 bg-gradient-to-br from-ocean-50/80 to-teal-50/80" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-ocean-100 rounded-full blur-3xl" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-teal-100 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center text-xl leading-none">
            🦐
          </div>
          <span className="text-foreground text-xl font-bold">Shrimp365</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-5xl font-bold text-foreground leading-tight mb-6">
            {t.loginX.heroTitle}<br />
            <span className="bg-gradient-to-r from-ocean-500 to-teal-500 bg-clip-text text-transparent">
              {t.loginX.heroTitleHighlight}
            </span>
          </h1>
          <p className="text-ocean-700 text-lg leading-relaxed mb-8">
            {t.loginX.heroSubtitle}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {t.loginX.features.map((item) => (
              <div key={item.label} className="flex items-center gap-3 bg-ocean-50 rounded-xl p-3 border border-ocean-100">
                <span className="text-2xl">{item.icon}</span>
                <span className="text-sm text-ocean-700">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-6 text-ocean-600 text-sm">
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
            <span className="text-foreground text-xl font-bold">Shrimp365</span>
          </div>

          <Card className="bg-card border border-border shadow-sm">
            {verified && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-t-2xl px-4 py-3 text-sm">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {t.loginX.verifiedBanner}
              </div>
            )}
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl font-bold text-foreground">{t.auth.loginTitle}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t.auth.loginSubtitle}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground">{t.auth.emailLabel}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-400 min-h-[44px]"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-foreground">{t.auth.passwordLabel}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t.auth.passwordPlaceholder}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-400 pr-10 min-h-[44px]"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? t.loginX.hidePassword : t.loginX.showPassword}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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

              <div className="mt-4">
                <SocialLogin />
              </div>

              {process.env.NEXT_PUBLIC_SHOW_TEST_ACCOUNTS === "true" && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-center text-xs text-ocean-600 mb-3 flex items-center gap-2 justify-center">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {t.auth.testAccounts}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => fillTestAccount("admin")}
                      className="text-xs bg-ocean-50 hover:bg-ocean-100 text-ocean-700 border border-ocean-200 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <div className="font-medium">관리자</div>
                      <div className="text-ocean-500 mt-0.5 truncate">admin@</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => fillTestAccount("operator")}
                      className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <div className="font-medium">운영자</div>
                      <div className="text-teal-500 mt-0.5 truncate">operator@</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => fillTestAccount("monitor")}
                      className="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <div className="font-medium">모니터링</div>
                      <div className="text-purple-500 mt-0.5 truncate">monitor@</div>
                    </button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground mt-2">{t.auth.testAccountHint}</p>
                </div>
              )}

              <div className="text-center mt-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t.auth.noAccount}{" "}
                  <Link href="/signup" className="text-ocean-600 hover:text-ocean-700 font-medium transition-colors">
                    {t.auth.goSignup}
                  </Link>
                </p>
                <p className="text-sm text-muted-foreground">
                  <Link href="/forgot-password" className="text-ocean-600 hover:text-ocean-700 font-medium transition-colors">
                    {t.auth.forgotPassword}
                  </Link>
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.loginX.guidePrompt}{" "}
                  <Link href="/guide" className="text-ocean-600 hover:text-ocean-700 font-medium transition-colors">
                    📖 {t.loginX.guideLink}
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginPageInner />
    </Suspense>
  )
}
