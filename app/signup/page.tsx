"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Eye, EyeOff, Waves, AlertCircle, CheckCircle2 } from "lucide-react"

export default function SignupPage() {
  const router = useRouter()
  const { signup } = useAuth()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const passwordStrength = () => {
    if (!password) return 0
    let score = 0
    if (password.length >= 10) score++
    if (/[0-9]/.test(password)) score++
    if (/[a-zA-Z]/.test(password)) score++
    if (/[^a-zA-Z0-9]/.test(password)) score++
    return score
  }

  const strengthLabel = ["", "약함", "보통", "강함", "매우 강함"]
  const strengthColor = ["", "bg-red-500", "bg-amber-500", "bg-ocean-500", "bg-emerald-500"]
  const strength = passwordStrength()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!name.trim()) { setError("이름을 입력해주세요."); return }
    if (password !== confirmPassword) { setError("비밀번호가 일치하지 않습니다."); return }
    if (password.length < 8) { setError("비밀번호는 최소 8자 이상이어야 합니다."); return }

    setLoading(true)
    const result = await signup(email, password, name)
    setLoading(false)
    if (result.success) {
      // Supabase 이메일 인증 사용 시 인증 메일 발송됨
      // 인증 없이 바로 로그인 되면 대시보드로 이동
      router.replace("/dashboard")
    } else {
      setError(result.error || "회원가입에 실패했습니다.")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950 p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">Shrimp365</span>
        </div>

        <Card className="bg-white/5 border-white/10 backdrop-blur-md shadow-2xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold text-white">회원가입</CardTitle>
            <CardDescription className="text-ocean-300">
              새 계정을 만들어 스마트 양식 관리를 시작하세요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-ocean-100">이름</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="홍길동"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-ocean-100">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-ocean-100">비밀번호</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="6자 이상 입력하세요"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all ${i <= strength ? strengthColor[strength] : "bg-white/10"}`}
                        />
                      ))}
                    </div>
                    <p className={`text-xs ${strength <= 1 ? "text-red-400" : strength === 2 ? "text-amber-400" : "text-emerald-400"}`}>
                      {strengthLabel[strength]}
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-ocean-100">비밀번호 확인</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="비밀번호를 다시 입력하세요"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-ocean-400 pr-10"
                    required
                  />
                  {confirmPassword && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      {password === confirmPassword
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : <AlertCircle className="w-4 h-4 text-red-400" />
                      }
                    </span>
                  )}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold h-11"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    계정 생성 중...
                  </span>
                ) : "회원가입"}
              </Button>
            </form>

            <p className="text-center text-sm text-ocean-400 mt-4">
              이미 계정이 있으신가요?{" "}
              <Link href="/login" className="text-ocean-300 hover:text-white font-medium transition-colors">
                로그인
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
