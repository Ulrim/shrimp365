"use client"

// 양액 레시피 입력(농업 베드 폼 전용) — 선행 시안 agriculture-mode-ui.md §6-2, mode-split-ui.md 5-8.
//
// 입력은 mS/cm, 저장은 µS/cm(×1000). 환산은 `recipeToDb` 한 곳이다.
// 목표가 비면 오차 입력은 disabled 이고 저장 시 NULL — 오차 컬럼은 건드리지 않는다(DEFAULT 유지).
import { FlaskConical } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useAgriT } from "@/lib/i18n-context"
import type { AgriFarmsDict } from "@/lib/i18n/agri/farms"
import type { Tank } from "@/types"
import { INPUT_CLS, LABEL_CLS } from "./form-styles"

export interface RecipeForm { ec: string; ecTol: string; ph: string; phTol: string }

/** 오차는 기본값을 미리 채운다(EC ±0.1 mS/cm, pH ±0.5). */
export const EMPTY_RECIPE: RecipeForm = { ec: "", ecTol: "0.1", ph: "", phTol: "0.5" }

export function recipeFromTank(tank: Tank): RecipeForm {
  return {
    ec: tank.target_ec != null ? String(tank.target_ec / 1000) : "",
    ecTol: String((tank.ec_tolerance ?? 100) / 1000),
    ph: tank.target_ph != null ? String(tank.target_ph) : "",
    phTol: String(tank.ph_tolerance ?? 0.5),
  }
}

/** 값이 있을 때만 범위 검증. 오류 문구 또는 null. */
export function validateRecipe(d: AgriFarmsDict, r: RecipeForm): string | null {
  if (r.ec) {
    const ec = parseFloat(r.ec)
    if (isNaN(ec) || ec < 0.1 || ec > 10) return d.ecRangeError
    const tol = parseFloat(r.ecTol)
    if (isNaN(tol) || tol < 0.01 || tol > 2) return d.ecToleranceRangeError
  }
  if (r.ph) {
    const ph = parseFloat(r.ph)
    if (isNaN(ph) || ph < 3 || ph > 9) return d.phRangeError
    const tol = parseFloat(r.phTol)
    if (isNaN(tol) || tol < 0.1 || tol > 2) return d.phToleranceRangeError
  }
  return null
}

/** 저장용 변환 — 목표를 지우면 NULL, 목표가 있을 때만 오차를 함께 싣는다. */
export function recipeToDb(r: RecipeForm): {
  target_ec: number | null
  ec_tolerance?: number
  target_ph: number | null
  ph_tolerance?: number
} {
  return {
    target_ec: r.ec ? Math.round(parseFloat(r.ec) * 1000) : null,
    ...(r.ec ? { ec_tolerance: Math.round(parseFloat(r.ecTol) * 1000) } : {}),
    target_ph: r.ph ? parseFloat(r.ph) : null,
    ...(r.ph ? { ph_tolerance: parseFloat(r.phTol) } : {}),
  }
}

export function RecipeFields({ idPrefix, value, onChange }: {
  idPrefix: string
  value: RecipeForm
  onChange: (v: RecipeForm) => void
}) {
  const { farms: d } = useAgriT()
  const set = (patch: Partial<RecipeForm>) => onChange({ ...value, ...patch })
  return (
    <div className="border-t border-border pt-4 mt-1 space-y-3">
      <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
        <FlaskConical className="w-4 h-4 text-brand-fg" aria-hidden="true" />
        {d.recipeTitle} <span className="text-xs text-muted-foreground font-normal">{d.recipeOptional}</span>
      </p>
      <p className="text-xs text-muted-foreground">{d.recipeHint}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-ec`} className={LABEL_CLS}>
            {d.targetEc} ({d.ecUnit})
          </Label>
          <Input
            id={`${idPrefix}-ec`}
            type="number" inputMode="decimal" step={0.1} min={0.1} max={10}
            placeholder={d.targetEcPlaceholder}
            className={INPUT_CLS}
            value={value.ec}
            onChange={e => set({ ec: e.target.value })}
          />
        </div>
        <div className={cn("space-y-1.5", !value.ec && "opacity-50")}>
          <Label htmlFor={`${idPrefix}-ec-tol`} className={LABEL_CLS}>
            {d.ecTolerance} (± {d.ecUnit})
          </Label>
          <Input
            id={`${idPrefix}-ec-tol`}
            type="number" inputMode="decimal" step={0.05} min={0.01} max={2}
            className={INPUT_CLS}
            value={value.ecTol}
            onChange={e => set({ ecTol: e.target.value })}
            disabled={!value.ec}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-ph`} className={LABEL_CLS}>{d.targetPh}</Label>
          <Input
            id={`${idPrefix}-ph`}
            type="number" inputMode="decimal" step={0.1} min={3} max={9}
            placeholder={d.targetPhPlaceholder}
            className={INPUT_CLS}
            value={value.ph}
            onChange={e => set({ ph: e.target.value })}
          />
        </div>
        <div className={cn("space-y-1.5", !value.ph && "opacity-50")}>
          <Label htmlFor={`${idPrefix}-ph-tol`} className={LABEL_CLS}>{d.phTolerance} (±)</Label>
          <Input
            id={`${idPrefix}-ph-tol`}
            type="number" inputMode="decimal" step={0.1} min={0.1} max={2}
            className={INPUT_CLS}
            value={value.phTol}
            onChange={e => set({ phTol: e.target.value })}
            disabled={!value.ph}
          />
        </div>
      </div>
    </div>
  )
}
