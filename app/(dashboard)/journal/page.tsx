"use client"

import { useState, useEffect, useCallback } from "react"
import { MOCK_JOURNALS, MOCK_DIAGNOSES, MOCK_TANKS, MOCK_INVENTORY_ITEMS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { PLAN_LIMITS, type Plan, hasExport } from "@/lib/plans"
import { UpgradeModal } from "@/components/ui/upgrade-modal"
import {
  getJournalEntries, createJournalEntry, updateJournalEntry, deleteJournalEntry,
  getAllTanks, insertWaterQuality,
  getDiagnoses, createDiagnosis, updateDiagnosis, deleteDiagnosis,
  getInventoryItems, createInventoryTransaction,
} from "@/lib/db"
import { WQ_BOUNDS, WqField } from "@/lib/utils"
import { JournalEntry, Tank, DiagnosisResult, InventoryItem } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import {
  BookOpen, Plus, Thermometer, Droplets, Wind, Waves, UtensilsCrossed,
  RefreshCw, FlaskConical, Skull, CheckCircle2, Calendar, User, StickyNote,
  Pencil, Trash2, AlertTriangle, Download, ChevronDown,
  XCircle, AlertCircle, Clock, FileText, Activity,
} from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"
import { exportToCsv } from "@/lib/export"
import { useT } from "@/lib/i18n-context"

// ── Diagnosis helpers ─────────────────────────────────────────────────────────

const RISK_META = {
  low:      { label: "낮음", badgeVariant: "success"  as const, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", bar: "bg-emerald-500", step: 1 },
  medium:   { label: "보통", badgeVariant: "warning"  as const, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   bar: "bg-amber-500",   step: 2 },
  high:     { label: "높음", badgeVariant: "danger"   as const, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",       bar: "bg-red-500",     step: 3 },
  critical: { label: "긴급", badgeVariant: "danger"   as const, color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20", bar: "bg-purple-500",  step: 4 },
}

const RESULT_META = {
  양성: { badgeVariant: "danger"  as const, icon: <XCircle      className="w-3.5 h-3.5" /> },
  의심: { badgeVariant: "warning" as const, icon: <AlertCircle  className="w-3.5 h-3.5" /> },
  음성: { badgeVariant: "success" as const, icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
}

type RiskLevel  = keyof typeof RISK_META
type ResultType = keyof typeof RESULT_META
type TestType   = DiagnosisResult["test_type"]

const RISK_STEPS: { key: RiskLevel; label: string }[] = [
  { key: "low",      label: "낮음" },
  { key: "medium",   label: "보통" },
  { key: "high",     label: "높음" },
  { key: "critical", label: "긴급" },
]

const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

function getWorstRisk(list: DiagnosisResult[]): RiskLevel {
  if (list.length === 0) return "low"
  return list.reduce<RiskLevel>(
    (acc, d) => (riskOrder[d.risk_level as RiskLevel] > riskOrder[acc] ? (d.risk_level as RiskLevel) : acc),
    "low"
  )
}

function sevenDaysAgo() { return new Date(Date.now() - 7 * 86400000) }

interface DiagFormState {
  tank_id: string
  test_type: TestType | ""
  result: ResultType | ""
  vibrio_count: string
  pathogenic_ratio: string
  risk_level: RiskLevel | ""
  action_taken: string
  notes: string
}

const EMPTY_DIAG_FORM: DiagFormState = {
  tank_id: "", test_type: "", result: "", vibrio_count: "",
  pathogenic_ratio: "", risk_level: "", action_taken: "", notes: "",
}

// ── Journal constants ─────────────────────────────────────────────────────────

const FEED_TYPES = ["입식기 사료 (No.0)", "초기 사료 (No.1)", "성장기 사료 (No.2)", "성장기 사료 (No.3)", "마무리 사료 (No.4)", "기타"]
const MICROBIAL_TYPES = ["EM균", "바실러스균", "광합성균", "복합 미생물제", "기타"]

const defaultJournalForm = {
  tank_id: "",
  date: new Date().toISOString().split("T")[0],
  temperature: "", ph: "", do_level: "", salinity: "",
  ammonia: "", nitrite: "", nitrate: "", alkalinity: "", turbidity: "",
  feeding_amount: "",
  feed_type: "성장기 사료 (No.3)",
  feeding_times: "4",
  mortality_count: "",
  water_exchange_rate: "",
  disinfection: false,
  disinfection_type: "",
  microbial_input: false,
  microbial_type: "EM균",
  microbial_amount: "",
  feedItemId: "",
  microbialItemId: "",
  chemicalItemId: "",
  chemicalQty: "",
  check_aeration: false,
  check_filtration: false,
  check_circulation: false,
  check_feeding_check: false,
  notes: "",
}

// ── JournalCard ───────────────────────────────────────────────────────────────

function JournalCard({ entry, onEdit, onDelete }: { entry: JournalEntry; onEdit: (e: JournalEntry) => void; onDelete: (e: JournalEntry) => void }) {
  const { t } = useT()
  return (
    <Card className="bg-slate-800/50 border-white/5 hover:border-white/10 transition-all group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-semibold">{entry.tank_name}</span>
              <Badge variant="ocean" className="text-xs">{formatDate(entry.date)}</Badge>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <User className="w-3 h-3" />
              <span>{entry.created_by}</span>
              <span>·</span>
              <span>{formatDateTime(entry.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(entry)} className="p-1.5 rounded-lg text-slate-500 hover:text-ocean-400 hover:bg-white/5 transition-colors" aria-label={t.journal.editEntry}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDelete(entry)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors" aria-label={t.common.delete}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-ocean-400 mb-1"><UtensilsCrossed className="w-3.5 h-3.5" /></div>
            <p className="text-lg font-bold text-white">{entry.feeding_amount}<span className="text-xs text-slate-400">kg</span></p>
            <p className="text-xs text-slate-400">{t.journal.catFeeding}</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-amber-400 mb-1"><Skull className="w-3.5 h-3.5" /></div>
            <p className="text-lg font-bold text-white">{entry.mortality_count.toLocaleString()}<span className="text-xs text-slate-400">마리</span></p>
            <p className="text-xs text-slate-400">폐사</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-teal-400 mb-1"><RefreshCw className="w-3.5 h-3.5" /></div>
            <p className="text-lg font-bold text-white">{entry.water_exchange_rate}<span className="text-xs text-slate-400">%</span></p>
            <p className="text-xs text-slate-400">{t.journal.catWaterChange}</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-purple-400 mb-1"><FlaskConical className="w-3.5 h-3.5" /></div>
            <p className="text-sm font-bold text-white">{entry.microbial_input ? entry.microbial_type || "투입" : "미투입"}</p>
            <p className="text-xs text-slate-400">미생물</p>
          </div>
        </div>

        <div className="text-xs text-slate-300 bg-slate-700/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <p className="text-xs text-slate-400 font-medium shrink-0">사료:</p>
          <p>{entry.feed_type} · 일 {entry.feeding_times}회</p>
        </div>
        {entry.notes && (
          <div className="mt-2 text-xs text-slate-300 bg-slate-700/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <StickyNote className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
            <p>{entry.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Diagnosis sub-components ──────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card className="bg-slate-800/50 border-white/5 hover:border-white/10 transition-all">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-400 mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          </div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-white/5">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function RiskScaleIndicator({ worstRisk }: { worstRisk: RiskLevel }) {
  const { t } = useT()
  return (
    <Card className="bg-slate-800/50 border-white/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />현재 위험 단계
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          {RISK_STEPS.map((step, idx) => {
            const meta = RISK_META[step.key]
            const isActive = step.key === worstRisk
            const isPast = idx < RISK_STEPS.findIndex(s => s.key === worstRisk)
            return (
              <div key={step.key} className="flex-1 flex flex-col items-center gap-2">
                <div className={`h-2.5 w-full rounded-full transition-all ${isActive || isPast ? meta.bar : "bg-slate-700"} ${isActive ? "ring-2 ring-offset-2 ring-offset-slate-800 ring-white/30" : ""}`} />
                <span className={`text-xs font-medium ${isActive ? meta.color : isPast ? "text-slate-400" : "text-slate-600"}`}>{step.label}</span>
              </div>
            )
          })}
        </div>
        <div className={`mt-4 flex items-center gap-3 p-3 rounded-xl border ${RISK_META[worstRisk].bg}`}>
          <AlertTriangle className={`w-5 h-5 shrink-0 ${RISK_META[worstRisk].color}`} />
          <div>
            <p className={`text-sm font-semibold ${RISK_META[worstRisk].color}`}>{RISK_META[worstRisk].label} 위험 단계</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {worstRisk === "low" && "현재 모든 수조가 정상 범위입니다."}
              {worstRisk === "medium" && "일부 수조에서 주의가 필요합니다. 모니터링을 강화하세요."}
              {worstRisk === "high" && `${t.diagnosis.urgentAction}. ${t.diagnosis.biosecurity}`}
              {worstRisk === "critical" && `긴급 상황! ${t.diagnosis.ahpndProtocol}`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Page sizes ────────────────────────────────────────────────────────────────

const J_PAGE = 20
const D_PAGE = 20

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const { user } = useAuth()
  const { t } = useT()
  const plan = (user?.plan ?? "free") as Plan
  const mock = isTestAccount(user?.email)

  const [pageTab, setPageTab] = useState<"journal" | "diagnosis">("journal")

  // Shared
  const [tanks, setTanks] = useState<Tank[]>([])

  // ── Journal state ──
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [jLoading, setJLoading] = useState(true)
  const [jLoadingMore, setJLoadingMore] = useState(false)
  const [jHasMore, setJHasMore] = useState(false)
  const [jOffset, setJOffset] = useState(0)
  const [jFilterFrom, setJFilterFrom] = useState("")
  const [jFilterTo, setJFilterTo] = useState("")
  const [jDialogOpen, setJDialogOpen] = useState(false)
  const [jForm, setJForm] = useState(defaultJournalForm)
  const [jSaving, setJSaving] = useState(false)
  const [jSaved, setJSaved] = useState(false)
  const [jSaveError, setJSaveError] = useState<string | null>(null)
  const [jEditTarget, setJEditTarget] = useState<JournalEntry | null>(null)
  const [jEditForm, setJEditForm] = useState<Partial<typeof defaultJournalForm>>({})
  const [jEditSaving, setJEditSaving] = useState(false)
  const [jDeleteTarget, setJDeleteTarget] = useState<JournalEntry | null>(null)
  const [jDeleting, setJDeleting] = useState(false)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])

  // ── Diagnosis state ──
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [dLoading, setDLoading] = useState(true)
  const [dLoadingMore, setDLoadingMore] = useState(false)
  const [dHasMore, setDHasMore] = useState(false)
  const [dOffset, setDOffset] = useState(0)
  const [dFilterFrom, setDFilterFrom] = useState("")
  const [dFilterTo, setDFilterTo] = useState("")
  const [dDialogOpen, setDDialogOpen] = useState(false)
  const [dForm, setDForm] = useState<DiagFormState>(EMPTY_DIAG_FORM)
  const [dSubmitting, setDSubmitting] = useState(false)
  const [dSubmitError, setDSubmitError] = useState<string | null>(null)
  const [dToast, setDToast] = useState<string | null>(null)
  const [dEditTarget, setDEditTarget] = useState<DiagnosisResult | null>(null)
  const [dEditForm, setDEditForm] = useState<DiagFormState>(EMPTY_DIAG_FORM)
  const [dEditSaving, setDEditSaving] = useState(false)
  const [dEditError, setDEditError] = useState<string | null>(null)
  const [dDeleteTarget, setDDeleteTarget] = useState<DiagnosisResult | null>(null)
  const [dDeleting, setDDeleting] = useState(false)
  const [dUpgradeOpen, setDUpgradeOpen] = useState(false)

  const diagLimit = PLAN_LIMITS[plan].diagPerMonth
  const now = new Date()
  const thisMonthCount = diagnoses.filter(d => {
    const dt = new Date(d.tested_at)
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()
  }).length

  // ── Journal loaders ──

  async function loadJournals(from: string, to: string, newOffset: number, replace: boolean) {
    try {
      const j = await getJournalEntries(undefined, J_PAGE, from || undefined, to || undefined, newOffset)
      setJHasMore(j.length === J_PAGE)
      if (replace) {
        setJournals(j.length ? j : (newOffset === 0 && mock ? MOCK_JOURNALS : []))
      } else {
        setJournals(prev => [...prev, ...j])
      }
    } catch {
      if (newOffset === 0 && mock) setJournals(MOCK_JOURNALS)
    }
  }

  // ── Diagnosis loaders ──

  async function loadDiagnoses(from: string, to: string, newOffset: number, replace: boolean) {
    try {
      const d = await getDiagnoses(undefined, from || undefined, to || undefined, newOffset, D_PAGE)
      setDHasMore(d.length === D_PAGE)
      if (replace) {
        setDiagnoses(d.length ? d : (newOffset === 0 && mock ? MOCK_DIAGNOSES : []))
      } else {
        setDiagnoses(prev => [...prev, ...d])
      }
    } catch {
      if (newOffset === 0 && mock) setDiagnoses(MOCK_DIAGNOSES)
    }
  }

  const loadAll = useCallback(async () => {
    setJLoading(true)
    setDLoading(true)
    try {
      const [, tanksData, invData] = await Promise.all([loadJournals("", "", 0, true), getAllTanks(), getInventoryItems()])
      setTanks(tanksData.length ? tanksData : (mock ? MOCK_TANKS : []))
      setInventoryItems(invData.length ? invData : (mock ? MOCK_INVENTORY_ITEMS : []))
      await loadDiagnoses("", "", 0, true)
    } catch {
      if (mock) { setJournals(MOCK_JOURNALS); setDiagnoses(MOCK_DIAGNOSES); setTanks(MOCK_TANKS); setInventoryItems(MOCK_INVENTORY_ITEMS) }
    } finally {
      setJLoading(false)
      setDLoading(false)
    }
  }, [user?.email])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Journal handlers ──

  const handleJFilter = async () => {
    setJLoading(true); setJOffset(0)
    await loadJournals(jFilterFrom, jFilterTo, 0, true)
    setJLoading(false)
  }

  const handleJLoadMore = async () => {
    const next = jOffset + J_PAGE
    setJLoadingMore(true)
    await loadJournals(jFilterFrom, jFilterTo, next, false)
    setJOffset(next); setJLoadingMore(false)
  }

  const handleJCsvExport = () => {
    if (!hasExport(plan)) { window.location.href = "/pricing"; return }
    exportToCsv(journals.map(j => ({
      날짜: j.date, 수조: j.tank_name,
      급이량_kg: j.feeding_amount, 사료종류: j.feed_type, 급이횟수: j.feeding_times,
      폐사수: j.mortality_count, 환수율: j.water_exchange_rate,
      미생물투입: j.microbial_input ? "예" : "아니오", 미생물종류: j.microbial_type || "",
      소독: j.disinfection ? "예" : "아니오", 메모: j.notes || "",
      작성자: j.created_by, 작성일: j.created_at,
    })), `journal_${new Date().toISOString().split("T")[0]}`)
  }

  const jUpdate = (field: string, value: string | boolean) =>
    setJForm(prev => ({ ...prev, [field]: value }))

  const handleJSave = async () => {
    setJSaveError(null)
    const wqFields: WqField[] = ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"]
    for (const field of wqFields) {
      const raw = jForm[field as keyof typeof jForm] as string
      if (!raw) continue
      const val = parseFloat(raw)
      if (!Number.isFinite(val)) { setJSaveError(`${WQ_BOUNDS[field].label}: 유효한 숫자를 입력해주세요.`); return }
      if (val < WQ_BOUNDS[field].min || val > WQ_BOUNDS[field].max) {
        setJSaveError(`${WQ_BOUNDS[field].label}: ${WQ_BOUNDS[field].min}~${WQ_BOUNDS[field].max}${WQ_BOUNDS[field].unit} 범위를 벗어났습니다.`)
        return
      }
    }
    setJSaving(true)
    try {
      const entry = await createJournalEntry({
        tank_id: jForm.tank_id, date: jForm.date,
        feeding_amount: parseFloat(jForm.feeding_amount) || 0,
        feed_type: jForm.feed_type,
        feeding_times: parseInt(jForm.feeding_times) || 0,
        mortality_count: parseInt(jForm.mortality_count) || 0,
        water_exchange_rate: parseInt(jForm.water_exchange_rate) || 0,
        microbial_input: jForm.microbial_input,
        microbial_type: jForm.microbial_input ? jForm.microbial_type : null,
        microbial_amount: jForm.microbial_input ? parseFloat(jForm.microbial_amount) || null : null,
        disinfection: jForm.disinfection,
        disinfection_type: jForm.disinfection ? jForm.disinfection_type : null,
        check_aeration: jForm.check_aeration, check_filtration: jForm.check_filtration,
        check_circulation: jForm.check_circulation, check_feeding_check: jForm.check_feeding_check,
        notes: jForm.notes || null,
      })
      setJournals(prev => [entry, ...prev])

      // 재고 자동 차감
      try {
        const deductions: { itemId: string; qty: number; note: string }[] = []
        if (jForm.feedItemId && parseFloat(jForm.feeding_amount) > 0)
          deductions.push({ itemId: jForm.feedItemId, qty: parseFloat(jForm.feeding_amount), note: `일지 자동차감 - ${jForm.feed_type}` })
        if (jForm.microbial_input && jForm.microbialItemId && parseFloat(jForm.microbial_amount) > 0)
          deductions.push({ itemId: jForm.microbialItemId, qty: parseFloat(jForm.microbial_amount), note: `일지 자동차감 - ${jForm.microbial_type}` })
        if (jForm.disinfection && jForm.chemicalItemId && parseFloat(jForm.chemicalQty) > 0)
          deductions.push({ itemId: jForm.chemicalItemId, qty: parseFloat(jForm.chemicalQty), note: `일지 자동차감 - ${jForm.disinfection_type || "소독"}` })

        for (const d of deductions) {
          if (!mock) {
            await createInventoryTransaction({ item_id: d.itemId, type: "out", quantity: d.qty, tank_id: jForm.tank_id, recorded_at: jForm.date, notes: d.note })
          }
          setInventoryItems(prev => prev.map(i => i.id === d.itemId ? { ...i, current_stock: Math.max(0, i.current_stock - d.qty), updated_at: new Date().toISOString() } : i))
        }
      } catch { /* 재고 차감 실패 시 일지 저장은 유지 */ }

      const hasWq = jForm.temperature || jForm.ph || jForm.do_level || jForm.salinity ||
        jForm.ammonia || jForm.nitrite || jForm.nitrate || jForm.alkalinity || jForm.turbidity
      if (hasWq) {
        try {
          await insertWaterQuality(jForm.tank_id, {
            temperature: parseFloat(jForm.temperature) || 0, ph: parseFloat(jForm.ph) || 0,
            do_level: parseFloat(jForm.do_level) || 0, salinity: parseFloat(jForm.salinity) || 0,
            ammonia: parseFloat(jForm.ammonia) || 0, nitrite: parseFloat(jForm.nitrite) || 0,
            nitrate: parseFloat(jForm.nitrate) || 0, alkalinity: parseFloat(jForm.alkalinity) || 0,
            turbidity: parseFloat(jForm.turbidity) || 0,
            recorded_at: new Date(`${jForm.date}T12:00:00`).toISOString(),
          })
        } catch { /* journal saved even if wq fails */ }
      }
    } catch {
      const selectedTank = tanks.find(tk => tk.id === jForm.tank_id)
      setJournals(prev => [{
        id: "local-" + Date.now(), tank_id: jForm.tank_id,
        tank_name: selectedTank?.name || "",
        date: jForm.date, feeding_amount: parseFloat(jForm.feeding_amount) || 0,
        feed_type: jForm.feed_type, feeding_times: parseInt(jForm.feeding_times) || 0,
        mortality_count: parseInt(jForm.mortality_count) || 0,
        water_exchange_rate: parseInt(jForm.water_exchange_rate) || 0,
        microbial_input: jForm.microbial_input,
        microbial_type: jForm.microbial_input ? jForm.microbial_type : undefined,
        microbial_amount: jForm.microbial_input ? parseFloat(jForm.microbial_amount) || null : null,
        disinfection: jForm.disinfection, disinfection_type: jForm.disinfection ? jForm.disinfection_type : null,
        check_aeration: jForm.check_aeration, check_filtration: jForm.check_filtration,
        check_circulation: jForm.check_circulation, check_feeding_check: jForm.check_feeding_check,
        notes: jForm.notes, created_by: "", created_at: new Date().toISOString(),
      }, ...prev])
    } finally {
      setJSaving(false); setJSaved(true)
      setTimeout(() => { setJSaved(false); setJDialogOpen(false); setJForm(defaultJournalForm); setJSaveError(null) }, 1200)
    }
  }

  const handleJEdit = (entry: JournalEntry) => {
    setJEditTarget(entry)
    setJEditForm({
      feeding_amount: String(entry.feeding_amount), feed_type: entry.feed_type,
      feeding_times: String(entry.feeding_times), mortality_count: String(entry.mortality_count),
      water_exchange_rate: String(entry.water_exchange_rate), disinfection: entry.disinfection,
      disinfection_type: entry.disinfection_type || "", microbial_input: entry.microbial_input,
      microbial_type: entry.microbial_type || "EM균",
      microbial_amount: entry.microbial_amount != null ? String(entry.microbial_amount) : "",
      check_aeration: entry.check_aeration, check_filtration: entry.check_filtration,
      check_circulation: entry.check_circulation, check_feeding_check: entry.check_feeding_check,
      notes: entry.notes || "",
    })
  }

  const handleJEditSave = async () => {
    if (!jEditTarget) return
    setJEditSaving(true)
    try {
      const updated = await updateJournalEntry(jEditTarget.id, {
        feeding_amount: parseFloat(jEditForm.feeding_amount || "0") || 0,
        feed_type: jEditForm.feed_type || jEditTarget.feed_type,
        feeding_times: parseInt(jEditForm.feeding_times || "0") || 0,
        mortality_count: parseInt(jEditForm.mortality_count || "0") || 0,
        water_exchange_rate: parseInt(jEditForm.water_exchange_rate || "0") || 0,
        disinfection: jEditForm.disinfection ?? jEditTarget.disinfection,
        disinfection_type: jEditForm.disinfection ? (jEditForm.disinfection_type || null) : null,
        microbial_input: jEditForm.microbial_input ?? jEditTarget.microbial_input,
        microbial_type: jEditForm.microbial_input ? (jEditForm.microbial_type || null) : null,
        microbial_amount: jEditForm.microbial_input ? (parseFloat(jEditForm.microbial_amount || "0") || null) : null,
        check_aeration: jEditForm.check_aeration ?? jEditTarget.check_aeration,
        check_filtration: jEditForm.check_filtration ?? jEditTarget.check_filtration,
        check_circulation: jEditForm.check_circulation ?? jEditTarget.check_circulation,
        check_feeding_check: jEditForm.check_feeding_check ?? jEditTarget.check_feeding_check,
        notes: jEditForm.notes || null,
      })
      setJournals(prev => prev.map(j => j.id === jEditTarget.id ? updated : j))
      setJEditTarget(null)
    } catch {
      setJournals(prev => prev.map(j => j.id === jEditTarget.id ? {
        ...j, feeding_amount: parseFloat(jEditForm.feeding_amount || "0") || 0,
        mortality_count: parseInt(jEditForm.mortality_count || "0") || 0,
        notes: jEditForm.notes || undefined,
      } : j))
      setJEditTarget(null)
    } finally { setJEditSaving(false) }
  }

  const handleJDelete = async () => {
    if (!jDeleteTarget) return
    setJDeleting(true)
    try { await deleteJournalEntry(jDeleteTarget.id) } catch { /* remove locally */ }
    setJournals(prev => prev.filter(j => j.id !== jDeleteTarget.id))
    setJDeleteTarget(null); setJDeleting(false)
  }

  // ── Diagnosis handlers ──

  const handleDFilter = async () => {
    setDLoading(true); setDOffset(0)
    await loadDiagnoses(dFilterFrom, dFilterTo, 0, true)
    setDLoading(false)
  }

  const handleDLoadMore = async () => {
    const next = dOffset + D_PAGE
    setDLoadingMore(true)
    await loadDiagnoses(dFilterFrom, dFilterTo, next, false)
    setDOffset(next); setDLoadingMore(false)
  }

  const handleDCsvExport = () => {
    if (!hasExport(plan)) { window.location.href = "/pricing"; return }
    exportToCsv(diagnoses.map(d => ({
      수조: d.tank_name, 검사항목: d.test_type, 결과: d.result,
      비브리오수_CFU_mL: d.vibrio_count, 병원성비율_pct: d.pathogenic_ratio,
      위험도: d.risk_level, 검사자: d.tested_by,
      조치사항: d.action_taken || "", 비고: d.notes || "", 검사일시: d.tested_at,
    })), `diagnosis_${new Date().toISOString().split("T")[0]}`)
  }

  function showDToast(msg: string) {
    setDToast(msg); setTimeout(() => setDToast(null), 3500)
  }

  function setDField<K extends keyof DiagFormState>(key: K, value: DiagFormState[K]) {
    setDForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleDSubmit(e: React.FormEvent) {
    e.preventDefault(); setDSubmitError(null)
    if (diagLimit !== Infinity && thisMonthCount >= diagLimit) {
      setDDialogOpen(false); setDUpgradeOpen(true); return
    }
    if (!dForm.tank_id || !dForm.test_type || !dForm.result || !dForm.risk_level) {
      setDSubmitError("필수 항목을 모두 입력해주세요."); return
    }
    const vibrioNum = dForm.vibrio_count ? Number(dForm.vibrio_count) : 0
    const ratioNum  = dForm.pathogenic_ratio ? Number(dForm.pathogenic_ratio) : 0
    if (!Number.isFinite(vibrioNum) || vibrioNum < 0 || vibrioNum > 10_000_000) {
      setDSubmitError("비브리오 수치는 0~10,000,000 CFU/mL 범위로 입력해주세요."); return
    }
    if (!Number.isFinite(ratioNum) || ratioNum < 0 || ratioNum > 100) {
      setDSubmitError("병원성 비율은 0~100% 범위로 입력해주세요."); return
    }
    const tank = tanks.find(tk => tk.id === dForm.tank_id)
    setDSubmitting(true)
    try {
      await createDiagnosis({
        tank_id: dForm.tank_id, test_type: dForm.test_type, result: dForm.result,
        vibrio_count: vibrioNum, pathogenic_ratio: ratioNum, risk_level: dForm.risk_level,
        action_taken: dForm.action_taken || undefined, notes: dForm.notes || undefined,
      })
      setDForm(EMPTY_DIAG_FORM); setDDialogOpen(false)
      showDToast(`진단 결과가 등록되었습니다. (${tank?.name} · ${dForm.test_type} · ${dForm.result})`)
      await loadDiagnoses("", "", 0, true)
    } catch (err) {
      setDSubmitError(err instanceof Error ? err.message : "진단 결과 저장에 실패했습니다.")
    } finally { setDSubmitting(false) }
  }

  function openDEdit(d: DiagnosisResult) {
    setDEditTarget(d); setDEditError(null)
    setDEditForm({
      tank_id: d.tank_id, test_type: d.test_type, result: d.result as ResultType,
      vibrio_count: d.vibrio_count > 0 ? String(d.vibrio_count) : "",
      pathogenic_ratio: d.pathogenic_ratio > 0 ? String(d.pathogenic_ratio) : "",
      risk_level: d.risk_level as RiskLevel,
      action_taken: d.action_taken || "", notes: d.notes || "",
    })
  }

  async function handleDEditSave(e: React.FormEvent) {
    e.preventDefault(); setDEditError(null)
    if (!dEditTarget) return
    const ev = dEditForm.vibrio_count ? Number(dEditForm.vibrio_count) : 0
    const er = dEditForm.pathogenic_ratio ? Number(dEditForm.pathogenic_ratio) : 0
    if (!Number.isFinite(ev) || ev < 0 || ev > 10_000_000) { setDEditError("비브리오 수치는 0~10,000,000 CFU/mL 범위로 입력해주세요."); return }
    if (!Number.isFinite(er) || er < 0 || er > 100) { setDEditError("병원성 비율은 0~100% 범위로 입력해주세요."); return }
    setDEditSaving(true)
    try {
      const updated = await updateDiagnosis(dEditTarget.id, {
        tank_id: dEditForm.tank_id, test_type: dEditForm.test_type || undefined,
        result: dEditForm.result || undefined, vibrio_count: ev, pathogenic_ratio: er,
        risk_level: dEditForm.risk_level || undefined,
        action_taken: dEditForm.action_taken || null, notes: dEditForm.notes || null,
      })
      setDiagnoses(prev => prev.map(d => d.id === dEditTarget.id ? updated : d))
      setDEditTarget(null); showDToast("진단 결과가 수정되었습니다.")
    } catch (err) {
      setDEditError(err instanceof Error ? err.message : "수정에 실패했습니다.")
    } finally { setDEditSaving(false) }
  }

  async function handleDDelete() {
    if (!dDeleteTarget) return
    setDDeleting(true)
    try { await deleteDiagnosis(dDeleteTarget.id) } catch { /* remove locally */ }
    setDiagnoses(prev => prev.filter(d => d.id !== dDeleteTarget.id))
    setDDeleteTarget(null); setDDeleting(false)
    showDToast("진단 결과가 삭제되었습니다.")
  }

  const dTotalTests    = diagnoses.length
  const dPositiveCount = diagnoses.filter(d => d.result === "양성").length
  const dHighRiskTanks = new Set(diagnoses.filter(d => d.risk_level === "high" || d.risk_level === "critical").map(d => d.tank_id)).size
  const dRecentCount   = diagnoses.filter(d => new Date(d.tested_at) >= sevenDaysAgo()).length
  const dWorstRisk     = getWorstRisk(diagnoses)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Diagnosis Toast */}
      {dToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 border border-white/10 text-white text-sm px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />{dToast}
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white">
            {pageTab === "journal" ? t.journal.title : t.diagnosis.title}
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {pageTab === "journal" ? t.journal.subtitle : t.diagnosis.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Tab switcher */}
          <div className="flex bg-slate-800 border border-white/10 rounded-xl p-1">
            <button
              onClick={() => setPageTab("journal")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                pageTab === "journal"
                  ? "bg-ocean-500/20 text-ocean-300 border border-ocean-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />{t.journal.title}
            </button>
            <button
              onClick={() => setPageTab("diagnosis")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                pageTab === "diagnosis"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />{t.diagnosis.title}
            </button>
          </div>

          {/* Journal actions */}
          {pageTab === "journal" && (
            <>
              {journals.length > 0 && (
                <Button
                  variant="outline"
                  onClick={handleJCsvExport}
                  className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
                >
                  <Download className="w-4 h-4 mr-1" />CSV
                  {!hasExport(plan) && <span className="ml-1 text-xs text-amber-400">Basic+</span>}
                </Button>
              )}
              <Button
                onClick={() => setJDialogOpen(true)}
                className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white"
              >
                <Plus className="w-4 h-4" />{t.journal.addEntry}
              </Button>
            </>
          )}

          {/* Diagnosis actions */}
          {pageTab === "diagnosis" && (
            <>
              {diagnoses.length > 0 && (
                <Button
                  variant="outline"
                  onClick={handleDCsvExport}
                  className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
                  title={hasExport(plan) ? t.diagnosis.csvExport : t.diagnosis.csvProOnly}
                >
                  <Download className="w-4 h-4 mr-1" />CSV
                  {!hasExport(plan) && <span className="ml-1 text-xs text-amber-400">Basic+</span>}
                </Button>
              )}
              {diagLimit !== Infinity && (
                <span className={`text-xs px-2 py-1 rounded-lg border ${
                  thisMonthCount >= diagLimit
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : thisMonthCount >= diagLimit * 0.7
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-slate-800/60 border-white/10 text-slate-400"
                }`}>
                  {t.diagnosis.thisMonth} {thisMonthCount}/{diagLimit}회
                </span>
              )}
              <Dialog open={dDialogOpen} onOpenChange={(open) => {
                if (open && diagLimit !== Infinity && thisMonthCount >= diagLimit) { setDUpgradeOpen(true); return }
                setDDialogOpen(open)
                if (open) { setDForm(EMPTY_DIAG_FORM); setDSubmitError(null) }
              }}>
                <DialogTrigger asChild>
                  <Button className="gap-2 bg-purple-600 hover:bg-purple-500 text-white border-0">
                    <Plus className="w-4 h-4" />{t.diagnosis.newTest}
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-900 border-white/10 text-white max-w-xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-white flex items-center gap-2">
                      <FlaskConical className="w-5 h-5 text-purple-400" />{t.diagnosis.newTest}
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleDSubmit} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                      <Label className="text-slate-300 text-sm">{t.diagnosis.tank} <span className="text-red-400">*</span></Label>
                      <Select value={dForm.tank_id} onValueChange={v => setDField("tank_id", v)}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue placeholder={t.diagnosis.selectTank} /></SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10">
                          {tanks.map(tank => <SelectItem key={tank.id} value={tank.id} className="text-white focus:bg-slate-700">{tank.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300 text-sm">{t.diagnosis.testType} <span className="text-red-400">*</span></Label>
                      <Select value={dForm.test_type} onValueChange={v => setDField("test_type", v as TestType)}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue placeholder="검사 항목을 선택하세요" /></SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10">
                          {(["AHPND", "총비브리오", "EHP", "WSSV", "기타"] as TestType[]).map(tt => (
                            <SelectItem key={tt} value={tt} className="text-white focus:bg-slate-700">{tt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300 text-sm">{t.diagnosis.result} <span className="text-red-400">*</span></Label>
                      <Select value={dForm.result} onValueChange={v => setDField("result", v as ResultType)}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue placeholder="결과를 선택하세요" /></SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10">
                          <SelectItem value="양성" className="text-red-300 focus:bg-slate-700">{t.diagnosis.resultPositive}</SelectItem>
                          <SelectItem value="의심" className="text-amber-300 focus:bg-slate-700">{t.diagnosis.resultSuspected}</SelectItem>
                          <SelectItem value="음성" className="text-emerald-300 focus:bg-slate-700">{t.diagnosis.resultNegative}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-slate-300 text-sm">총 비브리오 균수 (CFU/mL)</Label>
                        <Input type="number" min={0} placeholder="예: 8500" value={dForm.vibrio_count} onChange={e => setDField("vibrio_count", e.target.value)} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-300 text-sm">병원성 비율 (%)</Label>
                        <Input type="number" min={0} max={100} placeholder="예: 35" value={dForm.pathogenic_ratio} onChange={e => setDField("pathogenic_ratio", e.target.value)} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300 text-sm">위험 단계 <span className="text-red-400">*</span></Label>
                      <Select value={dForm.risk_level} onValueChange={v => setDField("risk_level", v as RiskLevel)}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue placeholder="위험 단계를 선택하세요" /></SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10">
                          <SelectItem value="low" className="text-emerald-300 focus:bg-slate-700">낮음</SelectItem>
                          <SelectItem value="medium" className="text-amber-300 focus:bg-slate-700">보통</SelectItem>
                          <SelectItem value="high" className="text-red-300 focus:bg-slate-700">높음</SelectItem>
                          <SelectItem value="critical" className="text-purple-300 focus:bg-slate-700">긴급</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300 text-sm flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />조치사항</Label>
                      <Textarea placeholder="시행한 또는 예정된 조치사항을 입력하세요" value={dForm.action_taken} onChange={e => setDField("action_taken", e.target.value)} rows={3} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 resize-none" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300 text-sm">{t.diagnosis.notes}</Label>
                      <Textarea placeholder={t.diagnosis.notesPlaceholder} value={dForm.notes} onChange={e => setDField("notes", e.target.value)} rows={2} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 resize-none" />
                    </div>
                    {dSubmitError && <p className="text-sm text-red-400 flex items-center gap-1.5"><XCircle className="w-4 h-4 shrink-0" />{dSubmitError}</p>}
                    <DialogFooter className="pt-2">
                      <Button type="button" variant="outline" onClick={() => setDDialogOpen(false)} className="border-white/10 text-slate-300 hover:bg-slate-700" disabled={dSubmitting}>{t.common.cancel}</Button>
                      <Button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white border-0" disabled={dSubmitting}>
                        {dSubmitting ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-1.5" />}
                        {t.common.submit}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* ── Journal Tab ── */}
      {pageTab === "journal" && (
        <>
          <div className="flex flex-wrap items-center gap-3 bg-slate-800/40 border border-white/5 rounded-xl px-4 py-3">
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex items-center gap-2">
              <input type="date" value={jFilterFrom} onChange={e => setJFilterFrom(e.target.value)} className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ocean-400" />
              <span className="text-slate-500 text-sm">~</span>
              <input type="date" value={jFilterTo} onChange={e => setJFilterTo(e.target.value)} className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ocean-400" />
            </div>
            <Button size="sm" onClick={handleJFilter} className="bg-ocean-500/20 hover:bg-ocean-500/30 text-ocean-300 border border-ocean-500/30">{t.common.filter}</Button>
            {(jFilterFrom || jFilterTo) && (
              <button onClick={() => { setJFilterFrom(""); setJFilterTo(""); setJOffset(0); loadJournals("", "", 0, true) }} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">{t.common.reset}</button>
            )}
          </div>

          {jLoading ? (
            <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {journals.length === 0 ? (
                  <p className="text-slate-400 text-sm col-span-2 text-center py-12">{t.journal.noEntries}. {t.journal.noEntriesMsg}</p>
                ) : journals.map(entry => (
                  <JournalCard key={entry.id} entry={entry} onEdit={handleJEdit} onDelete={setJDeleteTarget} />
                ))}
              </div>
              {jHasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={handleJLoadMore} disabled={jLoadingMore} className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5">
                    {jLoadingMore
                      ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t.common.loading}</span>
                      : <span className="flex items-center gap-2"><ChevronDown className="w-4 h-4" />더 보기</span>}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Diagnosis Tab ── */}
      {pageTab === "diagnosis" && (
        <>
          <div className="flex flex-wrap items-center gap-3 bg-slate-800/40 border border-white/5 rounded-xl px-4 py-3">
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex items-center gap-2">
              <input type="date" value={dFilterFrom} onChange={e => setDFilterFrom(e.target.value)} className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400" />
              <span className="text-slate-500 text-sm">~</span>
              <input type="date" value={dFilterTo} onChange={e => setDFilterTo(e.target.value)} className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400" />
            </div>
            <Button size="sm" onClick={handleDFilter} className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30">{t.common.filter}</Button>
            {(dFilterFrom || dFilterTo) && (
              <button onClick={() => { setDFilterFrom(""); setDFilterTo(""); setDOffset(0); loadDiagnoses("", "", 0, true) }} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">{t.common.reset}</button>
            )}
          </div>

          {dLoading ? (
            <Card className="bg-slate-800/50 border-white/5">
              <CardContent className="p-8 text-center text-slate-400">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-purple-400" />{t.common.loading}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={<FlaskConical className="w-5 h-5 text-purple-400" />} label="총 검사 건수" value={dTotalTests} sub="누적 진단 기록" color="text-purple-400" />
                <StatCard icon={<XCircle className="w-5 h-5 text-red-400" />} label={t.diagnosis.resultPositive} value={dPositiveCount} sub={`전체의 ${dTotalTests ? Math.round((dPositiveCount / dTotalTests) * 100) : 0}%`} color="text-red-400" />
                <StatCard icon={<AlertTriangle className="w-5 h-5 text-amber-400" />} label="고위험 수조" value={dHighRiskTanks} sub="높음 이상 위험 단계" color="text-amber-400" />
                <StatCard icon={<Clock className="w-5 h-5 text-ocean-400" />} label="최근 7일" value={dRecentCount} sub="최근 진단 건수" color="text-ocean-400" />
              </div>

              <RiskScaleIndicator worstRisk={dWorstRisk} />

              <Card className="bg-slate-800/50 border-white/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-base flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-400" />진단 이력 ({diagnoses.length}건)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {diagnoses.length === 0 ? (
                    <div className="text-center py-14 text-slate-500">
                      <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{t.diagnosis.noTests}</p>
                      <p className="text-xs mt-1">{t.diagnosis.noTestsMsg}</p>
                    </div>
                  ) : (
                    <>
                      {/* Desktop Table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-slate-500 text-xs border-b border-white/5">
                              <th className="text-left pb-3 font-medium">{t.diagnosis.tank}</th>
                              <th className="text-left pb-3 font-medium">{t.diagnosis.testType}</th>
                              <th className="text-left pb-3 font-medium">{t.diagnosis.result}</th>
                              <th className="text-right pb-3 font-medium">비브리오수</th>
                              <th className="text-right pb-3 font-medium">병원성 비율</th>
                              <th className="text-right pb-3 font-medium">위험도</th>
                              <th className="text-right pb-3 font-medium">{t.diagnosis.testedAt}</th>
                              <th className="text-left pb-3 font-medium pl-4">조치사항</th>
                              <th className="pb-3 w-16" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {diagnoses.map(d => {
                              const rm = RESULT_META[d.result as ResultType]
                              const rk = RISK_META[d.risk_level as RiskLevel]
                              return (
                                <tr key={d.id} className="hover:bg-white/[0.02] transition-colors group">
                                  <td className="py-4 text-white font-medium">{d.tank_name}</td>
                                  <td className="py-4 text-slate-300">{d.test_type}</td>
                                  <td className="py-4"><Badge variant={rm.badgeVariant} className="flex items-center gap-1 w-fit">{rm.icon}{d.result}</Badge></td>
                                  <td className="py-4 text-right text-slate-300 tabular-nums">{d.vibrio_count > 0 ? `${d.vibrio_count.toLocaleString()} CFU/mL` : "—"}</td>
                                  <td className="py-4 text-right text-slate-300 tabular-nums">{d.pathogenic_ratio > 0 ? `${d.pathogenic_ratio}%` : "—"}</td>
                                  <td className="py-4 text-right"><Badge variant={rk.badgeVariant} className="w-fit ml-auto">{rk.label}</Badge></td>
                                  <td className="py-4 text-right text-slate-500 text-xs whitespace-nowrap">{formatDateTime(d.tested_at)}</td>
                                  <td className="py-4 pl-4 text-slate-400 text-xs max-w-[200px] truncate">{d.action_taken ?? "—"}</td>
                                  <td className="py-4">
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                                      <button onClick={() => openDEdit(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-ocean-400 hover:bg-white/5 transition-colors" aria-label={t.common.edit}><Pencil className="w-3.5 h-3.5" /></button>
                                      <button onClick={() => setDDeleteTarget(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors" aria-label={t.common.delete}><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-3">
                        {diagnoses.map(d => {
                          const rm = RESULT_META[d.result as ResultType]
                          const rk = RISK_META[d.risk_level as RiskLevel]
                          return (
                            <div key={d.id} className={`p-4 rounded-xl border ${rk.bg} space-y-3`}>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-white font-semibold">{d.tank_name}</p>
                                  <p className="text-xs text-slate-400 mt-0.5">{d.test_type}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={rm.badgeVariant} className="flex items-center gap-1">{rm.icon}{d.result}</Badge>
                                  <Badge variant={rk.badgeVariant}>{rk.label}</Badge>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-slate-800/60 rounded-lg p-2">
                                  <p className="text-slate-500">비브리오수</p>
                                  <p className="text-slate-200 font-medium mt-0.5">{d.vibrio_count > 0 ? `${d.vibrio_count.toLocaleString()} CFU/mL` : "—"}</p>
                                </div>
                                <div className="bg-slate-800/60 rounded-lg p-2">
                                  <p className="text-slate-500">병원성 비율</p>
                                  <p className="text-slate-200 font-medium mt-0.5">{d.pathogenic_ratio > 0 ? `${d.pathogenic_ratio}%` : "—"}</p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-xs text-slate-500">
                                <span className="flex items-center gap-1"><User className="w-3 h-3" />{d.tested_by}</span>
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDateTime(d.tested_at)}</span>
                              </div>
                              {d.action_taken && (
                                <div className="bg-slate-800/60 rounded-lg p-2 text-xs">
                                  <p className="text-slate-500 mb-0.5">조치사항</p>
                                  <p className="text-slate-300">{d.action_taken}</p>
                                </div>
                              )}
                              <div className="flex items-center justify-end gap-1 pt-1">
                                <button onClick={() => openDEdit(d)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-ocean-400 hover:bg-white/5 transition-colors"><Pencil className="w-3 h-3" />{t.common.edit}</button>
                                <button onClick={() => setDDeleteTarget(d)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-white/5 transition-colors"><Trash2 className="w-3 h-3" />{t.common.delete}</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {dHasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={handleDLoadMore} disabled={dLoadingMore} className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5">
                    {dLoadingMore
                      ? <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />{t.common.loading}</span>
                      : <span className="flex items-center gap-2"><ChevronDown className="w-4 h-4" />더 보기</span>}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Journal Dialogs ── */}

      {/* Edit Journal */}
      <Dialog open={!!jEditTarget} onOpenChange={open => !open && setJEditTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><Pencil className="w-4 h-4 text-ocean-400" />{t.journal.editEntry}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5 text-ocean-400" />{t.journal.catFeeding} (kg)</Label>
                <Input type="number" step="0.1" value={jEditForm.feeding_amount || ""} onChange={e => setJEditForm(p => ({ ...p, feeding_amount: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">사료 종류</Label>
                <Select value={jEditForm.feed_type || ""} onValueChange={v => setJEditForm(p => ({ ...p, feed_type: v }))}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    {FEED_TYPES.map(f => <SelectItem key={f} value={f} className="text-white hover:bg-white/5">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">급이 횟수</Label>
                <Input type="number" value={jEditForm.feeding_times || ""} onChange={e => setJEditForm(p => ({ ...p, feeding_times: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><Skull className="w-3.5 h-3.5 text-amber-400" />폐사 (마리)</Label>
                <Input type="number" value={jEditForm.mortality_count || ""} onChange={e => setJEditForm(p => ({ ...p, mortality_count: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5 text-teal-400" />환수율 (%)</Label>
                <Input type="number" value={jEditForm.water_exchange_rate || ""} onChange={e => setJEditForm(p => ({ ...p, water_exchange_rate: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">{t.journal.notes}</Label>
              <Textarea value={jEditForm.notes || ""} onChange={e => setJEditForm(p => ({ ...p, notes: e.target.value }))} className="bg-slate-800 border-white/10 text-white resize-none" rows={3} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setJEditTarget(null)} className="text-slate-400 hover:text-white">{t.common.cancel}</Button>
            <Button onClick={handleJEditSave} disabled={jEditSaving} className="bg-gradient-to-r from-ocean-500 to-teal-500 text-white min-w-[80px]">
              {jEditSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Journal */}
      <Dialog open={!!jDeleteTarget} onOpenChange={open => !open && setJDeleteTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />{t.common.delete}</DialogTitle>
          </DialogHeader>
          <p className="text-slate-300 text-sm mt-2">
            <span className="font-semibold text-white">{jDeleteTarget?.tank_name}</span> ({jDeleteTarget && formatDate(jDeleteTarget.date)}) {t.journal.deleteConfirm}
          </p>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setJDeleteTarget(null)} className="text-slate-400 hover:text-white">{t.common.cancel}</Button>
            <Button onClick={handleJDelete} disabled={jDeleting} className="bg-red-500 hover:bg-red-600 text-white">
              {jDeleting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Journal */}
      <Dialog open={jDialogOpen} onOpenChange={setJDialogOpen}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><BookOpen className="w-5 h-5 text-ocean-400" />{t.journal.addEntry}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="basic" className="mt-2">
            <TabsList className="bg-slate-800 border-white/5 w-full">
              <TabsTrigger value="basic" className="flex-1 data-[state=active]:bg-ocean-500/20 data-[state=active]:text-ocean-300">기본 정보</TabsTrigger>
              <TabsTrigger value="water" className="flex-1 data-[state=active]:bg-ocean-500/20 data-[state=active]:text-ocean-300">수질 측정</TabsTrigger>
              <TabsTrigger value="ops" className="flex-1 data-[state=active]:bg-ocean-500/20 data-[state=active]:text-ocean-300">운영 작업</TabsTrigger>
              <TabsTrigger value="checklist" className="flex-1 data-[state=active]:bg-ocean-500/20 data-[state=active]:text-ocean-300">체크리스트</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">{t.journal.tank} *</Label>
                  <Select value={jForm.tank_id} onValueChange={v => jUpdate("tank_id", v)}>
                    <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue placeholder={t.journal.selectTank} /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10">
                      {tanks.map(tk => <SelectItem key={tk.id} value={tk.id} className="text-white hover:bg-white/5">{tk.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">{t.journal.date} *</Label>
                  <Input type="date" value={jForm.date} onChange={e => jUpdate("date", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5 text-ocean-400" />{t.journal.catFeeding} (kg)</Label>
                  <Input type="number" step="0.1" placeholder="0.0" value={jForm.feeding_amount} onChange={e => jUpdate("feeding_amount", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                  {inventoryItems.filter(i => i.category === "feed").length > 0 && (
                    <select value={jForm.feedItemId} onChange={e => jUpdate("feedItemId", e.target.value)}
                      className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-ocean-500">
                      <option value="">재고 차감 안 함</option>
                      {inventoryItems.filter(i => i.category === "feed").map(i =>
                        <option key={i.id} value={i.id}>{i.name} (재고: {i.current_stock}{i.unit})</option>
                      )}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">사료 종류</Label>
                  <Select value={jForm.feed_type} onValueChange={v => jUpdate("feed_type", v)}>
                    <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10">
                      {FEED_TYPES.map(f => <SelectItem key={f} value={f} className="text-white hover:bg-white/5">{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">급이 횟수 (회/일)</Label>
                  <Input type="number" placeholder="4" value={jForm.feeding_times} onChange={e => jUpdate("feeding_times", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 flex items-center gap-1"><Skull className="w-3.5 h-3.5 text-amber-400" />폐사 개수 (마리)</Label>
                  <Input type="number" placeholder="0" value={jForm.mortality_count} onChange={e => jUpdate("mortality_count", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5 text-teal-400" />환수율 (%)</Label>
                  <Input type="number" placeholder="0" value={jForm.water_exchange_rate} onChange={e => jUpdate("water_exchange_rate", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><StickyNote className="w-3.5 h-3.5 text-yellow-400" />{t.journal.notes}</Label>
                <Textarea placeholder={t.journal.notesPlaceholder} value={jForm.notes} onChange={e => jUpdate("notes", e.target.value)} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 resize-none" rows={3} />
              </div>
            </TabsContent>

            <TabsContent value="water" className="space-y-4 mt-4">
              <p className="text-xs text-slate-400 bg-ocean-500/10 border border-ocean-500/20 rounded-lg px-3 py-2">수질 측정값을 직접 입력하세요. 센서 연동 시 자동으로 불러옵니다.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { key: "temperature", label: "수온 (°C)",        icon: <Thermometer className="w-3.5 h-3.5 text-red-400" />,    placeholder: "28.0" },
                  { key: "ph",          label: "pH",               icon: <Droplets    className="w-3.5 h-3.5 text-blue-400" />,   placeholder: "7.8" },
                  { key: "do_level",    label: "DO (mg/L)",        icon: <Wind        className="w-3.5 h-3.5 text-teal-400" />,   placeholder: "6.5" },
                  { key: "salinity",    label: "염분 (ppt)",        icon: <Waves       className="w-3.5 h-3.5 text-ocean-400" />,  placeholder: "20" },
                  { key: "ammonia",     label: "암모니아 (mg/L)",   icon: <FlaskConical className="w-3.5 h-3.5 text-amber-400" />, placeholder: "0.1" },
                  { key: "nitrite",     label: "아질산염 (mg/L)",   icon: <FlaskConical className="w-3.5 h-3.5 text-orange-400" />,placeholder: "0.05" },
                  { key: "nitrate",     label: "질산염 (mg/L)",    icon: <FlaskConical className="w-3.5 h-3.5 text-yellow-400" />,placeholder: "5.0" },
                  { key: "alkalinity",  label: "알칼리도 (mg/L)",  icon: <FlaskConical className="w-3.5 h-3.5 text-purple-400" />,placeholder: "120" },
                  { key: "turbidity",   label: "탁도 (NTU)",       icon: <Droplets    className="w-3.5 h-3.5 text-gray-400" />,   placeholder: "5" },
                ].map(f => (
                  <div key={f.key} className="space-y-2">
                    <Label className="text-slate-300 flex items-center gap-1">{f.icon}{f.label}</Label>
                    <Input type="number" step="0.01" placeholder={f.placeholder} value={jForm[f.key as keyof typeof jForm] as string} onChange={e => jUpdate(f.key, e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="ops" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div><p className="text-sm text-white font-medium">소독 실시</p><p className="text-xs text-slate-400">수조 소독 여부</p></div>
                  <Switch checked={jForm.disinfection} onCheckedChange={v => jUpdate("disinfection", v)} />
                </div>
                {jForm.disinfection && (
                  <div className="space-y-2">
                    <Label className="text-slate-300">소독 방법/약품</Label>
                    <Input placeholder="소독 방법을 입력하세요" value={jForm.disinfection_type} onChange={e => jUpdate("disinfection_type", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                    {inventoryItems.filter(i => i.category === "chemical").length > 0 && (
                      <select value={jForm.chemicalItemId} onChange={e => jUpdate("chemicalItemId", e.target.value)}
                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-ocean-500">
                        <option value="">재고 차감 안 함</option>
                        {inventoryItems.filter(i => i.category === "chemical").map(i =>
                          <option key={i.id} value={i.id}>{i.name} (재고: {i.current_stock}{i.unit})</option>
                        )}
                      </select>
                    )}
                    {jForm.chemicalItemId && (
                      <Input type="number" step="0.01" placeholder="사용량 입력" value={jForm.chemicalQty} onChange={e => jUpdate("chemicalQty", e.target.value)} className="bg-slate-800 border-white/10 text-white text-sm" />
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div><p className="text-sm text-white font-medium">미생물제 투입</p><p className="text-xs text-slate-400">유익균 투입 여부</p></div>
                  <Switch checked={jForm.microbial_input} onCheckedChange={v => jUpdate("microbial_input", v)} />
                </div>
                {jForm.microbial_input && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-slate-300">미생물 종류</Label>
                      <Select value={jForm.microbial_type} onValueChange={v => jUpdate("microbial_type", v)}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10">
                          {MICROBIAL_TYPES.map(m => <SelectItem key={m} value={m} className="text-white hover:bg-white/5">{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">투입량 (mL/ton)</Label>
                      <Input type="number" placeholder="500" value={jForm.microbial_amount} onChange={e => jUpdate("microbial_amount", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                      {inventoryItems.filter(i => i.category === "probiotic").length > 0 && (
                        <select value={jForm.microbialItemId} onChange={e => jUpdate("microbialItemId", e.target.value)}
                          className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-ocean-500">
                          <option value="">재고 차감 안 함</option>
                          {inventoryItems.filter(i => i.category === "probiotic").map(i =>
                            <option key={i.id} value={i.id}>{i.name} (재고: {i.current_stock}{i.unit})</option>
                          )}
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="checklist" className="space-y-3 mt-4">
              <p className="text-xs text-slate-400">일일 점검 항목을 확인하세요</p>
              {[
                { key: "check_aeration",     label: "폭기 시스템 점검",  desc: "에어레이터 가동 상태 확인" },
                { key: "check_filtration",   label: "여과 시스템 점검",  desc: "필터 청결 및 가동 상태 확인" },
                { key: "check_circulation",  label: "순환 펌프 점검",    desc: "순환 펌프 가동 상태 및 유량 확인" },
                { key: "check_feeding_check",label: "섭이 반응 확인",    desc: "새우 섭이 반응 및 활동성 확인" },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div><p className="text-sm text-white font-medium">{item.label}</p><p className="text-xs text-slate-400">{item.desc}</p></div>
                  <Switch checked={jForm[item.key as keyof typeof jForm] as boolean} onCheckedChange={v => jUpdate(item.key, v)} />
                </div>
              ))}
            </TabsContent>
          </Tabs>
          {jSaveError && <p className="text-sm text-red-400 mt-2 px-1">{jSaveError}</p>}
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setJDialogOpen(false)} className="text-slate-400 hover:text-white">{t.common.cancel}</Button>
            <Button onClick={handleJSave} disabled={jSaving || jSaved || !jForm.tank_id} className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white min-w-[100px]">
              {jSaved
                ? <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t.journal.saved}</span>
                : jSaving
                ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t.journal.saving}</span>
                : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Diagnosis Dialogs ── */}

      {/* Edit Diagnosis */}
      <Dialog open={!!dEditTarget} onOpenChange={open => !open && setDEditTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><Pencil className="w-4 h-4 text-purple-400" />진단 결과 편집</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDEditSave} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">{t.diagnosis.testType}</Label>
                <Select value={dEditForm.test_type} onValueChange={v => setDEditForm(p => ({ ...p, test_type: v as TestType }))}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    {(["AHPND", "총비브리오", "EHP", "WSSV", "기타"] as TestType[]).map(tt => <SelectItem key={tt} value={tt} className="text-white focus:bg-slate-700">{tt}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">{t.diagnosis.result}</Label>
                <Select value={dEditForm.result} onValueChange={v => setDEditForm(p => ({ ...p, result: v as ResultType }))}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    <SelectItem value="양성" className="text-red-300 focus:bg-slate-700">{t.diagnosis.resultPositive}</SelectItem>
                    <SelectItem value="의심" className="text-amber-300 focus:bg-slate-700">{t.diagnosis.resultSuspected}</SelectItem>
                    <SelectItem value="음성" className="text-emerald-300 focus:bg-slate-700">{t.diagnosis.resultNegative}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">총 비브리오 균수 (CFU/mL)</Label>
                <Input type="number" min={0} placeholder="예: 8500" value={dEditForm.vibrio_count} onChange={e => setDEditForm(p => ({ ...p, vibrio_count: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">병원성 비율 (%)</Label>
                <Input type="number" min={0} max={100} placeholder="예: 35" value={dEditForm.pathogenic_ratio} onChange={e => setDEditForm(p => ({ ...p, pathogenic_ratio: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">위험 단계</Label>
              <Select value={dEditForm.risk_level} onValueChange={v => setDEditForm(p => ({ ...p, risk_level: v as RiskLevel }))}>
                <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-white/10">
                  <SelectItem value="low" className="text-emerald-300 focus:bg-slate-700">낮음</SelectItem>
                  <SelectItem value="medium" className="text-amber-300 focus:bg-slate-700">보통</SelectItem>
                  <SelectItem value="high" className="text-red-300 focus:bg-slate-700">높음</SelectItem>
                  <SelectItem value="critical" className="text-purple-300 focus:bg-slate-700">긴급</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />조치사항</Label>
              <Textarea placeholder="조치사항을 입력하세요" value={dEditForm.action_taken} onChange={e => setDEditForm(p => ({ ...p, action_taken: e.target.value }))} rows={3} className="bg-slate-800 border-white/10 text-white resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">{t.diagnosis.notes}</Label>
              <Textarea placeholder={t.diagnosis.notesPlaceholder} value={dEditForm.notes} onChange={e => setDEditForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="bg-slate-800 border-white/10 text-white resize-none" />
            </div>
            {dEditError && <p className="text-sm text-red-400 flex items-center gap-1.5"><XCircle className="w-4 h-4 shrink-0" />{dEditError}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDEditTarget(null)} className="border-white/10 text-slate-300 hover:bg-slate-700" disabled={dEditSaving}>{t.common.cancel}</Button>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white border-0" disabled={dEditSaving}>
                {dEditSaving ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Pencil className="w-4 h-4 mr-1.5" />}{t.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Diagnosis */}
      <Dialog open={!!dDeleteTarget} onOpenChange={open => !open && setDDeleteTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />{t.common.delete}</DialogTitle>
          </DialogHeader>
          <p className="text-slate-300 text-sm mt-2">
            <span className="font-semibold text-white">{dDeleteTarget?.tank_name}</span> — {dDeleteTarget?.test_type} ({dDeleteTarget?.result}) {t.diagnosis.deleteConfirm}
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDDeleteTarget(null)} className="border-white/10 text-slate-300 hover:bg-slate-700" disabled={dDeleting}>{t.common.cancel}</Button>
            <Button onClick={handleDDelete} disabled={dDeleting} className="bg-red-500 hover:bg-red-600 text-white border-0">
              {dDeleting ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}{t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade Modal */}
      <UpgradeModal open={dUpgradeOpen} onClose={() => setDUpgradeOpen(false)} currentPlan={plan} limitType="diag" />
    </div>
  )
}
