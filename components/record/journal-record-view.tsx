"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getAllTanks } from "@/lib/db"
import { MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { Tank } from "@/types"
import { StepWizard, WizardStep } from "@/components/wizard/step-wizard"
import { FEED_TYPES, MICROBIAL_TYPES, loadJournalDefaults, saveJournalDefaults, submitJournal, JournalFormValues } from "@/lib/record-actions"
import { Building2 } from "lucide-react"
import Link from "next/link"

const TODAY = new Date().toISOString().split("T")[0]

export function JournalRecordView() {
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useT()
  const mock = isTestAccount(user?.email)

  // 계정의 전체 수조. 폼에 뿌리는 목록은 아래에서 새우 수조만 걸러 낸다.
  const [allTanks, setAllTanks] = useState<Tank[]>([])
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

  const [loadingTanks, setLoadingTanks] = useState(!mock)
  const [tankLoadError, setTankLoadError] = useState(false)

  useEffect(() => {
    if (mock) { setAllTanks(MOCK_TANKS); return }
    getAllTanks()
      .then(result => { setAllTanks(result); setLoadingTanks(false) })
      .catch(() => { setTankLoadError(true); setLoadingTanks(false) })
  }, [mock])

  // 이 화면은 새우 전용이다(농업 일지 폼은 components/agri/agri-journal-record-view.tsx).
  // **쓰기 화면이라 더 엄하게 지킨다** — 안 거르면 혼합 계정에서 새우 폼(급이 kg·
  // 폐사 마리)이 수경재배 베드에 저장된다. 같은 컬럼을 두 뜻으로 쓰는 설계라
  // 잘못 적힌 행은 나중에 구분할 방법도 없다. 고를 수 없으면 저장할 수도 없다.
  const tanks = useMemo(
    () => allTanks.filter(tk => (tk.farm_type ?? "shrimp") !== "agriculture"),
    [allTanks],
  )

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
      setError(t.recordX.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const steps: WizardStep[] = [
    {
      // Step 1: 수조 + 날짜
      fields: [
        { key: "tank_id", label: t.wizard.tankLabel, type: "tank" },
        { key: "date", label: t.wizard.date, type: "date" },
      ],
    },
    {
      // Step 2: 사료
      fields: [
        { key: "feed_type", label: "사료 종류", type: "select", options: FEED_TYPES },
        { key: "feeding_amount", label: "급이량", type: "number", placeholder: "예: 3.5", unit: "kg" },
        { key: "feeding_times", label: "급이 횟수", type: "number", placeholder: "예: 4", unit: "회/일" },
      ],
    },
    {
      // Step 3: 건강 관리
      fields: [
        { key: "mortality_count", label: "폐사 수", type: "number", placeholder: "예: 0", unit: "마리", optional: true },
        { key: "water_exchange_rate", label: "일일 환수율", type: "number", placeholder: "예: 20", unit: "%/일", optional: true, hint: "하루 교환하는 물의 비율 (10~30% 권장)" },
      ],
    },
    {
      // Step 4: 소독 + 미생물
      fields: [
        { key: "disinfection", label: "소독 여부", type: "switch" },
        { key: "disinfection_type", label: "소독 종류", type: "text", placeholder: "소독제 이름", optional: true, dependsOn: { key: "disinfection", value: true } },
        { key: "microbial_input", label: "미생물 투여", type: "switch" },
        { key: "microbial_type", label: "미생물 종류", type: "select", options: MICROBIAL_TYPES, dependsOn: { key: "microbial_input", value: true }, optional: true },
        { key: "microbial_amount", label: "미생물 투여량", type: "number", placeholder: "예: 0.5", unit: "kg", dependsOn: { key: "microbial_input", value: true }, optional: true },
      ],
    },
    {
      // Step 5: 설비 점검 + 메모
      title: t.wizard.confirmTitle,
      fields: [
        { key: "check_aeration", label: "폭기 장치", type: "switch" },
        { key: "check_filtration", label: "여과 장치", type: "switch" },
        { key: "check_circulation", label: "순환 장치", type: "switch" },
        { key: "check_feeding_check", label: "급이 장치", type: "switch" },
        { key: "notes", label: "메모", type: "textarea", placeholder: "특이사항을 입력하세요", optional: true },
      ],
    },
  ]

  if (loadingTanks) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (tankLoadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center gap-4">
        <p className="text-destructive font-medium">{t.recordX.tankLoadFailed}</p>
        <button
          onClick={() => { setTankLoadError(false); setLoadingTanks(true); getAllTanks().then(r => { setAllTanks(r); setLoadingTanks(false) }).catch(() => { setTankLoadError(true); setLoadingTanks(false) }) }}
          className="text-sm text-emerald-600 underline"
        >
          {t.homeHub.retry}
        </button>
      </div>
    )
  }

  // 새우 수조가 하나도 없을 때. `!mock` 조건을 뺐다 — 조건이 있으면 데모 계정은
  // 빈 드롭다운짜리 마법사가 뜬다. 수경재배 베드만 있는 계정도 여기로 온다 —
  // 그 베드는 스마트팜 화면(헤더 스위치)에서 다룬다.
  if (tanks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
          <Building2 className="w-8 h-8 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground mb-2">{t.recordX.noTanksTitle}</h2>
          <p className="text-muted-foreground text-sm">{t.recordX.noTanksJournalMsg}</p>
        </div>
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 min-h-[44px] py-3 rounded-xl transition-colors"
        >
          <Building2 className="w-4 h-4" />
          {t.recordX.registerFarmCta}
        </Link>
      </div>
    )
  }

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
