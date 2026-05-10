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

const COST_CATEGORIES: { value: CycleCost["category"]; label: string; color: string }[] = [
  { value: "pl",          label: "치어(PL)",   color: "bg-teal-500" },
  { value: "feed",        label: "사료",       color: "bg-blue-500" },
  { value: "electricity", label: "전기료",     color: "bg-yellow-500" },
  { value: "labor",       label: "인건비",     color: "bg-purple-500" },
  { value: "chemicals",   label: "약품",       color: "bg-orange-500" },
  { value: "other",       label: "기타",       color: "bg-slate-500" },
]

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return "-"
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits })
}
function fmtKRW(n: number | null | undefined): string {
  if (n == null) return "-"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "백만원"
  return n.toLocaleString("ko-KR") + "원"
}

function StatusBadge({ status }: { status: ProductionCycle["status"] }) {
  if (status === "active")    return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">진행중</Badge>
  if (status === "completed") return <Badge className="bg-ocean-500/20 text-ocean-300 border-ocean-500/30">완료</Badge>
  return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">취소</Badge>
}

// ─── 사이클 생성 모달 ───────────────────────────────────────────────────────
function NewCycleDialog({ tanks, open, onClose, onCreated }: {
  tanks: Tank[]; open: boolean; onClose: () => void
  onCreated: (c: ProductionCycle) => void
}) {
  const [form, setForm] = useState({ tank_id: "", name: "", stocking_date: "", stocking_count: "", pl_source: "", pl_stage: "", target_weight_g: "", target_harvest_date: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.tank_id || !form.name || !form.stocking_date || !form.stocking_count) { setError("필수 항목을 입력해주세요."); return }
    setLoading(true); setError("")
    try {
      const c = await createProductionCycle({
        tank_id: form.tank_id, name: form.name, stocking_date: form.stocking_date,
        stocking_count: parseInt(form.stocking_count),
        pl_source: form.pl_source || undefined, pl_stage: form.pl_stage || undefined,
        target_weight_g: form.target_weight_g ? parseFloat(form.target_weight_g) : undefined,
        target_harvest_date: form.target_harvest_date || undefined, notes: form.notes || undefined,
      })
      onCreated(c); onClose()
      setForm({ tank_id: "", name: "", stocking_date: "", stocking_count: "", pl_source: "", pl_stage: "", target_weight_g: "", target_harvest_date: "", notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : "오류가 발생했습니다.") }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>새 생산 사이클 등록</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-slate-300">수조 *</Label>
              <select
                value={form.tank_id}
                onChange={e => setForm(p => ({ ...p, tank_id: e.target.value }))}
                className="mt-1 w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-ocean-500"
              >
                <option value="">수조 선택</option>
                {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-slate-300">사이클명 *</Label>
              <Input value={form.name} onChange={set("name")} placeholder="예: 2026-1차" className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">입식일 *</Label>
              <Input type="date" value={form.stocking_date} onChange={set("stocking_date")} className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">입식 수량(마리) *</Label>
              <Input type="number" value={form.stocking_count} onChange={set("stocking_count")} placeholder="50000" className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">PL 단계</Label>
              <Input value={form.pl_stage} onChange={set("pl_stage")} placeholder="PL12" className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">종묘 공급처</Label>
              <Input value={form.pl_source} onChange={set("pl_source")} placeholder="대성종묘" className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">목표 체중(g)</Label>
              <Input type="number" value={form.target_weight_g} onChange={set("target_weight_g")} placeholder="20" className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-slate-300">목표 수확일</Label>
              <Input type="date" value={form.target_harvest_date} onChange={set("target_harvest_date")} className="mt-1 bg-slate-800 border-white/10 text-white" />
            </div>
            <div className="col-span-2">
              <Label className="text-slate-300">메모</Label>
              <Textarea value={form.notes} onChange={set("notes")} className="mt-1 bg-slate-800 border-white/10 text-white resize-none" rows={2} />
            </div>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} className="text-slate-400">취소</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-ocean-500 hover:bg-ocean-600 text-white">
              {loading ? "저장 중..." : "등록"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 샘플링 추가 모달 ───────────────────────────────────────────────────────
function NewSampleDialog({ cycle, open, onClose, onCreated }: { cycle: ProductionCycle; open: boolean; onClose: () => void; onCreated: (s: GrowthSample) => void }) {
  const [form, setForm] = useState({ sampled_at: new Date().toISOString().split("T")[0], sample_count: "30", total_weight_g: "", survival_rate: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))
  const abw = form.sample_count && form.total_weight_g ? (parseFloat(form.total_weight_g) / parseInt(form.sample_count)).toFixed(2) : null

  const handleSubmit = async () => {
    if (!form.sampled_at || !form.sample_count || !form.total_weight_g) { setError("필수 항목을 입력하세요."); return }
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
    } catch (e) { setError(e instanceof Error ? e.message : "오류") }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader><DialogTitle>성장 샘플링 입력</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-slate-300">샘플링 날짜 *</Label><Input type="date" value={form.sampled_at} onChange={set("sampled_at")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">샘플 수(마리) *</Label><Input type="number" value={form.sample_count} onChange={set("sample_count")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">총 중량(g) *</Label><Input type="number" step="0.1" value={form.total_weight_g} onChange={set("total_weight_g")} placeholder="300" className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div>
              <Label className="text-slate-300">ABW (자동 계산)</Label>
              <div className="mt-1 h-9 px-3 flex items-center bg-slate-700 rounded-md text-ocean-300 font-bold">{abw ? `${abw} g` : "-"}</div>
            </div>
            <div><Label className="text-slate-300">생존율 (%)</Label><Input type="number" step="0.1" max="100" value={form.survival_rate} onChange={set("survival_rate")} placeholder="85" className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">입식 수량</Label><div className="mt-1 h-9 px-3 flex items-center bg-slate-700 rounded-md text-slate-400 text-sm">{fmt(cycle.stocking_count)} 마리</div></div>
          </div>
          <div><Label className="text-slate-300">메모</Label><Input value={form.notes} onChange={set("notes")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} className="text-slate-400">취소</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-teal-500 hover:bg-teal-600 text-white">{loading ? "저장 중..." : "저장"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 비용 추가 모달 ─────────────────────────────────────────────────────────
function NewCostDialog({ cycleId, open, onClose, onCreated }: { cycleId: string; open: boolean; onClose: () => void; onCreated: (c: CycleCost) => void }) {
  const [form, setForm] = useState({ category: "feed" as CycleCost["category"], label: "", amount: "", recorded_at: new Date().toISOString().split("T")[0], notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = async () => {
    if (!form.label || !form.amount) { setError("항목명과 금액을 입력하세요."); return }
    setLoading(true); setError("")
    try {
      const c = await createCycleCost({ cycle_id: cycleId, category: form.category, label: form.label, amount: parseFloat(form.amount), recorded_at: form.recorded_at, notes: form.notes || undefined })
      onCreated(c); onClose()
      setForm({ category: "feed", label: "", amount: "", recorded_at: new Date().toISOString().split("T")[0], notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : "오류") }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader><DialogTitle>비용 입력</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-slate-300">분류</Label>
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v as CycleCost["category"] }))}>
              <SelectTrigger className="mt-1 bg-slate-800 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-white/10 text-white">
                {COST_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-slate-300">항목명 *</Label><Input value={form.label} onChange={set("label")} placeholder="배합사료 1차" className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-slate-300">금액 (원) *</Label><Input type="number" value={form.amount} onChange={set("amount")} placeholder="1200000" className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">날짜</Label><Input type="date" value={form.recorded_at} onChange={set("recorded_at")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
          </div>
          <div><Label className="text-slate-300">메모</Label><Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} className="text-slate-400">취소</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-ocean-500 hover:bg-ocean-600 text-white">{loading ? "저장 중..." : "저장"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 수확 추가 모달 ─────────────────────────────────────────────────────────
function NewHarvestDialog({ cycleId, open, onClose, onCreated }: { cycleId: string; open: boolean; onClose: () => void; onCreated: (h: CycleHarvest) => void }) {
  const [form, setForm] = useState({ harvested_at: new Date().toISOString().split("T")[0], weight_kg: "", count: "", price_per_kg: "", notes: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))
  const revenue = form.weight_kg && form.price_per_kg ? parseFloat(form.weight_kg) * parseFloat(form.price_per_kg) : null

  const handleSubmit = async () => {
    if (!form.weight_kg || !form.price_per_kg) { setError("수확량과 단가를 입력하세요."); return }
    setLoading(true); setError("")
    try {
      const h = await createCycleHarvest({ cycle_id: cycleId, harvested_at: form.harvested_at, weight_kg: parseFloat(form.weight_kg), price_per_kg: parseFloat(form.price_per_kg), count: form.count ? parseInt(form.count) : undefined, notes: form.notes || undefined })
      onCreated(h); onClose()
      setForm({ harvested_at: new Date().toISOString().split("T")[0], weight_kg: "", count: "", price_per_kg: "", notes: "" })
    } catch (e) { setError(e instanceof Error ? e.message : "오류") }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader><DialogTitle>수확 기록</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-slate-300">수확일 *</Label><Input type="date" value={form.harvested_at} onChange={set("harvested_at")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">수확량(kg) *</Label><Input type="number" step="0.1" value={form.weight_kg} onChange={set("weight_kg")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">단가(원/kg) *</Label><Input type="number" value={form.price_per_kg} onChange={set("price_per_kg")} placeholder="16000" className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
            <div><Label className="text-slate-300">수확 마리수</Label><Input type="number" value={form.count} onChange={set("count")} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
          </div>
          {revenue !== null && <div className="p-3 bg-teal-500/10 rounded-lg text-teal-300 text-sm font-medium">예상 매출: {revenue.toLocaleString("ko-KR")}원</div>}
          <div><Label className="text-slate-300">메모</Label><Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="mt-1 bg-slate-800 border-white/10 text-white" /></div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose} className="text-slate-400">취소</Button>
            <Button onClick={handleSubmit} disabled={loading} className="bg-teal-500 hover:bg-teal-600 text-white">{loading ? "저장 중..." : "저장"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 사이클 상세 패널 ───────────────────────────────────────────────────────
function CycleDetail({ cycle, isMock, onClose, onUpdate }: { cycle: ProductionCycle; isMock: boolean; onClose: () => void; onUpdate: (c: Partial<ProductionCycle>) => void }) {
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

  const costByCategory = COST_CATEGORIES.map(cat => ({
    ...cat,
    total: costs.filter(c => c.category === cat.value).reduce((s, c) => s + c.amount, 0),
  })).filter(c => c.total > 0)

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-5 h-5 rotate-180" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-white font-bold text-lg">{cycle.tank_name} — {cycle.name}</h2>
            <StatusBadge status={cycle.status} />
          </div>
          <p className="text-slate-400 text-sm">입식일: {cycle.stocking_date} · {fmt(cycle.stocking_count)}마리</p>
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-white/10">
        <div className="bg-slate-800/50 rounded-xl p-3">
          <p className="text-slate-400 text-xs">사육 일수(DOC)</p>
          <p className="text-white font-bold text-xl">{cycle.doc ?? differenceInDays(new Date(), new Date(cycle.stocking_date))}일</p>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3">
          <p className="text-slate-400 text-xs">최신 ABW</p>
          <p className="text-teal-300 font-bold text-xl">{latestSample ? `${latestSample.abw_g.toFixed(1)}g` : "-"}</p>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3">
          <p className="text-slate-400 text-xs">추정 바이오매스</p>
          <p className="text-ocean-300 font-bold text-xl">{latestSample?.estimated_biomass_kg ? `${fmt(latestSample.estimated_biomass_kg)}kg` : "-"}</p>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3">
          <p className="text-slate-400 text-xs">생존율</p>
          <p className="text-emerald-300 font-bold text-xl">{latestSample?.survival_rate != null ? `${latestSample.survival_rate}%` : "-"}</p>
        </div>
      </div>

      {/* 탭 */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 bg-slate-800/60 border border-white/10 grid grid-cols-3">
          <TabsTrigger value="growth" className="text-slate-400 data-[state=active]:text-white data-[state=active]:bg-teal-500/20">성장 추적</TabsTrigger>
          <TabsTrigger value="cost" className="text-slate-400 data-[state=active]:text-white data-[state=active]:bg-teal-500/20">비용</TabsTrigger>
          <TabsTrigger value="finance" className="text-slate-400 data-[state=active]:text-white data-[state=active]:bg-teal-500/20">수익 분석</TabsTrigger>
        </TabsList>

        {/* 성장 추적 탭 */}
        <TabsContent value="growth" className="flex-1 overflow-auto p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-white font-medium">ABW 성장 곡선</h3>
            {!isMock && <Button size="sm" onClick={() => setSampleDlg(true)} className="bg-teal-500 hover:bg-teal-600 text-white text-xs"><Plus className="w-3 h-3 mr-1" />샘플링 입력</Button>}
          </div>
          {growthChartData.length > 0 ? (
            <div className="bg-slate-800/50 rounded-xl p-3">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={growthChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff" }} />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Line type="monotone" dataKey="ABW(g)" stroke="#14b8a6" strokeWidth={2} dot={{ fill: "#14b8a6", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="text-center text-slate-500 py-8">샘플링 데이터가 없습니다.</div>}

          <div className="space-y-2">
            <h4 className="text-slate-300 text-sm font-medium">샘플링 기록</h4>
            {samples.length === 0 ? <p className="text-slate-500 text-sm text-center py-4">기록 없음</p> : (
              <div className="space-y-2">
                {[...samples].reverse().map(s => (
                  <div key={s.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-sm w-16">{format(new Date(s.sampled_at), "MM/dd")}</span>
                      <span className="text-white font-medium">{s.abw_g.toFixed(2)}g</span>
                      {s.estimated_biomass_kg && <span className="text-ocean-300 text-sm">{fmt(s.estimated_biomass_kg)}kg</span>}
                      {s.survival_rate != null && <span className="text-emerald-300 text-sm">생존율 {s.survival_rate}%</span>}
                    </div>
                    {!isMock && <button onClick={() => deleteGrowthSample(s.id).then(() => setSamples(p => p.filter(x => x.id !== s.id)))} className="text-slate-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
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
              <h3 className="text-white font-medium">총 투입 비용</h3>
              <p className="text-2xl font-bold text-red-300">{fmtKRW(totalCost)}</p>
            </div>
            {!isMock && <Button size="sm" onClick={() => setCostDlg(true)} className="bg-ocean-500 hover:bg-ocean-600 text-white text-xs"><Plus className="w-3 h-3 mr-1" />비용 추가</Button>}
          </div>

          {costByCategory.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {costByCategory.map(c => (
                <div key={c.value} className="bg-slate-800/50 rounded-lg p-2.5 text-center">
                  <div className={`w-2 h-2 rounded-full ${c.color} mx-auto mb-1`} />
                  <p className="text-slate-400 text-xs">{c.label}</p>
                  <p className="text-white text-sm font-medium">{fmtKRW(c.total)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {costs.length === 0 ? <p className="text-slate-500 text-sm text-center py-4">비용 기록 없음</p> : (
              [...costs].reverse().map(c => {
                const cat = COST_CATEGORIES.find(x => x.value === c.category)
                return (
                  <div key={c.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${cat?.color ?? "bg-slate-500"} shrink-0`} />
                      <div>
                        <p className="text-white text-sm">{c.label}</p>
                        <p className="text-slate-400 text-xs">{c.recorded_at}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-red-300 font-medium text-sm">{c.amount.toLocaleString("ko-KR")}원</span>
                      {!isMock && <button onClick={() => deleteCycleCost(c.id).then(() => setCosts(p => p.filter(x => x.id !== c.id)))} className="text-slate-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
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
            <div className="bg-slate-800/50 rounded-xl p-3">
              <p className="text-slate-400 text-xs">총 매출</p>
              <p className="text-teal-300 font-bold text-xl">{fmtKRW(totalRevenue)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3">
              <p className="text-slate-400 text-xs">총 비용</p>
              <p className="text-red-300 font-bold text-xl">{fmtKRW(totalCost)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3">
              <p className="text-slate-400 text-xs">순이익</p>
              <p className={`font-bold text-xl ${profit >= 0 ? "text-emerald-300" : "text-red-400"}`}>{fmtKRW(profit)}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3">
              <p className="text-slate-400 text-xs">ROI</p>
              <p className={`font-bold text-xl ${(parseFloat(roi ?? "0")) >= 0 ? "text-emerald-300" : "text-red-400"}`}>{roi ? `${roi}%` : (cycle.status === "active" ? "진행중" : "-")}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3">
              <p className="text-slate-400 text-xs">FCR</p>
              <p className="text-ocean-300 font-bold text-xl">{fcr ?? (cycle.fcr?.toFixed(2) ?? "-")}</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3">
              <p className="text-slate-400 text-xs">kg당 원가</p>
              <p className="text-slate-200 font-bold text-xl">{costPerKg ? `${parseInt(costPerKg).toLocaleString("ko-KR")}원` : "-"}</p>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-slate-300 text-sm font-medium">수확 기록</h4>
              {cycle.status === "active" && !isMock && <Button size="sm" onClick={() => setHarvestDlg(true)} className="bg-teal-500 hover:bg-teal-600 text-white text-xs"><Plus className="w-3 h-3 mr-1" />수확 기록</Button>}
            </div>
            {harvests.length === 0 ? <p className="text-slate-500 text-sm text-center py-4">수확 기록 없음</p> : (
              <div className="space-y-2">
                {harvests.map(h => (
                  <div key={h.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2.5">
                    <div>
                      <p className="text-white text-sm">{h.harvested_at} · {fmt(h.weight_kg, 1)}kg{h.count ? ` · ${fmt(h.count)}마리` : ""}</p>
                      <p className="text-slate-400 text-xs">{h.price_per_kg.toLocaleString("ko-KR")}원/kg</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-teal-300 font-medium text-sm">{fmtKRW(h.revenue)}</span>
                      {!isMock && <button onClick={() => deleteCycleHarvest(h.id).then(() => setHarvests(p => p.filter(x => x.id !== h.id)))} className="text-slate-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
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
  const { t } = useT()
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
          <Card className="bg-slate-800/60 border-white/10">
            <CardContent className="p-3">
              <p className="text-slate-400 text-xs">진행중 사이클</p>
              <p className="text-white font-bold text-2xl">{activeCycles.length}개</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-white/10">
            <CardContent className="p-3">
              <p className="text-slate-400 text-xs">총 추정 바이오매스</p>
              <p className="text-ocean-300 font-bold text-2xl">{totalBiomass > 0 ? `${fmt(totalBiomass)}kg` : "-"}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-white/10">
            <CardContent className="p-3">
              <p className="text-slate-400 text-xs">평균 생존율</p>
              <p className="text-emerald-300 font-bold text-2xl">{avgSurvival != null ? `${avgSurvival.toFixed(1)}%` : "-"}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-white/10">
            <CardContent className="p-3">
              <p className="text-slate-400 text-xs">완료 사이클</p>
              <p className="text-slate-300 font-bold text-2xl">{cycles.filter(c => c.status === "completed").length}개</p>
            </CardContent>
          </Card>
        </div>

        {/* 필터 + 신규 버튼 */}
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex gap-1.5">
            {(["all", "active", "completed"] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${statusFilter === s ? "bg-ocean-500 text-white" : "text-slate-400 hover:text-white hover:bg-slate-700"}`}>
                {s === "all" ? "전체" : s === "active" ? "진행중" : "완료"}
              </button>
            ))}
          </div>
          {!mock && (
            <Button onClick={() => setNewCycleDlg(true)} size="sm" className="bg-ocean-500 hover:bg-ocean-600 text-white">
              <Plus className="w-4 h-4 mr-1" />새 사이클
            </Button>
          )}
        </div>

        {/* 사이클 카드 목록 */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <FlaskConical className="w-12 h-12 mb-3 opacity-30" />
            <p>등록된 사이클이 없습니다.</p>
            {!mock && <Button onClick={() => setNewCycleDlg(true)} size="sm" className="mt-3 bg-ocean-500 hover:bg-ocean-600 text-white">첫 사이클 등록하기</Button>}
          </div>
        ) : (
          <div className="space-y-3 overflow-auto">
            {filtered.map(c => (
              <div key={c.id} onClick={() => setSelectedCycle(c)} className="bg-slate-800/60 border border-white/10 rounded-xl p-4 cursor-pointer hover:border-ocean-500/50 transition-all group">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold">{c.tank_name ?? c.tank_id}</span>
                      <span className="text-slate-400 text-sm">{c.name}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-slate-500 text-xs mt-1">{c.farm_name && `${c.farm_name} · `}입식일 {c.stocking_date} · {fmt(c.stocking_count)}마리</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-ocean-400 transition-colors shrink-0 ml-2 mt-1" />
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <div className="text-center">
                    <p className="text-slate-500 text-xs">DOC</p>
                    <p className="text-slate-200 text-sm font-medium">{c.doc != null ? `${c.doc}일` : "-"}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-slate-500 text-xs">ABW</p>
                    <p className="text-teal-300 text-sm font-medium">{c.latest_abw_g != null ? `${c.latest_abw_g}g` : "-"}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-slate-500 text-xs">바이오매스</p>
                    <p className="text-ocean-300 text-sm font-medium">{c.latest_biomass_kg != null ? `${fmt(c.latest_biomass_kg)}kg` : "-"}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-slate-500 text-xs">{c.status === "completed" ? "FCR" : "생존율"}</p>
                    <p className="text-emerald-300 text-sm font-medium">
                      {c.status === "completed" ? (c.fcr ? c.fcr.toFixed(2) : "-") : (c.survival_rate != null ? `${c.survival_rate}%` : "-")}
                    </p>
                  </div>
                </div>
                {c.status === "completed" && c.profit != null && (
                  <div className={`mt-2 text-right text-sm font-medium ${c.profit >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                    순이익 {fmtKRW(c.profit)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 상세 패널 */}
      {selectedCycle && (
        <div className="flex flex-col flex-1 lg:max-w-[520px] bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
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
