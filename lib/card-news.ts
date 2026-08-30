import { supabase } from "@/lib/supabase"

export interface CardNews {
  id: string
  slug: string
  locale: string
  title: string
  summary: string
  body: string
  images: string[]
  cover_url: string | null
  tags: string[]
  published: boolean
  published_at: string
  view_count: number
  like_count: number
  created_at: string
  updated_at: string
}

export type CardNewsInput = {
  slug: string
  locale: string
  title: string
  summary: string
  body: string
  images: string[]
  cover_url?: string | null
  tags: string[]
  published: boolean
}

/** 제목에서 URL 슬러그를 만든다. 한글은 그대로 두고(디코딩된 한글 URL은 검색엔진이 처리함)
 *  공백·특수문자만 정리한다. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

/** 카드 이미지 업로드 — Storage `card-news` 버킷. 반환값은 공개 URL. */
export async function uploadCardImage(file: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")
  const ext = (file.name.split(".").pop() || "png").toLowerCase()
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from("card-news").upload(path, file, { upsert: false })
  if (error) throw error
  return supabase.storage.from("card-news").getPublicUrl(path).data.publicUrl
}

/** 조회수 +1 — 실패해도 열람 흐름을 막지 않는다.
 *  같은 탭에서 새로고침·뒤로가기로 다시 들어와도 중복 집계되지 않게 세션 단위로 한 번만 보낸다. */
export async function incrementCardNewsView(id: string) {
  try {
    const key = `cn_viewed_${id}`
    if (typeof sessionStorage !== "undefined") {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, "1")
    }
    await supabase.rpc("increment_card_news_view", { p_id: id })
  } catch {
    /* noop */
  }
}

async function callAdminApi(method: "POST" | "PATCH" | "DELETE", body: unknown) {
  const res = await fetch("/api/cardnews", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `요청 실패 (${res.status})`)
  return json
}

export const createCardNews = (values: CardNewsInput) => callAdminApi("POST", values)
export const updateCardNews = (id: string, values: Partial<CardNewsInput>) =>
  callAdminApi("PATCH", { id, ...values })
export const deleteCardNews = (id: string) => callAdminApi("DELETE", { id })
