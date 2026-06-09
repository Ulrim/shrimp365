"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  X, Settings, User, Lock, Bell, Info, Save, Eye, EyeOff,
  CheckCircle2, AlertCircle, CreditCard, Mail, Trash2, ExternalLink, RefreshCw,
} from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { PLAN_LABELS, PLAN_COLORS, PLAN_PRICES, PLAN_LIMITS, isPaidPlan } from "@/lib/plans"
import type { Plan } from "@/lib/plans"

type Tab = "account" | "subscription" | "notifications" | "info"

interface NotifPrefs {
  alertDanger: boolean
  alertWarning: boolean
  alertInfo: boolean
  soundEnabled: boolean
}

const DEFAULT_PREFS: NotifPrefs = {
  alertDanger: true,
  alertWarning: true,
  alertInfo: false,
  soundEnabled: false,
}

function loadPrefs(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS
  try {
    const raw = localStorage.getItem("shrimp365_notif_prefs")
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch { return DEFAULT_PREFS }
}

function savePrefs(prefs: NotifPrefs) {
  localStorage.setItem("shrimp365_notif_prefs", JSON.stringify(prefs))
}

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { user, updateProfile, updatePassword, updateEmail, logout } = useAuth()
  const { t } = useT()
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>("account")

  // Account state
  const [name, setName] = useState("")
  const [nameSaving, setNameSaving] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Email change state
  const [newEmail, setNewEmail] = useState("")
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Password state
  const [pw, setPw] = useState({ next: "", confirm: "" })
  const [showPw, setShowPw] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Notification prefs
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)

  // Account deletion
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null)

  // Subscription portal
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setName(user?.name || "")
      setTab("account")
      setNameMsg(null)
      setPwMsg(null)
      setEmailMsg(null)
      setPw({ next: "", confirm: "" })
      setNewEmail("")
      setDeleteConfirm("")
      setDeleteMsg(null)
      setPrefs(loadPrefs())
    }
  }, [open, user])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClickOutside)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClickOutside)
    }
  }, [open, onClose])

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setNameSaving(true)
    setNameMsg(null)
    try {
      await updateProfile(name.trim())
      setNameMsg({ ok: true, text: t.settings.nameUpdated })
    } catch {
      setNameMsg({ ok: false, text: t.settings.saving })
    } finally {
      setNameSaving(false)
    }
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailMsg({ ok: false, text: t.auth.emailPlaceholder })
      return
    }
    setEmailSaving(true)
    setEmailMsg(null)
    try {
      const result = await updateEmail(newEmail.trim())
      if (result.success) {
        setEmailMsg({ ok: true, text: t.settings.emailSent })
        setNewEmail("")
      } else {
        setEmailMsg({ ok: false, text: result.error || t.settings.changeEmail })
      }
    } catch {
      setEmailMsg({ ok: false, text: t.settings.changeEmail })
    } finally {
      setEmailSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwMsg(null)
    if (pw.next.length < 6) { setPwMsg({ ok: false, text: t.settings.passwordShort }); return }
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: t.settings.passwordMismatch }); return }
    setPwSaving(true)
    try {
      const result = await updatePassword(pw.next)
      if (result.success) {
        setPwMsg({ ok: true, text: t.settings.passwordChanged })
        setPw({ next: "", confirm: "" })
      } else {
        setPwMsg({ ok: false, text: result.error || t.settings.changePassword })
      }
    } catch {
      setPwMsg({ ok: false, text: t.settings.changePassword })
    } finally {
      setPwSaving(false)
    }
  }

  function togglePref<K extends keyof NotifPrefs>(key: K) {
    setPrefs(prev => {
      const updated = { ...prev, [key]: !prev[key] }
      savePrefs(updated)
      return updated
    })
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== t.settings.deleteConfirmWord) return
    setDeleting(true)
    setDeleteMsg(null)
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error)
      await logout()
      router.replace("/login")
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : t.settings.deleteAccount)
    } finally {
      setDeleting(false)
    }
  }

  async function handleOpenPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch("/api/dodo/portal", { method: "POST" })
      const json = await res.json()
      if (json.url) window.open(json.url, "_blank")
      else setPortalLoading(false)
    } catch {
      setPortalLoading(false)
    }
  }

  if (!open) return null

  const plan = (user?.plan ?? "free") as Plan

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "account",       label: t.settings.tabAccount,       icon: <User className="w-4 h-4" /> },
    { id: "subscription",  label: t.settings.tabSubscription,  icon: <CreditCard className="w-4 h-4" /> },
    { id: "notifications", label: t.settings.tabNotifications, icon: <Bell className="w-4 h-4" /> },
    { id: "info",          label: t.settings.tabInfo,          icon: <Info className="w-4 h-4" /> },
  ]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div ref={panelRef} className="relative w-full max-w-lg mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-ocean-500" />
            <span className="text-foreground font-semibold">{t.settings.title}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {TABS.map(tab_ => (
            <button
              key={tab_.id}
              onClick={() => setTab(tab_.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors ${
                tab === tab_.id
                  ? "text-ocean-600 border-b-2 border-ocean-500 bg-ocean-50"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {tab_.icon}
              {tab_.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 max-h-[65vh] overflow-y-auto space-y-6">

          {/* ── Account tab ── */}
          {tab === "account" && (
            <>
              {/* Name */}
              <form onSubmit={handleSaveName} className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{t.settings.displayName}</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="bg-background border-border text-foreground flex-1"
                    placeholder={t.settings.displayNamePlaceholder}
                  />
                  <Button type="submit" disabled={nameSaving || !name.trim()} size="sm" className="bg-ocean-500 hover:bg-ocean-600 text-white shrink-0">
                    {nameSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
                {nameMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${nameMsg.ok ? "text-emerald-500" : "text-red-500"}`}>
                    {nameMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {nameMsg.text}
                  </p>
                )}
              </form>

              <div className="border-t border-border" />

              {/* Email change */}
              <form onSubmit={handleChangeEmail} className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{t.settings.emailSection}</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">{t.common.email}</Label>
                  <Input value={user?.email || ""} disabled className="bg-muted border-border text-muted-foreground cursor-not-allowed" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">{t.settings.newEmail}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder={t.settings.newEmailPlaceholder}
                      className="bg-background border-border text-foreground flex-1"
                    />
                    <Button type="submit" disabled={emailSaving || !newEmail.trim()} size="sm" className="bg-muted hover:bg-accent text-foreground shrink-0">
                      {emailSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : t.settings.changeEmail}
                    </Button>
                  </div>
                </div>
                {emailMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${emailMsg.ok ? "text-emerald-500" : "text-red-500"}`}>
                    {emailMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {emailMsg.text}
                  </p>
                )}
              </form>

              <div className="border-t border-border" />

              {/* Password */}
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t.settings.passwordSection}</span>
                  </div>
                  <button type="button" onClick={() => setShowPw(v => !v)} className="text-xs text-muted-foreground hover:text-foreground/80 flex items-center gap-1">
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPw ? t.common.none : t.common.view}
                  </button>
                </div>
                <div className="space-y-2">
                  {[
                    { key: "next" as const, label: t.settings.newPassword, placeholder: t.settings.newPasswordPlaceholder },
                    { key: "confirm" as const, label: t.settings.confirmPassword, placeholder: t.settings.confirmPasswordPlaceholder },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-muted-foreground text-xs">{f.label}</Label>
                      <Input
                        type={showPw ? "text" : "password"}
                        value={pw[f.key]}
                        onChange={e => setPw(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="bg-background border-border text-foreground"
                      />
                    </div>
                  ))}
                </div>
                {pwMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${pwMsg.ok ? "text-emerald-500" : "text-red-500"}`}>
                    {pwMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {pwMsg.text}
                  </p>
                )}
                <Button type="submit" disabled={pwSaving || !pw.next || !pw.confirm} className="w-full bg-muted hover:bg-accent text-foreground">
                  {pwSaving ? t.settings.saving : t.settings.changePassword}
                </Button>
              </form>

              <div className="border-t border-border" />

              {/* Danger zone: account deletion */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">{t.settings.deleteAccount}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.settings.deleteAccountDesc}
                </p>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">{t.settings.deleteAccountConfirmLabel}</Label>
                  <Input
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder={t.settings.deleteAccountConfirmPlaceholder}
                    className="bg-background border-red-500/20 text-foreground"
                  />
                </div>
                {deleteMsg && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{deleteMsg}
                  </p>
                )}
                <Button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirm !== t.settings.deleteConfirmWord || deleting}
                  className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 disabled:opacity-30"
                  variant="outline"
                >
                  {deleting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  {t.settings.deleteAccountButton}
                </Button>
              </div>
            </>
          )}

          {/* ── Subscription tab ── */}
          {tab === "subscription" && (
            <div className="space-y-5">
              <div className="p-4 bg-muted border border-border rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t.settings.currentPlan}</span>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gradient-to-r from-ocean-500 to-teal-500 text-white">
                    Free
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">요금</span>
                  <span className="text-foreground font-semibold">무료 (광고 기반)</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  모든 기능을 제한 없이 무료로 사용할 수 있습니다.
                </p>
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">포함된 기능</p>
                {[
                  "수질 모니터링 · 이상 알림",
                  "AI 어드바이저 무제한",
                  "양식장·수조 무제한",
                  "질병 진단 (AHPND·EHP·WSSV)",
                  "재고 관리 · CSV 내보내기",
                  "7일·30일·90일 리포트",
                ].map(f => (
                  <div key={f} className="flex items-center gap-2 py-1.5 border-b border-border">
                    <span className="text-emerald-500">✓</span>
                    <span className="text-foreground/80">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Notifications tab ── */}
          {tab === "notifications" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground mb-4">{t.settings.tabNotifications}</p>
              {[
                { key: "alertDanger" as const, label: t.settings.notifDanger,   desc: t.dashboard.danger,   color: "text-red-500" },
                { key: "alertWarning" as const, label: t.settings.notifWarning, desc: t.dashboard.warning,  color: "text-amber-500" },
                { key: "alertInfo" as const,   label: t.settings.notifInfo,     desc: t.settings.tabInfo,   color: "text-ocean-500" },
                { key: "soundEnabled" as const, label: t.settings.notifSound,   desc: t.settings.notifSound, color: "text-purple-500" },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-4 bg-muted rounded-xl border border-border">
                  <div>
                    <p className={`text-sm font-medium ${item.color}`}>{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                  <Switch checked={prefs[item.key]} onCheckedChange={() => togglePref(item.key)} />
                </div>
              ))}
            </div>
          )}

          {/* ── Info tab ── */}
          {tab === "info" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="w-14 h-14 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-2xl flex items-center justify-center">
                  <span className="text-white text-2xl font-bold">🦐</span>
                </div>
                <div>
                  <p className="text-foreground font-bold text-lg">Shrimp365</p>
                  <p className="text-muted-foreground text-sm">{t.dashboard.subtitle}</p>
                  <p className="text-muted-foreground text-xs mt-1">v1.0.0</p>
                </div>
              </div>
              <div className="border-t border-border" />
              <div className="space-y-2 text-sm">
                {[
                  { label: t.settings.support, value: "CULIVER INC" },
                  { label: "Supabase", value: "Supabase" },
                  { label: "Next.js", value: "Next.js 16" },
                  { label: t.common.date, value: new Date().toLocaleDateString("ko-KR") },
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="text-foreground/80 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
              {/* Support contact */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{t.settings.support}</p>
                <a
                  href={`mailto:${t.settings.supportContact}`}
                  className="flex items-center gap-2 p-3 bg-ocean-500/10 border border-ocean-500/20 rounded-xl text-sm text-ocean-300 hover:bg-ocean-500/20 transition-colors"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  {t.settings.supportContact}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
