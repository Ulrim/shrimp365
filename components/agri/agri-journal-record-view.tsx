"use client"

// 영농 일지 폼 `/daumlabs/record/journal` — 수아 시안 mode-split-ui.md 5-4.
//
// StepWizard(공용, 수정 금지) 4스텝: 베드·날짜 → 양액 관리 → 재배 작업 → 설비 점검.
// 컬럼 매핑은 journal_entries 그대로다(feed_type = 양액 종류, feeding_amount = 보충량 L,
// water_exchange_rate = 교환율 %, disinfection = 방제, microbial_* = 자재 투입,
// check_* = 설비 점검). 농업에 대응물이 없는 mortality_count 는 폼에 없고 0 으로
// 저장한다 — 다른 뜻으로 재활용하지 않는다.
import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT, useAgriT } from "@/lib/i18n-context"
import { getAllTanks } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { loadJournalDefaults, saveJournalDefaults, submitJournal, type JournalFormValues } from "@/lib/record-actions"
import { AGRI_NUTRIENT_TYPES, AGRI_INPUT_TYPES } from "@/components/agri/agri-journal-constants"
import { StepWizard, type WizardStep } from "@/components/wizard/step-wizard"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { AgriSpinner, AgriLoadError } from "@/components/agri/agri-load-state"
import { Building2, BookOpen, RotateCcw } from "lucide-react"
import type { Tank } from "@/types"

const TODAY = new Date().toISOString().split("T")[0]

// 마지막으로 쓴 양액 종류·점검 상태를 기본값으로 — 농업 폼은 키를 분리해 저장한다
// (`loadJournalDefaults(true)`), 한 계정이 두 폼을 오가도 섞이지 않는다.
function initialValues(): Record<string, unknown> {
  const defaults = typeof window !== "undefined" ? loadJournalDefaults(true) : {}
  return {
    tank_id: "",
    date: TODAY,
    feed_type: defaults.feed_type ?? AGRI_NUTRIENT_TYPES[0],
    feeding_amount: "",
    feeding_times: defaults.feeding_times ?? "",
    mortality_count: "0",
    water_exchange_rate: "",
    disinfection: defaults.disinfection ?? false,
    disinfection_type: defaults.disinfection_type ?? "",
    microbial_input: defaults.microbial_input ?? false,
    microbial_type: defaults.microbial_type ?? AGRI_INPUT_TYPES[0],
    microbial_amount: "",
    // 재고 연동 칸 — 농업 화면에는 재고 페이지가 없어 비워 보낸다(차감 없음).
    feedItemId: "",
    microbialItemId: "",
    chemicalItemId: "",
    chemicalQty: "",
    check_aeration: defaults.check_aeration ?? false,
    check_filtration: defaults.check_filtration ?? false,
    check_circulation: defaults.check_circulation ?? false,
    check_feeding_check: defaults.check_feeding_check ?? false,
    notes: "",
  }
}

export function AgriJournalRecordView() {
  const { user } = useAuth()
  const { t } = useT()
  const { common, record: r } = useAgriT()
  const mock = isTestAccount(user?.email)

  const [tanks, setTanks] = useState<Tank[]>([])
  const [loadingTanks, setLoadingTanks] = useState(true)
  const [tankLoadError, setTankLoadError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    let alive = true
    // 테스트 계정은 목데이터가 전부 새우라 농업 베드가 없다 — 빈 상태가 정상.
    const load = mock ? Promise.resolve<Tank[]>([]) : getAllTanks()
    load
      .then(list => {
        if (!alive) return
        // 쓰기 화면이라 더 엄하게 — 농업 일지(양액 보충·방제)가 다른 유형 농장의 행에
        // 저장되지 않게. 같은 컬럼을 두 뜻으로 쓰는 설계라 잘못 적힌 행은 나중에
        // 구분할 방법도 없다. 고를 수 없으면 저장할 수도 없다.
        setTanks(list.filter(tk => tk.farm_type === "agriculture"))
        setLoadingTanks(false)
      })
      .catch(() => {
        if (!alive) return
        setTankLoadError(true)
        setLoadingTanks(false)
      })
    return () => { alive = false }
  }, [mock, retry])

  const handleChange = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const handleComplete = async () => {
    if (saved) return
    setError(null)
    setSaving(true)
    try {
      if (!mock) {
        await submitJournal({ ...values, mortality_count: "0" } as unknown as JournalFormValues, { mock })
      }
      saveJournalDefaults(values, true)
      setSaved(true)
    } catch {
      setError(r.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleAgain = () => {
    setValues(prev => ({ ...initialValues(), tank_id: prev.tank_id, date: prev.date }))
    setSaved(false)
    setError(null)
    setFormKey(k => k + 1)
  }

  // 설비 점검 순서는 양액이 도는 순서(펌프 → 필터·UV → 칠러)를 따라간다 — 현장
  // 점검 동선과 같다. 선택지 배열은 StepWizard 가 string[] 을 받으므로 복사해 넘긴다.
  const steps: WizardStep[] = [
    {
      title: r.jStepBedDate,
      fields: [
        { key: "tank_id", label: common.bed, type: "tank" },
        { key: "date", label: t.wizard.date, type: "date" },
      ],
    },
    {
      title: r.jStepNutrient,
      fields: [
        { key: "feed_type", label: r.nutrientType, type: "select", options: [...AGRI_NUTRIENT_TYPES] },
        { key: "feeding_amount", label: r.nutrientRefill, type: "number", placeholder: r.nutrientRefillPlaceholder, unit: r.nutrientRefillUnit, optional: true, hint: r.nutrientRefillHint },
        { key: "feeding_times", label: r.refillTimes, type: "number", placeholder: r.refillTimesPlaceholder, unit: r.refillTimesUnit, optional: true },
        { key: "water_exchange_rate", label: r.exchangeRate, type: "number", placeholder: r.exchangeRatePlaceholder, unit: "%", optional: true, hint: r.exchangeRateHint },
      ],
    },
    {
      title: r.jStepWork,
      fields: [
        { key: "disinfection", label: r.pestControl, type: "switch" },
        { key: "disinfection_type", label: r.pestAgent, type: "text", placeholder: r.pestAgentPlaceholder, optional: true, dependsOn: { key: "disinfection", value: true } },
        { key: "microbial_input", label: r.inputApplied, type: "switch" },
        { key: "microbial_type", label: r.inputType, type: "select", options: [...AGRI_INPUT_TYPES], dependsOn: { key: "microbial_input", value: true }, optional: true },
        { key: "microbial_amount", label: r.inputAmount, type: "number", placeholder: r.inputAmountPlaceholder, unit: r.inputAmountUnit, dependsOn: { key: "microbial_input", value: true }, optional: true, hint: r.inputAmountHint },
      ],
    },
    {
      title: r.jStepCheck,
      fields: [
        { key: "check_circulation", label: r.checkPump, type: "switch" },
        { key: "check_filtration", label: r.checkFilterUv, type: "switch" },
        { key: "check_aeration", label: r.checkChiller, type: "switch" },
        { key: "check_feeding_check", label: r.checkGrowth, type: "switch" },
        { key: "notes", label: r.notes, type: "textarea", placeholder: r.notesPlaceholder, optional: true },
      ],
    },
  ]

  if (loadingTanks) return <AgriSpinner />
  if (tankLoadError) {
    return (
      <AgriLoadError
        title={r.bedLoadFailed}
        onRetry={() => { setTankLoadError(false); setLoadingTanks(true); setRetry(n => n + 1) }}
      />
    )
  }
  if (tanks.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <AgriEmptyState
          icon={Building2}
          title={r.noBedsTitle}
          description={r.noBedsJournalMsg}
          ctaLabel={common.registerFarm}
          ctaHref="/daumlabs/farms"
          className="w-full max-w-md border-0 bg-transparent"
        />
      </div>
    )
  }

  return (
    <>
      <StepWizard
        key={formKey}
        title={r.journalTitle}
        steps={steps}
        tanks={tanks}
        values={values}
        onChange={handleChange}
        onComplete={handleComplete}
        saving={saving}
        saved={saved}
        error={error}
      />
      {saved && (
        <div className="w-full max-w-md mx-auto px-4 pb-8 grid grid-cols-1 sm:grid-cols-2 gap-3" role="status">
          <Link
            href="/daumlabs/journal"
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors duration-200"
          >
            <BookOpen className="w-4 h-4" aria-hidden="true" />
            {r.savedViewJournal}
          </Link>
          <button
            type="button"
            onClick={handleAgain}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors duration-200"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            {r.savedAgain}
          </button>
        </div>
      )}
    </>
  )
}
