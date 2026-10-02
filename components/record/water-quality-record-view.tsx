"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { AGRI_PREFIX, belongsToAgriScreen, useAgriRoute } from "@/lib/agri-route"
import { getAllTanks, insertWaterQuality } from "@/lib/db"
import { MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { WQ_BOUNDS, WqField } from "@/lib/utils"
import { agriNumOrNull, agriEcToMicroSiemens } from "@/lib/agri-standards"
import { Tank } from "@/types"
import { StepWizard, WizardStep } from "@/components/wizard/step-wizard"
import { Building2 } from "lucide-react"
import Link from "next/link"

const TODAY = new Date().toISOString().split("T")[0]

export function WaterQualityRecordView() {
  const router = useRouter()
  const { isAgri, href: withAgri } = useAgriRoute()
  const { user } = useAuth()
  const { t } = useT()
  const mock = isTestAccount(user?.email)

  // 계정의 전체 수조. 폼에 뿌리는 목록은 아래에서 이 화면 몫만 걸러 낸다.
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
    // 농업(수경재배) 3항목. 새우 폼은 이 칸을 쓰지도 저장하지도 않는다.
    conductivity: "",
    flow_rate: "",
    diff_pressure: "",
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

  // 화면은 URL 이 정한다(설계서 3장). **쓰기 화면이라 더 엄하게 지킨다** —
  // 모니터링은 틀린 기준으로 빨갛게 칠하고 끝이지만, 여기서는 농업 폼으로
  // 새우 수조에 양액 EC 를 저장할 수 있고 그렇게 남은 행은 지워지지 않는다.
  // 반대 방향도 같다(새우 폼이 베드에 염도·알칼리도를 적는다).
  // 고를 수 없으면 저장할 수도 없다 — 목록이 유일한 관문이다(StepWizard 의
  // 수조 칸은 optional 이 아니라 비어 있으면 다음 단계로 못 넘어간다).
  const tanks = useMemo(
    () => allTanks.filter(tk => belongsToAgriScreen(tk.farm_type, isAgri)),
    [allTanks, isAgri],
  )

  const handleChange = (key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const handleComplete = async () => {
    setError(null)
    const wqFields: WqField[] = isAgri
      ? ["conductivity", "ph", "temperature", "do_level", "flow_rate", "diff_pressure"]
      : ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"]
    for (const field of wqFields) {
      const raw = values[field] as string
      if (!raw) continue
      const val = parseFloat(raw)
      if (!Number.isFinite(val)) { setError(`${WQ_BOUNDS[field].label}: ${t.journalX.errInvalidNumber}`); return }
      // EC 만 사람이 쓰는 단위(mS/cm)와 경계 단위(µS/cm)가 다르다.
      // 입력값을 µS/cm 로 올려 비교하고, 에러 문구는 mS/cm 로 되돌려 보여 준다 —
      // 그대로 쓰면 "0~20000" 이 떠서 농가가 자릿수를 오해한다(수아 시안 §2-5).
      const bound = WQ_BOUNDS[field]
      const compare = isAgri && field === "conductivity" ? val * 1000 : val
      if (compare < bound.min || compare > bound.max) {
        if (isAgri && field === "conductivity") {
          setError(t.agri.ecRangeErrorMs
            .replace("{{min}}", String(bound.min / 1000))
            .replace("{{max}}", String(bound.max / 1000)))
        } else {
          setError(`${bound.label}: ${bound.min}~${bound.max}${bound.unit} ${t.journalX.errOutOfRange}`)
        }
        return
      }
    }

    setSaving(true)
    try {
      if (!mock) {
        if (isAgri) {
          await insertWaterQuality(values.tank_id as string, {
            temperature: parseFloat(values.temperature as string) || 0,
            ph: parseFloat(values.ph as string) || 0,
            do_level: parseFloat(values.do_level as string) || 0,
            // EC 환산 지점 4/4 — 입력 mS/cm × 1000 = 저장 µS/cm.
            // (나머지 3곳: 레시피 폼 저장, 차트 목표선 라벨, 양액 상태 카드)
            //
            // 새우 6항목과 달리 이 셋은 **빈 칸을 0 이 아니라 null 로 저장한다.**
            // 저장소가 일부러 nullable 로 둔 컬럼이라서다 — 안 잰 값에 0 을 넣으면
            // buildChartData 의 `typeof === "number"` 검사를 통과해 선이 바닥으로
            // 처지고, wq_series 버킷 평균이 조용히 낮아진다.
            //
            // 단, **"0" 을 친 것과 빈 칸은 다르다.** 유량 0(펌프 정지)·차압 0 은
            // 지워서는 안 되는 실측값이다. EC 0 만 실측이 아니라 null 로 접는다
            // — 어느 쪽이 실측인지는 lib/agri-standards.ts 의 AGRI_ZERO_MEANING.
            conductivity: agriEcToMicroSiemens(values.conductivity as string),
            flow_rate: agriNumOrNull(values.flow_rate as string),
            diff_pressure: agriNumOrNull(values.diff_pressure as string),
            // 새우 6항목은 농업 폼에서 받지 않는다. 0 이면 checkThresholds 가
            // 판정에서 건너뛴다(lib/thresholds.ts).
            salinity: 0, ammonia: 0, nitrite: 0, nitrate: 0, alkalinity: 0, turbidity: 0,
            recorded_at: new Date(`${values.date as string}T12:00:00`).toISOString(),
          })
        } else {
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
      }
      setSaved(true)
      setTimeout(() => router.replace(withAgri("/dashboard")), 1200)
    } catch {
      setError(t.recordX.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // 선택한 베드의 레시피를 힌트에 실어 보낸다. tanks 는 이미 select("*") 로
  // 받아 둔 것이라 **추가 조회가 없다**.
  //
  // 아래 steps 배열은 **매 렌더 다시 만들어진다** — useMemo 로 굳히면 베드를
  // 바꾸거나 EC 를 입력해도 힌트가 따라오지 않는다(수아 시안 §8-2).
  const selectedTank = tanks.find(tk => tk.id === values.tank_id)

  const ecHint = () => {
    const parts: string[] = []
    if (selectedTank?.target_ec != null) {
      parts.push(t.agri.recordEcTarget
        .replace("{{target}}", (selectedTank.target_ec / 1000).toFixed(2))
        .replace("{{tol}}", ((selectedTank.ec_tolerance ?? 100) / 1000).toFixed(2)))
    } else {
      // 레시피가 없어도 **숫자 범위를 적지 않는다.** 힌트에 "일반적으로 1.2~2.2"
      // 를 쓰는 순간 그것이 전역 EC 기준선이 된다(수아 시안 §2-4).
      parts.push(t.agri.recordEcNoTarget)
    }
    const v = parseFloat(values.conductivity as string)
    if (Number.isFinite(v) && v > 0) {
      parts.push(t.agri.recordEcSaveNote.replace("{{v}}", Math.round(v * 1000).toLocaleString()))
    }
    return parts.join(" · ")
  }

  const phHint = () =>
    selectedTank?.target_ph != null
      ? t.agri.recordPhTarget
          .replace("{{target}}", String(selectedTank.target_ph))
          .replace("{{tol}}", String(selectedTank.ph_tolerance ?? 0.5))
      : t.agri.recordPhNoTarget

  // 농업 4스텝 — EC 가 첫 입력 항목이다(사업 KPI 가 EC 제어 정확도).
  const agriSteps: WizardStep[] = [
    {
      fields: [{ key: "tank_id", label: t.wizard.tankLabel, type: "tank" }],
    },
    {
      fields: [
        { key: "date", label: t.wizard.date, type: "date" },
        { key: "conductivity", label: "EC", type: "number", placeholder: "예: 1.85", unit: t.agri.targetEcUnit, optional: true, hint: ecHint() },
        { key: "ph", label: "pH", type: "number", placeholder: "예: 6.0", optional: true, hint: phHint() },
      ],
    },
    {
      fields: [
        { key: "temperature", label: t.waterQuality.temperature, type: "number", placeholder: "예: 21.5", unit: "°C", optional: true, hint: t.agri.recordTempHint },
        { key: "do_level", label: "DO", type: "number", placeholder: "예: 7.0", unit: "ppm", optional: true, hint: t.agri.recordDoHint },
      ],
    },
    {
      fields: [
        { key: "flow_rate", label: t.waterQualityX.flowRate, type: "number", placeholder: "예: 12", unit: "L/min", optional: true, hint: t.agri.recordFlowHint },
        { key: "diff_pressure", label: t.waterQualityX.diffPressure, type: "number", placeholder: "예: 15", unit: "kPa", optional: true, hint: t.agri.recordDpHint },
      ],
      title: t.wizard.confirmTitle,
    },
  ]

  const shrimpSteps: WizardStep[] = [
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

  const steps = isAgri ? agriSteps : shrimpSteps

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

  // 이 화면 몫의 수조가 하나도 없을 때. `!mock` 조건을 뺐다 — 목데이터는
  // 전부 새우라 데모 계정이 농업 주소를 직접 치면 목록이 비는데, 예전 조건
  // 이면 그 경우에 빈 드롭다운짜리 마법사가 떴다.
  if (tanks.length === 0) {
    // 다른 축에는 수조가 있는가. 있으면 "농장을 등록하세요"가 아니라 그
    // 수조가 사는 화면으로 보낸다(설계서 5-4 의 화면 전환 진입점과 같은 문구).
    const crossAxis = allTanks.length > 0
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
          href={crossAxis ? (isAgri ? "/home" : `${AGRI_PREFIX}/home`) : "/onboarding"}
          className="inline-flex items-center gap-2 bg-ocean-500 hover:bg-ocean-600 text-white font-semibold px-6 min-h-[44px] py-3 rounded-xl transition-colors"
        >
          <Building2 className="w-4 h-4" aria-hidden="true" />
          {crossAxis
            ? (isAgri ? t.agri.openShrimpScreen : t.agri.openAgriScreen)
            : t.recordX.registerFarmCta}
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
      notice={isAgri ? t.agri.recordNotice : undefined}
    />
  )
}
