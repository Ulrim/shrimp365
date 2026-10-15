"use client"

// 베드 추가·수정·삭제 다이얼로그(농업 화면) — 수아 시안 mode-split-ui.md 5-8 "베드 폼".
//
// 베드는 데이터 모델의 Tank 다. 새우 전용 컬럼은 폼에 없고 저장 시 0 으로 채운다
// (stocking_density·shrimp_count). 정식일 → stocking_date, 수확 예정일 → harvest_date,
// cycle_day 는 정식일이 있으면 계산값·없으면 0. 레시피는 recipe-fields.tsx 가 환산한다.
// 데이터는 lib/db 의 createTank / updateTank / deleteTank 만 쓴다.
import { useState } from "react"
import { Edit2, Plus, Sprout, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { createTank, deleteTank, updateTank } from "@/lib/db"
import { useAgriT, useT } from "@/lib/i18n-context"
import { cn, computeCycleDay } from "@/lib/utils"
import type { AgriFarmsDict } from "@/lib/i18n/agri/farms"
import type { Farm, Tank } from "@/types"
import { CTA_CLS, DIALOG_CLS, FIELD_ERROR_CLS, ICON_BTN_CLS, INPUT_CLS, LABEL_CLS } from "./form-styles"
import { EMPTY_RECIPE, RecipeFields, recipeFromTank, recipeToDb, validateRecipe, type RecipeForm } from "./recipe-fields"

/** 베드 유형은 DB(tanks.tank_type)에 한국어 값으로 저장된다. 화면 라벨만 사전. */
export type BedType = "실내" | "반실내" | "노지"
const BED_TYPES: BedType[] = ["실내", "반실내", "노지"]

export function bedTypeLabel(d: AgriFarmsDict, type: BedType | undefined): string {
  switch (type) {
    case "반실내": return d.bedTypeSemi
    case "노지":   return d.bedTypeOutdoor
    default:       return d.bedTypeIndoor
  }
}

interface BedForm {
  name: string
  tank_type: BedType
  volume: string
  stocking_date: string
  harvest_date: string
}

// NFT 베드는 대부분 온실·실내라 기본 유형은 "실내".
const EMPTY_FORM: BedForm = { name: "", tank_type: "실내", volume: "", stocking_date: "", harvest_date: "" }

interface FieldErrors { name?: string; volume?: string; recipe?: string }

/** 제출 시 검증 — 값이 있을 때만 범위를 본다. 필드별 오류를 돌려준다. */
function validate(d: AgriFarmsDict, form: BedForm, recipe: RecipeForm): FieldErrors {
  const errors: FieldErrors = {}
  if (!form.name.trim()) errors.name = d.bedNameRequired
  if (form.volume) {
    const v = parseFloat(form.volume)
    if (isNaN(v) || v < 0.1 || v > 100000) errors.volume = d.volumeRangeError
  }
  const recipeError = validateRecipe(d, recipe)
  if (recipeError) errors.recipe = recipeError
  return errors
}

/** 폼 → 저장값(레시피 제외). 새우 전용 컬럼은 폼에 없으니 0 으로 채운다. */
function toDbValues(form: BedForm) {
  return {
    name: form.name.trim(),
    tank_type: form.tank_type,
    volume: parseFloat(form.volume) || 0,
    stocking_density: 0,
    shrimp_count: 0,
    cycle_day: form.stocking_date ? computeCycleDay(form.stocking_date) : 0,
    stocking_date: form.stocking_date || null,
    harvest_date: form.harvest_date || null,
  }
}

/** 레시피 저장값.
 *  추가(insert)는 목표가 있을 때만 컬럼을 싣는다 — 마이그레이션 전 DB 에서 "없는 컬럼"으로
 *  베드 추가가 막히면 안 된다(createTank 주석). 수정(update)은 목표를 지운 경우를 NULL 로
 *  써야 하므로 target_* 를 항상 싣는다. */
function recipeValues(recipe: RecipeForm, mode: "insert" | "update") {
  const db = recipeToDb(recipe)
  return {
    ...(db.target_ec != null
      ? { target_ec: db.target_ec, ec_tolerance: db.ec_tolerance }
      : mode === "update" ? { target_ec: null } : {}),
    ...(db.target_ph != null
      ? { target_ph: db.target_ph, ph_tolerance: db.ph_tolerance }
      : mode === "update" ? { target_ph: null } : {}),
  }
}

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

/** 베드 공통 필드 — 이름·유형·용량·정식일·수확 예정일·레시피. 추가·수정이 함께 쓴다. */
function BedFormFields({ idPrefix, form, setForm, recipe, setRecipe, errors }: {
  idPrefix: string
  form: BedForm
  setForm: (f: BedForm) => void
  recipe: RecipeForm
  setRecipe: (r: RecipeForm) => void
  errors: FieldErrors
}) {
  const { farms: d } = useAgriT()
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`} className={LABEL_CLS}>{d.bedName} *</Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder={d.bedNamePlaceholder}
          className={cn(INPUT_CLS, "min-h-[44px]")}
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          aria-invalid={!!errors.name}
        />
        {errors.name && <p className={FIELD_ERROR_CLS}>{errors.name}</p>}
      </div>

      <div className="space-y-1.5">
        <Label className={LABEL_CLS}>{d.bedType}</Label>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={d.bedType}>
          {BED_TYPES.map(type => {
            const active = form.tank_type === type
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => setForm({ ...form, tank_type: type })}
                className={cn(
                  "min-h-[44px] rounded-lg border text-sm font-medium transition-colors duration-200 motion-reduce:transition-none",
                  active
                    ? "bg-brand text-white border-brand"
                    : "bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                {bedTypeLabel(d, type)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-volume`} className={LABEL_CLS}>
          {d.volume} <span className="text-xs opacity-70">{d.volumeOptional}</span>
        </Label>
        <Input
          id={`${idPrefix}-volume`}
          type="number" inputMode="decimal" min={0.1} step={0.1}
          placeholder={d.volumePlaceholder}
          className={cn(INPUT_CLS, "min-h-[44px]")}
          value={form.volume}
          onChange={e => setForm({ ...form, volume: e.target.value })}
          aria-invalid={!!errors.volume}
        />
        {errors.volume
          ? <p className={FIELD_ERROR_CLS}>{errors.volume}</p>
          : <p className="text-xs text-muted-foreground">{d.volumeHint}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-planting`} className={LABEL_CLS}>{d.plantingDate}</Label>
          <Input
            id={`${idPrefix}-planting`}
            type="date"
            className={cn(INPUT_CLS, "min-h-[44px]")}
            value={form.stocking_date}
            onChange={e => setForm({ ...form, stocking_date: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-harvest`} className={LABEL_CLS}>{d.harvestPlanDate}</Label>
          <Input
            id={`${idPrefix}-harvest`}
            type="date"
            className={cn(INPUT_CLS, "min-h-[44px]")}
            value={form.harvest_date}
            onChange={e => setForm({ ...form, harvest_date: e.target.value })}
          />
        </div>
      </div>

      <RecipeFields idPrefix={`${idPrefix}-recipe`} value={recipe} onChange={setRecipe} />
      {errors.recipe && <p className={FIELD_ERROR_CLS}>{errors.recipe}</p>}
    </>
  )
}

// ─── 추가 ────────────────────────────────────────────────────────────────────

export function AddBedDialog({ farm, onSuccess, variant = "header" }: {
  farm: Farm
  onSuccess: () => void
  /** header = 섹션 머리의 작은 버튼(기본), cta = 빈 상태의 큰 버튼. */
  variant?: "header" | "cta"
}) {
  const { t } = useT()
  const { farms: d } = useAgriT()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [form, setForm] = useState<BedForm>(EMPTY_FORM)
  const [recipe, setRecipe] = useState<RecipeForm>(EMPTY_RECIPE)

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setError(null); setErrors({})
      setForm(EMPTY_FORM); setRecipe(EMPTY_RECIPE)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fieldErrors = validate(d, form, recipe)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return
    setSaving(true)
    setError(null)
    try {
      await createTank({
        farm_id: farm.id,
        ...toDbValues(form),
        ...recipeValues(recipe, "insert"),
      })
      handleOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(limitAware(err, d.bedLimitMsg, d.saveFailed))
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
            <Plus className="w-4 h-4" aria-hidden="true" /> {d.addBed}
          </button>
        ) : (
          <Button size="sm" className={cn(CTA_CLS, "gap-1.5 min-h-[44px] shrink-0")}>
            <Plus className="w-4 h-4" aria-hidden="true" /> {d.addBed}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_CLS, "max-h-[90vh] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Sprout className="w-5 h-5 text-brand-fg" aria-hidden="true" /> {d.addBed}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">{farm.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" noValidate>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <BedFormFields
            idPrefix={`agri-bed-add-${farm.id}`} form={form} setForm={setForm}
            recipe={recipe} setRecipe={setRecipe} errors={errors}
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

export function EditBedDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const { t } = useT()
  const { farms: d } = useAgriT()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [form, setForm] = useState<BedForm>(EMPTY_FORM)
  const [recipe, setRecipe] = useState<RecipeForm>(EMPTY_RECIPE)

  // 열 때마다 현재 베드 값으로 채운다 — effect 가 아니라 열기 이벤트에서.
  function handleOpenChange(v: boolean) {
    if (v) {
      setForm({
        name: tank.name,
        tank_type: tank.tank_type ?? "실내",
        volume: tank.volume ? String(tank.volume) : "",
        stocking_date: tank.stocking_date ?? "",
        harvest_date: tank.harvest_date ?? "",
      })
      setRecipe(recipeFromTank(tank))
      setError(null); setErrors({})
    }
    setOpen(v)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fieldErrors = validate(d, form, recipe)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return
    setSaving(true)
    setError(null)
    try {
      await updateTank(tank.id, { ...toDbValues(form), ...recipeValues(recipe, "update") })
      setOpen(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : d.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className={ICON_BTN_CLS} title={d.editBed} aria-label={`${d.editBed}: ${tank.name}`}>
          <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_CLS, "max-h-[90vh] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-brand-fg" aria-hidden="true" /> {d.editBed}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">{tank.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2" noValidate>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <BedFormFields
            idPrefix={`agri-bed-edit-${tank.id}`} form={form} setForm={setForm}
            recipe={recipe} setRecipe={setRecipe} errors={errors}
          />
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

export function DeleteBedDialog({ tank, onSuccess }: { tank: Tank; onSuccess: () => void }) {
  const { t } = useT()
  const { farms: d } = useAgriT()
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
      setError(err instanceof Error && err.message ? err.message : d.deleteFailed)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setError(null) }}>
      <DialogTrigger asChild>
        <button type="button" className={cn(ICON_BTN_CLS, "hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10")} title={d.deleteBed} aria-label={`${d.deleteBed}: ${tank.name}`}>
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_CLS, "sm:max-w-sm")}>
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" /> {d.deleteBed}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            <span className="text-foreground font-medium">{tank.name}</span> — {d.deleteBedConfirm}
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
