"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getAllTanks, insertWaterQuality } from "@/lib/db"
import { MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { WQ_BOUNDS, WqField } from "@/lib/utils"
import { Tank } from "@/types"
import { StepWizard, WizardStep } from "@/components/wizard/step-wizard"
import { Building2 } from "lucide-react"
import Link from "next/link"

const TODAY = new Date().toISOString().split("T")[0]

export function WaterQualityRecordView() {
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useT()
  const mock = isTestAccount(user?.email)

  // 계정의 전체 수조. 폼에 뿌리는 목록은 아래에서 새우 수조만 걸러 낸다.
  const [allTanks, setAllTanks] = useState<Tank[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({
    tank_id: "",
    date: TODAY,
    temperature: "",
    ph: "",
    do_level: "",
    salinity: "",
    ammonia: "",
    nitrite: "",
    nitrate: "",
    alkalinity: "",
    turbidity: "",
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [loadingTanks, setLoadingTanks] = useState(!mock)
  const [tankLoadError, setTankLoadError] = useState(false)

  useEffect(() => {
    if (mock) { setAllTanks(MOCK_TANKS); return }
    getAllTanks()
      .then(result => { setAllTanks(result); setLoadingTanks(false) })
      .catch(() => { setTankLoadError(true); setLoadingTanks(false) })
  }, [mock])

  // 이 화면은 새우 전용이다(농업 측정 폼은 components/agri/agri-measure-record-view.tsx).
  // **쓰기 화면이라 더 엄하게 지킨다** — 안 거르면 혼합 계정에서 새우 폼이
  // 수경재배 베드에 염도·알칼리도를 적고, 그렇게 남은 행은 지워지지 않는다.
  // 고를 수 없으면 저장할 수도 없다 — 목록이 유일한 관문이다(StepWizard 의
  // 수조 칸은 optional 이 아니라 비어 있으면 다음 단계로 못 넘어간다).
  const tanks = useMemo(
    () => allTanks.filter(tk => (tk.farm_type ?? "shrimp") !== "agriculture"),
    [allTanks],
  )

  const handleChange = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const handleComplete = async () => {
    setError(null)
    const wqFields: WqField[] = ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"]
    for (const field of wqFields) {
      const raw = values[field] as string
      if (!raw) continue
      const val = parseFloat(raw)
      if (!Number.isFinite(val)) { setError(`${WQ_BOUNDS[field].label}: ${t.journalX.errInvalidNumber}`); return }
      const bound = WQ_BOUNDS[field]
      if (val < bound.min || val > bound.max) {
        setError(`${bound.label}: ${bound.min}~${bound.max}${bound.unit} ${t.journalX.errOutOfRange}`)
        return
      }
    }

    setSaving(true)
    try {
      if (!mock) {
        await insertWaterQuality(values.tank_id as string, {
          temperature: parseFloat(values.temperature as string) || 0,
          ph: parseFloat(values.ph as string) || 0,
          do_level: parseFloat(values.do_level as string) || 0,
          salinity: parseFloat(values.salinity as string) || 0,
          ammonia: parseFloat(values.ammonia as string) || 0,
          nitrite: parseFloat(values.nitrite as string) || 0,
          nitrate: parseFloat(values.nitrate as string) || 0,
          alkalinity: parseFloat(values.alkalinity as string) || 0,
          turbidity: parseFloat(values.turbidity as string) || 0,
          recorded_at: new Date(`${values.date as string}T12:00:00`).toISOString(),
        })
      }
      setSaved(true)
      setTimeout(() => router.replace("/dashboard"), 1200)
    } catch {
      setError(t.recordX.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const steps: WizardStep[] = [
    {
      fields: [{ key: "tank_id", label: t.wizard.tankLabel, type: "tank" }],
    },
    {
      fields: [
        { key: "date", label: t.wizard.date, type: "date" },
        { key: "temperature", label: t.waterQuality.temperature, type: "number", placeholder: "예: 28.5", unit: "°C", optional: true, hint: "최적 범위: 26~28°C" },
        { key: "salinity", label: t.waterQuality.salinity, type: "number", placeholder: "예: 20", unit: "‰", optional: true, hint: "흰다리새우 적정 15~35‰ (=ppt)" },
      ],
    },
    {
      fields: [
        { key: "ph", label: t.waterQuality.ph, type: "number", placeholder: "예: 7.8", optional: true, hint: "최적 범위: 7.8~8.5" },
        { key: "do_level", label: "용존산소 (DO)", type: "number", placeholder: "예: 6.5", unit: "mg/L", optional: true, hint: "최적: 7.0 mg/L 이상 (5.0 미만 위험)" },
      ],
    },
    {
      fields: [
        { key: "ammonia", label: t.waterQuality.ammonia, type: "number", placeholder: "예: 0.1", unit: "mg/L", optional: true, hint: "0.5 mg/L 이상 시 위험" },
        { key: "nitrite", label: t.waterQuality.nitrite, type: "number", placeholder: "예: 0.05", unit: "mg/L", optional: true, hint: "0.1 mg/L 이상 시 주의" },
        { key: "nitrate", label: t.waterQuality.nitrate, type: "number", placeholder: "예: 5", unit: "mg/L", optional: true, hint: "20 mg/L 이하 권장" },
      ],
    },
    {
      fields: [
        { key: "alkalinity", label: t.waterQuality.alkalinity, type: "number", placeholder: "예: 150", unit: "mg/L", optional: true, hint: "최적 범위: 100~150 mg/L" },
        { key: "turbidity", label: t.waterQuality.turbidity, type: "number", placeholder: "예: 10", unit: "NTU", optional: true, hint: "10 NTU 이하 권장" },
      ],
      title: t.wizard.confirmTitle,
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
          className="text-sm text-ocean-600 underline"
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
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <Building2 className="w-8 h-8 text-ocean-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground mb-2">{t.recordX.noTanksTitle}</h2>
          <p className="text-muted-foreground text-sm">{t.recordX.noTanksWqMsg}</p>
        </div>
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-2 bg-ocean-500 hover:bg-ocean-600 text-white font-semibold px-6 min-h-[44px] py-3 rounded-xl transition-colors"
        >
          <Building2 className="w-4 h-4" aria-hidden="true" />
          {t.recordX.registerFarmCta}
        </Link>
      </div>
    )
  }

  return (
    <StepWizard
      title={t.record.waterQuality}
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
