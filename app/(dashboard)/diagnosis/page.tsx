"use client"

import { useState, useEffect, useCallback } from "react"
import { MOCK_DIAGNOSES, MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { PLAN_LIMITS, type Plan, hasExport } from "@/lib/plans"
import { UpgradeModal } from "@/components/ui/upgrade-modal"
import { getDiagnoses, createDiagnosis, updateDiagnosis, deleteDiagnosis, getAllTanks } from "@/lib/db"
import { DiagnosisResult, Tank } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/utils"
import {
  FlaskConical,
  Plus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  User,
  FileText,
  Activity,
  RefreshCw,
  Pencil,
  Trash2,
  Download,
  ChevronDown,
  Calendar,
} from "lucide-react"
import { exportToCsv } from "@/lib/export"

// ── helpers ──────────────────────────────────────────────────────────────────

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

type RiskLevel = keyof typeof RISK_META
type ResultType = keyof typeof RESULT_META
type TestType = DiagnosisResult["test_type"]

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

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 86400000)
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <Card className="bg-slate-800/50 border-white/5 hover:border-white/10 transition-all">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-400 mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          </div>
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center bg-white/5`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RiskScaleIndicator({ worstRisk }: { worstRisk: RiskLevel }) {
  return (
    <Card className="bg-slate-800/50 border-white/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />
          현재 위험 단계
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
                <div
                  className={`h-2.5 w-full rounded-full transition-all ${
                    isActive || isPast ? meta.bar : "bg-slate-700"
                  } ${isActive ? "ring-2 ring-offset-2 ring-offset-slate-800 ring-white/30" : ""}`}
                />
                <span
                  className={`text-xs font-medium ${
                    isActive ? meta.color : isPast ? "text-slate-400" : "text-slate-600"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>

        <div className={`mt-4 flex items-center gap-3 p-3 rounded-xl border ${RISK_META[worstRisk].bg}`}>
          <AlertTriangle className={`w-5 h-5 shrink-0 ${RISK_META[worstRisk].color}`} />
          <div>
            <p className={`text-sm font-semibold ${RISK_META[worstRisk].color}`}>
              {RISK_META[worstRisk].label} 위험 단계
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {worstRisk === "low" && "현재 모든 수조가 정상 범위입니다."}
              {worstRisk === "medium" && "일부 수조에서 주의가 필요합니다. 모니터링을 강화하세요."}
              {worstRisk === "high" && "높은 위험 수조가 감지됩니다. 즉시 조치가 필요합니다."}
              {worstRisk === "critical" && "긴급 상황입니다! 즉각적인 격리 및 전문가 자문이 필요합니다."}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── form state ────────────────────────────────────────────────────────────────

interface FormState {
  tank_id: string
  test_type: TestType | ""
  result: ResultType | ""
  vibrio_count: string
  pathogenic_ratio: string
  risk_level: RiskLevel | ""
  action_taken: string
  notes: string
}

const EMPTY_FORM: FormState = {
  tank_id: "",
  test_type: "",
  result: "",
  vibrio_count: "",
  pathogenic_ratio: "",
  risk_level: "",
  action_taken: "",
  notes: "",
}

const PAGE_SIZE = 20

// ── main page ─────────────────────────────────────────────────────────────────

export default function DiagnosisPage() {
  const { user } = useAuth()
  const plan = (user?.plan ?? "free") as Plan
  const diagLimit = PLAN_LIMITS[plan].diagPerMonth
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<DiagnosisResult | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DiagnosisResult | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const mock = isTestAccount(user?.email)

  // Count this month's diagnoses for limit display
  const now = new Date()
  const thisMonthCount = diagnoses.filter(d => {
    const dt = new Date(d.tested_at)
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()
  }).length

  async function loadDiagnoses(from: string, to: string, newOffset: number, replace: boolean) {
    const mock = isTestAccount(user?.email)
    try {
      const d = await getDiagnoses(undefined, from || undefined, to || undefined, newOffset, PAGE_SIZE)
      setHasMore(d.length === PAGE_SIZE)
      if (replace) {
        setDiagnoses(d.length ? d : (newOffset === 0 && mock ? MOCK_DIAGNOSES : []))
      } else {
        setDiagnoses(prev => [...prev, ...d])
      }
    } catch {
      if (newOffset === 0 && mock) setDiagnoses(MOCK_DIAGNOSES)
    }
  }

  const loadData = useCallback(async () => {
    const mock = isTestAccount(user?.email)
    setIsLoading(true)
    try {
      const [, t] = await Promise.all([loadDiagnoses("", "", 0, true), getAllTanks()])
      setTanks(t.length ? t : (mock ? MOCK_TANKS : []))
    } catch {
      if (mock) {
        setDiagnoses(MOCK_DIAGNOSES)
        setTanks(MOCK_TANKS)
      }
    } finally {
      setIsLoading(false)
    }
  }, [user?.email])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleFilter = async () => {
    setIsLoading(true)
    setOffset(0)
    await loadDiagnoses(filterFrom, filterTo, 0, true)
    setIsLoading(false)
  }

  const handleLoadMore = async () => {
    const newOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    await loadDiagnoses(filterFrom, filterTo, newOffset, false)
    setOffset(newOffset)
    setLoadingMore(false)
  }

  const handleCsvExport = () => {
    exportToCsv(diagnoses.map(d => ({
      수조: d.tank_name,
      검사항목: d.test_type,
      결과: d.result,
      비브리오수_CFU_mL: d.vibrio_count,
      병원성비율_pct: d.pathogenic_ratio,
      위험도: d.risk_level,
      검사자: d.tested_by,
      조치사항: d.action_taken || "",
      비고: d.notes || "",
      검사일시: d.tested_at,
    })), `질병진단_${new Date().toISOString().split("T")[0]}`)
  }

  // Summary stats
  const totalTests     = diagnoses.length
  const positiveCount  = diagnoses.filter(d => d.result === "양성").length
  const highRiskTanks  = new Set(
    diagnoses
      .filter(d => d.risk_level === "high" || d.risk_level === "critical")
      .map(d => d.tank_id)
  ).size
  const recentCount    = diagnoses.filter(
    d => new Date(d.tested_at) >= sevenDaysAgo()
  ).length
  const worstRisk      = getWorstRisk(diagnoses)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (diagLimit !== Infinity && thisMonthCount >= diagLimit) {
      setDialogOpen(false)
      setUpgradeOpen(true)
      return
    }

    if (!form.tank_id || !form.test_type || !form.result || !form.risk_level) {
      setSubmitError("필수 항목을 모두 입력해주세요.")
      return
    }

    const vibrioNum = form.vibrio_count ? Number(form.vibrio_count) : 0
    const ratioNum  = form.pathogenic_ratio ? Number(form.pathogenic_ratio) : 0
    if (!Number.isFinite(vibrioNum) || vibrioNum < 0 || vibrioNum > 10_000_000) {
      setSubmitError("비브리오 수치는 0~10,000,000 CFU/mL 범위로 입력해주세요.")
      return
    }
    if (!Number.isFinite(ratioNum) || ratioNum < 0 || ratioNum > 100) {
      setSubmitError("병원성 비율은 0~100% 범위로 입력해주세요.")
      return
    }

    const tank = tanks.find(t => t.id === form.tank_id)
    setIsSubmitting(true)
    try {
      await createDiagnosis({
        tank_id: form.tank_id,
        test_type: form.test_type,
        result: form.result,
        vibrio_count: vibrioNum,
        pathogenic_ratio: ratioNum,
        risk_level: form.risk_level,
        action_taken: form.action_taken || undefined,
        notes: form.notes || undefined,
      })
      setForm(EMPTY_FORM)
      setDialogOpen(false)
      showToast(`진단 결과가 성공적으로 등록되었습니다. (${tank?.name} · ${form.test_type} · ${form.result})`)
      await loadData()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "진단 결과 저장에 실패했습니다.")
    } finally {
      setIsSubmitting(false)
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function openEdit(d: DiagnosisResult) {
    setEditTarget(d)
    setEditError(null)
    setEditForm({
      tank_id: d.tank_id,
      test_type: d.test_type,
      result: d.result as ResultType,
      vibrio_count: d.vibrio_count > 0 ? String(d.vibrio_count) : "",
      pathogenic_ratio: d.pathogenic_ratio > 0 ? String(d.pathogenic_ratio) : "",
      risk_level: d.risk_level as RiskLevel,
      action_taken: d.action_taken || "",
      notes: d.notes || "",
    })
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    setEditError(null)
    if (!editTarget) return

    const editVibrioNum = editForm.vibrio_count ? Number(editForm.vibrio_count) : 0
    const editRatioNum  = editForm.pathogenic_ratio ? Number(editForm.pathogenic_ratio) : 0
    if (!Number.isFinite(editVibrioNum) || editVibrioNum < 0 || editVibrioNum > 10_000_000) {
      setEditError("비브리오 수치는 0~10,000,000 CFU/mL 범위로 입력해주세요.")
      return
    }
    if (!Number.isFinite(editRatioNum) || editRatioNum < 0 || editRatioNum > 100) {
      setEditError("병원성 비율은 0~100% 범위로 입력해주세요.")
      return
    }

    setEditSaving(true)
    try {
      const updated = await updateDiagnosis(editTarget.id, {
        tank_id: editForm.tank_id,
        test_type: editForm.test_type || undefined,
        result: editForm.result || undefined,
        vibrio_count: editVibrioNum,
        pathogenic_ratio: editRatioNum,
        risk_level: editForm.risk_level || undefined,
        action_taken: editForm.action_taken || null,
        notes: editForm.notes || null,
      })
      setDiagnoses(prev => prev.map(d => d.id === editTarget.id ? updated : d))
      setEditTarget(null)
      showToast("진단 결과가 수정되었습니다.")
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "수정에 실패했습니다.")
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDiagnosis(deleteTarget.id)
    } catch { /* remove locally */ }
    setDiagnoses(prev => prev.filter(d => d.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
    showToast("진단 결과가 삭제되었습니다.")
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Toast */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 border border-white/10 text-white text-sm px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <FlaskConical className="w-6 h-6 text-purple-400" />
            질병 진단
          </h1>
          <p className="text-sm text-slate-400 mt-1">수조별 병원체 검사 결과 및 위험도 관리</p>
        </div>

        <div className="flex items-center gap-2">
          {diagnoses.length > 0 && (
            <Button
              variant="outline"
              onClick={hasExport(plan) ? handleCsvExport : () => window.location.href = "/pricing"}
              className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
              title={hasExport(plan) ? "CSV 다운로드" : "Pro 플랜 이상에서 사용 가능합니다"}
            >
              <Download className="w-4 h-4 mr-1" />CSV
              {!hasExport(plan) && <span className="ml-1 text-xs text-amber-400">Pro</span>}
            </Button>
          )}
          {/* Monthly limit badge */}
          {diagLimit !== Infinity && (
            <span className={`text-xs px-2 py-1 rounded-lg border ${
              thisMonthCount >= diagLimit
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : thisMonthCount >= diagLimit * 0.7
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-slate-800/60 border-white/10 text-slate-400"
            }`}>
              이번 달 {thisMonthCount}/{diagLimit}회
            </span>
          )}
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            if (open && diagLimit !== Infinity && thisMonthCount >= diagLimit) {
              setUpgradeOpen(true)
              return
            }
            setDialogOpen(open)
            if (open) { setForm(EMPTY_FORM); setSubmitError(null) }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-purple-600 hover:bg-purple-500 text-white border-0">
                <Plus className="w-4 h-4" />
                진단 추가
              </Button>
            </DialogTrigger>

          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-purple-400" />
                새 진단 결과 등록
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              {/* 수조 선택 */}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">
                  수조 선택 <span className="text-red-400">*</span>
                </Label>
                <Select value={form.tank_id} onValueChange={v => setField("tank_id", v)}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                    <SelectValue placeholder="수조를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    {tanks.map(tank => (
                      <SelectItem key={tank.id} value={tank.id} className="text-white focus:bg-slate-700">
                        {tank.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 검사 항목 */}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">
                  검사 항목 <span className="text-red-400">*</span>
                </Label>
                <Select value={form.test_type} onValueChange={v => setField("test_type", v as TestType)}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                    <SelectValue placeholder="검사 항목을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    {(["AHPND", "총비브리오", "EHP", "WSSV", "기타"] as TestType[]).map(t => (
                      <SelectItem key={t} value={t} className="text-white focus:bg-slate-700">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 결과 */}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">
                  결과 <span className="text-red-400">*</span>
                </Label>
                <Select value={form.result} onValueChange={v => setField("result", v as ResultType)}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                    <SelectValue placeholder="결과를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    <SelectItem value="양성" className="text-red-300 focus:bg-slate-700">양성</SelectItem>
                    <SelectItem value="의심" className="text-amber-300 focus:bg-slate-700">의심</SelectItem>
                    <SelectItem value="음성" className="text-emerald-300 focus:bg-slate-700">음성</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 수치 row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">총 비브리오 균수 (CFU/mL)</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="예: 8500"
                    value={form.vibrio_count}
                    onChange={e => setField("vibrio_count", e.target.value)}
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">병원성 비율 (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="예: 35"
                    value={form.pathogenic_ratio}
                    onChange={e => setField("pathogenic_ratio", e.target.value)}
                    className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600"
                  />
                </div>
              </div>

              {/* 위험 단계 */}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">
                  위험 단계 <span className="text-red-400">*</span>
                </Label>
                <Select value={form.risk_level} onValueChange={v => setField("risk_level", v as RiskLevel)}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                    <SelectValue placeholder="위험 단계를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    <SelectItem value="low"      className="text-emerald-300 focus:bg-slate-700">낮음</SelectItem>
                    <SelectItem value="medium"   className="text-amber-300   focus:bg-slate-700">보통</SelectItem>
                    <SelectItem value="high"     className="text-red-300     focus:bg-slate-700">높음</SelectItem>
                    <SelectItem value="critical" className="text-purple-300  focus:bg-slate-700">긴급</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 조치사항 */}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> 조치사항
                </Label>
                <Textarea
                  placeholder="시행한 또는 예정된 조치사항을 입력하세요"
                  value={form.action_taken}
                  onChange={e => setField("action_taken", e.target.value)}
                  rows={3}
                  className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 resize-none"
                />
              </div>

              {/* 비고 */}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">비고</Label>
                <Textarea
                  placeholder="추가 메모 사항"
                  value={form.notes}
                  onChange={e => setField("notes", e.target.value)}
                  rows={2}
                  className="bg-slate-800 border-white/10 text-white placeholder:text-slate-600 resize-none"
                />
              </div>

              {submitError && (
                <p className="text-sm text-red-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 shrink-0" /> {submitError}
                </p>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="border-white/10 text-slate-300 hover:bg-slate-700"
                  disabled={isSubmitting}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  className="bg-purple-600 hover:bg-purple-500 text-white border-0"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <FlaskConical className="w-4 h-4 mr-1.5" />
                  )}
                  등록
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-800/40 border border-white/5 rounded-xl px-4 py-3">
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
            className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
          <span className="text-slate-500 text-sm">~</span>
          <input
            type="date"
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        </div>
        <Button size="sm" onClick={handleFilter} className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30">
          조회
        </Button>
        {(filterFrom || filterTo) && (
          <button
            onClick={() => { setFilterFrom(""); setFilterTo(""); setOffset(0); loadDiagnoses("", "", 0, true) }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            초기화
          </button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <Card className="bg-slate-800/50 border-white/5">
          <CardContent className="p-8 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-purple-400" />
            진단 데이터를 불러오는 중...
          </CardContent>
        </Card>
      )}

      {/* Summary Cards + Risk Indicator (hidden while loading) */}
      {!isLoading && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<FlaskConical className="w-5 h-5 text-purple-400" />}
            label="총 검사 건수"
            value={totalTests}
            sub="누적 진단 기록"
            color="text-purple-400"
          />
          <StatCard
            icon={<XCircle className="w-5 h-5 text-red-400" />}
            label="양성 건수"
            value={positiveCount}
            sub={`전체의 ${totalTests ? Math.round((positiveCount / totalTests) * 100) : 0}%`}
            color="text-red-400"
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
            label="고위험 수조"
            value={highRiskTanks}
            sub="높음 이상 위험 단계"
            color="text-amber-400"
          />
          <StatCard
            icon={<Clock className="w-5 h-5 text-ocean-400" />}
            label="최근 7일"
            value={recentCount}
            sub="최근 진단 건수"
            color="text-ocean-400"
          />
        </div>

        {/* Risk Indicator */}
        <RiskScaleIndicator worstRisk={worstRisk} />

      {/* Diagnosis History */}
      <Card className="bg-slate-800/50 border-white/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              진단 이력 ({diagnoses.length}건)
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {diagnoses.length === 0 ? (
            <div className="text-center py-14 text-slate-500">
              <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">등록된 진단 결과가 없습니다.</p>
              <p className="text-xs mt-1">진단 추가 버튼으로 첫 결과를 입력하세요.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 text-xs border-b border-white/5">
                      <th className="text-left pb-3 font-medium">수조</th>
                      <th className="text-left pb-3 font-medium">검사 항목</th>
                      <th className="text-left pb-3 font-medium">결과</th>
                      <th className="text-right pb-3 font-medium">비브리오수</th>
                      <th className="text-right pb-3 font-medium">병원성 비율</th>
                      <th className="text-right pb-3 font-medium">위험도</th>
                      <th className="text-right pb-3 font-medium">검사일시</th>
                      <th className="text-left pb-3 font-medium pl-4">조치사항</th>
                      <th className="pb-3 w-16" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {diagnoses.map(d => {
                      const resultMeta = RESULT_META[d.result as ResultType]
                      const riskMeta   = RISK_META[d.risk_level as RiskLevel]
                      return (
                        <tr key={d.id} className="hover:bg-white/[0.02] transition-colors group">
                          <td className="py-4 text-white font-medium">{d.tank_name}</td>
                          <td className="py-4 text-slate-300">{d.test_type}</td>
                          <td className="py-4">
                            <Badge
                              variant={resultMeta.badgeVariant}
                              className="flex items-center gap-1 w-fit"
                            >
                              {resultMeta.icon}
                              {d.result}
                            </Badge>
                          </td>
                          <td className="py-4 text-right text-slate-300 tabular-nums">
                            {d.vibrio_count > 0 ? `${d.vibrio_count.toLocaleString()} CFU/mL` : "—"}
                          </td>
                          <td className="py-4 text-right text-slate-300 tabular-nums">
                            {d.pathogenic_ratio > 0 ? `${d.pathogenic_ratio}%` : "—"}
                          </td>
                          <td className="py-4 text-right">
                            <Badge variant={riskMeta.badgeVariant} className="w-fit ml-auto">
                              {riskMeta.label}
                            </Badge>
                          </td>
                          <td className="py-4 text-right text-slate-500 text-xs whitespace-nowrap">
                            {formatDateTime(d.tested_at)}
                          </td>
                          <td className="py-4 pl-4 text-slate-400 text-xs max-w-[200px] truncate">
                            {d.action_taken ?? "—"}
                          </td>
                          <td className="py-4">
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                              <button onClick={() => openEdit(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-ocean-400 hover:bg-white/5 transition-colors" aria-label="편집">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeleteTarget(d)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors" aria-label="삭제">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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
                  const resultMeta = RESULT_META[d.result as ResultType]
                  const riskMeta   = RISK_META[d.risk_level as RiskLevel]
                  return (
                    <div
                      key={d.id}
                      className={`p-4 rounded-xl border ${riskMeta.bg} space-y-3`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-semibold">{d.tank_name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{d.test_type}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={resultMeta.badgeVariant} className="flex items-center gap-1">
                            {resultMeta.icon}{d.result}
                          </Badge>
                          <Badge variant={riskMeta.badgeVariant}>{riskMeta.label}</Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-slate-800/60 rounded-lg p-2">
                          <p className="text-slate-500">비브리오수</p>
                          <p className="text-slate-200 font-medium mt-0.5">
                            {d.vibrio_count > 0 ? `${d.vibrio_count.toLocaleString()} CFU/mL` : "—"}
                          </p>
                        </div>
                        <div className="bg-slate-800/60 rounded-lg p-2">
                          <p className="text-slate-500">병원성 비율</p>
                          <p className="text-slate-200 font-medium mt-0.5">
                            {d.pathogenic_ratio > 0 ? `${d.pathogenic_ratio}%` : "—"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" /> {d.tested_by}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatDateTime(d.tested_at)}
                        </span>
                      </div>

                      {d.action_taken && (
                        <div className="bg-slate-800/60 rounded-lg p-2 text-xs">
                          <p className="text-slate-500 mb-0.5">조치사항</p>
                          <p className="text-slate-300">{d.action_taken}</p>
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-1 pt-1">
                        <button onClick={() => openEdit(d)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-ocean-400 hover:bg-white/5 transition-colors">
                          <Pencil className="w-3 h-3" />편집
                        </button>
                        <button onClick={() => setDeleteTarget(d)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-white/5 transition-colors">
                          <Trash2 className="w-3 h-3" />삭제
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
          >
            {loadingMore ? (
              <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />불러오는 중...</span>
            ) : (
              <span className="flex items-center gap-2"><ChevronDown className="w-4 h-4" />더 보기</span>
            )}
          </Button>
        </div>
      )}
      </>}

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => !open && setEditTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-4 h-4 text-purple-400" />진단 결과 편집
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSave} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">검사 항목</Label>
                <Select value={editForm.test_type} onValueChange={v => setEditForm(p => ({ ...p, test_type: v as TestType }))}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    {(["AHPND", "총비브리오", "EHP", "WSSV", "기타"] as TestType[]).map(t => (
                      <SelectItem key={t} value={t} className="text-white focus:bg-slate-700">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">결과</Label>
                <Select value={editForm.result} onValueChange={v => setEditForm(p => ({ ...p, result: v as ResultType }))}>
                  <SelectTrigger className="bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-white/10">
                    <SelectItem value="양성" className="text-red-300 focus:bg-slate-700">양성</SelectItem>
                    <SelectItem value="의심" className="text-amber-300 focus:bg-slate-700">의심</SelectItem>
                    <SelectItem value="음성" className="text-emerald-300 focus:bg-slate-700">음성</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">총 비브리오 균수 (CFU/mL)</Label>
                <Input type="number" min={0} placeholder="예: 8500" value={editForm.vibrio_count} onChange={e => setEditForm(p => ({ ...p, vibrio_count: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">병원성 비율 (%)</Label>
                <Input type="number" min={0} max={100} placeholder="예: 35" value={editForm.pathogenic_ratio} onChange={e => setEditForm(p => ({ ...p, pathogenic_ratio: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">위험 단계</Label>
              <Select value={editForm.risk_level} onValueChange={v => setEditForm(p => ({ ...p, risk_level: v as RiskLevel }))}>
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
              <Textarea placeholder="조치사항을 입력하세요" value={editForm.action_taken} onChange={e => setEditForm(p => ({ ...p, action_taken: e.target.value }))} rows={3} className="bg-slate-800 border-white/10 text-white resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">비고</Label>
              <Textarea placeholder="추가 메모" value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="bg-slate-800 border-white/10 text-white resize-none" />
            </div>
            {editError && <p className="text-sm text-red-400 flex items-center gap-1.5"><XCircle className="w-4 h-4 shrink-0" />{editError}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)} className="border-white/10 text-slate-300 hover:bg-slate-700" disabled={editSaving}>취소</Button>
              <Button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white border-0" disabled={editSaving}>
                {editSaving ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Pencil className="w-4 h-4 mr-1.5" />}저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Upgrade Modal — monthly diag limit */}
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentPlan={plan}
        limitType="diag"
      />

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />진단 결과 삭제
            </DialogTitle>
          </DialogHeader>
          <p className="text-slate-300 text-sm mt-2">
            <span className="font-semibold text-white">{deleteTarget?.tank_name}</span> — {deleteTarget?.test_type} ({deleteTarget?.result}) 결과를 삭제합니다. 이 작업은 되돌릴 수 없습니다.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="border-white/10 text-slate-300 hover:bg-slate-700" disabled={deleting}>취소</Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white border-0">
              {deleting ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
