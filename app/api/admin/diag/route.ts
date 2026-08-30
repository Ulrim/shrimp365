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
    .select("id, name, tank_id, active, last_seen_at, agent_version, last_payload")
    .order("created_at", { ascending: true })

  // 5) 기기별 최신 측정값과 자동 판정.
  //    "지금 값이 정상인가" 를 사람이 계산하지 않고도 알 수 있어야 한다.
  //    용존산소는 수온에 따라 물이 품을 수 있는 양이 정해지므로, 포화도를
  //    계산해 물에서 나올 수 없는 값인지 함께 말해 준다.
  const 최신값: Record<string, unknown>[] = []
  for (const d of (devices ?? []).filter(x => x.active)) {
    const { data: last } = await admin
      .from("water_quality_readings")
      .select("recorded_at, temperature, ph, do_level, salinity, conductivity")
      .eq("device_id", d.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    let 판정 = "측정값 없음"
    if (last) {
      const t = last.temperature as number | null
      const dov = last.do_level as number | null
      if (typeof dov === "number" && typeof t === "number" && t > -5 && t < 60) {
        // Benson-Krause — 1기압 담수 기준 포화 용존산소
        const K = t + 273.15
        const sat = Math.exp(-139.34411 + 1.575701e5 / K - 6.642308e7 / K ** 2
          + 1.243800e10 / K ** 3 - 8.621949e11 / K ** 4)
        const pct = Math.round((dov / sat) * 100)
        판정 = pct > 150
          ? `용존산소 ${dov} mg/L = 포화 ${pct}% — 물에서 나올 수 없는 값(전극이 물 밖이거나 보정 필요)`
          : pct < 40
            ? `용존산소 ${dov} mg/L = 포화 ${pct}% — 낮음(산소 공급 확인)`
            : `용존산소 ${dov} mg/L = 포화 ${pct}% — 정상`
      } else if (typeof dov !== "number") {
        판정 = "용존산소 값이 없음"
      }
    }
    최신값.push({
      기기: d.name, 최근수신: d.last_seen_at, 버전: d.agent_version,
      최신측정: last ?? null, 판정,
      마지막원본: (d as Record<string, unknown>).last_payload ?? null,
    })
  }

  return NextResponse.json({
    설명: "사이트가 실제로 쓰는 API 경로로 검사한 결과입니다. 이 결과를 그대로 복사해 전달해 주세요.",
    기기별_최신값: 최신값,
    supabase_프로젝트: projectHost,
    검사1_device_id_직접조회: explicitSelect,
    검사2_전체조회에_device_id_포함: starHasDeviceId,
    검사3_최근1시간: { 전체: totalHour ?? 0, 센서표시있음: taggedHour },
    최근기록_8건: recent,
    기기목록: devices ?? [],
  })
}
