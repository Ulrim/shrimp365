"use client"

import { useState, useEffect } from "react"
import { MOCK_JOURNALS, MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getJournalEntries, createJournalEntry, updateJournalEntry, deleteJournalEntry, getAllTanks, insertWaterQuality } from "@/lib/db"
import { WQ_BOUNDS, WqField } from "@/lib/utils"
import { JournalEntry, Tank } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  BookOpen, Plus, Thermometer, Droplets, Wind, Waves, Fish, UtensilsCrossed,
  RefreshCw, FlaskConical, Skull, CheckCircle2, Calendar, User, StickyNote,
  Pencil, Trash2, AlertTriangle, Download, ChevronDown
} from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"
import { exportToCsv } from "@/lib/export"

const FEED_TYPES = ["입식기 사료 (No.0)", "초기 사료 (No.1)", "성장기 사료 (No.2)", "성장기 사료 (No.3)", "마무리 사료 (No.4)", "기타"]
const MICROBIAL_TYPES = ["EM균", "바실러스균", "광합성균", "복합 미생물제", "기타"]

const defaultFormValues = {
  tank_id: "",
  date: new Date().toISOString().split("T")[0],
  // Water quality
  temperature: "",
  ph: "",
  do_level: "",
  salinity: "",
  ammonia: "",
  nitrite: "",
  nitrate: "",
  alkalinity: "",
  turbidity: "",
  // Feeding
  feeding_amount: "",
  feed_type: "성장기 사료 (No.3)",
  feeding_times: "4",
  // Mortality
  mortality_count: "",
  // Water management
  water_exchange_rate: "",
  disinfection: false,
  disinfection_type: "",
  // Microbial
  microbial_input: false,
  microbial_type: "EM균",
  microbial_amount: "",
  // Checklist
  check_aeration: false,
  check_filtration: false,
  check_circulation: false,
  check_feeding_check: false,
  // Notes
  notes: "",
}

function JournalCard({ entry, onEdit, onDelete }: { entry: JournalEntry; onEdit: (e: JournalEntry) => void; onDelete: (e: JournalEntry) => void }) {
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
            <button
              onClick={() => onEdit(entry)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-ocean-400 hover:bg-white/5 transition-colors"
              aria-label="일지 편집"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(entry)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
              aria-label="일지 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-ocean-400 mb-1">
              <UtensilsCrossed className="w-3.5 h-3.5" />
            </div>
            <p className="text-lg font-bold text-white">{entry.feeding_amount}<span className="text-xs text-slate-400">kg</span></p>
            <p className="text-xs text-slate-400">급이량</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-amber-400 mb-1">
              <Skull className="w-3.5 h-3.5" />
            </div>
            <p className="text-lg font-bold text-white">{entry.mortality_count.toLocaleString()}<span className="text-xs text-slate-400">마리</span></p>
            <p className="text-xs text-slate-400">폐사</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-teal-400 mb-1">
              <RefreshCw className="w-3.5 h-3.5" />
            </div>
            <p className="text-lg font-bold text-white">{entry.water_exchange_rate}<span className="text-xs text-slate-400">%</span></p>
            <p className="text-xs text-slate-400">환수율</p>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-purple-400 mb-1">
              <FlaskConical className="w-3.5 h-3.5" />
            </div>
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

const PAGE_SIZE = 20

export default function JournalPage() {
  const { user } = useAuth()
  const [journals, setJournals] = useState<JournalEntry[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(defaultFormValues)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<JournalEntry | null>(null)
  const [editForm, setEditForm] = useState<Partial<typeof defaultFormValues>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  const mock = isTestAccount(user?.email)

  async function loadJournals(from: string, to: string, newOffset: number, replace: boolean) {
    try {
      const j = await getJournalEntries(undefined, PAGE_SIZE, from || undefined, to || undefined, newOffset)
      setHasMore(j.length === PAGE_SIZE)
      if (replace) {
        setJournals(j.length ? j : (newOffset === 0 && mock ? MOCK_JOURNALS : []))
      } else {
        setJournals(prev => [...prev, ...j])
      }
    } catch {
      if (newOffset === 0 && mock) setJournals(MOCK_JOURNALS)
    }
  }

  useEffect(() => {
    async function load() {
      setLoadingData(true)
      const mock = isTestAccount(user?.email)
      try {
        const [, t] = await Promise.all([loadJournals("", "", 0, true), getAllTanks()])
        setTanks(t.length ? t : (mock ? MOCK_TANKS : []))
      } catch {
        if (mock) {
          setJournals(MOCK_JOURNALS)
          setTanks(MOCK_TANKS)
        }
      } finally {
        setLoadingData(false)
      }
    }
    load()
  }, [user])

  const handleFilter = async () => {
    setLoadingData(true)
    setOffset(0)
    await loadJournals(filterFrom, filterTo, 0, true)
    setLoadingData(false)
  }

  const handleLoadMore = async () => {
    const newOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    await loadJournals(filterFrom, filterTo, newOffset, false)
    setOffset(newOffset)
    setLoadingMore(false)
  }

  const handleCsvExport = () => {
    exportToCsv(journals.map(j => ({
      날짜: j.date,
      수조: j.tank_name,
      급이량_kg: j.feeding_amount,
      사료종류: j.feed_type,
      급이횟수: j.feeding_times,
      폐사수: j.mortality_count,
      환수율: j.water_exchange_rate,
      미생물투입: j.microbial_input ? "예" : "아니오",
      미생물종류: j.microbial_type || "",
      소독: j.disinfection ? "예" : "아니오",
      메모: j.notes || "",
      작성자: j.created_by,
      작성일: j.created_at,
    })), `양식일지_${new Date().toISOString().split("T")[0]}`)
  }

  const update = (field: string, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const handleSave = async () => {
    setSaveError(null)

    // Validate WQ fields if any are filled in
    const wqFields: WqField[] = ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"]
    for (const field of wqFields) {
      const raw = form[field as keyof typeof form] as string
      if (raw === "" || raw === undefined) continue
      const val = parseFloat(raw)
      if (!Number.isFinite(val)) {
        setSaveError(`${WQ_BOUNDS[field].label}: 유효한 숫자를 입력해주세요.`)
        return
      }
      if (val < WQ_BOUNDS[field].min || val > WQ_BOUNDS[field].max) {
        setSaveError(`${WQ_BOUNDS[field].label}: ${WQ_BOUNDS[field].min}~${WQ_BOUNDS[field].max}${WQ_BOUNDS[field].unit} 범위를 벗어났습니다.`)
        return
      }
    }

    setSaving(true)
    try {
      const entry = await createJournalEntry({
        tank_id: form.tank_id,
        date: form.date,
        feeding_amount: parseFloat(form.feeding_amount) || 0,
        feed_type: form.feed_type,
        feeding_times: parseInt(form.feeding_times) || 0,
        mortality_count: parseInt(form.mortality_count) || 0,
        water_exchange_rate: parseInt(form.water_exchange_rate) || 0,
        microbial_input: form.microbial_input,
        microbial_type: form.microbial_input ? form.microbial_type : null,
        microbial_amount: form.microbial_input ? parseFloat(form.microbial_amount) || null : null,
        disinfection: form.disinfection,
        disinfection_type: form.disinfection ? form.disinfection_type : null,
        check_aeration: form.check_aeration,
        check_filtration: form.check_filtration,
        check_circulation: form.check_circulation,
        check_feeding_check: form.check_feeding_check,
        notes: form.notes || null,
      })
      setJournals(prev => [entry, ...prev])

      // 수질 데이터가 입력된 경우 water_quality_readings에도 저장
      const hasWq = form.temperature || form.ph || form.do_level || form.salinity ||
        form.ammonia || form.nitrite || form.nitrate || form.alkalinity || form.turbidity
      if (hasWq) {
        try {
          await insertWaterQuality(form.tank_id, {
            temperature: parseFloat(form.temperature) || 0,
            ph: parseFloat(form.ph) || 0,
            do_level: parseFloat(form.do_level) || 0,
            salinity: parseFloat(form.salinity) || 0,
            ammonia: parseFloat(form.ammonia) || 0,
            nitrite: parseFloat(form.nitrite) || 0,
            nitrate: parseFloat(form.nitrate) || 0,
            alkalinity: parseFloat(form.alkalinity) || 0,
            turbidity: parseFloat(form.turbidity) || 0,
            recorded_at: new Date(`${form.date}T12:00:00`).toISOString(),
          })
        } catch {
          // 수질 저장 실패해도 일지는 저장됨
        }
      }
    } catch {
      // fallback: 로컬 상태에만 추가
      const selectedTank = tanks.find(t => t.id === form.tank_id)
      setJournals(prev => [{
        id: "local-" + Date.now(),
        tank_id: form.tank_id,
        tank_name: selectedTank?.name || "미선택",
        date: form.date,
        feeding_amount: parseFloat(form.feeding_amount) || 0,
        feed_type: form.feed_type,
        feeding_times: parseInt(form.feeding_times) || 0,
        mortality_count: parseInt(form.mortality_count) || 0,
        water_exchange_rate: parseInt(form.water_exchange_rate) || 0,
        microbial_input: form.microbial_input,
        microbial_type: form.microbial_input ? form.microbial_type : undefined,
        microbial_amount: form.microbial_input ? parseFloat(form.microbial_amount) || null : null,
        disinfection: form.disinfection,
        disinfection_type: form.disinfection ? form.disinfection_type : null,
        check_aeration: form.check_aeration,
        check_filtration: form.check_filtration,
        check_circulation: form.check_circulation,
        check_feeding_check: form.check_feeding_check,
        notes: form.notes,
        created_by: "",
        created_at: new Date().toISOString(),
      }, ...prev])
    } finally {
      setSaving(false)
      setSaved(true)
      setTimeout(() => { setSaved(false); setDialogOpen(false); setForm(defaultFormValues); setSaveError(null) }, 1200)
    }
  }

  const handleEdit = (entry: JournalEntry) => {
    setEditTarget(entry)
    setEditForm({
      feeding_amount: String(entry.feeding_amount),
      feed_type: entry.feed_type,
      feeding_times: String(entry.feeding_times),
      mortality_count: String(entry.mortality_count),
      water_exchange_rate: String(entry.water_exchange_rate),
      disinfection: entry.disinfection,
      disinfection_type: entry.disinfection_type || "",
      microbial_input: entry.microbial_input,
      microbial_type: entry.microbial_type || "EM균",
      microbial_amount: entry.microbial_amount != null ? String(entry.microbial_amount) : "",
      check_aeration: entry.check_aeration,
      check_filtration: entry.check_filtration,
      check_circulation: entry.check_circulation,
      check_feeding_check: entry.check_feeding_check,
      notes: entry.notes || "",
    })
  }

  const handleEditSave = async () => {
    if (!editTarget) return
    setEditSaving(true)
    try {
      const updated = await updateJournalEntry(editTarget.id, {
        feeding_amount: parseFloat(editForm.feeding_amount || "0") || 0,
        feed_type: editForm.feed_type || editTarget.feed_type,
        feeding_times: parseInt(editForm.feeding_times || "0") || 0,
        mortality_count: parseInt(editForm.mortality_count || "0") || 0,
        water_exchange_rate: parseInt(editForm.water_exchange_rate || "0") || 0,
        disinfection: editForm.disinfection ?? editTarget.disinfection,
        disinfection_type: editForm.disinfection ? (editForm.disinfection_type || null) : null,
        microbial_input: editForm.microbial_input ?? editTarget.microbial_input,
        microbial_type: editForm.microbial_input ? (editForm.microbial_type || null) : null,
        microbial_amount: editForm.microbial_input ? (parseFloat(editForm.microbial_amount || "0") || null) : null,
        check_aeration: editForm.check_aeration ?? editTarget.check_aeration,
        check_filtration: editForm.check_filtration ?? editTarget.check_filtration,
        check_circulation: editForm.check_circulation ?? editTarget.check_circulation,
        check_feeding_check: editForm.check_feeding_check ?? editTarget.check_feeding_check,
        notes: editForm.notes || null,
      })
      setJournals(prev => prev.map(j => j.id === editTarget.id ? updated : j))
      setEditTarget(null)
    } catch {
      setJournals(prev => prev.map(j => j.id === editTarget.id ? {
        ...j,
        feeding_amount: parseFloat(editForm.feeding_amount || "0") || 0,
        mortality_count: parseInt(editForm.mortality_count || "0") || 0,
        notes: editForm.notes || undefined,
      } : j))
      setEditTarget(null)
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteJournalEntry(deleteTarget.id)
    } catch { /* remove locally even on error */ }
    setJournals(prev => prev.filter(j => j.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">양식 일지</h2>
          <p className="text-sm text-slate-400 mt-0.5">수질 측정, 급이, 폐사, 작업 내역을 기록합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {journals.length > 0 && (
            <Button variant="outline" onClick={handleCsvExport} className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5">
              <Download className="w-4 h-4 mr-1" />CSV
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)} className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white">
            <Plus className="w-4 h-4" />일지 작성
          </Button>
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
            className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ocean-400"
          />
          <span className="text-slate-500 text-sm">~</span>
          <input
            type="date"
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            className="bg-slate-700 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ocean-400"
          />
        </div>
        <Button size="sm" onClick={handleFilter} className="bg-ocean-500/20 hover:bg-ocean-500/30 text-ocean-300 border border-ocean-500/30">
          조회
        </Button>
        {(filterFrom || filterTo) && (
          <button
            onClick={() => { setFilterFrom(""); setFilterTo(""); setOffset(0); loadJournals("", "", 0, true) }}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            초기화
          </button>
        )}
      </div>

      {/* Entries */}
      {loadingData ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {journals.length === 0 ? (
              <p className="text-slate-400 text-sm col-span-2 text-center py-12">일지가 없습니다. 첫 일지를 작성해보세요.</p>
            ) : journals.map(entry => (
              <JournalCard key={entry.id} entry={entry} onEdit={handleEdit} onDelete={setDeleteTarget} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />불러오는 중...</span>
                ) : (
                  <span className="flex items-center gap-2"><ChevronDown className="w-4 h-4" />더 보기</span>
                )}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Edit Journal Dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => !open && setEditTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-4 h-4 text-ocean-400" />일지 편집
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5 text-ocean-400" />급이량 (kg)</Label>
                <Input type="number" step="0.1" value={editForm.feeding_amount || ""} onChange={e => setEditForm(p => ({ ...p, feeding_amount: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">사료 종류</Label>
                <Select value={editForm.feed_type || ""} onValueChange={v => setEditForm(p => ({ ...p, feed_type: v }))}>
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
                <Input type="number" value={editForm.feeding_times || ""} onChange={e => setEditForm(p => ({ ...p, feeding_times: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><Skull className="w-3.5 h-3.5 text-amber-400" />폐사 (마리)</Label>
                <Input type="number" value={editForm.mortality_count || ""} onChange={e => setEditForm(p => ({ ...p, mortality_count: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5 text-teal-400" />환수율 (%)</Label>
                <Input type="number" value={editForm.water_exchange_rate || ""} onChange={e => setEditForm(p => ({ ...p, water_exchange_rate: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">메모</Label>
              <Textarea value={editForm.notes || ""} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} className="bg-slate-800 border-white/10 text-white resize-none" rows={3} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-white">취소</Button>
            <Button onClick={handleEditSave} disabled={editSaving} className="bg-gradient-to-r from-ocean-500 to-teal-500 text-white min-w-[80px]">
              {editSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />일지 삭제
            </DialogTitle>
          </DialogHeader>
          <p className="text-slate-300 text-sm mt-2">
            <span className="font-semibold text-white">{deleteTarget?.tank_name}</span> ({deleteTarget && formatDate(deleteTarget.date)}) 일지를 삭제합니다. 이 작업은 되돌릴 수 없습니다.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="text-slate-400 hover:text-white">취소</Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">
              {deleting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Journal Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-ocean-400" />양식 일지 작성
            </DialogTitle>
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
                  <Label className="text-slate-300">수조 선택 *</Label>
                  <Select value={form.tank_id} onValueChange={v => update("tank_id", v)}>
                    <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                      <SelectValue placeholder="수조를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10">
                      {tanks.map(t => (
                        <SelectItem key={t.id} value={t.id} className="text-white hover:bg-white/5">{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">날짜 *</Label>
                  <Input type="date" value={form.date} onChange={e => update("date", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5 text-ocean-400" />급이량 (kg)</Label>
                  <Input type="number" step="0.1" placeholder="0.0" value={form.feeding_amount} onChange={e => update("feeding_amount", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">사료 종류</Label>
                  <Select value={form.feed_type} onValueChange={v => update("feed_type", v)}>
                    <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10">
                      {FEED_TYPES.map(f => <SelectItem key={f} value={f} className="text-white hover:bg-white/5">{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">급이 횟수 (회/일)</Label>
                  <Input type="number" placeholder="4" value={form.feeding_times} onChange={e => update("feeding_times", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 flex items-center gap-1"><Skull className="w-3.5 h-3.5 text-amber-400" />폐사 개수 (마리)</Label>
                  <Input type="number" placeholder="0" value={form.mortality_count} onChange={e => update("mortality_count", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5 text-teal-400" />환수율 (%)</Label>
                  <Input type="number" placeholder="0" value={form.water_exchange_rate} onChange={e => update("water_exchange_rate", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-1"><StickyNote className="w-3.5 h-3.5 text-yellow-400" />메모 / 특이사항</Label>
                <Textarea placeholder="오늘 특이사항을 기록하세요..." value={form.notes} onChange={e => update("notes", e.target.value)} className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 resize-none" rows={3} />
              </div>
            </TabsContent>

            <TabsContent value="water" className="space-y-4 mt-4">
              <p className="text-xs text-slate-400 bg-ocean-500/10 border border-ocean-500/20 rounded-lg px-3 py-2">
                수질 측정값을 직접 입력하세요. 센서 연동 시 자동으로 불러옵니다.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { key: "temperature", label: "수온 (°C)", icon: <Thermometer className="w-3.5 h-3.5 text-red-400" />, placeholder: "28.0" },
                  { key: "ph", label: "pH", icon: <Droplets className="w-3.5 h-3.5 text-blue-400" />, placeholder: "7.8" },
                  { key: "do_level", label: "DO (mg/L)", icon: <Wind className="w-3.5 h-3.5 text-teal-400" />, placeholder: "6.5" },
                  { key: "salinity", label: "염분 (ppt)", icon: <Waves className="w-3.5 h-3.5 text-ocean-400" />, placeholder: "20" },
                  { key: "ammonia", label: "암모니아 (mg/L)", icon: <FlaskConical className="w-3.5 h-3.5 text-amber-400" />, placeholder: "0.1" },
                  { key: "nitrite", label: "아질산염 (mg/L)", icon: <FlaskConical className="w-3.5 h-3.5 text-orange-400" />, placeholder: "0.05" },
                  { key: "nitrate", label: "질산염 (mg/L)", icon: <FlaskConical className="w-3.5 h-3.5 text-yellow-400" />, placeholder: "5.0" },
                  { key: "alkalinity", label: "알칼리도 (mg/L)", icon: <FlaskConical className="w-3.5 h-3.5 text-purple-400" />, placeholder: "120" },
                  { key: "turbidity", label: "탁도 (NTU)", icon: <Droplets className="w-3.5 h-3.5 text-gray-400" />, placeholder: "5" },
                ].map(f => (
                  <div key={f.key} className="space-y-2">
                    <Label className="text-slate-300 flex items-center gap-1">{f.icon}{f.label}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={f.placeholder}
                      value={form[f.key as keyof typeof form] as string}
                      onChange={e => update(f.key, e.target.value)}
                      className="bg-slate-800 border-white/10 text-white"
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="ops" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div>
                    <p className="text-sm text-white font-medium">소독 실시</p>
                    <p className="text-xs text-slate-400">수조 소독 여부</p>
                  </div>
                  <Switch checked={form.disinfection} onCheckedChange={v => update("disinfection", v)} />
                </div>
                {form.disinfection && (
                  <div className="space-y-2">
                    <Label className="text-slate-300">소독 방법/약품</Label>
                    <Input placeholder="소독 방법을 입력하세요" value={form.disinfection_type} onChange={e => update("disinfection_type", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                  </div>
                )}
                <div className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div>
                    <p className="text-sm text-white font-medium">미생물제 투입</p>
                    <p className="text-xs text-slate-400">유익균 투입 여부</p>
                  </div>
                  <Switch checked={form.microbial_input} onCheckedChange={v => update("microbial_input", v)} />
                </div>
                {form.microbial_input && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-slate-300">미생물 종류</Label>
                      <Select value={form.microbial_type} onValueChange={v => update("microbial_type", v)}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10">
                          {MICROBIAL_TYPES.map(m => <SelectItem key={m} value={m} className="text-white hover:bg-white/5">{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">투입량 (mL/ton)</Label>
                      <Input type="number" placeholder="500" value={form.microbial_amount} onChange={e => update("microbial_amount", e.target.value)} className="bg-slate-800 border-white/10 text-white" />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="checklist" className="space-y-3 mt-4">
              <p className="text-xs text-slate-400">일일 점검 항목을 확인하세요</p>
              {[
                { key: "check_aeration", label: "폭기 시스템 점검", desc: "에어레이터 가동 상태 확인" },
                { key: "check_filtration", label: "여과 시스템 점검", desc: "필터 청결 및 가동 상태 확인" },
                { key: "check_circulation", label: "순환 펌프 점검", desc: "순환 펌프 가동 상태 및 유량 확인" },
                { key: "check_feeding_check", label: "섭이 반응 확인", desc: "새우 섭이 반응 및 활동성 확인" },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between p-4 bg-slate-800/60 rounded-xl border border-white/5">
                  <div>
                    <p className="text-sm text-white font-medium">{item.label}</p>
                    <p className="text-xs text-slate-400">{item.desc}</p>
                  </div>
                  <Switch
                    checked={form[item.key as keyof typeof form] as boolean}
                    onCheckedChange={v => update(item.key, v)}
                  />
                </div>
              ))}
            </TabsContent>
          </Tabs>

          {saveError && (
            <p className="text-sm text-red-400 mt-2 px-1">{saveError}</p>
          )}
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-white">
              취소
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || saved || !form.tank_id}
              className="bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white min-w-[100px]"
            >
              {saved ? (
                <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />저장완료</span>
              ) : saving ? (
                <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />저장중...</span>
              ) : "일지 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
