"use client"

import { useState, useEffect, useCallback } from "react"
import { MOCK_FARMS, MOCK_TANKS, MOCK_SENSOR_DEVICES, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { getFarms, getTanksByFarm, createFarm, createTank, updateFarm, deleteFarm, updateTank, deleteTank, getSensorDevices, deleteSensorDevice, toggleSensorDevice, requestDeviceUpdate } from "@/lib/db"
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
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { SensorDevice } from "@/types"
import { PairDeviceDialog } from "@/components/sensors/pair-device-dialog"
import { CoordinateField } from "@/components/farms/coordinate-field"
import { FarmMap } from "@/components/farms/farm-map"
import { useT } from "@/lib/i18n-context"
import { AddressSearch } from "@/components/ui/address-search"

function computeCycleDay(stockingDate: string | null | undefined): number {
  if (!stockingDate) return 0
  const ms = Date.now() - new Date(stockingDate).getTime()
  return Math.max(1, Math.floor(ms / 86_400_000) + 1)
}
import type { Farm, Tank } from "@/types"

// ─── Status meta ────────────────────────────────────────────────────────────

function useStatusMeta() {
  const { t } = useT()
  const STATUS_META: Record<
    Tank["status"],
    { label: string; dot: string; text: string; bg: string; border: string; icon: React.ReactNode }
  > = {
    active: {
      label: t.dashboard.normal,
      dot: "bg-emerald-500",
      text: "text-emerald-500",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />,
    },
    warning: {
      label: t.dashboard.warning,
      dot: "bg-amber-500",
      text: "text-amber-500",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      icon: <AlertCircle className="w-3.5 h-3.5 text-amber-500" />,
    },
    danger: {
      label: t.dashboard.danger,
      dot: "bg-red-500",
      text: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      icon: <XCircle className="w-3.5 h-3.5 text-red-500" />,
    },
    inactive: {
      label: t.farms.tankStatusInactive,
      dot: "bg-muted-foreground",
      text: "text-muted-foreground",
      bg: "bg-muted",
      border: "border-border",
      icon: <CheckCircle className="w-3.5 h-3.5 text-muted-foreground" />,
    },
  }
  return STATUS_META
}

// ─── Add Farm Dialog ─────────────────────────────────────────────────────────

function AddFarmDialog({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", location: "", owner_name: "", area: "" })
  const [coords, setCoords] = useState<{ lat: number | null; lon: number | null }>({ lat: null, lon: null })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createFarm({
        name: form.name,
        location: form.location,
        owner_name: form.owner_name,
        area: parseFloat(form.area),
        latitude: coords.lat,
        longitude: coords.lon,
      })
      setSubmitted(true)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "저장에 실패했습니다."
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setSubmitted(false)
      setError(null)
      setForm({ name: "", location: "", owner_name: "", area: "" })
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-ocean-500 hover:bg-ocean-600 text-white gap-1.5 min-h-[44px]">
          <Plus className="w-4 h-4" /> {t.farms.addFarm}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-ocean-500" /> {t.farms.addFarm}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t.farms.subtitle}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-500" />
            </div>
            <p className="text-foreground font-semibold text-lg">{t.farms.farmCreated}</p>
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">{form.name || t.farms.addFarm}</span>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="farm-name" className="text-muted-foreground text-sm">{t.farms.farmName} *</Label>
              <Input
                id="farm-name"
                placeholder={t.farms.farmNamePlaceholder}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500/50"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="farm-location" className="text-muted-foreground text-sm">{t.farms.location} *</Label>
              <AddressSearch
                id="farm-location"
                value={form.location}
                onChange={addr => setForm(f => ({ ...f, location: addr }))}
                placeholder={t.farms.locationPlaceholder}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="farm-owner" className="text-muted-foreground text-sm">{t.farms.ownerName}</Label>
              <Input
                id="farm-owner"
                placeholder={t.farms.ownerNamePlaceholder}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500/50"
                value={form.owner_name}
                onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="farm-area" className="text-muted-foreground text-sm">{t.farms.area} ({t.farms.areaUnit})</Label>
              <Input
                id="farm-area"
                type="number"
                placeholder="예: 4000"
                min={1}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500/50"
                value={form.area}
                onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
                required
              />
            </div>
            <CoordinateField
              latitude={coords.lat}
              longitude={coords.lon}
              onChange={(lat, lon) => setCoords({ lat, lon })}
            />
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-border text-muted-foreground hover:bg-accent w-full sm:w-auto"
                onClick={() => handleOpenChange(false)}
              >
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving} className="bg-ocean-500 hover:bg-ocean-600 text-white w-full sm:w-auto">
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t.farms.saving}
                  </span>
                ) : t.common.add}
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
              {t.common.close}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}

// ─── Add Tank Dialog ─────────────────────────────────────────────────────────

function AddTankDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", volume: "", density: "", stocking_date: "", harvest_date: "", tank_type: "노지" as "노지" | "실내" | "반실내" })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const volume = parseFloat(form.volume) || 0
    const density = parseFloat(form.density) || 0
    if (!form.name.trim()) { setError("수조 이름을 입력해주세요."); return }
    if (volume <= 0 || volume > 100000) { setError("용량은 0 초과 100,000 m³ 이하여야 합니다."); return }
    if (density < 0 || density > 10000) { setError("입식 밀도는 0~10,000 마리/m³ 범위여야 합니다."); return }
    setSaving(true)
    setError(null)
    try {
      const cycleDay = form.stocking_date ? computeCycleDay(form.stocking_date) : 0
      await createTank({
        farm_id: farm.id,
        name: form.name.trim(),
        tank_type: form.tank_type,
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
      const msg = err instanceof Error ? err.message : "저장에 실패했습니다."
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setSubmitted(false)
      setError(null)
      setForm({ name: "", volume: "", density: "", stocking_date: "", harvest_date: "", tank_type: "노지" })
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-accent gap-1.5 min-h-[44px]">
          <Plus className="w-4 h-4" /> {t.farms.addTank}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Droplets className="w-5 h-5 text-teal-500" /> {t.farms.addTank}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {farm.name}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-500" />
            </div>
            <p className="text-foreground font-semibold text-lg">{t.farms.tankCreated}</p>
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">{form.name || t.farms.addTank}</span>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="tank-name" className="text-muted-foreground text-sm">{t.farms.tankName} *</Label>
              <Input
                id="tank-name"
                placeholder={t.farms.tankNamePlaceholder}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500/50"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-sm">{t.common.type}</Label>
              <div className="flex gap-2">
                {(["노지", "실내", "반실내"] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, tank_type: type }))}
                    className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-all
                      ${form.tank_type === type
                        ? "bg-ocean-500 border-ocean-500 text-white"
                        : "bg-muted border-border text-muted-foreground hover:bg-accent"
                      }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tank-volume" className="text-muted-foreground text-sm">{t.farms.tankVolume} ({t.farms.tankVolumeUnit}) *</Label>
              <Input
                id="tank-volume"
                type="number"
                placeholder="예: 500"
                min={1}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500/50"
                value={form.volume}
                onChange={e => setForm(f => ({ ...f, volume: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tank-density" className="text-muted-foreground text-sm">{t.farms.tankDensity} ({t.farms.tankDensityUnit}) *</Label>
              <Input
                id="tank-density"
                type="number"
                placeholder="예: 120"
                min={1}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ocean-500/50"
                value={form.density}
                onChange={e => setForm(f => ({ ...f, density: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tank-stocking" className="text-muted-foreground text-sm">입식일</Label>
                <Input
                  id="tank-stocking"
                  type="date"
                  className="bg-muted border-border text-foreground focus-visible:ring-ocean-500/50"
                  value={form.stocking_date}
                  onChange={e => setForm(f => ({ ...f, stocking_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tank-harvest" className="text-muted-foreground text-sm">예정 출하일</Label>
                <Input
                  id="tank-harvest"
                  type="date"
                  className="bg-muted border-border text-foreground focus-visible:ring-ocean-500/50"
                  value={form.harvest_date}
                  onChange={e => setForm(f => ({ ...f, harvest_date: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-border text-muted-foreground hover:bg-accent w-full sm:w-auto"
                onClick={() => handleOpenChange(false)}
              >
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white w-full sm:w-auto">
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t.farms.saving}
                  </span>
                ) : t.common.add}
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
              {t.common.close}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}

// ─── Edit Farm Dialog ────────────────────────────────────────────────────────

function EditFarmDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: farm.name, location: farm.location, owner_name: farm.owner_name ?? "", area: String(farm.area) })
  const [coords, setCoords] = useState<{ lat: number | null; lon: number | null }>({ lat: farm.latitude, lon: farm.longitude })

  useEffect(() => {
    if (open) {
      setForm({ name: farm.name, location: farm.location, owner_name: farm.owner_name ?? "", area: String(farm.area) })
      setCoords({ lat: farm.latitude, lon: farm.longitude })
    }
  }, [open, farm])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateFarm(farm.id, { name: form.name, location: form.location, owner_name: form.owner_name, area: parseFloat(form.area) || 0, latitude: coords.lat, longitude: coords.lon })
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
        <button className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center" title={t.farms.editFarm} aria-label={t.farms.editFarm}>
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-ocean-500" /> {t.farms.editFarm}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.farms.farmName} *</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required className="bg-muted border-border text-foreground" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.farms.location}</Label>
            <AddressSearch
              value={form.location}
              onChange={addr => setForm(p => ({ ...p, location: addr }))}
              placeholder={t.farms.locationPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.farms.ownerName}</Label>
            <Input value={form.owner_name} onChange={e => setForm(p => ({ ...p, owner_name: e.target.value }))} placeholder={t.farms.ownerNamePlaceholder} className="bg-muted border-border text-foreground placeholder:text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.farms.area} ({t.farms.areaUnit})</Label>
            <Input type="number" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} className="bg-muted border-border text-foreground" />
          </div>
          <CoordinateField
            latitude={coords.lat}
            longitude={coords.lon}
            onChange={(lat, lon) => setCoords({ lat, lon })}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">{t.common.cancel}</Button>
            <Button type="submit" disabled={saving} className="bg-ocean-500 hover:bg-ocean-600 text-white w-full sm:w-auto">
              {saving ? t.farms.saving : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete Farm Dialog ───────────────────────────────────────────────────────

function DeleteFarmDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const { t } = useT()
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
        <button className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors flex items-center justify-center" title={t.farms.deleteFarm} aria-label={t.farms.deleteFarm}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" /> {t.farms.deleteFarm}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            <strong className="text-foreground">{farm.name}</strong> — {t.farms.deleteFarmConfirm}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">{t.common.cancel}</Button>
          <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto">
            {deleting ? t.farms.saving : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Tank Dialog ─────────────────────────────────────────────────────────

function EditTankDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const { t } = useT()
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
    tank_type: (tank.tank_type ?? "노지") as "노지" | "실내" | "반실내",
  })

  useEffect(() => {
    if (open) setForm({
      name: tank.name,
      volume: String(tank.volume),
      density: String(tank.stocking_density),
      stocking_date: tank.stocking_date ?? "",
      harvest_date: tank.harvest_date ?? "",
      status: tank.status,
      tank_type: (tank.tank_type ?? "노지") as "노지" | "실내" | "반실내",
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
        tank_type: form.tank_type,
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
    { value: "active",   label: t.dashboard.normal,        color: "text-emerald-500" },
    { value: "warning",  label: t.dashboard.warning,       color: "text-amber-500" },
    { value: "danger",   label: t.dashboard.danger,        color: "text-red-500" },
    { value: "inactive", label: t.farms.tankStatusInactive, color: "text-muted-foreground" },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center" title={t.farms.editTank} aria-label={t.farms.editTank}>
          <Edit2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-md w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-teal-500" /> {t.farms.editTank}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.farms.tankName} *</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required className="bg-muted border-border text-foreground" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.common.type}</Label>
            <div className="flex gap-2">
              {(["노지", "실내", "반실내"] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, tank_type: type }))}
                  className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-all
                    ${form.tank_type === type
                      ? "bg-ocean-500 border-ocean-500 text-white"
                      : "bg-muted border-border text-muted-foreground hover:bg-accent"
                    }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t.farms.tankVolume} ({t.farms.tankVolumeUnit})</Label>
              <Input type="number" value={form.volume} onChange={e => setForm(p => ({ ...p, volume: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t.farms.tankDensity} ({t.farms.tankDensityUnit})</Label>
              <Input type="number" value={form.density} onChange={e => setForm(p => ({ ...p, density: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">입식일</Label>
              <Input type="date" value={form.stocking_date} onChange={e => setForm(p => ({ ...p, stocking_date: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">예정 출하일</Label>
              <Input type="date" value={form.harvest_date} onChange={e => setForm(p => ({ ...p, harvest_date: e.target.value }))} className="bg-muted border-border text-foreground" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t.common.status}</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, status: opt.value }))}
                  aria-label={`수조 상태: ${opt.label}`}
                  aria-pressed={form.status === opt.value}
                  className={`py-1.5 min-h-[44px] rounded-lg text-xs font-medium border transition-colors ${
                    form.status === opt.value
                      ? `${opt.color} border-current bg-current/10`
                      : "text-muted-foreground border-border hover:border-border/60"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">수질 데이터 저장 시 자동 갱신됩니다</p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">{t.common.cancel}</Button>
            <Button type="submit" disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white w-full sm:w-auto">
              {saving ? t.farms.saving : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete Tank Dialog ───────────────────────────────────────────────────────

function DeleteTankDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const { t } = useT()
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
        <button className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors flex items-center justify-center" title={t.farms.deleteTank} aria-label={t.farms.deleteTank}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-[95vw] sm:max-w-sm w-full">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" /> {t.farms.deleteTank}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            <strong className="text-foreground">{tank.name}</strong> — {t.farms.deleteTankConfirm}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-border text-muted-foreground w-full sm:w-auto">{t.common.cancel}</Button>
          <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto">
            {deleting ? t.farms.saving : t.common.delete}
          </Button>
        </DialogFooter>
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
  // 배포된 최신 버전. 정적 파일이라 로그인 없이도 읽힌다.
  const [latest, setLatest] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded || latest !== null) return
    fetch("/updates/manifest.json")
      .then(r => (r.ok ? r.json() : null))
      .then(m => setLatest(typeof m?.latest === "string" ? m.latest : ""))
      .catch(() => setLatest(""))
  }, [expanded, latest])

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
    <div className="border-t border-border pt-3 mt-1">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5" />
          기기 연동
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-500">
              <Wifi className="w-3 h-3" /> {activeCount}대 연결 중
            </span>
          )}
          {devices.length > 0 && activeCount === 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <WifiOff className="w-3 h-3" /> 미연결
            </span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-2">불러오는 중...</p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">연결된 기기가 없습니다.</p>
          ) : (
            devices.map(device => (
              <div key={device.id} className="bg-muted rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${device.active ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="text-xs text-foreground font-medium truncate">{device.name}</p>
                    <p className="text-[10px] text-muted-foreground">{timeSince(device.last_seen_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(device)}
                    className={`text-[10px] px-2 py-1 min-h-[32px] rounded border transition-colors ${
                      device.active
                        ? "border-emerald-500/30 text-emerald-500 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30"
                        : "border-border text-muted-foreground hover:text-emerald-500 hover:border-emerald-500/30"
                    }`}
                    title={device.active ? "비활성화" : "활성화"}
                  >
                    {device.active ? "활성" : "비활성"}
                  </button>
                  <button
                    onClick={() => handleDelete(device.id)}
                    disabled={deletingId === device.id}
                    className="p-1.5 min-h-[32px] min-w-[32px] rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors flex items-center justify-center"
                    title="삭제"
                    aria-label="기기 삭제"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                </div>
                <DeviceIdentity device={device} />
                <DeviceUpdate device={device} latest={latest} onChanged={loadDevices} />
              </div>
            ))
          )}
          <PairDeviceDialog tank={tank} onSuccess={loadDevices} />
        </div>
      )}
    </div>
  )
}

// ─── Device Identity ─────────────────────────────────────────────────────────

// API 키는 등록 직후 한 번만 보여 주므로, 화면에서 "이 카드가 어느 장비인지"를
// 알 수 있는 값이 필요하다. 라즈베리파이가 보고한 CPU 시리얼(보드마다 고정)을 쓴다.
const PAYLOAD_LABELS: Record<string, { label: string; unit: string }> = {
  temperature:   { label: "수온",   unit: "°C" },
  ph:            { label: "pH",     unit: "" },
  do_level:      { label: "DO",     unit: "ppm" },
  salinity:      { label: "염도",   unit: "‰" },
  conductivity:  { label: "전도도", unit: "µS/cm" },
  tds:           { label: "TDS",    unit: "ppm" },
  do_saturation: { label: "DO 포화", unit: "%" },
  orp:           { label: "ORP",    unit: "mV" },
}

function DeviceIdentity({ device }: { device: SensorDevice }) {
  const payload = device.last_payload ?? {}
  const measured = Object.entries(payload).filter(
    ([k, v]) => typeof v === "number" && k in PAYLOAD_LABELS
  ) as [string, number][]

  if (!device.serial && measured.length === 0) return null

  return (
    <div className="mt-2 pt-2 border-t border-border/60 space-y-1.5">
      {device.serial && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Cpu className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate" title={device.serial}>{device.serial}</span>
          {device.firmware && <span className="opacity-70 shrink-0">· {device.firmware}</span>}
        </div>
      )}
      {measured.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {measured.map(([key, value]) => {
            const meta = PAYLOAD_LABELS[key]
            return (
              <span key={key} className="text-[10px] text-muted-foreground tabular-nums">
                {meta.label} <span className="text-foreground font-semibold">{value}</span>
                {meta.unit && <span className="opacity-70">{meta.unit}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Device Update ───────────────────────────────────────────────────────────

// 원격 업데이트는 승인제다. 여기서 누른 기기만 다음 확인 때(5분마다)
// 새 버전을 받아 간다. 누르지 않으면 장비는 지금 버전 그대로 돈다.
//
// 꾸러미가 진짜인지는 이 화면이 아니라 서명이 보장한다. 장비는 서명을
// 확인한 뒤에만 적용하고, 적용 후 자리를 잡지 못하면 스스로 되돌린다.

/** "1.2.3" 을 견줄 수 있는 형태로. 형식이 아니면 null. */
function parseVersion(v: string | null): number[] | null {
  if (!v || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return null
  return v.split(".").map(Number)
}

function isNewer(candidate: string | null, current: string | null): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a) return false
  if (!b) return true // 버전을 아직 모르는 기기 — 일단 올릴 수 있게 둔다
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

const UPDATE_STATUS_LABELS: Record<string, string> = {
  requested: "업데이트 대기 중",
  downloading: "내려받는 중",
  applied: "업데이트 완료",
  failed: "업데이트 실패",
  rolled_back: "되돌림 — 이전 버전으로 동작 중",
}

function DeviceUpdate({
  device, latest, onChanged,
}: {
  device: SensorDevice
  latest: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = device.agent_version
  const pending = device.update_to
  const canUpdate = !pending && isNewer(latest, current)
  // 이미 최신이면 업데이트를 권하지 않는다(승인제라 자동 적용도 없다).
  const upToDate = !pending && !!current && !!latest && !isNewer(latest, current)
  const failed = device.update_status === "failed" || device.update_status === "rolled_back"

  // 보여줄 것이 아무것도 없으면 자리를 차지하지 않는다.
  if (!current && !pending && !canUpdate && !failed) return null

  async function handle(version: string | null) {
    setBusy(true)
    setError(null)
    try {
      await requestDeviceUpdate(device.id, version)
      onChanged()
    } catch {
      setError("변경하지 못했습니다. 잠시 후 다시 시도해 주세요.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/60 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground">
          버전 <span className="text-foreground font-mono">{current ?? "확인 전"}</span>
        </span>

        {canUpdate && (
          <>
            <span className="text-[10px] text-emerald-500 font-medium">
              새 버전 {latest}
            </span>
            <button
              onClick={() => handle(latest)}
              disabled={busy}
              className="text-[10px] px-2 py-1 min-h-[28px] rounded border border-ocean-500/40 text-ocean-500 hover:bg-ocean-500/10 transition-colors disabled:opacity-50"
            >
              {busy ? "요청 중…" : "업데이트"}
            </button>
          </>
        )}

        {pending && (
          <>
            <span className="text-[10px] text-ocean-500 font-medium">
              {UPDATE_STATUS_LABELS[device.update_status ?? "requested"] ?? "대기 중"} → {pending}
            </span>
            <button
              onClick={() => handle(null)}
              disabled={busy}
              className="text-[10px] px-2 py-1 min-h-[28px] rounded border border-border text-muted-foreground hover:text-red-500 hover:border-red-500/30 transition-colors disabled:opacity-50"
              title="아직 받아 가지 않았다면 취소됩니다"
            >
              취소
            </button>
          </>
        )}

        {upToDate && (
          <span className="text-[10px] text-emerald-500 font-medium">
            최신 버전입니다 · v{latest}
          </span>
        )}

        {!pending && failed && (
          <span className="text-[10px] text-amber-500 font-medium">
            {UPDATE_STATUS_LABELS[device.update_status!]}
          </span>
        )}
      </div>

      {pending && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          장비가 5분마다 확인해 자동으로 적용합니다.
        </p>
      )}

      {!pending && failed && device.update_message && (
        <p className="text-[10px] text-muted-foreground leading-relaxed break-words">
          {device.update_message}
        </p>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  )
}

// ─── Tank Card ───────────────────────────────────────────────────────────────

function TankCard({ tank, onRefresh }: { tank: Tank; onRefresh: () => void }) {
  const STATUS_META = useStatusMeta()
  const meta = STATUS_META[tank.status]
  const isPulsing = tank.status === "warning" || tank.status === "danger"

  return (
    <Card className={`bg-card border transition-all hover:border-border hover:bg-card group ${meta.border}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`w-2.5 h-2.5 rounded-full ${meta.dot} ${isPulsing ? "animate-pulse" : ""} shrink-0 mt-0.5`} />
            <h3 className="text-foreground font-semibold text-base leading-tight truncate">{tank.name}</h3>
          </div>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${meta.bg} ${meta.border} ${meta.text}`}
            aria-label={`수조 상태: ${meta.label}`}
          >
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
          <div className="bg-muted rounded-lg p-2.5">
            <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
              <Droplets className="w-3 h-3" /> 용량
            </p>
            <p className="text-foreground font-bold text-sm">{tank.volume.toLocaleString()} m³</p>
          </div>
          <div className="bg-muted rounded-lg p-2.5">
            <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
              <Layers className="w-3 h-3" /> 밀도
            </p>
            <p className="text-foreground font-bold text-sm">{tank.stocking_density} 마리/m³</p>
          </div>
          <div className="col-span-2 bg-muted rounded-lg p-2.5">
            <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
              <Fish className="w-3 h-3" /> 새우 수
            </p>
            <p className="text-foreground font-bold text-sm">{tank.shrimp_count.toLocaleString()} 마리</p>
          </div>
          {tank.stocking_date && (
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> 입식일
              </p>
              <p className="text-foreground font-bold text-sm">{formatDate(tank.stocking_date)}</p>
            </div>
          )}
          {tank.harvest_date && (
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" /> 예정 출하
              </p>
              <p className={`font-bold text-sm ${new Date(tank.harvest_date) <= new Date() ? "text-red-500" : "text-foreground"}`}>
                {formatDate(tank.harvest_date)}
              </p>
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <p className="text-muted-foreground text-xs">등록 {formatDate(tank.created_at)}</p>
          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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
  const { t } = useT()
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
          : "bg-muted border-border hover:bg-accent"
      }`}
    >
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${selected ? "bg-ocean-500/20" : "bg-muted"}`}>
            <Building2 className={`w-4.5 h-4.5 ${selected ? "text-ocean-500" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`font-semibold text-sm leading-tight truncate ${selected ? "text-foreground" : "text-foreground/80"}`}>{farm.name}</p>
            <p className="text-muted-foreground text-xs mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{farm.location}</span>
            </p>
          </div>
        </div>
        {hasIssues && (
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0 mt-1" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-background rounded-lg px-2.5 py-1.5">
          <p className="text-muted-foreground mb-0.5">{t.farms.area}</p>
          <p className="text-foreground font-medium">{farm.area.toLocaleString()} {t.farms.areaUnit}</p>
        </div>
        <div className="bg-background rounded-lg px-2.5 py-1.5">
          <p className="text-muted-foreground mb-0.5">수조</p>
          <p className="text-foreground font-medium">{tanks.length}{t.farms.tankCount}</p>
        </div>
      </div>

      {tanks.length > 0 && (
        <div className="flex items-center gap-2 mt-2.5">
          {active > 0 && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {active}
            </span>
          )}
          {warning > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-500">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {warning}
            </span>
          )}
          {danger > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-500">
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
  const { t } = useT()
  const counts = {
    active: tanks.filter(t => t.status === "active").length,
    warning: tanks.filter(t => t.status === "warning").length,
    danger: tanks.filter(t => t.status === "danger").length,
    inactive: tanks.filter(t => t.status === "inactive").length,
  }
  const total = tanks.length

  const items = [
    { key: "active" as const, label: t.dashboard.normal, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400", Icon: CheckCircle },
    { key: "warning" as const, label: t.dashboard.warning, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400", Icon: AlertCircle },
    { key: "danger" as const, label: t.dashboard.danger, color: "text-red-500", bg: "bg-red-500/10 border-red-500/20", dot: "bg-red-400", Icon: XCircle },
  ]

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-muted-foreground text-xs font-medium">{t.common.all} {total}{t.farms.tankCount}</span>
      <div className="hidden sm:block w-px h-4 bg-border" />
      {items.map(({ key, label, color, bg, dot, Icon }) => (
        <div key={key} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium ${bg} ${color}`}>
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
  const { t } = useT()
  const [farms, setFarms] = useState<Farm[]>([])
  const [tanksMap, setTanksMap] = useState<Record<string, Tank[]>>({})
  const [selectedFarmId, setSelectedFarmId] = useState<string>("")
  const [loadingFarms, setLoadingFarms] = useState(true)
  const [loadingTanks, setLoadingTanks] = useState(false)

  const loadFarms = useCallback(async () => {
    const mock = isTestAccount(user?.email)
    setLoadingFarms(true)
    if (mock) {
      setFarms(MOCK_FARMS)
      if (!selectedFarmId && MOCK_FARMS.length > 0) setSelectedFarmId(MOCK_FARMS[0].id)
      setLoadingFarms(false)
      return
    }
    try {
      const data = await getFarms()
      setFarms(data)
      if (!selectedFarmId && data.length > 0) setSelectedFarmId(data[0].id)
    } catch { } finally {
      setLoadingFarms(false)
    }
  }, [selectedFarmId, user?.email])

  const loadTanksForFarm = useCallback(async (farmId: string) => {
    if (!farmId) return
    const mock = isTestAccount(user?.email)
    setLoadingTanks(true)
    if (mock) {
      setTanksMap(prev => ({ ...prev, [farmId]: MOCK_TANKS.filter(t => t.farm_id === farmId) }))
      setLoadingTanks(false)
      return
    }
    try {
      const data = await getTanksByFarm(farmId)
      setTanksMap(prev => ({ ...prev, [farmId]: data }))
    } catch { } finally {
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
          <p className="text-muted-foreground text-sm">{t.common.loading}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-ocean-500 shrink-0" />
            <span className="truncate">{t.farms.title}</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t.farms.subtitle}
          </p>
        </div>
        <AddFarmDialog onSuccess={handleFarmAdded} />
      </div>

      {/* 양식장 위치 — 여러 곳을 운영할 때 급한 곳이 어디인지 한눈에 */}
      {farms.length > 0 && (
        <FarmMap farms={farms} tanks={Object.values(tanksMap).flat()} />
      )}

      {/* Main layout: left list + right tank grid */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ── Left: Farm List ── */}
        <div className="w-full lg:w-72 lg:shrink-0 space-y-3">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider px-1">
            {t.nav.farms} ({farms.length})
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
            <Card className="bg-card border-border mt-2">
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{t.farms.title}</p>
                  <div className="flex items-center gap-0.5">
                    <EditFarmDialog farm={selectedFarm} onSuccess={handleFarmAdded} />
                    <DeleteFarmDialog farm={selectedFarm} onSuccess={() => { setSelectedFarmId(""); handleFarmAdded() }} />
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">{t.farms.farmName}</span>
                    <span className="text-foreground font-medium text-right truncate max-w-[10rem]">{selectedFarm.name}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">{t.farms.location}</span>
                    <span className="text-foreground font-medium text-right truncate max-w-[10rem]">{selectedFarm.location}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">{t.farms.area}</span>
                    <span className="text-foreground font-medium">{selectedFarm.area.toLocaleString()} {t.farms.areaUnit}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground shrink-0">등록일</span>
                    <span className="text-foreground font-medium">{formatDate(selectedFarm.created_at)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right: Tank Grid ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Tank section header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <h2 className="text-foreground font-semibold flex items-center gap-1.5 min-w-0">
                <Layers className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="truncate">{selectedFarm?.name} 수조</span>
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
                <p className="text-muted-foreground text-sm">{t.common.loading}</p>
              </div>
            </div>
          ) : selectedTanks.length === 0 ? (
            <Card className="bg-card border-border border-dashed">
              <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
                  <Layers className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground font-medium">{t.farms.noTanks}</p>
                <p className="text-muted-foreground text-sm">{t.farms.noTanksMsg}</p>
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
