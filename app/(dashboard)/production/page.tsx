"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { isTestAccount, MOCK_PRODUCTION_CYCLES, MOCK_GROWTH_SAMPLES, MOCK_CYCLE_COSTS, MOCK_CYCLE_HARVESTS } from "@/lib/mock-data"
import {
  getProductionCycles, createProductionCycle, updateProductionCycle, deleteProductionCycle,
  getGrowthSamples, createGrowthSample, deleteGrowthSample,
  getCycleCosts, createCycleCost, deleteCycleCost,
  getCycleHarvests, createCycleHarvest, deleteCycleHarvest,
  getAllTanks,
} from "@/lib/db"
import { ProductionCycle, GrowthSample, CycleCost, CycleHarvest } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area,
} from "recharts"
import { Plus, Trash2, FlaskConical, TrendingUp, DollarSign, ChevronRight, CheckCircle2, XCircle, Clock, Fish } from "lucide-react"
import { format, differenceInDays } from "date-fns"
import { ko } from "date-fns/locale"
import type { Tank } from "@/types"
import type { Dict, Locale } from "@/lib/i18n"

// 비용 카테고리 메타(값·색상은 코드, 라벨은 i18n)
const COST_CATEGORY_META: { value: CycleCost["category"]; color: string }[] = [
  { value: "pl",          color: "bg-teal-500" },
  { value: "feed",        color: "bg-blue-500" },
  { value: "electricity", color: "bg-yellow-500" },
  { value: "labor",       color: "bg-purple-500" },
  { value: "chemicals",   color: "bg-orange-500" },
  { value: "other",       color: "bg-muted-foreground" },
]

function localeTag(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"
}
function fmt(n: number | null | undefined, locale: Locale, digits = 0): string {
  if (n == null) return "-"
  return n.toLocaleString(localeTag(locale), { maximumFractionDigits: digits })
}
function fmtKRW(n: number | null | undefined, locale: Locale, t: Dict): string {
  if (n == null) return "-"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + t.production.millionWon
  return n.toLocaleString(localeTag(locale)) + t.production.won
}

function StatusBadge({ status }: { status: ProductionCycle["status"] }) {
  const { t } = useT()
  if (status === "active")    return <Badge aria-label={t.production.statusActiveAria} className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30">{t.production.statusActive}</Badge>
  if (status === "completed") return <Badge aria-label={t.production.statusCompletedAria} className="bg-ocean-500/20 text-ocean-600 dark:text-ocean-300 border-ocean-500/30">{t.production.statusCompleted}</Badge>
  return <Badge aria-label={t.production.statusCancelledAria} className="bg-muted-foreground/20 text-muted-foreground border-border">{t.production.statusCancelled}</Badge>
}

// ─── 사이클 생성 모달 ───────────────────────────────────────────────────────
function NewCycleDialog({ tanks, open, onClose, onCreated }: {
  tanks: Tank[]; open: boolean; onClose: () => void
  onCreated: (c: ProductionCycle) => void
}) {
  const { t } = useT()
  const [form, setForm] = useState({ tank_id: "", name: "", stocking_date: "", stocking_count: "", pl_source: "", pl_stage: "", pl_species: "", initial_weight_g: "", target_weight_g: "", target_harvest_date: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.tank_id || !form.name || !form.stocking_date || !form.stocking_count) { setError(t.production.requiredFields); return }
    setLoading(true); setError("")
    try {
      const c = await createProductionCycle({
        tank_id: form.tank_id, name: form.name, stocking_date: form.stocking_date,
        stocking_count: parseInt(form.stocking_count),
        pl_source: form.pl_source || undefined, pl_stage: form.pl_stage || undefined,
        initial_weight_g: form.initial_weight_g ? parseFloat(form.initial_weight_g) : undefined,
        pl_species: form.pl_species || undefined,
        target_weight_g: form.target_weight_g ? parseFloat(form.target_weight_g) : undefined,
        target_harvest_date: form.target_harvest_date || undefined, notes: form.notes || undefined,
      })
      onCreated(c); onClose()
      setForm({ tank_id: "", name: "", stocking_date: "", stocking_count: "", pl_source: "", pl_stage: "", pl_species: "", initial_weight_g: "", target_weight_g: "", target_harvest_date: "", notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : t.production.errorOccurred) }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t.production.newCycle}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-foreground/80">{t.production.tank} *</Label>
              <select
                value={form.tank_id}
                onChange={e => setForm(p => ({ ...p, tank_id: e.target.value }))}
                className="mt-1 w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500"
              >
                <option value="">{t.production.selectTank}</option>
                {tanks.map(tk => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.cycleName} *</Label>
              <Input value={form.name} onChange={set("name")} placeholder={t.production.cycleNamePlaceholder} className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.stockingDate} *</Label>
              <Input type="date" value={form.stocking_date} onChange={set("stocking_date")} className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.stockingCount}({t.production.unitFish}) *</Label>
              <Input type="number" value={form.stocking_count} onChange={set("stocking_count")} placeholder="50000" className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.initialWeight} (g)</Label>
              <Input type="number" min="0" step="0.01" value={form.initial_weight_g} onChange={set("initial_weight_g")} placeholder={t.production.initialWeightPlaceholder} className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.plSource}</Label>
              <Input value={form.pl_source} onChange={set("pl_source")} placeholder={t.production.plSourcePlaceholder} className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div className="col-span-2">
              <Label className="text-foreground/80">{t.production.species}</Label>
              <select
                value={form.pl_species}
                onChange={e => setForm(p => ({ ...p, pl_species: e.target.value }))}
                className="mt-1 w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm focus:outline-none focus:border-ocean-500"
              >
                <option value="">{t.production.speciesNone}</option>
                {t.production.shrimpSpecies.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.targetWeight}(g)</Label>
              <Input type="number" value={form.target_weight_g} onChange={set("target_weight_g")} placeholder="20" className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div>
              <Label className="text-foreground/80">{t.production.targetHarvestDate}</Label>
              <Input type="date" value={form.target_harvest_date} onChange={set("target_harvest_date")} className="mt-1 bg-muted border-border text-foreground" />
            </div>
            <div className="col-span-2">
              <Label className="text-foreground/80">{t.common.note}</Label>
              <Textarea value={form.notes} onChange={set("notes")} className="mt-1 bg-muted border-border text-foreground resize-none" rows={2} />
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} aria-label={t.production.cancelCycleAria} className="text-muted-foreground min-h-[44px]">{t.common.cancel}</Button>
            <Button onClick={handleSubmit} disabled={loading} aria-label={t.production.saveCycleAria} className="bg-ocean-500 hover:bg-ocean-600 text-white min-h-[44px]">
              {loading ? t.production.saving : t.production.register}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 샘플링 추가 모달 ───────────────────────────────────────────────────────
function NewSampleDialog({ cycle, open, onClose, onCreated }: { cycle: ProductionCycle; open: boolean; onClose: () => void; onCreated: (s: GrowthSample) => void }) {
  const { t, locale } = useT()
  const [form, setForm] = useState({ sampled_at: new Date().toISOString().split("T")[0], sample_count: "30", total_weight_g: "", survival_rate: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))
  const abw = form.sample_count && form.total_weight_g ? (parseFloat(form.total_weight_g) / parseInt(form.sample_count)).toFixed(2) : null

  const handleSubmit = async () => {
    if (!form.sampled_at || !form.sample_count || !form.total_weight_g) { setError(t.production.requiredFields); return }
    setLoading(true); setError("")
    try {
      const s = await createGrowthSample({
        cycle_id: cycle.id, tank_id: cycle.tank_id, sampled_at: form.sampled_at,
        sample_count: parseInt(form.sample_count), total_weight_g: parseFloat(form.total_weight_g),
        survival_rate: form.survival_rate ? parseFloat(form.survival_rate) : undefined,
        notes: form.notes || undefined,
      })
      onCreated(s); onClose()
      setForm({ sampled_at: new Date().toISOString().split("T")[0], sample_count: "30", total_weight_g: "", survival_rate: "", notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : t.production.errorOccurred) }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md">
        <DialogHeader><DialogTitle>{t.production.sampleTitle}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-foreground/80">{t.production.sampleDate} *</Label><Input type="date" value={form.sampled_at} onChange={set("sampled_at")} className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.production.sampleCount}({t.production.unitFish}) *</Label><Input type="number" value={form.sample_count} onChange={set("sample_count")} className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.production.totalWeight}(g) *</Label><Input type="number" step="0.1" value={form.total_weight_g} onChange={set("total_weight_g")} placeholder="300" className="mt-1 bg-muted border-border text-foreground" /></div>
            <div>
              <Label className="text-foreground/80">ABW ({t.production.autoCalc})</Label>
              <div className="mt-1 h-9 px-3 flex items-center bg-muted rounded-md text-ocean-500 font-bold">{abw ? `${abw} g` : "-"}</div>
            </div>
            <div><Label className="text-foreground/80">{t.production.survivalRate} (%)</Label><Input type="number" step="0.1" max="100" value={form.survival_rate} onChange={set("survival_rate")} placeholder="85" className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.production.stockingCount}</Label><div className="mt-1 h-9 px-3 flex items-center bg-muted rounded-md text-muted-foreground text-sm">{fmt(cycle.stocking_count, locale)} {t.production.unitFish}</div></div>
          </div>
          <div><Label className="text-foreground/80">{t.common.note}</Label><Input value={form.notes} onChange={set("notes")} className="mt-1 bg-muted border-border text-foreground" /></div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} aria-label={t.production.cancelSampleAria} className="text-muted-foreground min-h-[44px]">{t.common.cancel}</Button>
            <Button onClick={handleSubmit} disabled={loading} aria-label={t.production.saveSampleAria} className="bg-teal-500 hover:bg-teal-600 text-white min-h-[44px]">{loading ? t.production.saving : t.common.save}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 비용 추가 모달 ─────────────────────────────────────────────────────────
function NewCostDialog({ cycleId, open, onClose, onCreated }: { cycleId: string; open: boolean; onClose: () => void; onCreated: (c: CycleCost) => void }) {
  const { t } = useT()
  const [form, setForm] = useState({ category: "feed" as CycleCost["category"], label: "", amount: "", recorded_at: new Date().toISOString().split("T")[0], notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.label || !form.amount) { setError(t.production.costRequired); return }
    setLoading(true); setError("")
    try {
      const c = await createCycleCost({ cycle_id: cycleId, category: form.category, label: form.label, amount: parseFloat(form.amount), recorded_at: form.recorded_at, notes: form.notes || undefined })
      onCreated(c); onClose()
      setForm({ category: "feed", label: "", amount: "", recorded_at: new Date().toISOString().split("T")[0], notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : t.production.errorOccurred) }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md">
        <DialogHeader><DialogTitle>{t.production.costTitle}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-foreground/80">{t.production.category}</Label>
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v as CycleCost["category"] }))}>
              <SelectTrigger className="mt-1 bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                {COST_CATEGORY_META.map(c => <SelectItem key={c.value} value={c.value}>{t.production.costCategories[c.value]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-foreground/80">{t.production.itemName} *</Label><Input value={form.label} onChange={set("label")} placeholder={t.production.itemNamePlaceholder} className="mt-1 bg-muted border-border text-foreground" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-foreground/80">{t.production.amountLabel} *</Label><Input type="number" value={form.amount} onChange={set("amount")} placeholder="1200000" className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.common.date}</Label><Input type="date" value={form.recorded_at} onChange={set("recorded_at")} className="mt-1 bg-muted border-border text-foreground" /></div>
          </div>
          <div><Label className="text-foreground/80">{t.common.note}</Label><Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="mt-1 bg-muted border-border text-foreground" /></div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} aria-label={t.production.cancelCostAria} className="text-muted-foreground min-h-[44px]">{t.common.cancel}</Button>
            <Button onClick={handleSubmit} disabled={loading} aria-label={t.production.saveCostAria} className="bg-ocean-500 hover:bg-ocean-600 text-white min-h-[44px]">{loading ? t.production.saving : t.common.save}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 수확 추가 모달 ─────────────────────────────────────────────────────────
function NewHarvestDialog({ cycleId, open, onClose, onCreated }: { cycleId: string; open: boolean; onClose: () => void; onCreated: (h: CycleHarvest) => void }) {
  const { t, locale } = useT()
  const [form, setForm] = useState({ harvested_at: new Date().toISOString().split("T")[0], weight_kg: "", count: "", price_per_kg: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))
  const revenue = form.weight_kg && form.price_per_kg ? parseFloat(form.weight_kg) * parseFloat(form.price_per_kg) : null

  const handleSubmit = async () => {
    if (!form.weight_kg || !form.price_per_kg) { setError(t.production.harvestRequired); return }
    setLoading(true); setError("")
    try {
      const h = await createCycleHarvest({ cycle_id: cycleId, harvested_at: form.harvested_at, weight_kg: parseFloat(form.weight_kg), price_per_kg: parseFloat(form.price_per_kg), count: form.count ? parseInt(form.count) : undefined, notes: form.notes || undefined })
      onCreated(h); onClose()
      setForm({ harvested_at: new Date().toISOString().split("T")[0], weight_kg: "", count: "", price_per_kg: "", notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : t.production.errorOccurred) }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md">
        <DialogHeader><DialogTitle>{t.production.harvestRecord}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-foreground/80">{t.production.harvestDate} *</Label><Input type="date" value={form.harvested_at} onChange={set("harvested_at")} className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.production.harvestWeightLabel} *</Label><Input type="number" step="0.1" value={form.weight_kg} onChange={set("weight_kg")} className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.production.unitPriceLabel} *</Label><Input type="number" value={form.price_per_kg} onChange={set("price_per_kg")} placeholder="16000" className="mt-1 bg-muted border-border text-foreground" /></div>
            <div><Label className="text-foreground/80">{t.production.harvestCount}</Label><Input type="number" value={form.count} onChange={set("count")} className="mt-1 bg-muted border-border text-foreground" /></div>
          </div>
          {revenue !== null && <div className="p-3 bg-teal-500/10 rounded-lg text-teal-500 text-sm font-medium">{t.production.expectedRevenue}: {revenue.toLocaleString(localeTag(locale))}{t.production.won}</div>}
          <div><Label className="text-foreground/80">{t.common.note}</Label><Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="mt-1 bg-muted border-border text-foreground" /></div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} aria-label={t.production.cancelHarvestAria} className="text-muted-foreground min-h-[44px]">{t.common.cancel}</Button>
            <Button onClick={handleSubmit} disabled={loading} aria-label={t.production.saveHarvestAria} className="bg-teal-500 hover:bg-teal-600 text-white min-h-[44px]">{loading ? t.production.saving : t.common.save}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 사이클 상세 패널 ───────────────────────────────────────────────────────
function CycleDetail({ cycle, isMock, onClose, onUpdate }: { cycle: ProductionCycle; isMock: boolean; onClose: () => void; onUpdate: (c: Partial<ProductionCycle>) => void }) {
  const { t, locale } = useT()
  const [samples, setSamples] = useState<GrowthSample[]>([])
  const [costs, setCosts] = useState<CycleCost[]>([])
  const [harvests, setHarvests] = useState<CycleHarvest[]>([])
  const [tab, setTab] = useState("growth")
  const [sampleDlg, setSampleDlg] = useState(false)
  const [costDlg, setCostDlg] = useState(false)
  const [harvestDlg, setHarvestDlg] = useState(false)

  useEffect(() => {
    if (isMock) {
      setSamples(MOCK_GROWTH_SAMPLES[cycle.id] || [])
      setCosts(MOCK_CYCLE_COSTS[cycle.id] || [])
      setHarvests(MOCK_CYCLE_HARVESTS[cycle.id] || [])
    } else {
      getGrowthSamples(cycle.id).then(setSamples).catch(() => {})
      getCycleCosts(cycle.id).then(setCosts).catch(() => {})
      getCycleHarvests(cycle.id).then(setHarvests).catch(() => {})
    }
  }, [cycle.id, isMock])

  // 계산 지표
  const totalCost = costs.reduce((s, c) => s + c.amount, 0)
  const totalRevenue = harvests.reduce((s, h) => s + h.revenue, 0)
  const totalHarvestKg = harvests.reduce((s, h) => s + h.weight_kg, 0)
  const totalFeedKg = costs.filter(c => c.category === "feed").reduce((s, c) => s + (c.amount / 3000), 0) // rough estimate if no exact kg
  const latestSample = samples.length > 0 ? samples[samples.length - 1] : null
  const fcr = totalHarvestKg > 0 && cycle.total_feed_kg ? (cycle.total_feed_kg / totalHarvestKg).toFixed(2) : null
  const costPerKg = totalHarvestKg > 0 ? (totalCost / totalHarvestKg).toFixed(0) : null
  const profit = totalRevenue - totalCost
  const roi = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : null

  const growthChartData = samples.map(s => ({
    date: format(new Date(s.sampled_at), "MM/dd"),
    "ABW(g)": parseFloat(s.abw_g.toFixed(2)),
    "바이오매스(kg)": s.estimated_biomass_kg ?? undefined,
    doc: differenceInDays(new Date(s.sampled_at), new Date(cycle.stocking_date)),
  }))

  const costByCategory = COST_CATEGORY_META.map(cat => ({
    ...cat,
    label: t.production.costCategories[cat.value],
    total: costs.filter(c => c.category === cat.value).reduce((s, c) => s + c.amount, 0),
  })).filter(c => c.total > 0)

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <button onClick={onClose} aria-label={t.production.closeDetailAria} className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-foreground font-bold text-lg">{cycle.tank_name} — {cycle.name}</h2>
            <StatusBadge status={cycle.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            {t.production.stockingDate}: {cycle.stocking_date} · {fmt(cycle.stocking_count, locale)}{t.production.unitFish}
            {cycle.initial_weight_g != null && ` · ${t.production.initialWeight}: ${cycle.initial_weight_g}g`}
          </p>
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-border">
        <div className="bg-muted rounded-xl p-3" aria-label={`${t.production.doc} ${cycle.doc ?? differenceInDays(new Date(), new Date(cycle.stocking_date))}${t.production.unitDays}`}>
          <p className="text-muted-foreground text-xs">{t.production.doc}(DOC)</p>
          <p className="text-foreground font-bold text-2xl leading-tight mt-1">{cycle.doc ?? differenceInDays(new Date(), new Date(cycle.stocking_date))}<span className="text-sm font-normal text-muted-foreground ml-0.5">{t.production.unitDays}</span></p>
        </div>
        <div className="bg-muted rounded-xl p-3" aria-label={`${t.production.avgWeight} ${latestSample ? latestSample.abw_g.toFixed(1) + "g" : t.common.none}`}>
          <p className="text-muted-foreground text-xs">{t.production.latestAbw} <span className="text-muted-foreground/60 font-normal">({t.production.avgWeight})</span></p>
          <p className="text-teal-600 dark:text-teal-400 font-bold text-2xl leading-tight mt-1">{latestSample ? latestSample.abw_g.toFixed(1) : "—"}<span className="text-sm font-normal text-muted-foreground ml-0.5">g</span></p>
        </div>
        <div className="bg-muted rounded-xl p-3" aria-label={`${t.production.estBiomass} ${latestSample?.estimated_biomass_kg ? fmt(latestSample.estimated_biomass_kg, locale) + "kg" : t.common.none}`}>
          <p className="text-muted-foreground text-xs">{t.production.estBiomass}</p>
          <p className="text-ocean-600 dark:text-ocean-400 font-bold text-2xl leading-tight mt-1">{latestSample?.estimated_biomass_kg ? fmt(latestSample.estimated_biomass_kg, locale) : "—"}<span className="text-sm font-normal text-muted-foreground ml-0.5">kg</span></p>
        </div>
        <div className="bg-muted rounded-xl p-3" aria-label={`${t.production.survivalRate} ${latestSample?.survival_rate != null ? latestSample.survival_rate + "%" : t.common.none}`}>
          <p className="text-muted-foreground text-xs">{t.production.survivalRate}</p>
          <p className={`font-bold text-2xl leading-tight mt-1 ${latestSample?.survival_rate != null ? (latestSample.survival_rate >= 80 ? "text-emerald-600 dark:text-emerald-400" : latestSample.survival_rate >= 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400") : "text-muted-foreground"}`}>
            {latestSample?.survival_rate != null ? latestSample.survival_rate : "—"}<span className="text-sm font-normal text-muted-foreground ml-0.5">{latestSample?.survival_rate != null ? "%" : ""}</span>
          </p>
        </div>
      </div>

      {/* 탭 */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 bg-muted border border-border grid grid-cols-3">
          <TabsTrigger value="growth" className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-teal-500/20">{t.production.tabGrowth}</TabsTrigger>
          <TabsTrigger value="cost" className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-teal-500/20">{t.production.tabCost}</TabsTrigger>
          <TabsTrigger value="finance" className="text-muted-foreground data-[state=active]:text-foreground data-[state=active]:bg-teal-500/20">{t.production.tabFinance}</TabsTrigger>
        </TabsList>

        {/* 성장 추적 탭 */}
        <TabsContent value="growth" className="flex-1 overflow-auto p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-foreground font-medium">{t.production.abwGrowthCurve}</h3>
            {!isMock && <Button size="sm" onClick={() => setSampleDlg(true)} aria-label={t.production.sampleTitle} className="bg-teal-500 hover:bg-teal-600 text-white text-xs min-h-[44px]"><Plus className="w-3 h-3 mr-1" />{t.production.sampleInput}</Button>}
          </div>
          {growthChartData.length > 0 ? (
            <div className="bg-muted rounded-xl p-3" role="img" aria-label={t.production.abwChartAria}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={growthChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--foreground))" }} />
                  <Legend wrapperStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Line type="monotone" dataKey="ABW(g)" stroke="#14b8a6" strokeWidth={2} dot={{ fill: "#14b8a6", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Fish className="w-10 h-10 opacity-30" />
              <p className="text-sm">{t.production.noSamples}</p>
              {!isMock && <Button size="sm" onClick={() => setSampleDlg(true)} className="mt-1 bg-teal-500 hover:bg-teal-600 text-white text-xs" aria-label={t.production.firstSample}><Plus className="w-3 h-3 mr-1" />{t.production.firstSample}</Button>}
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-foreground/80 text-sm font-medium">{t.production.sampleRecords}</h4>
            {samples.length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">{t.production.noRecords}</p> : (
              <div className="space-y-2">
                {[...samples].reverse().map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-muted-foreground text-sm w-12 shrink-0">{format(new Date(s.sampled_at), "MM/dd")}</span>
                      <span className="text-foreground font-medium">{s.abw_g.toFixed(2)}g</span>
                      {s.estimated_biomass_kg && <span className="text-ocean-500 text-sm">{fmt(s.estimated_biomass_kg, locale)}kg</span>}
                      {s.survival_rate != null && <span className="text-emerald-500 text-sm">{t.production.survivalRate} {s.survival_rate}%</span>}
                    </div>
                    {!isMock && <button onClick={() => deleteGrowthSample(s.id).then(() => setSamples(p => p.filter(x => x.id !== s.id)))} aria-label={`${format(new Date(s.sampled_at), "MM/dd")} ${t.production.deleteSample}`} className="text-muted-foreground hover:text-red-500 transition-colors shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* 비용 탭 */}
        <TabsContent value="cost" className="flex-1 overflow-auto p-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-foreground font-medium">{t.production.totalCost}</h3>
              <p className="text-2xl font-bold text-red-500">{fmtKRW(totalCost, locale, t)}</p>
            </div>
            {!isMock && <Button size="sm" onClick={() => setCostDlg(true)} aria-label={t.production.addCost} className="bg-ocean-500 hover:bg-ocean-600 text-white text-xs min-h-[44px]"><Plus className="w-3 h-3 mr-1" />{t.production.addCost}</Button>}
          </div>

          {costByCategory.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {costByCategory.map(c => (
                <div key={c.value} className="bg-muted rounded-lg p-2.5 text-center">
                  <div className={`w-2 h-2 rounded-full ${c.color} mx-auto mb-1`} />
                  <p className="text-muted-foreground text-xs">{c.label}</p>
                  <p className="text-foreground text-sm font-medium">{fmtKRW(c.total, locale, t)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {costs.length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">{t.production.noCostRecords}</p> : (
              [...costs].reverse().map(c => {
                const cat = COST_CATEGORY_META.find(x => x.value === c.category)
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${cat?.color ?? "bg-muted-foreground"} shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-foreground text-sm truncate">{c.label}</p>
                        <p className="text-muted-foreground text-xs">{c.recorded_at}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-red-500 font-medium text-sm">{c.amount.toLocaleString(localeTag(locale))}{t.production.won}</span>
                      {!isMock && <button onClick={() => deleteCycleCost(c.id).then(() => setCosts(p => p.filter(x => x.id !== c.id)))} aria-label={`${c.label} ${t.production.deleteCost}`} className="text-muted-foreground hover:text-red-500 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* 수익 분석 탭 */}
        <TabsContent value="finance" className="flex-1 overflow-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted rounded-xl p-3">
              <p className="text-muted-foreground text-xs">{t.production.totalRevenue}</p>
              <p className="text-teal-500 font-bold text-xl">{fmtKRW(totalRevenue, locale, t)}</p>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <p className="text-muted-foreground text-xs">{t.production.totalCostSimple}</p>
              <p className="text-red-500 font-bold text-xl">{fmtKRW(totalCost, locale, t)}</p>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <p className="text-muted-foreground text-xs">{t.production.netProfit}</p>
              <p className={`font-bold text-xl ${profit >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtKRW(profit, locale, t)}</p>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <p className="text-muted-foreground text-xs">ROI</p>
              <p className={`font-bold text-xl ${(parseFloat(roi ?? "0")) >= 0 ? "text-emerald-500" : "text-red-500"}`}>{roi ? `${roi}%` : (cycle.status === "active" ? t.production.statusActive : "-")}</p>
            </div>
            <div className="bg-muted rounded-xl p-3" aria-label={`${t.production.fcrName} FCR ${fcr ?? cycle.fcr?.toFixed(2) ?? t.common.none}`}>
              <p className="text-muted-foreground text-xs">FCR <span className="text-muted-foreground/60 font-normal">({t.production.fcrName})</span></p>
              <p className={`font-bold text-2xl leading-tight mt-1 ${(fcr || cycle.fcr) ? (parseFloat(fcr ?? cycle.fcr?.toFixed(2) ?? "99") <= 1.5 ? "text-emerald-600 dark:text-emerald-400" : parseFloat(fcr ?? cycle.fcr?.toFixed(2) ?? "99") <= 2.0 ? "text-ocean-600 dark:text-ocean-400" : "text-amber-600 dark:text-amber-400") : "text-muted-foreground"}`}>
                {fcr ?? (cycle.fcr?.toFixed(2) ?? "—")}<span className="text-xs font-normal text-muted-foreground ml-1">{(fcr || cycle.fcr) ? t.production.fcrUnit : ""}</span>
              </p>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <p className="text-muted-foreground text-xs">{t.production.costPerKgLabel}</p>
              <p className="text-foreground font-bold text-2xl leading-tight mt-1">{costPerKg ? parseInt(costPerKg).toLocaleString(localeTag(locale)) : "—"}<span className="text-sm font-normal text-muted-foreground ml-0.5">{costPerKg ? t.production.won : ""}</span></p>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-foreground/80 text-sm font-medium">{t.production.harvestRecord}</h4>
              {cycle.status === "active" && !isMock && <Button size="sm" onClick={() => setHarvestDlg(true)} aria-label={t.production.addHarvest} className="bg-teal-500 hover:bg-teal-600 text-white text-xs min-h-[44px]"><Plus className="w-3 h-3 mr-1" />{t.production.harvestRecord}</Button>}
            </div>
            {harvests.length === 0 ? <p className="text-muted-foreground text-sm text-center py-4">{t.production.noHarvestRecords}</p> : (
              <div className="space-y-2">
                {harvests.map(h => (
                  <div key={h.id} className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-foreground text-sm truncate">{h.harvested_at} · {fmt(h.weight_kg, locale, 1)}kg{h.count ? ` · ${fmt(h.count, locale)}${t.production.unitFish}` : ""}</p>
                      <p className="text-muted-foreground text-xs">{h.price_per_kg.toLocaleString(localeTag(locale))}{t.production.wonPerKg}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-teal-500 font-medium text-sm">{fmtKRW(h.revenue, locale, t)}</span>
                      {!isMock && <button onClick={() => deleteCycleHarvest(h.id).then(() => setHarvests(p => p.filter(x => x.id !== h.id)))} aria-label={`${h.harvested_at} ${t.production.deleteHarvest}`} className="text-muted-foreground hover:text-red-500 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {!isMock && (
        <>
          <NewSampleDialog cycle={cycle} open={sampleDlg} onClose={() => setSampleDlg(false)} onCreated={s => setSamples(p => [...p, s])} />
          <NewCostDialog cycleId={cycle.id} open={costDlg} onClose={() => setCostDlg(false)} onCreated={c => setCosts(p => [...p, c])} />
          <NewHarvestDialog cycleId={cycle.id} open={harvestDlg} onClose={() => setHarvestDlg(false)} onCreated={h => setHarvests(p => [...p, h])} />
        </>
      )}
    </div>
  )
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────
export default function ProductionPage() {
  const { user } = useAuth()
  const { t, locale } = useT()
  const mock = isTestAccount(user?.email)

  const [cycles, setCycles] = useState<ProductionCycle[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCycle, setSelectedCycle] = useState<ProductionCycle | null>(null)
  const [newCycleDlg, setNewCycleDlg] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all")

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (mock) {
        setCycles(MOCK_PRODUCTION_CYCLES)
        const { MOCK_TANKS } = await import("@/lib/mock-data")
        setTanks(MOCK_TANKS)
      } else {
        const [c, tk] = await Promise.all([getProductionCycles(), getAllTanks()])
        setCycles(c); setTanks(tk)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [mock])

  useEffect(() => { loadData() }, [loadData])

  const filtered = cycles.filter(c => statusFilter === "all" || c.status === statusFilter)
  const activeCycles = cycles.filter(c => c.status === "active")
  const totalBiomass = activeCycles.reduce((s, c) => s + (c.latest_biomass_kg ?? 0), 0)
  const avgSurvival = activeCycles.filter(c => c.survival_rate != null).length > 0
    ? activeCycles.filter(c => c.survival_rate != null).reduce((s, c) => s + (c.survival_rate ?? 0), 0) / activeCycles.filter(c => c.survival_rate != null).length
    : null

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex h-full gap-0 lg:gap-6">
      {/* 사이클 목록 패널 */}
      <div className={`flex flex-col flex-1 min-w-0 ${selectedCycle ? "hidden lg:flex" : "flex"}`}>
        {/* 상단 요약 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Card className="bg-muted border-border">
            <CardContent className="p-3">
              <p className="text-muted-foreground text-xs">{t.production.activeCycles}</p>
              <p className="text-foreground font-bold text-2xl">{activeCycles.length}{t.common.unit.pcs}</p>
            </CardContent>
          </Card>
          <Card className="bg-muted border-border">
            <CardContent className="p-3">
              <p className="text-muted-foreground text-xs">{t.production.totalEstBiomass}</p>
              <p className="text-ocean-500 font-bold text-2xl">{totalBiomass > 0 ? `${fmt(totalBiomass, locale)}kg` : "-"}</p>
            </CardContent>
          </Card>
          <Card className="bg-muted border-border">
            <CardContent className="p-3">
              <p className="text-muted-foreground text-xs">{t.production.avgSurvival}</p>
              <p className="text-emerald-500 font-bold text-2xl">{avgSurvival != null ? `${avgSurvival.toFixed(1)}%` : "-"}</p>
            </CardContent>
          </Card>
          <Card className="bg-muted border-border">
            <CardContent className="p-3">
              <p className="text-muted-foreground text-xs">{t.production.completedCycles}</p>
              <p className="text-foreground/80 font-bold text-2xl">{cycles.filter(c => c.status === "completed").length}{t.common.unit.pcs}</p>
            </CardContent>
          </Card>
        </div>

        {/* 필터 + 신규 버튼 */}
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex gap-1.5">
            {(["all", "active", "completed"] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} aria-label={`${s === "all" ? t.common.all : s === "active" ? t.production.statusActive : t.production.statusCompleted} ${t.common.filter}`} aria-pressed={statusFilter === s} className={`px-3 py-1.5 min-h-[44px] rounded-lg text-sm transition-colors ${statusFilter === s ? "bg-ocean-500 text-white" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
                {s === "all" ? t.common.all : s === "active" ? t.production.statusActive : t.production.statusCompleted}
              </button>
            ))}
          </div>
          {!mock && (
            <Button onClick={() => setNewCycleDlg(true)} size="sm" aria-label={t.production.newCycle} className="bg-ocean-500 hover:bg-ocean-600 text-white min-h-[44px]">
              <Plus className="w-4 h-4 mr-1" />{t.production.newCycleShort}
            </Button>
          )}
        </div>

        {/* 사이클 카드 목록 */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <FlaskConical className="w-12 h-12 mb-1 opacity-30" />
            <p className="font-medium text-foreground/60">{t.production.noCycles}</p>
            <p className="text-sm text-center max-w-xs">{t.production.noCyclesMsg}</p>
            {!mock && <Button onClick={() => setNewCycleDlg(true)} size="sm" aria-label={t.production.firstCycleAria} className="mt-2 bg-ocean-500 hover:bg-ocean-600 text-white min-h-[44px]">{t.production.firstCycleBtn}</Button>}
          </div>
        ) : (
          <div className="space-y-3 overflow-auto">
            {filtered.map(c => (
              <div key={c.id} onClick={() => setSelectedCycle(c)} className="bg-muted border border-border rounded-xl p-4 cursor-pointer hover:border-ocean-500/50 transition-all group">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground font-semibold">{c.tank_name ?? c.tank_id}</span>
                      <span className="text-muted-foreground text-sm">{c.name}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-muted-foreground text-xs mt-1">
                      {c.farm_name && `${c.farm_name} · `}{t.production.stockingDate} {c.stocking_date} · {fmt(c.stocking_count, locale)}{t.production.unitFish}
                      {c.initial_weight_g != null && ` · ${t.production.initialWeight} ${c.initial_weight_g}g`}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-ocean-500 transition-colors shrink-0 ml-2 mt-1" />
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <div className="text-center bg-muted/60 rounded-lg py-2 px-1">
                    <p className="text-muted-foreground text-xs">DOC</p>
                    <p className="text-foreground font-semibold text-sm mt-0.5">{c.doc != null ? `${c.doc}${t.production.unitDays}` : "—"}</p>
                  </div>
                  <div className="text-center bg-muted/60 rounded-lg py-2 px-1">
                    <p className="text-muted-foreground text-xs">ABW</p>
                    <p className="text-teal-600 dark:text-teal-400 font-semibold text-sm mt-0.5">{c.latest_abw_g != null ? `${c.latest_abw_g}g` : "—"}</p>
                  </div>
                  <div className="text-center bg-muted/60 rounded-lg py-2 px-1">
                    <p className="text-muted-foreground text-xs">{t.production.biomass}</p>
                    <p className="text-ocean-600 dark:text-ocean-400 font-semibold text-sm mt-0.5">{c.latest_biomass_kg != null ? `${fmt(c.latest_biomass_kg, locale)}kg` : "—"}</p>
                  </div>
                  <div className="text-center bg-muted/60 rounded-lg py-2 px-1">
                    <p className="text-muted-foreground text-xs">{c.status === "completed" ? "FCR" : t.production.survivalRate}</p>
                    <p className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm mt-0.5">
                      {c.status === "completed" ? (c.fcr ? c.fcr.toFixed(2) : "—") : (c.survival_rate != null ? `${c.survival_rate}%` : "—")}
                    </p>
                  </div>
                </div>
                {c.status === "completed" && c.profit != null && (
                  <div className={`mt-2 text-right text-sm font-medium ${c.profit >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {t.production.netProfit} {fmtKRW(c.profit, locale, t)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 상세 패널 */}
      {selectedCycle && (
        <div className="flex flex-col flex-1 lg:max-w-[520px] bg-card border border-border rounded-2xl overflow-hidden">
          <CycleDetail
            cycle={selectedCycle}
            isMock={mock}
            onClose={() => setSelectedCycle(null)}
            onUpdate={updates => setSelectedCycle(p => p ? { ...p, ...updates } : null)}
          />
        </div>
      )}

      {!mock && (
        <NewCycleDialog tanks={tanks} open={newCycleDlg} onClose={() => setNewCycleDlg(false)} onCreated={c => { setCycles(p => [c, ...p]); setNewCycleDlg(false) }} />
      )}
    </div>
  )
}
