import { supabase } from "@/lib/supabase"
import type {
  CountBucket, CountRecord, CountWaterQualityPoint,
  VisionAlertConfig, VisionCamera, VisionCameraStatus,
} from "@/types"

// 개체수 모니터링 데이터 계층.
//
// 두 갈래로 나뉜다. 어느 쪽인지 헷갈리면 "돌고 있는 스트림을 건드리는가"를
// 물으면 된다.
//
//  · **읽기는 Supabase 직결** — 개체수 기록·집계·경보 설정 조회. RLS 가 남의
//    것을 걸러 주고, 수질과 같은 DB 라 통합 조회가 한 번에 끝난다. 비전
//    서비스를 거치면 왕복만 늘고 얻는 것이 없다.
//  · **쓰기와 제어는 /api/vision/** — 카메라 등록·수정·시작·정지, 경보 설정
//    저장. 이건 비전 서비스의 실행 중인 상태(스트림, 판정 캐시)를 바꾸는
//    일이라 반드시 그쪽을 거쳐야 한다.

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/vision${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? "개체수 서비스 요청이 실패했습니다.")
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ─────────────────────────────────────────────
// 실시간 연결 준비물
// ─────────────────────────────────────────────

export interface VisionSessionInfo {
  /** 비전 서비스가 설정되어 있고 볼 카메라가 있는가. false 면 화면은 안내만 띄운다. */
  enabled: boolean
  cameraIds: string[]
  token: string | null
  wsUrl: string | null
  expiresIn?: number
}

export async function getVisionSession(): Promise<VisionSessionInfo> {
  return api<VisionSessionInfo>("/session")
}

// ─────────────────────────────────────────────
// 카메라
// ─────────────────────────────────────────────

/** 목록 조회에서 조인해 오는 모양 — 수조·양식장 이름을 평평하게 편다. */
type CameraRow = VisionCamera & {
  tanks?: { name: string; farm_id: string; farms?: { name: string } | { name: string }[] } | null
}

function flatten(row: CameraRow): VisionCamera {
  const tank = row.tanks ?? undefined
  const farm = Array.isArray(tank?.farms) ? tank?.farms[0] : tank?.farms
  const camera = { ...row } as CameraRow & { tanks?: unknown }
  // 조인해 온 중첩 객체는 화면 타입에 없다. 이름만 뽑고 걷어낸다.
  delete camera.tanks
  return { ...(camera as VisionCamera), tank_name: tank?.name, farm_name: farm?.name }
}

export async function getCameras(tankId?: string): Promise<VisionCamera[]> {
  const query = tankId ? `?tank_id=${encodeURIComponent(tankId)}` : ""
  const rows = await api<CameraRow[]>(`/cameras${query}`)
  return rows.map(flatten)
}

export async function createCamera(values: {
  tank_id: string
  name: string
  camera_type?: "usb" | "rtsp" | "http"
  stream_url?: string | null
  fps_target?: number
  tank_area_m2?: number | null
  install_height?: number | null
}): Promise<VisionCamera> {
  return api<VisionCamera>("/cameras", { method: "POST", body: JSON.stringify(values) })
}

export async function updateCamera(
  id: string,
  values: Partial<Omit<VisionCamera, "id" | "tank_id" | "created_at">>
): Promise<VisionCamera> {
  return api<VisionCamera>(`/cameras/${id}`, { method: "PATCH", body: JSON.stringify(values) })
}

export async function deleteCamera(id: string): Promise<void> {
  await api<void>(`/cameras/${id}`, { method: "DELETE" })
}

export async function startCamera(id: string): Promise<void> {
  await api<{ detail: string }>(`/cameras/${id}/start`, { method: "POST" })
}

export async function stopCamera(id: string): Promise<void> {
  await api<{ detail: string }>(`/cameras/${id}/stop`, { method: "POST" })
}

export async function getCameraStatus(
  id: string
): Promise<{ camera_id: string; status: VisionCameraStatus; message: string | null }> {
  return api(`/cameras/${id}/status`)
}

/** MJPEG 영상 주소. <img src={...}> 로 그대로 쓴다(같은 출처라 쿠키가 실린다). */
export function streamUrl(cameraId: string): string {
  return `/api/vision/stream/${cameraId}`
}

// ─────────────────────────────────────────────
// 개체수 (Supabase 직결)
// ─────────────────────────────────────────────

/** 카메라별 가장 최근 개체수 한 줄씩.
 *
 *  PostgREST 에는 DISTINCT ON 이 없어 카메라마다 한 번씩 묻는다. 카메라는
 *  많아야 수십 대라 이 편이 뷰를 새로 만드는 것보다 단순하다. */
export async function getLatestCounts(cameraIds: string[]): Promise<Record<string, CountRecord>> {
  const rows = await Promise.all(
    cameraIds.map(async (id) => {
      const { data } = await supabase
        .from("count_records")
        .select("*")
        .eq("camera_id", id)
        .order("time", { ascending: false })
        .limit(1)
        .maybeSingle()
      return data as CountRecord | null
    })
  )
  const out: Record<string, CountRecord> = {}
  for (const row of rows) if (row) out[row.camera_id] = row
  return out
}

/** 원본 기록. 내보내기와 짧은 구간 보기에 쓴다. 긴 구간은 집계를 쓸 것. */
export async function getCountRecords(
  cameraId: string,
  hours = 24,
  limit = 5000
): Promise<CountRecord[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data, error } = await supabase
    .from("count_records")
    .select("*")
    .eq("camera_id", cameraId)
    .gte("time", since)
    .order("time", { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as CountRecord[]
}

/** 구간 집계. 버킷 크기는 초 단위(1시간=3600). */
export async function getCountHistory(
  cameraId: string,
  start: Date,
  end: Date,
  bucketSeconds = 3600
): Promise<CountBucket[]> {
  const { data, error } = await supabase.rpc("vision_count_history", {
    p_camera_id: cameraId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
    p_bucket_seconds: bucketSeconds,
  })
  if (error) throw error
  return (data ?? []) as CountBucket[]
}

/** 개체수 ↔ 수질을 같은 시간 버킷으로 맞춘 시계열. 통합 분석 차트의 재료다. */
export async function getCountWaterQualitySeries(
  tankId: string,
  start: Date,
  end: Date,
  bucketSeconds = 3600
): Promise<CountWaterQualityPoint[]> {
  const { data, error } = await supabase.rpc("vision_count_wq_series", {
    p_tank_id: tankId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
    p_bucket_seconds: bucketSeconds,
  })
  if (error) throw error
  return (data ?? []) as CountWaterQualityPoint[]
}

// ─────────────────────────────────────────────
// 경보 설정
// ─────────────────────────────────────────────

export async function getAlertConfigs(): Promise<VisionAlertConfig[]> {
  return api<VisionAlertConfig[]>("/alert-configs")
}

export async function createAlertConfig(values: {
  camera_id: string | null
  alert_type: VisionAlertConfig["alert_type"]
  threshold_value?: number | null
  threshold_pct?: number | null
  window_minutes?: number
  is_enabled?: boolean
  notify_email?: string | null
}): Promise<VisionAlertConfig> {
  return api<VisionAlertConfig>("/alert-configs", {
    method: "POST",
    body: JSON.stringify(values),
  })
}

export async function updateAlertConfig(
  id: string,
  values: Omit<VisionAlertConfig, "id" | "user_id" | "created_at">
): Promise<VisionAlertConfig> {
  return api<VisionAlertConfig>(`/alert-configs/${id}`, {
    method: "PUT",
    body: JSON.stringify(values),
  })
}

export async function deleteAlertConfig(id: string): Promise<void> {
  await api<void>(`/alert-configs/${id}`, { method: "DELETE" })
}

// ─────────────────────────────────────────────
// 상관계수
// ─────────────────────────────────────────────

/**
 * 피어슨 상관계수. 두 항목이 같이 움직이는 정도를 -1 ~ 1 로 돌려준다.
 *
 * 한쪽이라도 값이 없는 구간은 통째로 뺀다 — 수질과 개체수는 측정 주기가 달라
 * 빈칸이 흔하고, 그걸 0 으로 메우면 없는 상관이 생겨난다.
 * 표본이 3개 미만이거나 한쪽이 내내 같은 값이면 계산이 무의미하므로 null.
 */
export function correlation(pairs: [number | null, number | null][]): number | null {
  const clean = pairs.filter(
    ([a, b]) => a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b)
  ) as [number, number][]
  if (clean.length < 3) return null

  const n = clean.length
  const meanA = clean.reduce((s, [a]) => s + a, 0) / n
  const meanB = clean.reduce((s, [, b]) => s + b, 0) / n
  let cov = 0
  let varA = 0
  let varB = 0
  for (const [a, b] of clean) {
    const da = a - meanA
    const db = b - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA === 0 || varB === 0) return null
  return cov / Math.sqrt(varA * varB)
}

/** 상관계수를 사람 말로. 부호(같이 오르는가/반대인가)와 세기를 함께 말한다. */
export function correlationLabel(r: number | null): string {
  if (r === null) return "표본 부족"
  const strength = Math.abs(r)
  const direction = r > 0 ? "양" : "음"
  if (strength < 0.2) return "거의 무관"
  if (strength < 0.4) return `약한 ${direction}의 상관`
  if (strength < 0.7) return `뚜렷한 ${direction}의 상관`
  return `강한 ${direction}의 상관`
}
