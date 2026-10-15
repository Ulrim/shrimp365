"use client"

// 농장 추가·수정·삭제 다이얼로그(농업 화면) — 수아 시안 mode-split-ui.md 5-8 "농장 폼".
//
// 추가: 유형 필드가 없다. 이 화면에서 만드는 농장은 항상 farm_type: "agriculture".
// 수정: 유형 2택(양식장/스마트팜) + 안내 한 줄. 양식장으로 바꿔 저장하면 이 화면 목록에서
//      사라지고 호출부가 "양식장 화면으로 옮겨졌습니다" 토스트를 띄운다.
// 데이터는 lib/db 의 createFarm / updateFarm / deleteFarm 만 쓴다.
import { useState } from "react"
import { Building2, Edit2, Plus, Sprout, Trash2, Waves } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { AddressSearch } from "@/components/ui/address-search"
import { CoordinateField } from "@/components/farms/coordinate-field"
import { createFarm, deleteFarm, updateFarm } from "@/lib/db"
import { useAgriT, useT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import type { Farm } from "@/types"
import { CTA_CLS, DIALOG_CLS, ICON_BTN_CLS, INPUT_CLS, LABEL_CLS } from "./form-styles"

type FarmType = "shrimp" | "agriculture"

interface FarmForm { name: string; location: string; owner_name: string; area: string }
interface Coords { lat: number | null; lon: number | null }

const EMPTY_FORM: FarmForm = { name: "", location: "", owner_name: "", area: "" }

/** 플랜 한도 오류는 lib/db 가 새우 어휘로 던진다 — 농업 사전 문구로 바꿔 보인다. */
function limitAware(err: unknown, limitMsg: string, fallback: string): string {
  const msg = err instanceof Error ? err.message : ""
  if (/플랜/.test(msg)) return limitMsg
  return msg || fallback
}

function SavingLabel({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
      {label}
    </span>
  )
}

/** 농장 공통 필드 — 이름·주소·대표자·면적·좌표. 추가·수정이 함께 쓴다. */
function FarmFormFields({ idPrefix, form, setForm, coords, setCoords, nameError }: {
  idPrefix: string
  form: FarmForm
  setForm: (f: FarmForm) => void
  coords: Coords
  setCoords: (c: Coords) => void
  nameError: string | null
}) {
  const { farms: d } = useAgriT()
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`} className={LABEL_CLS}>{d.farmName} *</Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder={d.farmNamePlaceholder}
          className={cn(INPUT_CLS, "min-h-[44px]")}
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          aria-invalid={!!nameError}
        />
        {nameError && <p className="text-xs text-red-600 dark:text-red-400">{nameError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-location`} className={LABEL_CLS}>{d.address}</Label>
        <AddressSearch
          id={`${idPrefix}-location`}
          value={form.location}
          onChange={addr => setForm({ ...form, location: addr })}
          placeholder={d.addressPlaceholder}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-owner`} className={LABEL_CLS}>{d.owner}</Label>
        <Input
          id={`${idPrefix}-owner`}
          placeholder={d.ownerPlaceholder}
          className={cn(INPUT_CLS, "min-h-[44px]")}
          value={form.owner_name}
          onChange={e => setForm({ ...form, owner_name: e.target.value })}
          maxLength={80}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-area`} className={LABEL_CLS}>{d.area}</Label>
        <Input
          id={`${idPrefix}-area`}
          type="number" inputMode="decimal" min={0} step="any"
          placeholder={d.areaPlaceholder}
          className={cn(INPUT_CLS, "min-h-[44px]")}
          value={form.area}
          onChange={e => setForm({ ...form, area: e.target.value })}
        />
      </div>
      <CoordinateField
        latitude={coords.lat}
        longitude={coords.lon}
        onChange={(lat, lon) => setCoords({ lat, lon })}
      />
    </>
  )
}

/** 유형 2택 카드 — 수정 폼 전용(추가 폼에는 없다). */
function FarmTypePicker({ value, onChange }: { value: FarmType; onChange: (v: FarmType) => void }) {
  const { farms: d } = useAgriT()
  const CARDS = [
    { type: "shrimp" as const, Icon: Waves, label: d.farmTypeShrimp },
    { type: "agriculture" as const, Icon: Sprout, label: d.farmTypeAgri },
  ]
  return (
    <div className="space-y-1.5">
      <Label className={LABEL_CLS}>{d.farmType}</Label>
      <div className="grid grid-cols-2 gap-3" role="group" aria-label={d.farmType}>
        {CARDS.map(({ type, Icon, label }) => {
          const active = value === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChange(type)}
              aria-pressed={active}
              className={cn(
                "min-h-[44px] rounded-xl border p-3 text-left flex items-center gap-2 transition-colors duration-200 motion-reduce:transition-none",
                active
                  ? "border-brand bg-brand/5 ring-1 ring-brand/40"
                  : "border-border bg-muted/50 hover:border-brand/40",
              )}
            >
              <Icon className={cn("w-5 h-5 shrink-0", active ? "text-brand-fg" : "text-muted-foreground")} aria-hidden="true" />
              <span className="text-sm font-semibold text-foreground">{label}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{d.farmTypeChangeNote}</p>
    </div>
  )
}

// ─── 추가 ────────────────────────────────────────────────────────────────────

export function AddFarmDialog({ onSuccess, variant = "header" }: {
  onSuccess: () => void
  /** header = 상단 작은 버튼(기본), cta = 빈 상태의 큰 버튼. */
  variant?: "header" | "cta"
}) {
  const { t } = useT()
  const { farms: d } = useAgriT()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [form, setForm] = useState<FarmForm>(EMPTY_FORM)
  const [coords, setCoords] = useState<Coords>({ lat: null, lon: null })

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setError(null); setNameError(null)
      setForm(EMPTY_FORM); setCoords({ lat: null, lon: null })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setNameError(d.farmNameRequired); return }
    setNameError(null)
    setSaving(true)
    setError(null)
    try {
      await createFarm({
        name: form.name.trim(),
        location: form.location,
        owner_name: form.owner_name,
        area: parseFloat(form.area) || 0,
        latitude: coords.lat,
        longitude: coords.lon,
        // 이 화면에서 만드는 농장은 전부 스마트팜이다 — 유형 선택이 없다.
        farm_type: "agriculture",
      })
      handleOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(limitAware(err, d.farmLimitMsg, d.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {variant === "cta" ? (
          <button
            type="button"
            className={cn("inline-flex items-center justify-center gap-1.5 min-h-[44px] px-6 rounded-xl text-sm font-medium transition-colors", CTA_CLS)}
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> {d.addFarm}
          </button>
        ) : (
          <Button size="sm" className={cn(CTA_CLS, "gap-1.5 min-h-[44px] flex-1 sm:flex-none")}>
            <Plus className="w-4 h-4" aria-hidden="true" /> {d.addFarm}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={DIALOG_CLS}>
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-brand-fg" aria-hidden="true" /> {d.addFarm}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">{d.subtitle}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" noValidate>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <FarmFormFields
            idPrefix="agri-farm-add" form={form} setForm={setForm}
            coords={coords} setCoords={setCoords} nameError={nameError}
          />
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="border-border text-muted-foreground hover:bg-accent w-full sm:w-auto min-h-[44px]" onClick={() => handleOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving} className={cn(CTA_CLS, "w-full sm:w-auto min-h-[44px]")}>
              {saving ? <SavingLabel label={t.common.loading} /> : t.common.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 수정 ────────────────────────────────────────────────────────────────────

export function EditFarmDialog({ farm, onSuccess }: {
  farm: Farm
  /** movedOut = 유형을 양식장으로 바꿔 저장해 이 화면 목록에서 빠진 경우. */
  onSuccess: (result: { movedOut: boolean }) => void
}) {
  const { t } = useT()
  const { farms: d } = useAgriT()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [form, setForm] = useState<FarmForm>(EMPTY_FORM)
  const [farmType, setFarmType] = useState<FarmType>("agriculture")
  const [coords, setCoords] = useState<Coords>({ lat: null, lon: null })

  // 열 때마다 현재 농장 값으로 채운다 — effect 가 아니라 열기 이벤트에서.
  function handleOpenChange(v: boolean) {
    if (v) {
      setForm({ name: farm.name, location: farm.location, owner_name: farm.owner_name ?? "", area: farm.area ? String(farm.area) : "" })
      setFarmType(farm.farm_type ?? "agriculture")
      setCoords({ lat: farm.latitude, lon: farm.longitude })
      setError(null); setNameError(null)
    }
    setOpen(v)
  }

  const typeChanged = farmType !== (farm.farm_type ?? "agriculture")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setNameError(d.farmNameRequired); return }
    setNameError(null)
    setSaving(true)
    setError(null)
    try {
      await updateFarm(farm.id, {
        name: form.name.trim(),
        location: form.location,
        owner_name: form.owner_name,
        area: parseFloat(form.area) || 0,
        latitude: coords.lat,
        longitude: coords.lon,
        ...(typeChanged ? { farm_type: farmType } : {}),
      })
      setOpen(false)
      onSuccess({ movedOut: typeChanged && farmType === "shrimp" })
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : d.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className={ICON_BTN_CLS} title={d.editFarm} aria-label={d.editFarm}>
          <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={DIALOG_CLS}>
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-brand-fg" aria-hidden="true" /> {d.editFarm}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2" noValidate>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <FarmFormFields
            idPrefix={`agri-farm-edit-${farm.id}`} form={form} setForm={setForm}
            coords={coords} setCoords={setCoords} nameError={nameError}
          />
          <FarmTypePicker value={farmType} onChange={setFarmType} />
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="border-border text-muted-foreground hover:bg-accent w-full sm:w-auto min-h-[44px]" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving} className={cn(CTA_CLS, "w-full sm:w-auto min-h-[44px]")}>
              {saving ? <SavingLabel label={t.common.loading} /> : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 삭제 ────────────────────────────────────────────────────────────────────

export function DeleteFarmDialog({ farm, onSuccess }: { farm: Farm; onSuccess: () => void }) {
  const { t } = useT()
  const { farms: d } = useAgriT()
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
      setError(err instanceof Error && err.message ? err.message : d.deleteFailed)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setError(null) }}>
      <DialogTrigger asChild>
        <button type="button" className={cn(ICON_BTN_CLS, "hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10")} title={d.deleteFarm} aria-label={d.deleteFarm}>
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_CLS, "sm:max-w-sm")}>
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" /> {d.deleteFarm}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            <span className="text-foreground font-medium">{farm.name}</span> — {d.deleteFarmConfirm}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" className="border-border text-muted-foreground hover:bg-accent w-full sm:w-auto min-h-[44px]" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button type="button" variant="destructive" disabled={deleting} className="w-full sm:w-auto min-h-[44px]" onClick={handleDelete}>
            {deleting ? <SavingLabel label={t.common.loading} /> : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
