// 비전 장비(라즈베리파이)가 들어오는 문의 공통 부분 — **서버 전용**.
//
// 장비는 기기 키(X-Device-Key) 하나로 자기를 밝힌다. 그 키로 "이 장비가 맡은
// 카메라는 무엇인가"를 푸는 일과 "살아 있다"를 적는 일은 장비가 부르는 모든
// 경로에서 똑같이 필요하다. 한 곳에 둔다 — 경로마다 베껴 두면 언젠가 한쪽만
// 고쳐져, 소유 확인이 느슨한 문이 하나 남는다.
import { createAdminClient } from "@/lib/supabase-server"
import { NextResponse } from "next/server"

export type AdminClient = ReturnType<typeof createAdminClient>

export type DeviceCameraRow = {
  id: string
  tank_id: string
  name: string
  camera_type: string
  stream_url: string | null
  resolution_w: number
  resolution_h: number
  fps_target: number
  is_active: boolean
  tanks?: { name?: string; farm_id?: string } | { name?: string; farm_id?: string }[]
}

export function deviceUnauthorized() {
  return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
}

export function serviceUnavailable() {
  return NextResponse.json(
    { error: "서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다." },
    { status: 503 }
  )
}

/** 이 기기 키가 맡은 카메라들. 없으면 빈 배열(아직 연결 전이거나 해제됨). */
export async function camerasOf(admin: AdminClient, key: string): Promise<DeviceCameraRow[]> {
  const { data } = await admin
    .from("vision_cameras")
    .select(
      "id, tank_id, name, camera_type, stream_url, resolution_w, resolution_h, fps_target, is_active, tanks!vision_cameras_tank_id_fkey(name, farm_id)"
    )
    .eq("api_key", key)
  return (data ?? []) as unknown as DeviceCameraRow[]
}

/** 조인해 온 수조를 한 겹 벗긴다. supabase-js 는 관계를 객체로도 배열로도 준다. */
export function tankOf(row: DeviceCameraRow) {
  return Array.isArray(row.tanks) ? row.tanks[0] : row.tanks
}

/** 이 기기가 살아 있다고 적는다. 어느 경로로 왔든 연락은 연락이다. */
export async function touch(
  admin: AdminClient,
  key: string,
  extra: { agent_version?: string; host_url?: string | null } = {}
) {
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
  if (extra.agent_version) patch.agent_version = extra.agent_version
  if (extra.host_url !== undefined) patch.host_url = extra.host_url || null
  await admin.from("vision_cameras").update(patch).eq("api_key", key)
}
