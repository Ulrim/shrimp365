"use client"

import { BrandMark } from "@/components/ui/brand-mark"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { getFarms, createFarm, createTank } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AddressSearch } from "@/components/ui/address-search"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Building2, Layers, CheckCircle2, Plus, Trash2, ChevronRight, ChevronLeft, AlertCircle, Waves, Sprout, FlaskConical } from "lucide-react"
import { useT, mergeDict } from "@/lib/i18n-context"
import { agriKo } from "@/lib/i18n/agri-ko"

type TankType = "노지" | "실내" | "반실내"
type FarmType = "shrimp" | "agriculture"

interface TankForm {
  id: number
  name: string
  tank_type: TankType
  volume: string
  stocking_density: string
  stocking_date: string
  /** 양액 레시피(농업) — mS/cm 로 입력받아 저장 시 ×1000 (µS/cm) */
  target_ec: string
  target_ph: string
}

function computeCycleDay(stockingDate: string): number {
  if (!stockingDate) return 0
  const diff = Date.now() - new Date(stockingDate).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { t: baseT, locale } = useT()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  // 유형 선택 — 기본은 언제나 새우 양식(절대 원칙).
  const [farmType, setFarmType] = useState<FarmType>("shrimp")
  const isAgri = farmType === "agriculture"
  // 온보딩 시점엔 farm 이 없어 전역 모드가 새우이므로 페이지 로컬로 merge 한다.
  // 농업 오버라이드 사전은 한국어뿐(설계서 4-2) — 다른 언어는 기존 라벨 그대로.
  const t = isAgri && locale === "ko" ? mergeDict(baseT, agriKo) : baseT
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Step 1 — farm info
  const [farmName, setFarmName] = useState("")
  const [farmLocation, setFarmLocation] = useState("")
  const [farmAddressDetail, setFarmAddressDetail] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [farmArea, setFarmArea] = useState("")

  // Step 2 — tanks
  const [tanks, setTanks] = useState<TankForm[]>([
    { id: 1, name: "", tank_type: "노지", volume: "", stocking_density: "", stocking_date: "", target_ec: "", target_ph: "" },
  ])
  const [nextId, setNextId] = useState(2)

  // Step 3 — completion
  const [createdFarmName, setCreatedFarmName] = useState("")
  const [createdTankCount, setCreatedTankCount] = useState(0)

  const STEP_LABELS = [t.onboarding.step1Title, t.onboarding.step2Title, t.onboarding.step3Title]

  useEffect(() => {
    if (!user) return
    if (isTestAccount(user.email)) {
      router.replace("/home")
      return
    }
    getFarms().then(farms => {
      if (farms.length > 0) router.replace("/home")
      else setChecking(false)
    }).catch(() => setChecking(false))
  }, [user, router])

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" aria-label="로딩 중" />
      </div>
    )
  }

  // ─── Tank management ───
  // NFT 베드는 대부분 온실·실내라 농업 모드 기본 유형은 "실내"(수아 시안 1-2).
  const defaultTankType: TankType = isAgri ? "실내" : "노지"

  const addTank = () => {
    if (tanks.length >= 20) return
    setTanks(prev => [...prev, { id: nextId, name: "", tank_type: defaultTankType, volume: "", stocking_density: "", stocking_date: "", target_ec: "", target_ph: "" }])
    setNextId(n => n + 1)
  }

  // 유형을 바꾸면 아직 등록 전인 베드/수조 카드의 유형 기본값을 맞춘다.
  const selectFarmType = (type: FarmType) => {
    if (type === farmType) return
    setFarmType(type)
    const def: TankType = type === "agriculture" ? "실내" : "노지"
    setTanks(prev => prev.map(tk => ({ ...tk, tank_type: def })))
  }

  const removeTank = (id: number) => {
    if (tanks.length <= 1) return
    setTanks(prev => prev.filter(tk => tk.id !== id))
  }

  const updateTank = (id: number, field: keyof TankForm, value: string) => {
    setTanks(prev => prev.map(tk => tk.id === id ? { ...tk, [field]: value } : tk))
  }

  // ─── Validation ───
  const validateStep1 = () => {
    if (!farmName.trim()) return t.onboarding.farmName
    if (!farmLocation.trim()) return t.onboarding.location
    if (!ownerName.trim()) return t.onboarding.ownerName
    return ""
  }

  const validateStep2 = () => {
    for (const tk of tanks) {
      if (!tk.name.trim()) return t.onboarding.tankName
      if (isAgri) {
        // 레시피는 선택 입력 — 입력했을 때만 범위를 본다.
        if (tk.target_ec) {
          const ec = parseFloat(tk.target_ec)
          if (isNaN(ec) || ec < 0.1 || ec > 10) return t.agri.ecRangeError
        }
        if (tk.target_ph) {
          const ph = parseFloat(tk.target_ph)
          if (isNaN(ph) || ph < 3 || ph > 9) return t.agri.phRangeError
        }
      }
    }
    return ""
  }

  const handleNext = () => {
    setError("")
    if (step === 1) {
      const err = validateStep1()
      if (err) { setError(err); return }
      setStep(2)
    }
  }

  const handleSubmit = async () => {
    setError("")
    const err = validateStep2()
    if (err) { setError(err); return }

    setSaving(true)
    try {
      const fullLocation = [farmLocation.trim(), farmAddressDetail.trim()].filter(Boolean).join(" ")
      const farm = await createFarm({
        name: farmName.trim(),
        location: fullLocation,
        owner_name: ownerName.trim(),
        area: farmArea ? parseFloat(farmArea) : 0,
        // 새우는 DB DEFAULT('shrimp')에 맡긴다 — 마이그레이션 전 DB 무변화.
        ...(isAgri ? { farm_type: "agriculture" as const } : {}),
      })

      await Promise.all(tanks.map(tk => {
        const volume = parseFloat(tk.volume) || 0
        if (isAgri) {
          // 입식 밀도·입식일은 새우 전용 — 0/null 로 저장한다.
          // 목표 EC 는 mS/cm 입력 → µS/cm(×1000) 저장. 오차는 DB DEFAULT.
          return createTank({
            farm_id: farm.id,
            name: tk.name.trim(),
            tank_type: tk.tank_type,
            volume,
            stocking_density: 0,
            shrimp_count: 0,
            cycle_day: 0,
            stocking_date: null,
            // 값이 있을 때만 싣는다 — 마이그레이션 전 DB(컬럼 없음)에서도
            // 레시피를 비워 두면 등록이 막히지 않는다.
            ...(tk.target_ec ? { target_ec: Math.round(parseFloat(tk.target_ec) * 1000) } : {}),
            ...(tk.target_ph ? { target_ph: parseFloat(tk.target_ph) } : {}),
          })
        }
        const density = parseFloat(tk.stocking_density) || 0
        return createTank({
          farm_id: farm.id,
          name: tk.name.trim(),
          tank_type: tk.tank_type,
          volume,
          stocking_density: density,
          shrimp_count: Math.round(volume * density),
          cycle_day: computeCycleDay(tk.stocking_date),
          stocking_date: tk.stocking_date || null,
        })
      }))

      setCreatedFarmName(farm.name)
      setCreatedTankCount(tanks.length)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 bg-ocean-50/60 border-r border-border relative overflow-hidden">
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-ocean-100 rounded-full blur-3xl" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-teal-100 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <BrandMark size={32} icon={16} />
          <span className="text-foreground text-xl font-bold">Shrimp365</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-foreground leading-tight mb-4">
            {t.onboarding.title}
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-8">
            {t.onboarding.subtitle}
          </p>

          {/* Step list */}
          <nav aria-label="온보딩 단계">
            <ol className="space-y-4">
              {STEP_LABELS.map((label, i) => {
                const s = (i + 1) as 1 | 2 | 3
                const isActive = step === s
                const isDone = step > s
                return (
                  <li key={s} className={`flex items-center gap-3 transition-all ${isActive ? "opacity-100" : isDone ? "opacity-70" : "opacity-40"}`}>
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                        ${isDone ? "bg-emerald-500 text-primary-foreground" : isActive ? "bg-ocean-500 text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      aria-current={isActive ? "step" : undefined}
                    >
                      {isDone ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : s}
                    </div>
                    <span className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                  </li>
                )
              })}
            </ol>
          </nav>
        </div>

        <div className="relative z-10 text-muted-foreground text-sm">© 2026 CULIVER INC. All rights reserved.</div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-xl">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center justify-center gap-2 mb-6">
            <BrandMark size={32} icon={16} />
            <span className="text-foreground text-lg font-bold">Shrimp365</span>
          </div>

          {/* Mobile step indicator */}
          <nav aria-label="온보딩 단계" className="flex lg:hidden items-center justify-center gap-2 mb-6">
            <ol className="flex items-center gap-2">
              {STEP_LABELS.map((label, i) => {
                const s = i + 1
                return (
                  <li key={s} className="flex items-center gap-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                        ${step > s ? "bg-emerald-500 text-primary-foreground" : step === s ? "bg-ocean-500 text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      aria-current={step === s ? "step" : undefined}
                      aria-label={`${label} ${step > s ? "(완료)" : step === s ? "(현재)" : ""}`}
                    >
                      {step > s ? "✓" : s}
                    </div>
                    {i < STEP_LABELS.length - 1 && (
                      <div className={`w-8 h-0.5 ${step > s ? "bg-emerald-500/60" : "bg-border"}`} />
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>

          {/* ── Step 1: Farm info ── */}
          {step === 1 && (
            <Card className="bg-card border border-border rounded-2xl shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-xl bg-ocean-100 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-ocean-600" aria-hidden="true" />
                  </div>
                  <div>
                    <CardTitle className="text-foreground text-lg">{t.onboarding.step1Title}</CardTitle>
                    <CardDescription className="text-muted-foreground text-xs">{t.onboarding.step1Subtitle}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 유형 선택 — 카드 2택 (수아 시안 1-1). 기본은 새우 양식. */}
                <div className="space-y-1.5">
                  <Label className="text-foreground text-sm font-medium">
                    {t.onboarding.farmTypeLabel} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-3" role="group" aria-label={t.onboarding.farmTypeLabel}>
                    <button
                      type="button"
                      onClick={() => selectFarmType("shrimp")}
                      aria-pressed={farmType === "shrimp"}
                      className={`min-h-[44px] rounded-xl border p-4 text-left transition-all
                        ${farmType === "shrimp"
                          ? "border-ocean-500 bg-ocean-500/5 ring-1 ring-ocean-500/40"
                          : "border-border bg-muted/50 hover:border-ocean-300"}`}
                    >
                      <Waves className={`w-6 h-6 mb-2 ${farmType === "shrimp" ? "text-ocean-600" : "text-muted-foreground"}`} aria-hidden="true" />
                      <p className="text-sm font-semibold text-foreground">{t.onboarding.farmTypeShrimp}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t.onboarding.farmTypeShrimpDesc}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => selectFarmType("agriculture")}
                      aria-pressed={farmType === "agriculture"}
                      className={`min-h-[44px] rounded-xl border p-4 text-left transition-all
                        ${farmType === "agriculture"
                          ? "border-ocean-500 bg-ocean-500/5 ring-1 ring-ocean-500/40"
                          : "border-border bg-muted/50 hover:border-ocean-300"}`}
                    >
                      <Sprout className={`w-6 h-6 mb-2 ${farmType === "agriculture" ? "text-ocean-600" : "text-muted-foreground"}`} aria-hidden="true" />
                      <p className="text-sm font-semibold text-foreground">{t.onboarding.farmTypeAgri}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t.onboarding.farmTypeAgriDesc}</p>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="farm-name" className="text-foreground text-sm font-medium">
                    {t.onboarding.farmName} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="farm-name"
                    value={farmName}
                    onChange={e => setFarmName(e.target.value)}
                    placeholder={t.onboarding.farmNamePlaceholder}
                    className="min-h-[44px]"
                    aria-required="true"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="farm-location" className="text-foreground text-sm font-medium">
                    {t.onboarding.location} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <AddressSearch
                    value={farmLocation}
                    onChange={setFarmLocation}
                    placeholder={t.onboarding.locationPlaceholder}
                    required
                  />
                  <Input
                    id="farm-location-detail"
                    value={farmAddressDetail}
                    onChange={e => setFarmAddressDetail(e.target.value)}
                    placeholder={t.onboarding.locationDetailPlaceholder}
                    aria-label={t.onboarding.locationDetail}
                    className="min-h-[44px] mt-2"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="owner-name" className="text-foreground text-sm font-medium">
                    {t.onboarding.ownerName} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="owner-name"
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    placeholder={t.onboarding.ownerNamePlaceholder}
                    className="min-h-[44px]"
                    aria-required="true"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="farm-area" className="text-foreground text-sm font-medium">
                    {t.onboarding.area} <span className="text-muted-foreground font-normal text-xs">(㎡, 선택)</span>
                  </Label>
                  <Input
                    id="farm-area"
                    type="number"
                    min="0"
                    value={farmArea}
                    onChange={e => setFarmArea(e.target.value)}
                    placeholder="예: 5000"
                    className="min-h-[44px]"
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-3 py-2 text-sm"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {error}
                  </div>
                )}

                <Button
                  className="w-full bg-ocean-600 hover:bg-ocean-700 text-white font-semibold min-h-[44px] gap-2"
                  onClick={handleNext}
                >
                  {t.onboarding.next} <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: Tank registration ── */}
          {step === 2 && (
            <div className="space-y-4">
              <Card className="bg-card border border-border rounded-2xl shadow-sm">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <Layers className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-foreground text-lg">{t.onboarding.step2Title}</CardTitle>
                      <CardDescription className="text-muted-foreground text-xs">{t.onboarding.step2Subtitle}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {tanks.map((tank, idx) => (
                    <div key={tank.id} className="bg-muted/50 border border-border rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground text-sm font-medium">{t.onboarding.tankName} {idx + 1}</span>
                        {tanks.length > 1 && (
                          <button
                            onClick={() => removeTank(tank.id)}
                            className="text-destructive/60 hover:text-destructive transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                            aria-label={`${t.onboarding.tankName} ${idx + 1} ${t.onboarding.removeTank}`}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`tank-name-${tank.id}`} className="text-foreground text-xs font-medium">
                          {t.onboarding.tankName} <span className="text-destructive" aria-hidden="true">*</span>
                        </Label>
                        <Input
                          id={`tank-name-${tank.id}`}
                          value={tank.name}
                          onChange={e => updateTank(tank.id, "name", e.target.value)}
                          placeholder={t.onboarding.tankNamePlaceholder}
                          className="min-h-[44px] text-sm"
                          aria-required="true"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-medium">
                          {isAgri ? t.agri.bedType : "수조 유형"} <span className="text-destructive" aria-hidden="true">*</span>
                        </Label>
                        <div className="flex gap-2" role="group" aria-label={isAgri ? t.agri.bedType : "수조 유형 선택"}>
                          {(["노지", "실내", "반실내"] as TankType[]).map(type => (
                            <button
                              key={type}
                              onClick={() => updateTank(tank.id, "tank_type", type)}
                              className={`flex-1 min-h-[44px] rounded-lg text-xs font-medium border transition-all
                                ${tank.tank_type === type
                                  ? "bg-ocean-500 text-white border-ocean-500"
                                  : "bg-muted text-muted-foreground border-border hover:border-ocean-300 hover:text-ocean-600"
                                }`}
                              aria-pressed={tank.tank_type === type}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {isAgri ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`tank-volume-${tank.id}`} className="text-foreground text-xs font-medium">
                            {t.agri.bedVolume} <span className="text-muted-foreground font-normal">(㎥, 선택)</span>
                          </Label>
                          <Input
                            id={`tank-volume-${tank.id}`}
                            type="number"
                            min="0"
                            step="0.1"
                            value={tank.volume}
                            onChange={e => updateTank(tank.id, "volume", e.target.value)}
                            placeholder="예: 1"
                            className="min-h-[44px] text-sm"
                          />
                          <p className="text-xs text-muted-foreground">{t.agri.bedVolumeHint}</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`tank-volume-${tank.id}`} className="text-foreground text-xs font-medium">
                              {t.onboarding.volume} <span className="text-muted-foreground font-normal">(㎥)</span>
                            </Label>
                            <Input
                              id={`tank-volume-${tank.id}`}
                              type="number"
                              min="0"
                              value={tank.volume}
                              onChange={e => updateTank(tank.id, "volume", e.target.value)}
                              placeholder="예: 500"
                              className="min-h-[44px] text-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`tank-density-${tank.id}`} className="text-foreground text-xs font-medium">
                              {t.onboarding.density} <span className="text-muted-foreground font-normal">(마리/㎥)</span>
                            </Label>
                            <Input
                              id={`tank-density-${tank.id}`}
                              type="number"
                              min="0"
                              value={tank.stocking_density}
                              onChange={e => updateTank(tank.id, "stocking_density", e.target.value)}
                              placeholder="예: 100"
                              className="min-h-[44px] text-sm"
                            />
                          </div>
                        </div>
                      )}

                      {!isAgri && (
                        <div className="space-y-1.5">
                          <Label htmlFor={`tank-date-${tank.id}`} className="text-foreground text-xs font-medium">
                            입식일 <span className="text-muted-foreground font-normal">(선택)</span>
                          </Label>
                          <Input
                            id={`tank-date-${tank.id}`}
                            type="date"
                            value={tank.stocking_date}
                            onChange={e => updateTank(tank.id, "stocking_date", e.target.value)}
                            max={new Date().toISOString().split("T")[0]}
                            className="min-h-[44px] text-sm"
                          />
                        </div>
                      )}

                      {/* 양액 레시피 블록 (수아 시안 1-2) — 온보딩은 목표 2필드만.
                          오차 입력은 /farms 폼에만 둔다(점진적 공개). */}
                      {isAgri && (
                        <div className="border-t border-border pt-3 space-y-2">
                          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <FlaskConical className="w-4 h-4 text-ocean-600" aria-hidden="true" />
                            {t.agri.recipeTitle} <span className="text-muted-foreground font-normal">{t.agri.recipeOptional}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{t.agri.recipeHint}</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor={`tank-ec-${tank.id}`} className="text-foreground text-xs font-medium">
                                {t.agri.targetEc} <span className="text-muted-foreground font-normal">({t.agri.targetEcUnit})</span>
                              </Label>
                              <Input
                                id={`tank-ec-${tank.id}`}
                                type="number"
                                step="0.1"
                                min="0.1"
                                max="10"
                                value={tank.target_ec}
                                onChange={e => updateTank(tank.id, "target_ec", e.target.value)}
                                placeholder={t.agri.targetEcPlaceholder}
                                className="min-h-[44px] text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`tank-ph-${tank.id}`} className="text-foreground text-xs font-medium">
                                {t.agri.targetPh}
                              </Label>
                              <Input
                                id={`tank-ph-${tank.id}`}
                                type="number"
                                step="0.1"
                                min="3"
                                max="9"
                                value={tank.target_ph}
                                onChange={e => updateTank(tank.id, "target_ph", e.target.value)}
                                placeholder={t.agri.targetPhPlaceholder}
                                className="min-h-[44px] text-sm"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t.agri.toleranceDefaultNote} {t.agri.recipeEditNote}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}

                  {tanks.length < 20 && (
                    <button
                      onClick={addTank}
                      className="w-full min-h-[44px] border-dashed border-2 border-border rounded-xl text-muted-foreground hover:border-ocean-300 hover:text-ocean-600 text-sm flex items-center justify-center gap-2 transition-all"
                      aria-label={t.onboarding.addMoreTank}
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" /> {t.onboarding.addMoreTank}
                    </button>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-3 py-2 text-sm"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2 min-h-[44px]"
                      onClick={() => { setError(""); setStep(1) }}
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" /> {t.onboarding.prev}
                    </Button>
                    <Button
                      className="flex-1 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold min-h-[44px] gap-2"
                      onClick={handleSubmit}
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" aria-hidden="true" />
                          {t.onboarding.completing}
                        </>
                      ) : (
                        <>{t.onboarding.finish} <CheckCircle2 className="w-4 h-4" aria-hidden="true" /></>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Step 3: Complete ── */}
          {step === 3 && (
            <Card className="bg-card border border-border rounded-2xl shadow-sm text-center">
              <CardContent className="pt-10 pb-8 px-8 space-y-6">
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">{t.onboarding.step3Title}</h2>
                  <p className="text-muted-foreground text-sm">
                    <span className="text-foreground font-semibold">&ldquo;{createdFarmName}&rdquo;</span>{" "}
                    {t.onboarding.step3Subtitle}
                    {" "}<span className="text-foreground font-semibold">{createdTankCount}</span>
                  </p>
                </div>
                <Button
                  className="w-full bg-ocean-600 hover:bg-ocean-700 text-white font-semibold min-h-[44px] text-base gap-2"
                  onClick={() => router.replace("/home")}
                >
                  {t.onboarding.complete} <ChevronRight className="w-5 h-5" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
