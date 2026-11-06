"use client"

// 영농 일지 수정·삭제 다이얼로그(시안 mode-split-ui.md 5-7).
//
// 수정은 StepWizard 가 아니라 **단일 폼**(스크롤) — 필드는 일지 쓰기 폼(5-4)과 같다.
// 저장은 lib/db.ts 의 updateJournalEntry / deleteJournalEntry 만 쓴다.
// `mortality_count` 는 폼에 없고 건드리지 않는다(다른 뜻으로 재활용하지 않는다).
import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AGRI_NUTRIENT_TYPES, AGRI_INPUT_TYPES } from "@/components/agri/agri-journal-constants"
import { updateJournalEntry, deleteJournalEntry } from "@/lib/db"
import { useAgriT, useT } from "@/lib/i18n-context"
import type { JournalEntry } from "@/types"
import { journalDateLabel } from "./agri-journal-card"

interface EditForm {
  feed_type: string
  feeding_amount: string
  feeding_times: string
  water_exchange_rate: string
  disinfection: boolean
  disinfection_type: string
  microbial_input: boolean
  microbial_type: string
  microbial_amount: string
  check_circulation: boolean
  check_filtration: boolean
  check_aeration: boolean
  check_feeding_check: boolean
  notes: string
}

function formFromEntry(e: JournalEntry): EditForm {
  return {
    feed_type: e.feed_type || AGRI_NUTRIENT_TYPES[0],
    feeding_amount: String(e.feeding_amount ?? ""),
    feeding_times: String(e.feeding_times ?? ""),
    water_exchange_rate: String(e.water_exchange_rate ?? ""),
    disinfection: e.disinfection,
    disinfection_type: e.disinfection_type ?? "",
    microbial_input: e.microbial_input,
    microbial_type: e.microbial_type || AGRI_INPUT_TYPES[0],
    microbial_amount: e.microbial_amount != null ? String(e.microbial_amount) : "",
    check_circulation: e.check_circulation,
    check_filtration: e.check_filtration,
    check_aeration: e.check_aeration,
    check_feeding_check: e.check_feeding_check,
    notes: e.notes ?? "",
  }
}

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0 }
const int = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0 }

const inputCls = "bg-muted border-border focus-visible:ring-brand-a50 min-h-[44px]"

// ── 수정 ─────────────────────────────────────────────────────────────────────

interface EditDialogProps {
  entry: JournalEntry | null
  onClose: () => void
  onSaved: (updated: JournalEntry) => void
}

export function AgriJournalEditDialog({ entry, onClose, onSaved }: EditDialogProps) {
  return (
    <Dialog open={!!entry} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
        {/* key 로 일지마다 폼 상태를 새로 만든다 — effect 로 복사하지 않는다. */}
        {entry && <EditBody key={entry.id} entry={entry} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function EditBody({ entry, onClose, onSaved }: { entry: JournalEntry; onClose: () => void; onSaved: (u: JournalEntry) => void }) {
  const { journal: j } = useAgriT()
  const { t, locale } = useT()
  const [form, setForm] = useState<EditForm>(() => formFromEntry(entry))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateJournalEntry(entry.id, {
        feed_type: form.feed_type || entry.feed_type,
        feeding_amount: num(form.feeding_amount),
        feeding_times: int(form.feeding_times),
        water_exchange_rate: int(form.water_exchange_rate),
        disinfection: form.disinfection,
        disinfection_type: form.disinfection ? (form.disinfection_type.trim() || null) : null,
        microbial_input: form.microbial_input,
        microbial_type: form.microbial_input ? (form.microbial_type || null) : null,
        microbial_amount: form.microbial_input ? (num(form.microbial_amount) || null) : null,
        check_circulation: form.check_circulation,
        check_filtration: form.check_filtration,
        check_aeration: form.check_aeration,
        check_feeding_check: form.check_feeding_check,
        notes: form.notes.trim() || null,
      })
      onSaved(updated)
    } catch {
      setError(j.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const id = (k: string) => `agri-journal-edit-${k}`

  return (
    <>
      <DialogHeader>
        <DialogTitle>{j.editTitle}</DialogTitle>
        <DialogDescription className="tabular-nums">{entry.tank_name} · {journalDateLabel(entry.date, locale)}</DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* 양액 관리 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={id("feed_type")}>{j.nutrientType}</Label>
            <Select value={form.feed_type} onValueChange={v => set("feed_type", v)}>
              <SelectTrigger id={id("feed_type")} className={inputCls}><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {AGRI_NUTRIENT_TYPES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("feeding_amount")}>{j.refillAmount} <span className="text-muted-foreground font-normal">(L)</span></Label>
            <Input id={id("feeding_amount")} type="number" inputMode="decimal" min={0} step={0.1} value={form.feeding_amount}
              onChange={e => set("feeding_amount", e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("feeding_times")}>{j.refillTimes} <span className="text-muted-foreground font-normal">({t.common.unit.timesPerDay})</span></Label>
            <Input id={id("feeding_times")} type="number" inputMode="numeric" min={0} step={1} value={form.feeding_times}
              onChange={e => set("feeding_times", e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("water_exchange_rate")}>{j.exchangeRate} <span className="text-muted-foreground font-normal">(%)</span></Label>
            <Input id={id("water_exchange_rate")} type="number" inputMode="numeric" min={0} max={100} step={1} value={form.water_exchange_rate}
              onChange={e => set("water_exchange_rate", e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* 재배 작업 */}
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={id("disinfection")}>{j.pestControl}</Label>
            <Switch id={id("disinfection")} checked={form.disinfection} onCheckedChange={v => set("disinfection", v)} className="data-[state=checked]:bg-brand" />
          </div>
          {form.disinfection && (
            <div className="space-y-1.5">
              <Label htmlFor={id("disinfection_type")}>{j.pestAgent}</Label>
              <Input id={id("disinfection_type")} value={form.disinfection_type} placeholder={j.pestAgentPlaceholder}
                onChange={e => set("disinfection_type", e.target.value)} className={inputCls} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={id("microbial_input")}>{j.tileInput}</Label>
            <Switch id={id("microbial_input")} checked={form.microbial_input} onCheckedChange={v => set("microbial_input", v)} className="data-[state=checked]:bg-brand" />
          </div>
          {form.microbial_input && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={id("microbial_type")}>{j.inputType}</Label>
                <Select value={form.microbial_type} onValueChange={v => set("microbial_type", v)}>
                  <SelectTrigger id={id("microbial_type")} className={inputCls}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {AGRI_INPUT_TYPES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id("microbial_amount")}>{j.inputAmount} <span className="text-muted-foreground font-normal">(kg)</span></Label>
                <Input id={id("microbial_amount")} type="number" inputMode="decimal" min={0} step={0.1} value={form.microbial_amount}
                  onChange={e => set("microbial_amount", e.target.value)} className={inputCls} />
              </div>
            </div>
          )}
        </div>

        {/* 설비 점검 */}
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-medium mb-3">{j.checksLabel}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ["check_circulation", j.checkPump],
              ["check_filtration", j.checkFilterUv],
              ["check_aeration", j.checkChiller],
              ["check_feeding_check", j.checkGrowth],
            ] as const).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between gap-3 min-h-[44px]">
                <Label htmlFor={id(k)}>{label}</Label>
                <Switch id={id(k)} checked={form[k]} onCheckedChange={v => set(k, v)} className="data-[state=checked]:bg-brand" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id("notes")}>{j.notes}</Label>
          <Textarea id={id("notes")} value={form.notes} placeholder={j.notesPlaceholder} rows={4}
            onChange={e => set("notes", e.target.value)} className="bg-muted border-border focus-visible:ring-brand-a50" />
        </div>

        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving} className="min-h-[44px] border-border">{t.common.cancel}</Button>
        <Button onClick={save} disabled={saving} className="min-h-[44px] bg-brand hover:bg-brand-hover text-white">{t.common.save}</Button>
      </DialogFooter>
    </>
  )
}

// ── 삭제 ─────────────────────────────────────────────────────────────────────

interface DeleteDialogProps {
  entry: JournalEntry | null
  onClose: () => void
  onDeleted: (id: string) => void
}

export function AgriJournalDeleteDialog({ entry, onClose, onDeleted }: DeleteDialogProps) {
  const { journal: j } = useAgriT()
  const { t, locale } = useT()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!entry) return
    setDeleting(true)
    setError(null)
    try {
      await deleteJournalEntry(entry.id)
      onDeleted(entry.id)
    } catch {
      setError(j.deleteFailed)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{j.deleteTitle}</DialogTitle>
          <DialogDescription>
            {entry && <span className="block mb-1 text-foreground tabular-nums">{entry.tank_name} · {journalDateLabel(entry.date, locale)}</span>}
            {j.deleteConfirm}
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={deleting} className="min-h-[44px] border-border">{t.common.cancel}</Button>
          <Button variant="destructive" onClick={remove} disabled={deleting} className="min-h-[44px]">{t.common.delete}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
