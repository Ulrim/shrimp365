"use client"

import { useState, useEffect, useRef } from "react"
import { X, Settings, User, Lock, Bell, Info, Save, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type Tab = "account" | "notifications" | "info"

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
  const { user, updateProfile, updatePassword } = useAuth()
  const panelRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>("account")

  // Account state
  const [name, setName] = useState("")
  const [nameSaving, setNameSaving] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Password state
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" })
  const [showPw, setShowPw] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Notification prefs
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS)

  useEffect(() => {
    if (open) {
      setName(user?.name || "")
      setTab("account")
      setNameMsg(null)
      setPwMsg(null)
      setPw({ current: "", next: "", confirm: "" })
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
        setPw({ current: "", next: "", confirm: "" })
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

  if (!open) return null

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "account",       label: "계정",    icon: <User className="w-4 h-4" /> },
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
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
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
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {/* ── Account tab ── */}
          {tab === "account" && (
            <div className="space-y-6">
              {/* Name */}
              <form onSubmit={handleSaveName} className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-medium text-white">표시 이름</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-400 text-xs">이름</Label>
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
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-400 text-xs">이메일 (변경 불가)</Label>
                  <Input value={user?.email || ""} disabled className="bg-slate-800/50 border-white/5 text-slate-500 cursor-not-allowed" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-400 text-xs">권한</Label>
                  <Input value={user?.role === "admin" ? "관리자" : "운영자"} disabled className="bg-slate-800/50 border-white/5 text-slate-500 cursor-not-allowed" />
                </div>
                {nameMsg && (
                  <p className={`text-xs flex items-center gap-1.5 ${nameMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                    {nameMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {nameMsg.text}
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
            </div>
          )}

          {/* ── Notifications tab ── */}
          {tab === "notifications" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-4">알림 유형별 수신 여부를 설정합니다. 설정은 이 기기에 저장됩니다.</p>
              {[
                { key: "alertDanger" as const, label: "위험 알림",       desc: "수질 기준 위험 수준 초과 시",           color: "text-red-400" },
                { key: "alertWarning" as const, label: "주의 알림",      desc: "수질 기준 주의 수준 접근 시",           color: "text-amber-400" },
                { key: "alertInfo" as const,   label: "정보성 알림",     desc: "정기 점검, 일지 미작성 알림 등",        color: "text-ocean-400" },
                { key: "soundEnabled" as const, label: "소리 알림",      desc: "알림 발생 시 소리 재생",                color: "text-purple-400" },
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
              <div className="p-3 bg-ocean-500/10 border border-ocean-500/20 rounded-xl text-xs text-ocean-300 text-center">
                문의·피드백: GitHub Issues 또는 관리자에게 연락하세요
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
