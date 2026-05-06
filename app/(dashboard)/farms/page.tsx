"use client"

import { useState, useEffect, useCallback } from "react"
import { MOCK_FARMS, MOCK_TANKS } from "@/lib/mock-data"
import { getFarms, getTanksByFarm, createFarm, createTank } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Building2,
  Plus,
  MapPin,
  Layers,
  Fish,
  Droplets,
  Edit2,
  Trash2,
  CheckCircle,
  AlertCircle,
  XCircle,
  TrendingUp,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { Farm, Tank } from "@/types"

// ─── Status meta ────────────────────────────────────────────────────────────

const STATUS_META: Record<
  Tank["status"],
  { label: string; dot: string; text: string; bg: string; border: string; icon: React.ReactNode }
> = {
  active: {
    label: "정상",
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
  },
  warning: {
    label: "주의",
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    icon: <AlertCircle className="w-3.5 h-3.5 text-amber-400" />,
  },
  danger: {
    label: "위험",
    dot: "bg-red-400",
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    icon: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  },
  inactive: {
    label: "비가동",
    dot: "bg-slate-400",
    text: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
    icon: <CheckCircle className="w-3.5 h-3.5 text-slate-400" />,
  },
}

// ─── Add Farm Dialog ─────────────────────────────────────────────────────────

function AddFarmDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", location: "", area: "" })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createFarm({
        name: form.name,
        location: form.location,
        area: parseFloat(form.area),
      })
      setSubmitted(true)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setSubmitted(false)
      setError(null)
      setForm({ name: "", location: "", area: "" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-ocean-500 hover:bg-ocean-600 text-white gap-1.5">
          <Plus className="w-4 h-4" /> 양식장 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-ocean-400" /> 양식장 추가
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            새로운 양식장 정보를 입력하세요.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-white font-semibold text-lg">양식장이 추가되었습니다</p>
            <p className="text-slate-400 text-sm">
              <span className="text-white font-medium">{form.name || "새 양식장"}</span>이(가) 성공적으로 등록되었습니다.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="farm-name" className="text-slate-300 text-sm">양식장 이름 *</Label>
              <Input
                id="farm-name"
                placeholder="예: 제3양식장"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="farm-location" className="text-slate-300 text-sm">위치 *</Label>
              <Input
                id="farm-location"
                placeholder="예: 전남 완도군 완도읍"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="farm-area" className="text-slate-300 text-sm">면적 (m²) *</Label>
              <Input
                id="farm-area"
                type="number"
                placeholder="예: 4000"
                min={1}
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.area}
                onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
                required
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-white/10 text-slate-300 hover:bg-white/5"
                onClick={() => handleOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={saving} className="bg-ocean-500 hover:bg-ocean-600 text-white">
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    등록중...
                  </span>
                ) : "등록하기"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {submitted && (
          <DialogFooter>
            <Button
              className="bg-ocean-500 hover:bg-ocean-600 text-white w-full"
              onClick={() => handleOpenChange(false)}
            >
              닫기
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Add Tank Dialog ─────────────────────────────────────────────────────────

function AddTankDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", volume: "", density: "" })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const volume = parseFloat(form.volume)
      const density = parseFloat(form.density)
      await createTank({
        farm_id: farm.id,
        name: form.name,
        volume,
        stocking_density: density,
        shrimp_count: Math.round(volume * density),
      })
      setSubmitted(true)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setSubmitted(false)
      setError(null)
      setForm({ name: "", volume: "", density: "" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5 gap-1.5">
          <Plus className="w-4 h-4" /> 수조 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Droplets className="w-5 h-5 text-teal-400" /> 수조 추가
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {farm.name}에 새 수조를 추가합니다.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-white font-semibold text-lg">수조가 추가되었습니다</p>
            <p className="text-slate-400 text-sm">
              <span className="text-white font-medium">{form.name || "새 수조"}</span>이(가) 성공적으로 등록되었습니다.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="tank-name" className="text-slate-300 text-sm">수조 이름 *</Label>
              <Input
                id="tank-name"
                placeholder="예: E-1조"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tank-volume" className="text-slate-300 text-sm">용량 (m³) *</Label>
              <Input
                id="tank-volume"
                type="number"
                placeholder="예: 500"
                min={1}
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.volume}
                onChange={e => setForm(f => ({ ...f, volume: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tank-density" className="text-slate-300 text-sm">입식 밀도 (마리/m³) *</Label>
              <Input
                id="tank-density"
                type="number"
                placeholder="예: 120"
                min={1}
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.density}
                onChange={e => setForm(f => ({ ...f, density: e.target.value }))}
                required
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-white/10 text-slate-300 hover:bg-white/5"
                onClick={() => handleOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white">
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    등록중...
                  </span>
                ) : "등록하기"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {submitted && (
          <DialogFooter>
            <Button
              className="bg-teal-600 hover:bg-teal-700 text-white w-full"
              onClick={() => handleOpenChange(false)}
            >
              닫기
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Tank Card ───────────────────────────────────────────────────────────────

function TankCard({ tank }: { tank: Tank }) {
  const meta = STATUS_META[tank.status]
  const isPulsing = tank.status === "warning" || tank.status === "danger"

  return (
    <Card className={`bg-slate-800/50 border transition-all hover:border-white/15 hover:bg-slate-800/70 group ${meta.border}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${meta.dot} ${isPulsing ? "animate-pulse" : ""} shrink-0 mt-0.5`} />
            <h3 className="text-white font-semibold text-base leading-tight">{tank.name}</h3>
          </div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.bg} ${meta.border} ${meta.text}`}>
            {meta.label}
          </span>
        </div>

        {/* Cycle day */}
        <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${meta.bg} ${meta.text} w-fit`}>
          <TrendingUp className="w-3.5 h-3.5" />
          입식 {tank.cycle_day}일차
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-900/60 rounded-lg p-2.5">
            <p className="text-slate-500 text-xs mb-0.5 flex items-center gap-1">
              <Droplets className="w-3 h-3" /> 용량
            </p>
            <p className="text-white font-bold text-sm">{tank.volume.toLocaleString()} m³</p>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-2.5">
            <p className="text-slate-500 text-xs mb-0.5 flex items-center gap-1">
              <Layers className="w-3 h-3" /> 밀도
            </p>
            <p className="text-white font-bold text-sm">{tank.stocking_density} 마리/m³</p>
          </div>
          <div className="col-span-2 bg-slate-900/60 rounded-lg p-2.5">
            <p className="text-slate-500 text-xs mb-0.5 flex items-center gap-1">
              <Fish className="w-3 h-3" /> 새우 수
            </p>
            <p className="text-white font-bold text-sm">{tank.shrimp_count.toLocaleString()} 마리</p>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between pt-1 border-t border-white/5">
          <p className="text-slate-600 text-xs">등록 {formatDate(tank.created_at)}</p>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="p-1.5 rounded-lg hover:bg-white/8 text-slate-400 hover:text-white transition-colors">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Farm Card ───────────────────────────────────────────────────────────────

function FarmCard({
  farm,
  selected,
  onClick,
  tanks,
}: {
  farm: Farm
  selected: boolean
  onClick: () => void
  tanks: Tank[]
}) {
  const active = tanks.filter(t => t.status === "active").length
  const warning = tanks.filter(t => t.status === "warning").length
  const danger = tanks.filter(t => t.status === "danger").length
  const hasIssues = warning > 0 || danger > 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all hover:border-ocean-500/50 hover:bg-ocean-500/5 ${
        selected
          ? "bg-ocean-500/10 border-ocean-500/40 ring-1 ring-ocean-500/20"
          : "bg-slate-800/40 border-white/8 hover:bg-slate-800/60"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${selected ? "bg-ocean-500/20" : "bg-slate-700/60"}`}>
            <Building2 className={`w-4.5 h-4.5 ${selected ? "text-ocean-400" : "text-slate-400"}`} />
          </div>
          <div>
            <p className={`font-semibold text-sm leading-tight ${selected ? "text-white" : "text-slate-200"}`}>{farm.name}</p>
            <p className="text-slate-500 text-xs mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[140px]">{farm.location}</span>
            </p>
          </div>
        </div>
        {hasIssues && (
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0 mt-1" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-900/40 rounded-lg px-2.5 py-1.5">
          <p className="text-slate-500 mb-0.5">면적</p>
          <p className="text-slate-200 font-medium">{farm.area.toLocaleString()} m²</p>
        </div>
        <div className="bg-slate-900/40 rounded-lg px-2.5 py-1.5">
          <p className="text-slate-500 mb-0.5">수조</p>
          <p className="text-slate-200 font-medium">{tanks.length}개</p>
        </div>
      </div>

      {tanks.length > 0 && (
        <div className="flex items-center gap-2 mt-2.5">
          {active > 0 && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {active}
            </span>
          )}
          {warning > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {warning}
            </span>
          )}
          {danger > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              {danger}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Status Summary Bar ──────────────────────────────────────────────────────

function StatusSummary({ tanks }: { tanks: Tank[] }) {
  const counts = {
    active: tanks.filter(t => t.status === "active").length,
    warning: tanks.filter(t => t.status === "warning").length,
    danger: tanks.filter(t => t.status === "danger").length,
    inactive: tanks.filter(t => t.status === "inactive").length,
  }
  const total = tanks.length

  const items = [
    { key: "active" as const, label: "정상", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400", Icon: CheckCircle },
    { key: "warning" as const, label: "주의", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400", Icon: AlertCircle },
    { key: "danger" as const, label: "위험", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", dot: "bg-red-400", Icon: XCircle },
  ]

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-slate-500 text-xs font-medium">전체 {total}개</span>
      <div className="w-px h-4 bg-white/8" />
      {items.map(({ key, label, color, bg, dot, Icon }) => (
        <div key={key} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${bg} ${color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot} ${key !== "active" ? "animate-pulse" : ""}`} />
          {label} {counts[key]}
        </div>
      ))}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FarmsPage() {
  const [farms, setFarms] = useState<Farm[]>([])
  const [tanksMap, setTanksMap] = useState<Record<string, Tank[]>>({})
  const [selectedFarmId, setSelectedFarmId] = useState<string>("")
  const [loadingFarms, setLoadingFarms] = useState(true)
  const [loadingTanks, setLoadingTanks] = useState(false)

  const loadFarms = useCallback(async () => {
    setLoadingFarms(true)
    try {
      const data = await getFarms()
      const result = data.length > 0 ? data : MOCK_FARMS
      setFarms(result)
      if (!selectedFarmId && result.length > 0) {
        setSelectedFarmId(result[0].id)
      }
    } catch {
      setFarms(MOCK_FARMS)
      if (!selectedFarmId && MOCK_FARMS.length > 0) {
        setSelectedFarmId(MOCK_FARMS[0].id)
      }
    } finally {
      setLoadingFarms(false)
    }
  }, [selectedFarmId])

  const loadTanksForFarm = useCallback(async (farmId: string) => {
    if (!farmId) return
    setLoadingTanks(true)
    try {
      const data = await getTanksByFarm(farmId)
      const result = data.length > 0 ? data : MOCK_TANKS.filter(t => t.farm_id === farmId)
      setTanksMap(prev => ({ ...prev, [farmId]: result }))
    } catch {
      setTanksMap(prev => ({
        ...prev,
        [farmId]: MOCK_TANKS.filter(t => t.farm_id === farmId),
      }))
    } finally {
      setLoadingTanks(false)
    }
  }, [])

  useEffect(() => {
    loadFarms()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedFarmId) {
      loadTanksForFarm(selectedFarmId)
    }
  }, [selectedFarmId, loadTanksForFarm])

  const selectedFarm = farms.find(f => f.id === selectedFarmId) ?? farms[0]
  const selectedTanks = tanksMap[selectedFarmId] ?? []

  const handleFarmAdded = () => {
    loadFarms()
  }

  const handleTankAdded = () => {
    if (selectedFarmId) {
      loadTanksForFarm(selectedFarmId)
    }
  }

  if (loadingFarms) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-ocean-500/30 border-t-ocean-500 rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">양식장 데이터를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-ocean-400" />
            양식장 · 수조 관리
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            양식장과 수조 현황을 한눈에 확인하고 관리하세요.
          </p>
        </div>
        <AddFarmDialog onSuccess={handleFarmAdded} />
      </div>

      {/* Main layout: left list + right tank grid */}
      <div className="flex gap-5 items-start">
        {/* ── Left: Farm List ── */}
        <div className="w-72 shrink-0 space-y-3">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider px-1">
            양식장 ({farms.length})
          </p>
          {farms.map(farm => (
            <FarmCard
              key={farm.id}
              farm={farm}
              selected={selectedFarmId === farm.id}
              onClick={() => setSelectedFarmId(farm.id)}
              tanks={tanksMap[farm.id] ?? []}
            />
          ))}

          {/* Farm info card */}
          {selectedFarm && (
            <Card className="bg-slate-800/30 border-white/5 mt-2">
              <CardContent className="p-4 space-y-2.5">
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">양식장 정보</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">이름</span>
                    <span className="text-slate-200 font-medium">{selectedFarm.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">위치</span>
                    <span className="text-slate-200 font-medium text-right max-w-[140px]">{selectedFarm.location}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">면적</span>
                    <span className="text-slate-200 font-medium">{selectedFarm.area.toLocaleString()} m²</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">등록일</span>
                    <span className="text-slate-200 font-medium">{formatDate(selectedFarm.created_at)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right: Tank Grid ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Tank section header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-white font-semibold flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-teal-400" />
                {selectedFarm?.name} 수조
              </h2>
              {selectedTanks.length > 0 && <StatusSummary tanks={selectedTanks} />}
            </div>
            {selectedFarm && <AddTankDialog farm={selectedFarm} onSuccess={handleTankAdded} />}
          </div>

          {/* Tanks */}
          {loadingTanks ? (
            <div className="flex items-center justify-center h-40">
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
                <p className="text-slate-400 text-sm">수조 데이터를 불러오는 중...</p>
              </div>
            </div>
          ) : selectedTanks.length === 0 ? (
            <Card className="bg-slate-800/30 border-white/5 border-dashed">
              <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-700/60 flex items-center justify-center">
                  <Layers className="w-7 h-7 text-slate-500" />
                </div>
                <p className="text-slate-400 font-medium">등록된 수조가 없습니다</p>
                <p className="text-slate-600 text-sm">위의 수조 추가 버튼으로 첫 번째 수조를 등록하세요.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {selectedTanks.map(tank => (
                <TankCard key={tank.id} tank={tank} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
