"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { getFarms, createFarm, createTank } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Waves, Building2, Layers, CheckCircle2, Plus, Trash2, ChevronRight, ChevronLeft, AlertCircle } from "lucide-react"

type TankType = "노지" | "실내" | "반실내"

interface TankForm {
  id: number
  name: string
  tank_type: TankType
  volume: string
  stocking_density: string
  stocking_date: string
}

const STEP_LABELS = ["양식장 정보", "수조 등록", "완료"]

function computeCycleDay(stockingDate: string): number {
  if (!stockingDate) return 0
  const diff = Date.now() - new Date(stockingDate).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Step 1 — 양식장 정보
  const [farmName, setFarmName] = useState("")
  const [farmLocation, setFarmLocation] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [farmArea, setFarmArea] = useState("")

  // Step 2 — 수조 목록
  const [tanks, setTanks] = useState<TankForm[]>([
    { id: 1, name: "", tank_type: "노지", volume: "", stocking_density: "", stocking_date: "" },
  ])
  const [nextId, setNextId] = useState(2)

  // 완료 후 표시용
  const [createdFarmName, setCreatedFarmName] = useState("")
  const [createdTankCount, setCreatedTankCount] = useState(0)

  useEffect(() => {
    if (!user) return
    if (isTestAccount(user.email)) {
      router.replace("/dashboard")
      return
    }
    // 이미 양식장이 있으면 온보딩 건너뜀
    getFarms().then(farms => {
      if (farms.length > 0) router.replace("/dashboard")
      else setChecking(false)
    }).catch(() => setChecking(false))
  }, [user, router])

  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─── 수조 관리 ───
  const addTank = () => {
    if (tanks.length >= 20) return
    setTanks(prev => [...prev, { id: nextId, name: "", tank_type: "노지", volume: "", stocking_density: "", stocking_date: "" }])
    setNextId(n => n + 1)
  }

  const removeTank = (id: number) => {
    if (tanks.length <= 1) return
    setTanks(prev => prev.filter(t => t.id !== id))
  }

  const updateTank = (id: number, field: keyof TankForm, value: string) => {
    setTanks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  // ─── 단계별 유효성 검사 ───
  const validateStep1 = () => {
    if (!farmName.trim()) return "양식장 이름을 입력해주세요."
    if (!farmLocation.trim()) return "주소를 입력해주세요."
    if (!ownerName.trim()) return "대표자 이름을 입력해주세요."
    return ""
  }

  const validateStep2 = () => {
    for (const t of tanks) {
      if (!t.name.trim()) return "모든 수조의 이름을 입력해주세요."
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
      const farm = await createFarm({
        name: farmName.trim(),
        location: farmLocation.trim(),
        owner_name: ownerName.trim(),
        area: farmArea ? parseFloat(farmArea) : 0,
      })

      await Promise.all(tanks.map(t => {
        const volume = parseFloat(t.volume) || 0
        const density = parseFloat(t.stocking_density) || 0
        return createTank({
          farm_id: farm.id,
          name: t.name.trim(),
          tank_type: t.tank_type,
          volume,
          stocking_density: density,
          shrimp_count: Math.round(volume * density),
          cycle_day: computeCycleDay(t.stocking_date),
          stocking_date: t.stocking_date || null,
        })
      }))

      setCreatedFarmName(farm.name)
      setCreatedTankCount(tanks.length)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록에 실패했습니다. 다시 시도해주세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950">
      {/* 좌측 브랜드 패널 */}
      <div className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-ocean-600/20 to-teal-600/20" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-ocean-500/10 rounded-full blur-3xl" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">Shrimp365</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            양식장 초기 설정
          </h1>
          <p className="text-ocean-200 text-base leading-relaxed mb-8">
            양식장과 수조 정보를 등록하면<br />
            수질 모니터링, 일지 관리, AI 진단까지<br />
            모든 기능을 즉시 사용할 수 있습니다.
          </p>

          {/* 스텝 목록 */}
          <div className="space-y-4">
            {STEP_LABELS.map((label, i) => {
              const s = (i + 1) as 1 | 2 | 3
              const isActive = step === s
              const isDone = step > s
              return (
                <div key={s} className={`flex items-center gap-3 transition-all ${isActive ? "opacity-100" : isDone ? "opacity-60" : "opacity-30"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                    ${isDone ? "bg-emerald-500 text-white" : isActive ? "bg-ocean-500 text-white" : "bg-white/10 text-white/60"}`}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : s}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? "text-white" : "text-ocean-300"}`}>{label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="relative z-10 text-ocean-400 text-sm">© 2025 Shrimp365</div>
      </div>

      {/* 우측 폼 */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-xl">
          {/* 모바일 로고 */}
          <div className="flex lg:hidden items-center justify-center gap-3 mb-6">
            <div className="w-9 h-9 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center">
              <Waves className="w-5 h-5 text-white" />
            </div>
            <span className="text-white text-lg font-bold">Shrimp365</span>
          </div>

          {/* 모바일 스텝 인디케이터 */}
          <div className="flex lg:hidden items-center justify-center gap-2 mb-6">
            {STEP_LABELS.map((label, i) => {
              const s = i + 1
              return (
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${step > s ? "bg-emerald-500 text-white" : step === s ? "bg-ocean-500 text-white" : "bg-white/10 text-white/40"}`}>
                    {step > s ? "✓" : s}
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <div className={`w-8 h-0.5 ${step > s ? "bg-emerald-500/60" : "bg-white/10"}`} />
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Step 1: 양식장 정보 ── */}
          {step === 1 && (
            <Card className="bg-white/5 border-white/10 backdrop-blur-md shadow-2xl">
              <CardHeader>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-xl bg-ocean-500/20 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-ocean-400" />
                  </div>
                  <div>
                    <CardTitle className="text-white text-lg">양식장 정보 입력</CardTitle>
                    <CardDescription className="text-ocean-400 text-xs">기본 양식장 정보를 입력해주세요</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-ocean-200 text-sm">양식장 이름 <span className="text-red-400">*</span></Label>
                  <Input
                    value={farmName}
                    onChange={e => setFarmName(e.target.value)}
                    placeholder="예: 제1양식장"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-ocean-200 text-sm">주소 <span className="text-red-400">*</span></Label>
                  <Input
                    value={farmLocation}
                    onChange={e => setFarmLocation(e.target.value)}
                    placeholder="예: 전남 여수시 돌산읍"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-ocean-200 text-sm">대표자 이름 <span className="text-red-400">*</span></Label>
                  <Input
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    placeholder="예: 홍길동"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-ocean-200 text-sm">전체 면적 (m²)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={farmArea}
                    onChange={e => setFarmArea(e.target.value)}
                    placeholder="예: 5000"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold h-11 gap-2"
                  onClick={handleNext}
                >
                  다음 단계 <ChevronRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: 수조 등록 ── */}
          {step === 2 && (
            <div className="space-y-4">
              <Card className="bg-white/5 border-white/10 backdrop-blur-md shadow-2xl">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-teal-500/20 flex items-center justify-center">
                      <Layers className="w-5 h-5 text-teal-400" />
                    </div>
                    <div>
                      <CardTitle className="text-white text-lg">수조 등록</CardTitle>
                      <CardDescription className="text-ocean-400 text-xs">양식장의 수조 정보를 입력해주세요 (최소 1개)</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {tanks.map((tank, idx) => (
                    <div key={tank.id} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-ocean-300 text-sm font-medium">수조 {idx + 1}</span>
                        {tanks.length > 1 && (
                          <button
                            onClick={() => removeTank(tank.id)}
                            className="text-red-400/70 hover:text-red-400 transition-colors"
                            aria-label="수조 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-ocean-200 text-xs">수조 이름 <span className="text-red-400">*</span></Label>
                        <Input
                          value={tank.name}
                          onChange={e => updateTank(tank.id, "name", e.target.value)}
                          placeholder="예: A-1조"
                          className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400 h-9 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-ocean-200 text-xs">수조 유형 <span className="text-red-400">*</span></Label>
                        <div className="flex gap-2">
                          {(["노지", "실내", "반실내"] as TankType[]).map(type => (
                            <button
                              key={type}
                              onClick={() => updateTank(tank.id, "tank_type", type)}
                              className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-all
                                ${tank.tank_type === type
                                  ? "bg-ocean-500 border-ocean-400 text-white"
                                  : "bg-white/5 border-white/10 text-ocean-300 hover:bg-white/10"
                                }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-ocean-200 text-xs">용량 (m³)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={tank.volume}
                            onChange={e => updateTank(tank.id, "volume", e.target.value)}
                            placeholder="예: 500"
                            className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400 h-9 text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-ocean-200 text-xs">입식 밀도 (마리/m³)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={tank.stocking_density}
                            onChange={e => updateTank(tank.id, "stocking_density", e.target.value)}
                            placeholder="예: 100"
                            className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-ocean-400 h-9 text-sm"
                          />
                        </div>
                      </div>

                      {tank.volume && tank.stocking_density && (
                        <p className="text-xs text-ocean-400">
                          총 입식 마릿수: <span className="text-ocean-300 font-medium">
                            {Math.round(parseFloat(tank.volume) * parseFloat(tank.stocking_density)).toLocaleString()}마리
                          </span>
                        </p>
                      )}

                      <div className="space-y-1.5">
                        <Label className="text-ocean-200 text-xs">입식일</Label>
                        <Input
                          type="date"
                          value={tank.stocking_date}
                          onChange={e => updateTank(tank.id, "stocking_date", e.target.value)}
                          max={new Date().toISOString().split("T")[0]}
                          className="bg-white/10 border-white/20 text-white focus-visible:ring-ocean-400 h-9 text-sm [color-scheme:dark]"
                        />
                      </div>
                    </div>
                  ))}

                  {tanks.length < 20 && (
                    <button
                      onClick={addTank}
                      className="w-full h-10 border border-dashed border-white/20 rounded-xl text-ocean-400 hover:text-ocean-300 hover:border-white/30 text-sm flex items-center justify-center gap-2 transition-all"
                    >
                      <Plus className="w-4 h-4" /> 수조 추가
                    </button>
                  )}

                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1 border-white/20 text-ocean-300 bg-transparent hover:bg-white/10 gap-2 h-11"
                      onClick={() => { setError(""); setStep(1) }}
                    >
                      <ChevronLeft className="w-4 h-4" /> 이전
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold h-11 gap-2"
                      onClick={handleSubmit}
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          등록 중...
                        </>
                      ) : (
                        <>등록 완료 <CheckCircle2 className="w-4 h-4" /></>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Step 3: 완료 ── */}
          {step === 3 && (
            <Card className="bg-white/5 border-white/10 backdrop-blur-md shadow-2xl text-center">
              <CardContent className="pt-10 pb-8 px-8 space-y-6">
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2">등록 완료!</h2>
                  <p className="text-ocean-300 text-sm">
                    <span className="text-white font-semibold">&ldquo;{createdFarmName}&rdquo;</span> 양식장과{" "}
                    <span className="text-white font-semibold">{createdTankCount}개</span> 수조가 성공적으로 등록되었습니다.
                  </p>
                </div>
                <div className="bg-ocean-500/10 border border-ocean-500/20 rounded-xl p-4 text-left space-y-1.5 text-sm">
                  <p className="text-ocean-300">이제 다음 기능을 사용할 수 있습니다:</p>
                  <p className="text-ocean-200">• 실시간 수질 모니터링</p>
                  <p className="text-ocean-200">• IoT 센서 기기 연동</p>
                  <p className="text-ocean-200">• 양식 일지 기록</p>
                  <p className="text-ocean-200">• AI 운영 어드바이저</p>
                </div>
                <Button
                  className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold h-12 text-base gap-2"
                  onClick={() => router.push("/dashboard")}
                >
                  대시보드 시작하기 <ChevronRight className="w-5 h-5" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
