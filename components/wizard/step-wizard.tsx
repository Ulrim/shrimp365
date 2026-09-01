"use client"

import { useState } from "react"
import { useT } from "@/lib/i18n-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Check, Info } from "lucide-react"
import { Tank } from "@/types"

export type StepField = {
  key: string
  label: string
  type: "number" | "select" | "switch" | "text" | "textarea" | "date" | "tank"
  placeholder?: string
  optional?: boolean
  unit?: string
  options?: string[]
  dependsOn?: { key: string; value: unknown }
  hint?: string
}

export type WizardStep = {
  fields: StepField[]
  title?: string
}

type Props = {
  title: string
  steps: WizardStep[]
  tanks: Tank[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onComplete: () => Promise<void>
  saving?: boolean
  saved?: boolean
  error?: string | null
  /** 폼 전체에 대한 안내 한 줄. 첫 스텝에서만 뜬다.
   *  새우 폼은 넘기지 않으므로 undefined — 렌더 결과가 이전과 완전히 같다. */
  notice?: string
}

export function StepWizard({ title, steps, tanks, values, onChange, onComplete, saving, saved, error, notice }: Props) {
  const { t } = useT()
  const [step, setStep] = useState(0)
  const total = steps.length
  const current = steps[step]

  const isLastStep = step === total - 1

  const handleNext = () => {
    if (isLastStep) {
      onComplete()
    } else {
      setStep(s => s + 1)
    }
  }

  const handleBack = () => setStep(s => Math.max(0, s - 1))

  const canAdvance = current.fields.every(f => {
    if (f.optional) return true
    if (f.dependsOn) {
      const depVal = values[f.dependsOn.key]
      if (depVal !== f.dependsOn.value) return true
    }
    const val = values[f.key]
    if (f.type === "switch") return true
    return val !== "" && val !== undefined && val !== null
  })

  return (
    <div className="w-full max-w-md mx-auto px-4 pt-6 pb-6">
      {/* Header */}
      <div className="mb-5 text-center">
        <h1 className="text-2xl font-bold text-foreground mb-1">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {t.wizard.step} {step + 1} / {total}
        </p>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-2 bg-muted rounded-full mb-5 overflow-hidden"
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`${step + 1}단계 / ${total}단계`}
      >
        <div
          className="h-full bg-ocean-500 rounded-full transition-all duration-300"
          style={{ width: `${((step + 1) / total) * 100}%` }}
        />
      </div>

      {/* 폼 전체 안내 — 필드에 딸린 힌트(bg-muted/50)와 다른 색·위치로 구분한다 */}
      {notice && step === 0 && (
        <p className="text-xs text-muted-foreground leading-relaxed bg-ocean-500/5 border border-ocean-500/20 rounded-xl px-3 py-2 mb-4 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-ocean-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      )}

      {/* Step card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
        {current.title && (
          <h2 className="text-lg font-semibold text-foreground">{current.title}</h2>
        )}

        {current.fields.map(field => {
          if (field.dependsOn) {
            const depVal = values[field.dependsOn.key]
            if (depVal !== field.dependsOn.value) return null
          }

          const value = values[field.key]

          return (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key} className="text-sm font-medium text-foreground">
                {field.label}
                {field.optional && <span className="text-muted-foreground ml-1 text-xs">(선택)</span>}
                {field.unit && <span className="text-muted-foreground ml-1 text-xs">({field.unit})</span>}
              </Label>

              {field.type === "tank" && (
                <Select value={value as string} onValueChange={v => onChange(field.key, v)}>
                  <SelectTrigger
                    className="w-full h-14 text-base min-h-[44px]"
                    aria-label={field.label}
                    aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                  >
                    <SelectValue placeholder={t.wizard.selectTank} />
                  </SelectTrigger>
                  <SelectContent>
                    {tanks.map(tk => (
                      <SelectItem key={tk.id} value={tk.id}>{tk.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {field.type === "date" && (
                <Input
                  id={field.key}
                  type="date"
                  className="h-14 text-base min-h-[44px]"
                  value={value as string}
                  onChange={e => onChange(field.key, e.target.value)}
                  aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                />
              )}

              {field.type === "number" && (
                <Input
                  id={field.key}
                  type="number"
                  inputMode="decimal"
                  className="h-14 text-base min-h-[44px]"
                  placeholder={field.placeholder}
                  value={value as string}
                  onChange={e => onChange(field.key, e.target.value)}
                  aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                />
              )}

              {field.type === "text" && (
                <Input
                  id={field.key}
                  type="text"
                  inputMode="text"
                  className="h-14 text-base min-h-[44px]"
                  placeholder={field.placeholder}
                  value={value as string}
                  onChange={e => onChange(field.key, e.target.value)}
                  aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                />
              )}

              {field.type === "textarea" && (
                <textarea
                  id={field.key}
                  className="w-full min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={field.placeholder}
                  value={value as string}
                  onChange={e => onChange(field.key, e.target.value)}
                />
              )}

              {field.type === "select" && field.options && (
                <Select value={value as string} onValueChange={v => onChange(field.key, v)}>
                  <SelectTrigger
                    className="w-full h-14 text-base min-h-[44px]"
                    aria-label={field.label}
                    aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                  >
                    <SelectValue placeholder={field.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {field.type === "switch" && (
                <div className="flex items-center gap-3 h-14 px-1">
                  <Switch
                    id={field.key}
                    checked={value as boolean}
                    onCheckedChange={v => onChange(field.key, v)}
                  />
                  <span className="text-base text-foreground">{value ? "예" : "아니오"}</span>
                </div>
              )}

              {field.hint && (
                <p id={`hint-${field.key}`} className="text-xs text-muted-foreground leading-relaxed bg-muted/50 rounded-lg px-3 py-2 border border-border">{field.hint}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive mt-3 text-center">{error}</p>
      )}

      {/* Navigation — immediately below card */}
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="lg"
          className="h-14 px-6 text-base flex-1"
          onClick={handleBack}
          disabled={step === 0}
        >
          <ChevronLeft className="w-5 h-5 mr-1" />
          {t.wizard.back}
        </Button>

        <Button
          size="lg"
          className={cn(
            "h-14 px-6 text-base flex-1",
            saved ? "bg-emerald-500 hover:bg-emerald-600" : ""
          )}
          onClick={handleNext}
          disabled={!canAdvance || saving}
        >
          {saved ? (
            <><Check className="w-5 h-5 mr-1" />{t.wizard.saved}</>
          ) : saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {t.wizard.save}
            </span>
          ) : isLastStep ? (
            <><Check className="w-5 h-5 mr-1" />{t.wizard.save}</>
          ) : (
            <>{t.wizard.next}<ChevronRight className="w-5 h-5 ml-1" /></>
          )}
        </Button>
      </div>
    </div>
  )
}
