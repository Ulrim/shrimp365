"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getAllTanks, insertWaterQuality } from "@/lib/db"
import { MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { WQ_BOUNDS, WqField } from "@/lib/utils"
import { Tank } from "@/types"
import { StepWizard, WizardStep } from "@/components/wizard/step-wizard"

const TODAY = new Date().toISOString().split("T")[0]

export default function RecordWaterQualityPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useT()
  const mock = isTestAccount(user?.email)

  const [tanks, setTanks] = useState<Tank[]>([])
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

  useEffect(() => {
    if (mock) { setTanks(MOCK_TANKS); return }
    getAllTanks().then(setTanks).catch(() => setTanks([]))
  }, [mock])

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
      if (!Number.isFinite(val)) { setError(`${WQ_BOUNDS[field].label}: 유효한 숫자를 입력해주세요.`); return }
      if (val < WQ_BOUNDS[field].min || val > WQ_BOUNDS[field].max) {
        setError(`${WQ_BOUNDS[field].label}: ${WQ_BOUNDS[field].min}~${WQ_BOUNDS[field].max}${WQ_BOUNDS[field].unit} 범위를 벗어났습니다.`)
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
      fields: [{ key: "temperature", label: t.waterQuality.temperature, type: "number", placeholder: "예: 28.5", unit: "°C", optional: true }],
    },
    {
      fields: [{ key: "ph", label: t.waterQuality.ph, type: "number", placeholder: "예: 7.8", optional: true }],
    },
    {
      fields: [{ key: "do_level", label: t.waterQuality.do_, type: "number", placeholder: "예: 6.5", unit: "mg/L", optional: true }],
    },
    {
      fields: [{ key: "salinity", label: t.waterQuality.salinity, type: "number", placeholder: "예: 15", unit: "ppt", optional: true }],
    },
    {
      fields: [{ key: "ammonia", label: t.waterQuality.ammonia, type: "number", placeholder: "예: 0.1", unit: "mg/L", optional: true }],
    },
    {
      fields: [{ key: "nitrite", label: t.waterQuality.nitrite, type: "number", placeholder: "예: 0.05", unit: "mg/L", optional: true }],
    },
    {
      fields: [{ key: "nitrate", label: t.waterQuality.nitrate, type: "number", placeholder: "예: 5", unit: "mg/L", optional: true }],
    },
    {
      fields: [{ key: "alkalinity", label: t.waterQuality.alkalinity, type: "number", placeholder: "예: 150", unit: "mg/L", optional: true }],
    },
    {
      fields: [{ key: "turbidity", label: t.waterQuality.turbidity, type: "number", placeholder: "예: 10", unit: "NTU", optional: true }],
      title: t.wizard.confirmTitle,
    },
  ]

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
