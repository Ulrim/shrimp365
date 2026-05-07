"use client"

import { useState, useEffect, useCallback } from "react"
import { MOCK_FARMS, MOCK_TANKS, MOCK_SENSOR_DEVICES, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getFarms, getTanksByFarm, createFarm, createTank, updateFarm, deleteFarm, updateTank, deleteTank, getSensorDevices, createSensorDevice, deleteSensorDevice, toggleSensorDevice } from "@/lib/db"
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
  Calendar,
  ShoppingCart,
  Wifi,
  WifiOff,
  Cpu,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { SensorDevice } from "@/types"

function computeCycleDay(stockingDate: string | null | undefined): number {
  if (!stockingDate) return 0
  const ms = Date.now() - new Date(stockingDate).getTime()
  return Math.max(1, Math.floor(ms / 86_400_000) + 1)
}
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
  const [form, setForm] = useState({ name: "", volume: "", density: "", stocking_date: "", harvest_date: "" })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const volume = parseFloat(form.volume)
      const density = parseFloat(form.density)
      const cycleDay = form.stocking_date ? computeCycleDay(form.stocking_date) : 0
      await createTank({
        farm_id: farm.id,
        name: form.name,
        volume,
        stocking_density: density,
        shrimp_count: Math.round(volume * density),
        cycle_day: cycleDay,
        stocking_date: form.stocking_date || null,
        harvest_date: form.harvest_date || null,
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
      setForm({ name: "", volume: "", density: "", stocking_date: "", harvest_date: "" })
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tank-stocking" className="text-slate-300 text-sm">입식일</Label>
                <Input
                  id="tank-stocking"
                  type="date"
                  className="bg-slate-800 border-white/10 text-white focus-visible:ring-ocean-500/50"
                  value={form.stocking_date}
                  onChange={e => setForm(f => ({ ...f, stocking_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tank-harvest" className="text-slate-300 text-sm">예정 출하일</Label>
                <Input
                  id="tank-harvest"
                  type="date"
                  className="bg-slate-800 border-white/10 text-white focus-visible:ring-ocean-500/50"
                  value={form.harvest_date}
                  onChange={e => setForm(f => ({ ...f, harvest_date: e.target.value }))}
                />
              </div>
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

// ─── Edit Farm Dialog ────────────────────────────────────────────────────────

function EditFarmDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: farm.name, location: farm.location, area: String(farm.area) })

  useEffect(() => {
    if (open) setForm({ name: farm.name, location: farm.location, area: String(farm.area) })
  }, [open, farm])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateFarm(farm.id, { name: form.name, location: form.location, area: parseFloat(form.area) || 0 })
      setOpen(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-white/8 text-slate-400 hover:text-white transition-colors" title="편집">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-ocean-400" /> 양식장 편집
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-slate-300">양식장 이름 *</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required className="bg-slate-800 border-white/10 text-white" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">위치</Label>
            <Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">면적 (m²)</Label>
            <Input type="number" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="border-white/10 text-slate-300">취소</Button>
            <Button type="submit" disabled={saving} className="bg-ocean-500 hover:bg-ocean-600 text-white">
              {saving ? "저장중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete Farm Dialog ───────────────────────────────────────────────────────

function DeleteFarmDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteFarm(farm.id)
      setOpen(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition-colors" title="삭제">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400" /> 양식장 삭제
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            <strong className="text-white">{farm.name}</strong>을 삭제하면 해당 양식장의 모든 수조 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-white/10 text-slate-300">취소</Button>
          <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
            {deleting ? "삭제중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Tank Dialog ─────────────────────────────────────────────────────────

function EditTankDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: tank.name,
    volume: String(tank.volume),
    density: String(tank.stocking_density),
    stocking_date: tank.stocking_date ?? "",
    harvest_date: tank.harvest_date ?? "",
    status: tank.status,
  })

  useEffect(() => {
    if (open) setForm({
      name: tank.name,
      volume: String(tank.volume),
      density: String(tank.stocking_density),
      stocking_date: tank.stocking_date ?? "",
      harvest_date: tank.harvest_date ?? "",
      status: tank.status,
    })
  }, [open, tank])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const volume = parseFloat(form.volume) || 0
      const density = parseFloat(form.density) || 0
      const cycleDay = form.stocking_date ? computeCycleDay(form.stocking_date) : tank.cycle_day
      await updateTank(tank.id, {
        name: form.name,
        volume,
        stocking_density: density,
        shrimp_count: Math.round(volume * density),
        cycle_day: cycleDay,
        stocking_date: form.stocking_date || null,
        harvest_date: form.harvest_date || null,
        status: form.status as Tank["status"],
      })
      setOpen(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }

  const STATUS_OPTIONS: { value: Tank["status"]; label: string; color: string }[] = [
    { value: "active",   label: "정상",  color: "text-emerald-400" },
    { value: "warning",  label: "주의",  color: "text-amber-400" },
    { value: "danger",   label: "위험",  color: "text-red-400" },
    { value: "inactive", label: "비가동", color: "text-slate-400" },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-white/8 text-slate-400 hover:text-white transition-colors" title="편집">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-teal-400" /> 수조 편집
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-slate-300">수조 이름 *</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required className="bg-slate-800 border-white/10 text-white" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">용량 (m³)</Label>
              <Input type="number" value={form.volume} onChange={e => setForm(p => ({ ...p, volume: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">재식 밀도 (마리/m³)</Label>
              <Input type="number" value={form.density} onChange={e => setForm(p => ({ ...p, density: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">입식일</Label>
              <Input type="date" value={form.stocking_date} onChange={e => setForm(p => ({ ...p, stocking_date: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">예정 출하일</Label>
              <Input type="date" value={form.harvest_date} onChange={e => setForm(p => ({ ...p, harvest_date: e.target.value }))} className="bg-slate-800 border-white/10 text-white" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">상태 (수동 설정)</Label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, status: opt.value }))}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    form.status === opt.value
                      ? `${opt.color} border-current bg-current/10`
                      : "text-slate-500 border-white/10 hover:border-white/20"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600">수질 데이터 저장 시 자동 갱신됩니다</p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="border-white/10 text-slate-300">취소</Button>
            <Button type="submit" disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white">
              {saving ? "저장중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete Tank Dialog ───────────────────────────────────────────────────────

function DeleteTankDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteTank(tank.id)
      setOpen(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition-colors" title="삭제">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400" /> 수조 삭제
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            <strong className="text-white">{tank.name}</strong>을 삭제하면 해당 수조의 모든 데이터(수질, 일지, 진단)도 함께 삭제됩니다.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-white/10 text-slate-300">취소</Button>
          <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
            {deleting ? "삭제중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register Device Dialog ──────────────────────────────────────────────────

const DEVICE_TYPE_LABELS: Record<SensorDevice["device_type"], string> = {
  multi:       "다항목 센서 (수온·pH·DO·염도·암모니아 등)",
  temperature: "수온 전용",
  ph:          "pH 전용",
  do:          "용존산소(DO) 전용",
}

function RegisterDeviceDialog({ tank, onSuccess }: { tank: import("@/types").Tank; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"form" | "done">("form")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<"key" | "url" | null>(null)
  const [createdDevice, setCreatedDevice] = useState<SensorDevice | null>(null)
  const [form, setForm] = useState({ name: "", device_type: "multi" as SensorDevice["device_type"] })

  const endpointUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/sensors/data`
    : "/api/sensors/data"

  async function handleCopy(text: string, type: "key" | "url") {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const device = await createSensorDevice({
        tank_id: tank.id,
        name: form.name,
        device_type: form.device_type,
      })
      setCreatedDevice(device)
      setStep("done")
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setOpen(false)
    setTimeout(() => {
      setStep("form")
      setError(null)
      setCreatedDevice(null)
      setForm({ name: "", device_type: "multi" })
    }, 200)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); else setOpen(true) }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs border-ocean-500/30 text-ocean-300 hover:bg-ocean-500/10 gap-1.5">
          <Plus className="w-3 h-3" /> 기기 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Cpu className="w-5 h-5 text-ocean-400" /> 센서 기기 등록
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {tank.name}에 연동할 수질 측정 기기를 등록합니다.
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="dev-name" className="text-slate-300 text-sm">기기 이름 *</Label>
              <Input
                id="dev-name"
                placeholder="예: A-1조 멀티센서"
                className="bg-slate-800 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-ocean-500/50"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-sm">기기 유형 *</Label>
              <div className="grid grid-cols-1 gap-2">
                {(Object.entries(DEVICE_TYPE_LABELS) as [SensorDevice["device_type"], string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, device_type: type }))}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      form.device_type === type
                        ? "border-ocean-500/50 bg-ocean-500/10 text-white"
                        : "border-white/10 bg-slate-800/50 text-slate-300 hover:border-white/20"
                    }`}
                  >
                    <span className="font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} className="border-white/10 text-slate-300">취소</Button>
              <Button type="submit" disabled={saving || !form.name.trim()} className="bg-ocean-500 hover:bg-ocean-600 text-white">
                {saving ? "등록중..." : "등록하기"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-white font-semibold">기기 등록 완료</p>
              <p className="text-slate-400 text-xs">아래 정보를 기기에 설정하세요. API 키는 다시 확인할 수 없습니다.</p>
            </div>

            {/* Endpoint URL */}
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400 font-medium">API 엔드포인트</p>
              <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2.5 border border-white/10">
                <code className="text-xs text-ocean-300 flex-1 break-all">{endpointUrl}</code>
                <button onClick={() => handleCopy(endpointUrl, "url")} className="text-slate-500 hover:text-white shrink-0">
                  {copied === "url" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400 font-medium">X-Device-Key <span className="text-amber-400">(1회만 표시)</span></p>
              <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2.5 border border-amber-500/30">
                <code className="text-xs text-amber-300 flex-1 break-all">{createdDevice?.api_key ?? ""}</code>
                <button onClick={() => handleCopy(createdDevice?.api_key ?? "", "key")} className="text-slate-500 hover:text-white shrink-0">
                  {copied === "key" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* ESP32 snippet */}
            <details className="group">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300 list-none flex items-center gap-1">
                <ChevronDown className="w-3.5 h-3.5 group-open:hidden" />
                <ChevronUp className="w-3.5 h-3.5 hidden group-open:block" />
                ESP32 예제 코드 보기
              </summary>
              <pre className="mt-2 text-[10px] text-slate-300 bg-slate-950 rounded-lg p-3 overflow-x-auto leading-relaxed border border-white/5">{`#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ENDPOINT = "${endpointUrl}";
const char* DEVICE_KEY = "${createdDevice?.api_key ?? "<YOUR_KEY>"}";

void sendReading(float temp, float ph, float doLevel) {
  HTTPClient http;
  http.begin(ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);

  StaticJsonDocument<256> doc;
  doc["temperature"] = temp;
  doc["ph"] = ph;
  doc["do_level"] = doLevel;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}`}</pre>
            </details>

            <DialogFooter>
              <Button onClick={handleClose} className="bg-ocean-500 hover:bg-ocean-600 text-white w-full">닫기</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Device Section ───────────────────────────────────────────────────────────

function DeviceSection({ tank }: { tank: import("@/types").Tank }) {
  const { user } = useAuth()
  const [devices, setDevices] = useState<SensorDevice[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function timeSince(iso: string | null) {
    if (!iso) return "미연결"
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "방금 전"
    if (mins < 60) return `${mins}분 전`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}시간 전`
    return `${Math.floor(hrs / 24)}일 전`
  }

  async function loadDevices() {
    setLoading(true)
    try {
      const mock = isTestAccount(user?.email)
      const data = await getSensorDevices(tank.id)
      if (data.length > 0) {
        setDevices(data)
      } else if (mock) {
        setDevices(MOCK_SENSOR_DEVICES.filter(d => d.tank_id === tank.id))
      } else {
        setDevices([])
      }
    } catch {
      if (isTestAccount(user?.email)) {
        setDevices(MOCK_SENSOR_DEVICES.filter(d => d.tank_id === tank.id))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDevices()
  }, [tank.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await deleteSensorDevice(id)
      setDevices(prev => prev.filter(d => d.id !== id))
    } catch { /* ignore */ }
    setDeletingId(null)
  }

  async function handleToggle(device: SensorDevice) {
    try {
      const updated = await toggleSensorDevice(device.id, !device.active)
      setDevices(prev => prev.map(d => d.id === updated.id ? updated : d))
    } catch { /* ignore */ }
  }

  const activeCount = devices.filter(d => d.active).length

  return (
    <div className="border-t border-white/5 pt-3 mt-1">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-300 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5" />
          기기 연동
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Wifi className="w-3 h-3" /> {activeCount}대 연결 중
            </span>
          )}
          {devices.length > 0 && activeCount === 0 && (
            <span className="flex items-center gap-1 text-slate-500">
              <WifiOff className="w-3 h-3" /> 미연결
            </span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="text-xs text-slate-500 text-center py-2">불러오는 중...</p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">연결된 기기가 없습니다.</p>
          ) : (
            devices.map(device => (
              <div key={device.id} className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${device.active ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                  <div className="min-w-0">
                    <p className="text-xs text-white font-medium truncate">{device.name}</p>
                    <p className="text-[10px] text-slate-500">{timeSince(device.last_seen_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(device)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      device.active
                        ? "border-emerald-500/30 text-emerald-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                        : "border-slate-600 text-slate-500 hover:text-emerald-400 hover:border-emerald-500/30"
                    }`}
                    title={device.active ? "비활성화" : "활성화"}
                  >
                    {device.active ? "활성" : "비활성"}
                  </button>
                  <button
                    onClick={() => handleDelete(device.id)}
                    disabled={deletingId === device.id}
                    className="p-1 rounded hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors"
                    title="삭제"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
          <RegisterDeviceDialog tank={tank} onSuccess={loadDevices} />
        </div>
      )}
    </div>
  )
}

// ─── Tank Card ───────────────────────────────────────────────────────────────

function TankCard({ tank, onRefresh }: { tank: Tank; onRefresh: () => void }) {
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
          {tank.stocking_date ? `입식 ${computeCycleDay(tank.stocking_date)}일차` : `${tank.cycle_day}일차`}
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
          {tank.stocking_date && (
            <div className="bg-slate-900/60 rounded-lg p-2.5">
              <p className="text-slate-500 text-xs mb-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> 입식일
              </p>
              <p className="text-white font-bold text-sm">{formatDate(tank.stocking_date)}</p>
            </div>
          )}
          {tank.harvest_date && (
            <div className="bg-slate-900/60 rounded-lg p-2.5">
              <p className="text-slate-500 text-xs mb-0.5 flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" /> 예정 출하
              </p>
              <p className={`font-bold text-sm ${new Date(tank.harvest_date) <= new Date() ? "text-red-400" : "text-white"}`}>
                {formatDate(tank.harvest_date)}
              </p>
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between pt-1 border-t border-white/5">
          <p className="text-slate-600 text-xs">등록 {formatDate(tank.created_at)}</p>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <EditTankDialog tank={tank} onSuccess={onRefresh} />
            <DeleteTankDialog tank={tank} onSuccess={onRefresh} />
          </div>
        </div>

        {/* Device Section */}
        <DeviceSection tank={tank} />
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
  const { user } = useAuth()
  const [farms, setFarms] = useState<Farm[]>([])
  const [tanksMap, setTanksMap] = useState<Record<string, Tank[]>>({})
  const [selectedFarmId, setSelectedFarmId] = useState<string>("")
  const [loadingFarms, setLoadingFarms] = useState(true)
  const [loadingTanks, setLoadingTanks] = useState(false)

  const loadFarms = useCallback(async () => {
    const mock = isTestAccount(user?.email)
    setLoadingFarms(true)
    try {
      const data = await getFarms()
      const result = data.length > 0 ? data : (mock ? MOCK_FARMS : [])
      setFarms(result)
      if (!selectedFarmId && result.length > 0) {
        setSelectedFarmId(result[0].id)
      }
    } catch {
      if (mock) {
        setFarms(MOCK_FARMS)
        if (!selectedFarmId && MOCK_FARMS.length > 0) {
          setSelectedFarmId(MOCK_FARMS[0].id)
        }
      }
    } finally {
      setLoadingFarms(false)
    }
  }, [selectedFarmId, user?.email])

  const loadTanksForFarm = useCallback(async (farmId: string) => {
    if (!farmId) return
    const mock = isTestAccount(user?.email)
    setLoadingTanks(true)
    try {
      const data = await getTanksByFarm(farmId)
      const result = data.length > 0 ? data : (mock ? MOCK_TANKS.filter(t => t.farm_id === farmId) : [])
      setTanksMap(prev => ({ ...prev, [farmId]: result }))
    } catch {
      setTanksMap(prev => ({
        ...prev,
        [farmId]: mock ? MOCK_TANKS.filter(t => t.farm_id === farmId) : [],
      }))
    } finally {
      setLoadingTanks(false)
    }
  }, [user?.email])

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
                <div className="flex items-center justify-between">
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">양식장 정보</p>
                  <div className="flex items-center gap-0.5">
                    <EditFarmDialog farm={selectedFarm} onSuccess={handleFarmAdded} />
                    <DeleteFarmDialog farm={selectedFarm} onSuccess={() => { setSelectedFarmId(""); handleFarmAdded() }} />
                  </div>
                </div>
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
                <TankCard key={tank.id} tank={tank} onRefresh={handleTankAdded} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
