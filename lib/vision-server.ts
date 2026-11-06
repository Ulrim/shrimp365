import { createServerClient } from "@supabase/ssr"
import type { NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

// 비전 서비스(vision/, Python) 호출 도우미 — **서버 전용**.
//
// 이 서비스는 인터넷에 노출되지 않는다. 컨테이너 내부 주소로만 부르고,
// 공유 키(X-Vision-Key)로 "shrimp365 가 맞다"를 증명한다. 그래서 **누가**
// 요청했고 그 사람이 이 카메라를 볼 자격이 있는지는 전적으로 여기서 판단해야
// 한다. 비전 서비스는 다시 묻지 않는다.
//
// 권한 판단은 직접 SQL 을 짜지 않고 **RLS 에 맡긴다** — 사용자 세션으로 만든
// 클라이언트로 vision_cameras 를 조회하면, 남의 카메라는 애초에 결과에
// 나오지 않는다(supabase/migrations/vision_monitoring.sql 의
// vision_cameras_all_own). 조건을 손으로 적으면 언젠가 한 곳을 빠뜨린다.

/** 카메라에 host_url 이 없을 때 쓰는 기본 주소.
 *
 *  장비가 한 대뿐인 배포(같은 호스트에 웹과 비전을 함께 띄운 경우)에서는
 *  이 값이 곧 그 장비다. 파이가 여러 대면 카메라마다 host_url 이 채워지므로
 *  이 값은 쓰이지 않는다. */
export const VISION_SERVICE_URL =
  process.env.VISION_SERVICE_URL || "http://vision:8000"

export function isVisionConfigured(): boolean {
  return !!process.env.VISION_SERVICE_KEY
}

/** 요청 쿠키에 묶인 Supabase 클라이언트. 이 클라이언트의 조회에는 RLS 가 걸린다. */
export function sessionClient(req: NextRequest): SupabaseClient {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // API 라우트는 세션을 갱신하지 않는다. 쿠키 쓰기는 미들웨어가 맡는다.
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
}

export interface VisionSession {
  supabase: SupabaseClient
  userId: string
}

/** 로그인 확인. 비로그인이면 null. */
export async function requireSession(req: NextRequest): Promise<VisionSession | null> {
  const supabase = sessionClient(req)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { supabase, userId: user.id }
}

/** 이 사용자가 가진 카메라 id 전부. RLS 가 남의 것을 걸러 낸다. */
export async function ownedCameraIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("vision_cameras").select("id")
  if (error) throw error
  return (data ?? []).map((r: { id: string }) => r.id)
}

/** 이 카메라가 내 것인가. 남의 것이면(또는 없으면) false. */
export async function ownsCamera(supabase: SupabaseClient, cameraId: string): Promise<boolean> {
  const { data } = await supabase
    .from("vision_cameras")
    .select("id")
    .eq("id", cameraId)
    .maybeSingle()
  return !!data
}

/**
 * 이 카메라를 맡은 장비의 주소를 찾는다. 소유 확인을 겸한다.
 *
 * 파이가 여러 대면 카메라마다 붙는 곳이 다르다. 전역 주소 하나로 보내면
 * 시작·정지·영상이 전부 첫 번째 장비로만 가고, 나머지 장비의 카메라는
 * "다른 장비에 물려 있습니다"만 돌려받는다.
 *
 * @returns 내 카메라가 아니면 null. 맞으면 그 장비의 주소(없으면 기본 주소).
 */
export async function cameraHost(
  supabase: SupabaseClient, cameraId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("vision_cameras")
    .select("id, host_url")
    .eq("id", cameraId)
    .maybeSingle()
  if (!data) return null   // RLS 가 남의 카메라를 걸러 낸다
  return (data.host_url as string | null)?.replace(/\/+$/, "") || VISION_SERVICE_URL
}

/** 이 수조가 내 것인가. 카메라를 새로 달 때 확인한다. */
export async function ownsTank(supabase: SupabaseClient, tankId: string): Promise<boolean> {
  const { data } = await supabase
    .from("tanks")
    .select("id")
    .eq("id", tankId)
    .maybeSingle()
  return !!data
}

/**
 * 비전 서비스 호출. 공유 키를 붙이고, 서비스가 죽어 있어도 화면이 깨지지 않게
 * 예외 대신 응답 객체를 돌려준다.
 *
 * 타임아웃을 반드시 건다 — 이 호출이 늘어지면 Next.js 요청 하나가 통째로
 * 묶인다. 영상 스트림처럼 오래 열려 있어야 하는 요청은 `timeoutMs: 0` 으로
 * 끈다(끊기면 영상이 멈춘다).
 */
export async function visionFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number; baseUrl?: string } = {}
): Promise<Response> {
  const { timeoutMs = 10_000, baseUrl, ...rest } = init
  const key = process.env.VISION_SERVICE_KEY
  if (!key) {
    return Response.json(
      { error: "VISION_SERVICE_KEY가 설정되지 않았습니다. 개체수 모니터링이 꺼져 있습니다." },
      { status: 503 }
    )
  }

  const headers = new Headers(rest.headers)
  headers.set("X-Vision-Key", key)

  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    return await fetch(`${baseUrl || VISION_SERVICE_URL}${path}`, {
      ...rest,
      headers,
      signal: controller?.signal,
      cache: "no-store",
    })
  } catch {
    // 서비스가 안 떠 있거나 타임아웃. 원인을 그대로 노출하지 않는다 —
    // 내부 호스트 주소가 브라우저로 새어 나갈 이유가 없다.
    return Response.json(
      { error: "개체수 분석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도하세요." },
      { status: 503 }
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 비전 서비스의 JSON 응답을 그대로 브라우저에 전달한다. */
export async function passThrough(res: Response): Promise<Response> {
  // 204 No Content 에 본문을 실으면 안 된다.
  if (res.status === 204) return new Response(null, { status: 204 })
  const text = await res.text()
  return new Response(text || "{}", {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}

export const UNAUTHORIZED = () =>
  Response.json({ error: "로그인이 필요합니다." }, { status: 401 })

export const NOT_FOUND = () =>
  Response.json({ error: "카메라를 찾을 수 없습니다." }, { status: 404 })
