"use client"

// 측정 기록 폼 `/daumlabs/record/water-quality` — 수아 시안 mode-split-ui.md 5-3.
//
// StepWizard(공용)를 그대로 쓰고 이 뷰는 **steps 배열과 저장 함수만** 가진다. 위저드 안
// 문구·진행바 색은 props(labels·progressClass)로 농업 사전·brand 토큰을 넘긴다.
// 4스텝: 베드 선택 → 양액 농도(EC·pH) → 양액 환경(온도·DO) → 순환 라인(유량·차압).
//
// 빈 칸 = null 규칙(저장 함수):
//   conductivity           agriEcToMicroSiemens — 빈 칸·"0" 모두 null, 저장은 µS/cm(×1000)
//   ph·temperature·do_level agriNumOrNull ?? 0  — 컬럼 0 채움 관례(agri-standards 주석), 0 은 화면에서 미측정
//   flow_rate·diff_pressure agriNumOrNull       — "0" 은 0 으로 산다(펌프 정지)
// 어느 항목에서 0 이 실측인지는 lib/agri-standards.ts 의 AGRI_ZERO_MEANING 한 곳.
import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT, useAgriT } from "@/lib/i18n-context"
import { getAllTanks, insertWaterQuality } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { AGRI_PARAMS, agriParam, agriParamLabel, type AgriParamKey } from "@/lib/agri-params"
import { agriNumOrNull, agriEcToMicroSiemens } from "@/lib/agri-standards"
import { StepWizard, type WizardStep } from "@/components/wizard/step-wizard"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { AgriSpinner, AgriLoadError } from "@/components/agri/agri-load-state"
import { Building2, TrendingUp, RotateCcw } from "lucide-react"
import type { Tank } from "@/types"

const TODAY = new Date().toISOString().split("T")[0]

const INITIAL_VALUES: Record<string, unknown> = {
  tank_id: "",
  date: TODAY,
  conductivity: "",
  ph: "",
  temperature: "",
  do_level: "",
  flow_rate: "",
  diff_pressure: "",
}

// 이 폼에 칸이 없는 컬럼. insertWaterQuality 시그니처가 number 를 요구해 0 으로
// 채운다 — 0 은 checkThresholds 가 판정에서 건너뛴다(lib/thresholds.ts). 폼에서
// 받지 않으므로 어떤 값도 사용자 입력에서 오지 않는다.
const COLUMNS_NOT_IN_FORM = { salinity: 0, ammonia: 0, nitrite: 0, nitrate: 0, alkalinity: 0, turbidity: 0 } as const

/** 제출 시 범위 검사 — 값이 있을 때만. 기준이 없는 항목(온도·DO·유량·차압)은 검사하지 않는다. */
const RANGE: Partial<Record<AgriParamKey, { min: number; max: number }>> = {
  conductivity: { min: 0.1, max: 10 },
  ph: { min: 0, max: 14 },
}

export function AgriMeasureRecordView() {
  const { user } = useAuth()
  const { t } = useT()
  const d = useAgriT()
  const { common, record: r } = d
  const mock = isTestAccount(user?.email)

  const [tanks, setTanks] = useState<Tank[]>([])
  const [loadingTanks, setLoadingTanks] = useState(true)
  const [tankLoadError, setTankLoadError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [values, setValues] = useState<Record<string, unknown>>(INITIAL_VALUES)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "한 건 더 기록" 은 StepWizard 를 다시 마운트해 내부 step 을 0 으로 되돌린다.
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    let alive = true
    // 테스트 계정은 목데이터가 전부 새우라 농업 베드가 없다 — 빈 상태가 정상.
    const load = mock ? Promise.resolve<Tank[]>([]) : getAllTanks()
    load
      .then(list => {
        if (!alive) return
        // 쓰기 화면이라 더 엄하게 — 고를 수 없으면 저장할 수도 없다. 목록이 유일한 관문.
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
    for (const p of AGRI_PARAMS) {
      const raw = (values[p.key] as string | undefined) ?? ""
      if (raw.trim() === "") continue
      const n = agriNumOrNull(raw)
      if (n == null) {
        setError(r.invalidNumber.replace("{{field}}", agriParamLabel(d, p.key)))
        return
      }
      const range = RANGE[p.key]
      if (range && (n < range.min || n > range.max)) {
        setError(p.key === "conductivity" ? r.ecRangeError : r.phRangeError)
        return
      }
    }

    setSaving(true)
    try {
      if (!mock) {
        await insertWaterQuality(values.tank_id as string, {
          conductivity: agriEcToMicroSiemens(values.conductivity as string),
          ph: agriNumOrNull(values.ph as string) ?? 0,
          temperature: agriNumOrNull(values.temperature as string) ?? 0,
          do_level: agriNumOrNull(values.do_level as string) ?? 0,
          flow_rate: agriNumOrNull(values.flow_rate as string),
          diff_pressure: agriNumOrNull(values.diff_pressure as string),
          ...COLUMNS_NOT_IN_FORM,
          recorded_at: new Date(`${values.date as string}T12:00:00`).toISOString(),
        })
      }
      setSaved(true)
    } catch {
      setError(r.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleAgain = () => {
    // 베드·날짜는 그대로 두고 측정값만 비운다 — 같은 베드를 연달아 재는 경우가 많다.
    setValues(prev => ({ ...INITIAL_VALUES, tank_id: prev.tank_id, date: prev.date }))
    setSaved(false)
    setError(null)
    setFormKey(k => k + 1)
  }

  // 선택한 베드의 레시피를 힌트에 실어 보낸다. tanks 는 이미 select("*") 로 받아 둔
  // 것이라 추가 조회가 없다. steps 는 **매 렌더 다시 만들어진다** — useMemo 로 굳히면
  // 베드를 바꿔도 힌트가 따라오지 않는다.
  const selectedTank = tanks.find(tk => tk.id === values.tank_id)
  const ecHint = selectedTank?.target_ec != null
    ? r.ecTarget
        .replace("{{target}}", (selectedTank.target_ec / 1000).toFixed(2))
        .replace("{{tol}}", ((selectedTank.ec_tolerance ?? 100) / 1000).toFixed(2))
    // 레시피가 없어도 숫자 범위를 적지 않는다 — 그 순간 전역 EC 기준선이 된다.
    : r.ecNoTarget
  const phHint = selectedTank?.target_ph != null
    ? r.phTarget
        .replace("{{target}}", String(selectedTank.target_ph))
        .replace("{{tol}}", String(selectedTank.ph_tolerance ?? 0.5))
    : r.phNoTarget

  const numberField = (key: AgriParamKey, placeholder: string, hint: string) => {
    const p = agriParam(key)
    return {
      key, label: agriParamLabel(d, key), type: "number" as const,
      placeholder, unit: p.unit || undefined, optional: true, hint,
    }
  }

  const steps: WizardStep[] = [
    {
      title: r.stepBed,
      fields: [{ key: "tank_id", label: common.bed, type: "tank" }],
    },
    {
      title: r.stepConcentration,
      fields: [
        { key: "date", label: t.wizard.date, type: "date" },
        numberField("conductivity", r.ecPlaceholder, ecHint),
        numberField("ph", r.phPlaceholder, phHint),
      ],
    },
    {
      title: r.stepEnvironment,
      fields: [
        numberField("temperature", r.tempPlaceholder, r.tempHint),
        numberField("do_level", r.doPlaceholder, r.doHint),
      ],
    },
    {
      title: r.stepCirculation,
      fields: [
        numberField("flow_rate", r.flowPlaceholder, r.flowHint),
        numberField("diff_pressure", r.dpPlaceholder, r.dpHint),
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
          description={r.noBedsMeasureMsg}
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
        title={r.measureTitle}
        steps={steps}
        tanks={tanks}
        values={values}
        onChange={handleChange}
        onComplete={handleComplete}
        saving={saving}
        saved={saved}
        error={error}
        notice={r.notice}
        labels={{ selectTank: common.selectBed, optional: common.optionalMark, yes: common.yes, no: common.no, stepAria: common.wizardStepAria }}
        progressClass="bg-brand"
        noticeClass="bg-brand-a5 border-brand-a20"
        noticeIconClass="text-brand-fg"
      />
      {saved && (
        <div className="w-full max-w-md mx-auto px-4 pb-8 grid grid-cols-1 sm:grid-cols-2 gap-3" role="status">
          <Link
            href={`/daumlabs/water-quality?tank=${encodeURIComponent(values.tank_id as string)}`}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors duration-200"
          >
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
            {r.savedViewTrend}
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
