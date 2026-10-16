"use client"

// 시스템 모니터링 통계 — 개요(/admin)와 사용자(/admin/users)가 함께 쓴다.
//
// 옛 app/(dashboard)/admin/page.tsx 의 타입·목데이터·불러오기를 그대로 옮겼다
// (설계서 admin-console.md 6장: 데이터 로직 변경 금지). 두 화면이 각자 이 훅을 불러
// /api/admin/stats 를 한 번씩 부른다. 권한 판정은 서버(api/admin/stats)가 한다.
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { isMonitorAccount, isTestAccount, MOCK_ADMIN_STATS, MOCK_ALERTS, type AdminUserRow } from "@/lib/mock-data"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  users: AdminUserRow[]
  total_farms: number
  total_tanks: number
  total_active_alerts: number
  tanks_by_status: { active: number; warning: number; danger: number; inactive: number }
  plan_distribution: { free: number; basic: number; pro: number; enterprise: number }
  recent_alerts: AdminAlert[]
  recent_diagnoses: AdminDiagnosis[]
}

export interface AdminAlert {
  id: string
  tank_id: string
  type: "danger" | "warning" | "info"
  parameter: string | null
  value: number | null
  threshold: number | null
  message: string
  created_at: string
  tank?: { name: string; farm?: { user_id: string; name: string } }
}

export interface AdminDiagnosis {
  id: string
  tank_id: string
  test_type: string
  result: string
  risk_level: string
  tested_at: string
  tank?: { name: string; farm?: { user_id: string; name: string } }
}

// ─── Mock data builder for monitor account ────────────────────────────────────

function buildMockStats(): AdminStats {
  const mockAlerts: AdminAlert[] = MOCK_ALERTS.filter(a => !a.resolved).map(a => ({
    ...a,
    tank: { name: a.tank_name, farm: { user_id: "mock-user-1", name: "제1양식장" } },
  }))
  const mockDiagnoses: AdminDiagnosis[] = [
    { id: "diag-1", tank_id: "tank-4", test_type: "AHPND",    result: "양성", risk_level: "high",   tested_at: new Date(Date.now() - 86400000).toISOString(),     tank: { name: "B-2조", farm: { user_id: "mock-user-1", name: "제1양식장" } } },
    { id: "diag-2", tank_id: "tank-6", test_type: "총비브리오", result: "의심", risk_level: "medium", tested_at: new Date(Date.now() - 86400000).toISOString(),     tank: { name: "C-2조", farm: { user_id: "mock-user-1", name: "제1양식장" } } },
    { id: "diag-3", tank_id: "tank-1", test_type: "총비브리오", result: "음성", risk_level: "low",    tested_at: new Date(Date.now() - 86400000 * 3).toISOString(), tank: { name: "A-1조", farm: { user_id: "mock-user-1", name: "제1양식장" } } },
    { id: "diag-4", tank_id: "tank-4", test_type: "EHP",       result: "음성", risk_level: "low",    tested_at: new Date(Date.now() - 86400000 * 5).toISOString(), tank: { name: "F-1조", farm: { user_id: "mock-user-2", name: "제2양식장" } } },
  ]
  return {
    ...MOCK_ADMIN_STATS,
    recent_alerts: mockAlerts,
    recent_diagnoses: mockDiagnoses,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAdminStats() {
  const { user } = useAuth()
  const router = useRouter()

  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const isMock = isMonitorAccount(user?.email) || isTestAccount(user?.email)

  const loadStats = useCallback(async () => {
    if (isMock) {
      setStats(buildMockStats())
      setLoading(false)
      return
    }
    try {
      const res = await fetch("/api/admin/stats")
      if (res.status === 403) { router.replace("/dashboard"); return }
      if (res.status === 503) { setError("SERVICE_KEY_MISSING"); setLoading(false); return }
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setStats(data)
    } catch {
      setError("fetch_error")
    } finally {
      setLoading(false)
    }
  }, [isMock, router])

  useEffect(() => {
    if (!user) return
    // 화면 권한 확인은 관리자 레이아웃(lib/admin-access.ts)이 먼저 했다.
    // setState 가 effect 본문에서 동기로 불리지 않도록 한 틱 미룬다(관제센터와 같은 방식).
    const t = setTimeout(() => { loadStats() }, 0)
    return () => clearTimeout(t)
  }, [user, loadStats])

  async function refresh() {
    setRefreshing(true)
    await loadStats()
    setRefreshing(false)
  }

  return { stats, loading, error, refreshing, refresh }
}
