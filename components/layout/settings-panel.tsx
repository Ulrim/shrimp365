"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  X, Settings, User, Lock, Bell, Info, Save, Eye, EyeOff,
  CheckCircle2, AlertCircle, CreditCard, Mail, Trash2, ExternalLink, RefreshCw,
} from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { PLAN_LABELS, PLAN_COLORS, PLAN_PRICES, isPaidPlan } from "@/lib/plans"
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
      setNameMsg({ ok: true, text: "이름이 저장되었습니다." })
    } catch {
      setNameMsg({ ok: false, text: "저장에 실패했습니다." })
    } finally {
      setNameSaving(false)
    }
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailMsg({ ok: false, text: "유효한 이메일 주소를 입력해주세요." })
      return
    }
    setEmailSaving(true)
    setEmailMsg(null)
    try {
      const result = await updateEmail(newEmail.trim())
      if (result.success) {
        setEmailMsg({ ok: true, text: "확인 메일을 발송했습니다. 새 이메일에서 링크를 클릭해주세요." })
        setNewEmail("")
      } else {
        setEmailMsg({ ok: false, text: result.error || "변경에 실패했습니다." })
      }
    } catch {
      setEmailMsg({ ok: false, text: "변경에 실패했습니다." })
    } finally {
      setEmailSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwMsg(null)
    if (pw.next.length < 6) { setPwMsg({ ok: false, text: "새 비밀번호는 6자 이상이어야 합니다." }); return }
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: "새 비밀번호가 일치하지 않습니다." }); return }
    setPwSaving(true)
    try {
      const result = await updatePassword(pw.next)
      if (result.success) {
        setPwMsg({ ok: true, text: "비밀번호가 변경되었습니다." })
        setPw({ next: "", confirm: "" })
      } else {
        setPwMsg({ ok: false, text: result.error || "변경에 실패했습니다." })
      }
    } catch {
      setPwMsg({ ok: false, text: "변경에 실패했습니다." })
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
    if (deleteConfirm !== "삭제") return
    setDeleting(true)
    setDeleteMsg(null)
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error)
      await logout()
      router.replace("/login")
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : "삭제에 실패했습니다.")
    } finally {
      setDeleting(false)
    }
  }

  async function handleOpenPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
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
    { id: "account",       label: "계정",    icon: <User className="w-4 h-4" /> },
    { id: "subscription",  label: "구독",    icon: <CreditCard className="w-4 h-4" /> },
    { id: "notifications", label: "알림",    icon: <Bell className="w-4 h-4" /> },
    { id: "info",          label: "정보",    icon: <Info className="w-4 h-4" /> },
  ]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div ref={panelRef} className="relative w-full max-w-lg mx-4 bg-slate-900 border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-ocean-400" />
            <span className="text-white font-semibold">설정</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "text-ocean-400 border-b-2 border-ocean-400 bg-ocean-500/5"
                  : "text-slate-400 hover:text-white hover:bg-white/3"
              }`}
            >
              {t.icon}
              {t.label}
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
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-medium text-white">표시 이름</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="bg-slate-800 border-white/10 text-white flex-1"
                    placeholder="표시 이름 입력"
                  />
                  <Button type="submit" disabled={nameSaving || !name.trim()} size="sm" className="bg-ocean-500 hover:bg-ocean-600 text-white shrink-0">
                    {nameSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
                {nameMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${nameMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {nameMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {nameMsg.text}
                  </p>
                )}
              </form>

              <div className="border-t border-white/10" />

              {/* Email change */}
              <form onSubmit={handleChangeEmail} className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-medium text-white">이메일 변경</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-400 text-xs">현재 이메일</Label>
                  <Input value={user?.email || ""} disabled className="bg-slate-800/50 border-white/5 text-slate-500 cursor-not-allowed" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-400 text-xs">새 이메일</Label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder="새 이메일 주소"
                      className="bg-slate-800 border-white/10 text-white flex-1"
                    />
                    <Button type="submit" disabled={emailSaving || !newEmail.trim()} size="sm" className="bg-slate-700 hover:bg-slate-600 text-white shrink-0">
                      {emailSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : "변경"}
                    </Button>
                  </div>
                </div>
                {emailMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${emailMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {emailMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {emailMsg.text}
                  </p>
                )}
              </form>

              <div className="border-t border-white/10" />

              {/* Password */}
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium text-white">비밀번호 변경</span>
                  </div>
                  <button type="button" onClick={() => setShowPw(v => !v)} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPw ? "숨기기" : "표시"}
                  </button>
                </div>
                <div className="space-y-2">
                  {[
                    { key: "next" as const, label: "새 비밀번호" },
                    { key: "confirm" as const, label: "새 비밀번호 확인" },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-slate-400 text-xs">{f.label}</Label>
                      <Input
                        type={showPw ? "text" : "password"}
                        value={pw[f.key]}
                        onChange={e => setPw(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder="6자 이상"
                        className="bg-slate-800 border-white/10 text-white"
                      />
                    </div>
                  ))}
                </div>
                {pwMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${pwMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {pwMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {pwMsg.text}
                  </p>
                )}
                <Button type="submit" disabled={pwSaving || !pw.next || !pw.confirm} className="w-full bg-slate-700 hover:bg-slate-600 text-white">
                  {pwSaving ? "변경중..." : "비밀번호 변경"}
                </Button>
              </form>

              <div className="border-t border-white/10" />

              {/* Danger zone: account deletion */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">계정 삭제</span>
                </div>
                <p className="text-xs text-slate-500">
                  계정을 삭제하면 모든 데이터(양식장, 수질 기록, 일지, 진단)가 영구 삭제되며 복구할 수 없습니다.
                </p>
                <div className="space-y-2">
                  <Label className="text-slate-400 text-xs">확인을 위해 <span className="text-red-400 font-bold">삭제</span>를 입력하세요</Label>
                  <Input
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder="삭제"
                    className="bg-slate-800 border-red-500/20 text-white"
                  />
                </div>
                {deleteMsg && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{deleteMsg}
                  </p>
                )}
                <Button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirm !== "삭제" || deleting}
                  className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 disabled:opacity-30"
                  variant="outline"
                >
                  {deleting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  계정 영구 삭제
                </Button>
              </div>
            </>
          )}

          {/* ── Subscription tab ── */}
          {tab === "subscription" && (
            <div className="space-y-5">
              {/* Current plan */}
              <div className="p-4 bg-slate-800/60 border border-white/10 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">현재 플랜</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${PLAN_COLORS[plan]}`}>
                    {PLAN_LABELS[plan]}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">월 요금</span>
                  <span className="text-white font-semibold">{PLAN_PRICES[plan]}</span>
                </div>
                <div className="text-xs text-slate-600">
                  플랜 변경·취소는 Stripe 고객 포털에서 처리됩니다.
                </div>
              </div>

              {/* Portal button */}
              {isPaidPlan(plan) ? (
                <Button
                  onClick={handleOpenPortal}
                  disabled={portalLoading}
                  className="w-full bg-ocean-500/10 hover:bg-ocean-500/20 text-ocean-300 border border-ocean-500/30"
                  variant="outline"
                >
                  {portalLoading
                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />로딩 중...</>
                    : <><ExternalLink className="w-4 h-4 mr-2" />구독 관리 (Stripe 포털)</>}
                </Button>
              ) : (
                <Button
                  onClick={() => { onClose(); router.push("/pricing") }}
                  className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white"
                >
                  플랜 업그레이드
                </Button>
              )}

              {/* Plan features summary */}
              <div className="space-y-2 text-sm">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">현재 플랜 한도</p>
                {[
                  { label: "양식장", value: plan === "enterprise" ? "무제한" : `${["free","basic","pro"].indexOf(plan) < 0 ? "?" : [1,2,5][["free","basic","pro"].indexOf(plan)]}개` },
                  { label: "AI 어드바이저", value: plan === "enterprise" ? "무제한" : `${[5,15,30][["free","basic","pro"].indexOf(plan)] ?? "?"}회/일` },
                  { label: "질병 진단", value: plan === "pro" || plan === "enterprise" ? "무제한" : plan === "basic" ? "10회/월" : "3회/월" },
                  { label: "CSV 내보내기", value: plan === "pro" || plan === "enterprise" ? "✓" : "✗" },
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-1.5 border-b border-white/5">
                    <span className="text-slate-500">{row.label}</span>
                    <span className="text-slate-300 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Notifications tab ── */}
          {tab === "notifications" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-4">알림 유형별 수신 여부를 설정합니다. 설정은 이 기기에 저장됩니다.</p>
              {[
                { key: "alertDanger" as const, label: "위험 알림",   desc: "수질 기준 위험 수준 초과 시", color: "text-red-400" },
                { key: "alertWarning" as const, label: "주의 알림",  desc: "수질 기준 주의 수준 접근 시", color: "text-amber-400" },
                { key: "alertInfo" as const,   label: "정보성 알림", desc: "정기 점검, 일지 미작성 알림 등", color: "text-ocean-400" },
                { key: "soundEnabled" as const, label: "소리 알림",  desc: "알림 발생 시 소리 재생", color: "text-purple-400" },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div>
                    <p className={`text-sm font-medium ${item.color}`}>{item.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
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
                  <p className="text-white font-bold text-lg">Shrimp365</p>
                  <p className="text-slate-400 text-sm">스마트 흰다리새우 양식 플랫폼</p>
                  <p className="text-slate-600 text-xs mt-1">v1.0.0</p>
                </div>
              </div>
              <div className="border-t border-white/10" />
              <div className="space-y-2 text-sm">
                {[
                  { label: "개발", value: "Shrimp365 팀" },
                  { label: "데이터베이스", value: "Supabase" },
                  { label: "프레임워크", value: "Next.js 16" },
                  { label: "빌드일", value: new Date().toLocaleDateString("ko-KR") },
                ].map(row => (
                  <div key={row.label} className="flex justify-between py-2 border-b border-white/5">
                    <span className="text-slate-500">{row.label}</span>
                    <span className="text-slate-300 font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
              {/* Support contact */}
              <div className="space-y-2">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">고객 지원</p>
                <a
                  href="mailto:support@shrimp365.com"
                  className="flex items-center gap-2 p-3 bg-ocean-500/10 border border-ocean-500/20 rounded-xl text-sm text-ocean-300 hover:bg-ocean-500/20 transition-colors"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  support@shrimp365.com
                </a>
                <p className="text-xs text-slate-600 text-center">
                  평일 09:00 – 18:00 · 영업일 기준 1일 내 답변
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
