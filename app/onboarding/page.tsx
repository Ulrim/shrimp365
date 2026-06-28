"use client"

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
import { Building2, Layers, CheckCircle2, Plus, Trash2, ChevronRight, ChevronLeft, AlertCircle } from "lucide-react"
import { useT } from "@/lib/i18n-context"

type TankType = "노지" | "실내" | "반실내"

interface TankForm {
  id: number
  name: string
  tank_type: TankType
  volume: string
  stocking_density: string
  stocking_date: string
}

function computeCycleDay(stockingDate: string): number {
  if (!stockingDate) return 0
  const diff = Date.now() - new Date(stockingDate).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useT()
  const [step, setStep] = useState<1 | 2 | 3>(1)
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
    { id: 1, name: "", tank_type: "노지", volume: "", stocking_density: "", stocking_date: "" },
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
  const addTank = () => {
    if (tanks.length >= 20) return
    setTanks(prev => [...prev, { id: nextId, name: "", tank_type: "노지", volume: "", stocking_density: "", stocking_date: "" }])
    setNextId(n => n + 1)
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
      })

      await Promise.all(tanks.map(tk => {
        const volume = parseFloat(tk.volume) || 0
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
      <div className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 bg-gradient-to-br from-ocean-50 via-teal-50 to-background border-r border-border relative overflow-hidden">
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-ocean-100 rounded-full blur-3xl" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-teal-100 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <span className="text-2xl">🦐</span>
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
            <span className="text-2xl">🦐</span>
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
                  className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold min-h-[44px] gap-2"
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
                          수조 유형 <span className="text-destructive" aria-hidden="true">*</span>
                        </Label>
                        <div className="flex gap-2" role="group" aria-label="수조 유형 선택">
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
                      className="flex-1 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold min-h-[44px] gap-2"
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
                  className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold min-h-[44px] text-base gap-2"
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
