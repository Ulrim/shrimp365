"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getAllTanks } from "@/lib/db"
import { MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { Tank } from "@/types"
import { StepWizard, WizardStep } from "@/components/wizard/step-wizard"
import { FEED_TYPES, MICROBIAL_TYPES, loadJournalDefaults, saveJournalDefaults, submitJournal, JournalFormValues } from "@/lib/record-actions"

const TODAY = new Date().toISOString().split("T")[0]

export default function RecordJournalPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useT()
  const mock = isTestAccount(user?.email)

  const [tanks, setTanks] = useState<Tank[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const defaults = typeof window !== "undefined" ? loadJournalDefaults() : {}
    return {
      tank_id: "",
      date: TODAY,
      feed_type: defaults.feed_type ?? FEED_TYPES[2],
      feeding_amount: "",
      feeding_times: defaults.feeding_times ?? "4",
      mortality_count: "",
      water_exchange_rate: "",
      disinfection: defaults.disinfection ?? false,
      disinfection_type: defaults.disinfection_type ?? "",
      microbial_input: defaults.microbial_input ?? false,
      microbial_type: defaults.microbial_type ?? MICROBIAL_TYPES[0],
      microbial_amount: "",
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
  })

  useEffect(() => {
    if (mock) { setTanks(MOCK_TANKS); return }
    getAllTanks().then(setTanks).catch(() => setTanks([]))
  }, [mock])

  const handleChange = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const handleComplete = async () => {
    setError(null)
    setSaving(true)
    try {
      if (!mock) {
        await submitJournal(values as unknown as JournalFormValues, { mock })
      }
      saveJournalDefaults(values)
      setSaved(true)
      setTimeout(() => router.replace("/home"), 1200)
    } catch {
      setError("저장에 실패했습니다. 다시 시도해주세요.")
    } finally {
      setSaving(false)
    }
  }

  const steps: WizardStep[] = [
    {
      fields: [{ key: "tank_id", label: "수조 선택", type: "tank" }],
    },
    {
      fields: [{ key: "date", label: t.wizard.date, type: "date" }],
    },
    {
      fields: [
        { key: "feed_type", label: "사료 종류", type: "select", options: FEED_TYPES },
      ],
    },
    {
      fields: [
        { key: "feeding_amount", label: "급이량", type: "number", placeholder: "예: 3.5", unit: "kg" },
        { key: "feeding_times", label: "급이 횟수", type: "number", placeholder: "예: 4", unit: "회/일" },
      ],
    },
    {
      fields: [{ key: "mortality_count", label: "폐사 수", type: "number", placeholder: "예: 0", unit: "마리", optional: true }],
    },
    {
      fields: [{ key: "water_exchange_rate", label: "환수율", type: "number", placeholder: "예: 20", unit: "%", optional: true }],
    },
    {
      fields: [
        { key: "disinfection", label: "소독 여부", type: "switch" },
        { key: "disinfection_type", label: "소독 종류", type: "text", placeholder: "소독제 이름", optional: true, dependsOn: { key: "disinfection", value: true } },
      ],
    },
    {
      fields: [
        { key: "microbial_input", label: "미생물 투여", type: "switch" },
        { key: "microbial_type", label: "미생물 종류", type: "select", options: MICROBIAL_TYPES, dependsOn: { key: "microbial_input", value: true }, optional: true },
        { key: "microbial_amount", label: "미생물 투여량", type: "number", placeholder: "예: 0.5", unit: "kg", dependsOn: { key: "microbial_input", value: true }, optional: true },
      ],
    },
    {
      title: "설비 점검",
      fields: [
        { key: "check_aeration", label: "폭기 장치", type: "switch" },
        { key: "check_filtration", label: "여과 장치", type: "switch" },
        { key: "check_circulation", label: "순환 장치", type: "switch" },
        { key: "check_feeding_check", label: "급이 장치", type: "switch" },
      ],
    },
    {
      fields: [
        { key: "notes", label: "메모", type: "textarea", placeholder: "특이사항을 입력하세요", optional: true },
      ],
      title: t.wizard.confirmTitle,
    },
  ]

  return (
    <StepWizard
      title={t.record.journal}
      steps={steps}
      tanks={tanks}
      values={values}
      onChange={handleChange}
      onComplete={handleComplete}
      saving={saving}
      saved={saved}
      error={error}
    />
  )
}
