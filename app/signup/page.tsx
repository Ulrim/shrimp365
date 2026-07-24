"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react"
import { SocialLogin } from "@/components/auth/social-login"
import { OPS_CSS } from "@/components/landing/ops-theme"

const DropMark = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

const BAR_COLORS = ["", "var(--s-crit)", "var(--s-warn)", "var(--s-blue)", "var(--s-good)"]

export default function SignupPage() {
  const router = useRouter()
  const { signup, user } = useAuth()
  const { t } = useT()

  useEffect(() => { if (user) router.replace("/") }, [user, router])

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const strength = (() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 10) s++
    if (/[0-9]/.test(password)) s++
    if (/[a-zA-Z]/.test(password)) s++
    if (/[^a-zA-Z0-9]/.test(password)) s++
    return s
  })()
  const strengthLabel = ["", t.signupX.weak, t.signupX.medium, t.signupX.strong, t.signupX.veryStrong]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (!name.trim()) { setError(t.signupX.nameRequired); return }
    if (password !== confirmPassword) { setError(t.auth.resetPasswordMismatch); return }
    if (password.length < 8) { setError(t.signupX.passwordMin8); return }
    setLoading(true)
    const result = await signup(email, password, name)
    setLoading(false)
    if (result.success) {
      sessionStorage.setItem("pendingVerifyEmail", email)
      router.replace("/verify-email")
    } else setError(result.error || t.auth.loginFailed)
  }

  return (
    <div className="s365">
      <style>{OPS_CSS}</style>
      <div className="s365-auth-main" style={{ minHeight: "100vh" }}>
        <div className="s365-auth-card">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <Link href="/" className="s365-brand"><span className="s365-mark"><DropMark /></span> Shrimp365</Link>
          </div>

          <div className="s365-authbox">
            <div className="top">
              <span className="s365-mark"><DropMark size={13} /></span>
              <h1>{t.auth.signupTitle}</h1>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="s365-fieldrow">
                <label htmlFor="name">{t.auth.nameLabel}</label>
                <input id="name" type="text" className="s365-input" placeholder={t.auth.namePlaceholder}
                  value={name} onChange={e => setName(e.target.value)} autoComplete="name" required />
              </div>
              <div className="s365-fieldrow">
                <label htmlFor="email">{t.auth.emailLabel}</label>
                <input id="email" type="email" className="s365-input" placeholder="email@example.com"
                  value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div className="s365-fieldrow">
                <label htmlFor="password">{t.auth.passwordLabel}</label>
                <div className="s365-inwrap">
                  <input id="password" type={showPassword ? "text" : "password"} className="s365-input" style={{ paddingRight: 40 }}
                    placeholder={t.auth.resetNewPasswordPlaceholder} value={password}
                    onChange={e => setPassword(e.target.value)} autoComplete="new-password" required />
                  <button type="button" className="toggle" onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? t.signupX.hidePassword : t.signupX.showPassword}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && (
                  <div>
                    <div className="s365-strength">
                      {[1, 2, 3, 4].map(i => (
                        <i key={i} style={{ background: i <= strength ? BAR_COLORS[strength] : "var(--s-muted)" }} />
                      ))}
                    </div>
                    <p className="s365-hint" style={{ color: strength <= 1 ? "var(--s-crit)" : strength === 2 ? "var(--s-warn)" : "var(--s-good)" }}>
                      {strengthLabel[strength]}
                    </p>
                  </div>
                )}
              </div>
              <div className="s365-fieldrow">
                <label htmlFor="confirmPassword">{t.auth.resetConfirmPassword}</label>
                <div className="s365-inwrap">
                  <input id="confirmPassword" type="password" className="s365-input" style={{ paddingRight: 40 }}
                    placeholder={t.auth.resetConfirmPasswordPlaceholder} value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
                  {confirmPassword && (
                    <span className="toggle" style={{ pointerEvents: "none" }}>
                      {password === confirmPassword
                        ? <CheckCircle2 className="w-4 h-4" style={{ color: "var(--s-good)" }} />
                        : <AlertCircle className="w-4 h-4" style={{ color: "var(--s-crit)" }} />}
                    </span>
                  )}
                </div>
              </div>

              {error && (
                <div className="s365-alert err"><AlertCircle className="w-4 h-4" style={{ flex: "0 0 auto" }} /> {error}</div>
              )}

              <button type="submit" className="s365-btn primary full lg" disabled={loading}>
                {loading ? t.auth.signupLoading : t.auth.signupButton}
              </button>
            </form>

            <SocialLogin />

            <div className="s365-authfoot">
              <span>{t.auth.hasAccount} <Link href="/login">{t.auth.goLogin}</Link></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
