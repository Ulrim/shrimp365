"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Eye, EyeOff, AlertCircle, ShieldCheck, CheckCircle2 } from "lucide-react"
import { SocialLogin } from "@/components/auth/social-login"
import { OPS_CSS } from "@/components/landing/ops-theme"

const DropMark = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

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
    if (result.success) router.replace("/home")
    else setError(result.error || t.auth.loginFailed)
  }

  const fillTestAccount = (type: "admin" | "operator" | "monitor") => {
    setEmail(`${type}@shrimp365.com`)
    setPassword("")
  }

  return (
    <div className="s365">
      <style>{OPS_CSS}</style>
      <div className="s365-auth">
        {/* Left — ops brand panel */}
        <aside className="s365-auth-side">
          <Link href="/" className="s365-brand"><span className="s365-mark"><DropMark /></span> Shrimp365</Link>
          <div>
            <span className="s365-eyebrow mono">{t.loginX.heroTitle}</span>
            <h1 className="s365-h1" style={{ fontSize: "clamp(28px,3vw,40px)", margin: "14px 0 14px" }}>
              {t.loginX.heroTitleHighlight}
            </h1>
            <p style={{ color: "var(--s-sub)", fontSize: 15.5, maxWidth: "42ch", margin: 0 }}>{t.loginX.heroSubtitle}</p>
            <div className="s365-sidefeat">
              {t.loginX.features.map(f => (
                <div key={f.label} className="it">
                  <CheckCircle2 className="w-[16px] h-[16px]" /> {f.label}
                </div>
              ))}
            </div>
          </div>
          <div className="mono" style={{ fontSize: 12, color: "var(--s-sub)" }}>© {new Date().getFullYear()} CULIVER INC.</div>
        </aside>

        {/* Right — form */}
        <main className="s365-auth-main">
          <div className="s365-auth-card">
            <div className="s365-authbox">
              <div className="top">
                <span className="s365-mark"><DropMark size={13} /></span>
                <h1>{t.auth.loginTitle}</h1>
              </div>

              {verified && (
                <div className="s365-alert ok"><CheckCircle2 className="w-4 h-4" style={{ flex: "0 0 auto" }} /> {t.loginX.verifiedBanner}</div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="s365-fieldrow">
                  <label htmlFor="email">{t.auth.emailLabel}</label>
                  <input id="email" type="email" className="s365-input" placeholder="email@example.com"
                    value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
                </div>
                <div className="s365-fieldrow">
                  <label htmlFor="password">{t.auth.passwordLabel}</label>
                  <div className="s365-inwrap">
                    <input id="password" type={showPassword ? "text" : "password"} className="s365-input" style={{ paddingRight: 40 }}
                      placeholder={t.auth.passwordPlaceholder} value={password} onChange={e => setPassword(e.target.value)}
                      autoComplete="current-password" required />
                    <button type="button" className="toggle" onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? t.loginX.hidePassword : t.loginX.showPassword}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="s365-alert err"><AlertCircle className="w-4 h-4" style={{ flex: "0 0 auto" }} /> {error}</div>
                )}

                <button type="submit" className="s365-btn primary full lg" disabled={loading}>
                  {loading ? t.auth.loginLoading : t.auth.loginButton}
                </button>
              </form>

              <SocialLogin />

              {process.env.NEXT_PUBLIC_SHOW_TEST_ACCOUNTS === "true" && (
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--s-hair)" }}>
                  <p className="mono" style={{ fontSize: 11, color: "var(--s-sub)", display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                    <ShieldCheck className="w-3.5 h-3.5" /> {t.auth.testAccounts}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {(["admin", "operator", "monitor"] as const).map(type => (
                      <button key={type} type="button" onClick={() => fillTestAccount(type)}
                        className="s365-btn ghost" style={{ height: 34, fontSize: 12 }}>{type}@</button>
                    ))}
                  </div>
                  <p style={{ textAlign: "center", fontSize: 11, color: "var(--s-sub)", marginTop: 8 }}>{t.auth.testAccountHint}</p>
                </div>
              )}

              <div className="s365-authfoot">
                <span>{t.auth.noAccount} <Link href="/signup">{t.auth.goSignup}</Link></span>
                <Link href="/forgot-password">{t.auth.forgotPassword}</Link>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginPageInner />
    </Suspense>
  )
}
