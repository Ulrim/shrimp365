import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"

export async function GET(req: NextRequest) {
  // 1. 호출자 인증 확인
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 2. Service Role Key 존재 여부 확인
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }

  try {
    const admin = createAdminClient()

    // 3. 호출자 권한 확인 (admin 역할만 허용)
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (callerProfile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // 4. 전체 데이터 병렬 조회
    const [usersRes, profilesRes, farmsRes, tanksRes, alertsRes, diagnosesRes] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 500 }),
      admin.from("profiles").select("id, name, role, plan, created_at"),
      admin.from("farms").select("id, user_id, name, location, created_at"),
      admin.from("tanks").select("id, farm_id, name, status, farm:farms!tanks_farm_id_fkey(user_id)"),
      admin.from("alerts")
        .select("id, tank_id, type, parameter, value, threshold, message, created_at, tank:tanks!alerts_tank_id_fkey(name, farm:farms!tanks_farm_id_fkey(user_id, name))")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(40),
      admin.from("diagnosis_results")
        .select("id, tank_id, test_type, result, risk_level, tested_at, tank:tanks!diagnosis_results_tank_id_fkey(name, farm:farms!tanks_farm_id_fkey(user_id, name))")
        .order("tested_at", { ascending: false })
        .limit(20),
    ])

    // 5. 집계
    const profileMap = new Map((profilesRes.data ?? []).map((p: Record<string, unknown>) => [p.id as string, p]))
    const farmsByUser = new Map<string, number>()
    const tanksByUser = new Map<string, number>()
    const activeTanksByUser = new Map<string, number>()
    const alertsByUser = new Map<string, number>()
    const tankStatusCounts = { active: 0, warning: 0, danger: 0, inactive: 0 }

    for (const f of farmsRes.data ?? []) {
      farmsByUser.set(f.user_id, (farmsByUser.get(f.user_id) ?? 0) + 1)
    }
    for (const t of tanksRes.data ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const farmData = t.farm as any
      const uid: string = (Array.isArray(farmData) ? farmData[0]?.user_id : farmData?.user_id) ?? ""
      tanksByUser.set(uid, (tanksByUser.get(uid) ?? 0) + 1)
      if (t.status === "active") activeTanksByUser.set(uid, (activeTanksByUser.get(uid) ?? 0) + 1)
      if (t.status in tankStatusCounts) tankStatusCounts[t.status as keyof typeof tankStatusCounts]++
    }
    for (const a of alertsRes.data ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tankData = a.tank as any
      const farmData = Array.isArray(tankData) ? tankData[0]?.farm : tankData?.farm
      const uid: string = (Array.isArray(farmData) ? farmData[0]?.user_id : farmData?.user_id) ?? ""
      alertsByUser.set(uid, (alertsByUser.get(uid) ?? 0) + 1)
    }

    const users = (usersRes.data?.users ?? []).map((u) => {
      const profile = profileMap.get(u.id) as Record<string, unknown> | undefined
      const uid = u.id
      return {
        id: uid,
        email: u.email ?? "",
        name: (profile?.name as string) || (u.email?.split("@")[0] ?? ""),
        role: (profile?.role as string) || "operator",
        plan: (profile?.plan as string) || "free",
        farm_count: farmsByUser.get(uid) ?? 0,
        tank_count: tanksByUser.get(uid) ?? 0,
        active_tanks: activeTanksByUser.get(uid) ?? 0,
        alert_count: alertsByUser.get(uid) ?? 0,
        joined_at: u.created_at,
      }
    })

    const planDist = { free: 0, basic: 0, pro: 0, enterprise: 0 }
    users.forEach(u => { if (u.plan in planDist) planDist[u.plan as keyof typeof planDist]++ })

    return NextResponse.json({
      users,
      total_farms: farmsRes.data?.length ?? 0,
      total_tanks: tanksRes.data?.length ?? 0,
      total_active_alerts: alertsRes.data?.length ?? 0,
      tanks_by_status: tankStatusCounts,
      plan_distribution: planDist,
      recent_alerts: alertsRes.data ?? [],
      recent_diagnoses: diagnosesRes.data ?? [],
    })
  } catch (err) {
    console.error("[admin/stats]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
