import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"
import { SUPER_ADMIN_EMAIL } from "@/lib/control-auth"

// 센서별 기록(device_id)이 왜 안 붙는지 확정하기 위한 진단 창구 (오너 전용).
//
// 핵심: 이 검사는 SQL Editor 가 아니라 **사이트가 실제로 쓰는 API 경로
// (PostgREST)** 로 수행한다. SQL 로는 컬럼이 보여도 API 스키마 캐시가 낡으면
// 저장·조회에서 조용히 빠지는데, 그 차이를 여기서 바로 드러낸다.
//
// 사용법: 오너 계정으로 로그인한 브라우저에서 /api/admin/diag 를 연다.
export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }
  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single()
  const isOwner = (user.email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase()
  if (profile?.role !== "admin" && !isOwner) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 })
  }

  const projectHost = (() => {
    try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host } catch { return "?" }
  })()

  // 1) API 경로에서 device_id 컬럼을 콕 집어 조회 — 캐시가 낡으면 여기서 오류가 난다.
  let explicitSelect: string
  let recent: { recorded_at: string; device_id: string | null }[] = []
  {
    const { data, error } = await admin
      .from("water_quality_readings")
      .select("recorded_at, device_id")
      .order("recorded_at", { ascending: false })
      .limit(8)
    if (error) {
      explicitSelect = `오류: ${error.code ?? ""} ${error.message}`
    } else {
      explicitSelect = "정상"
      recent = data ?? []
    }
  }

  // 2) select(*) 응답에 device_id 키가 포함되는가 — 낡은 캐시면 조용히 빠진다.
  let starHasDeviceId: boolean | string = "확인 불가"
  {
    const { data, error } = await admin
      .from("water_quality_readings")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(1)
    if (error) starHasDeviceId = `오류: ${error.message}`
    else if (data && data[0]) starHasDeviceId = Object.prototype.hasOwnProperty.call(data[0], "device_id")
  }

  // 3) 최근 1시간 기록 중 device_id 가 채워진 비율.
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count: totalHour } = await admin
    .from("water_quality_readings")
    .select("id", { count: "exact", head: true })
    .gte("recorded_at", oneHourAgo)
  let taggedHour: number | string = "확인 불가"
  {
    const { count, error } = await admin
      .from("water_quality_readings")
      .select("id", { count: "exact", head: true })
      .gte("recorded_at", oneHourAgo)
      .not("device_id", "is", null)
    taggedHour = error ? `오류: ${error.message}` : (count ?? 0)
  }

  // 4) 활성 기기 목록 — 기록의 device_id 와 대조할 기준.
  const { data: devices } = await admin
    .from("sensor_devices")
    .select("id, name, tank_id, active, last_seen_at, agent_version")
    .order("created_at", { ascending: true })

  return NextResponse.json({
    설명: "사이트가 실제로 쓰는 API 경로로 검사한 결과입니다. 이 결과를 그대로 복사해 전달해 주세요.",
    supabase_프로젝트: projectHost,
    검사1_device_id_직접조회: explicitSelect,
    검사2_전체조회에_device_id_포함: starHasDeviceId,
    검사3_최근1시간: { 전체: totalHour ?? 0, 센서표시있음: taggedHour },
    최근기록_8건: recent,
    기기목록: devices ?? [],
  })
}
