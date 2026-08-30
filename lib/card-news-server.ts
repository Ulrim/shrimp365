// 서버 컴포넌트 전용 — 카드뉴스 공개 읽기(anon RLS SELECT 정책에 의존).
// 브라우저 번들에 들어가지 않도록 Server Component / generateMetadata / sitemap에서만 import할 것.
import { cache } from "react"
import { createClient } from "@supabase/supabase-js"
import type { CardNews } from "@/lib/card-news"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** 환경변수가 없으면 null. 이 모듈은 sitemap·목록 등 프리렌더 경로에서 불리는데,
 *  createClient가 그대로 throw하면 빌드 전체가 죽는다("supabaseUrl is required").
 *  환경변수 없는 환경(프리뷰 배포 등)에서는 카드뉴스만 비우고 빌드는 살린다. */
function publicClient() {
  if (!supabaseUrl || !anonKey) {
    console.error("[card-news] NEXT_PUBLIC_SUPABASE_URL/ANON_KEY 미설정 — 카드뉴스를 비웁니다.")
    return null
  }
  return createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
}

const SELECT = "id, slug, locale, title, summary, body, images, cover_url, tags, published, published_at, view_count, like_count, created_at, updated_at"

/** 예약 발행 기준 시각. published_at 이 이 시각을 지나야 공개한다.
 *
 *  published=true 로 미리 넣어 두고 published_at 을 미래 날짜로 잡으면
 *  그날이 되기 전까지 목록·본문·사이트맵 어디에도 나오지 않는다.
 *  페이지는 revalidate=300 이므로 날짜가 지나고 최대 5분 안에 노출된다.
 *
 *  RLS 정책은 published=true 만 보므로 이 필터는 서버 조회 계층에 둔다.
 *  service_role 로 도는 관리자 API는 영향을 받지 않는다. */
function publishedBy() {
  return new Date().toISOString()
}

/** 특정 언어의 게시된 카드뉴스 목록(최신순). */
export const getCardNewsListServer = cache(async (locale: string): Promise<CardNews[]> => {
  const client = publicClient()
  if (!client) return []
  const { data, error } = await client
    .from("card_news")
    .select(SELECT)
    .eq("locale", locale)
    .eq("published", true)
    .lte("published_at", publishedBy())
    .order("published_at", { ascending: false })
  if (error) {
    console.error("[card-news] list", error.message)
    return []
  }
  return (data as CardNews[]) || []
})

/** 슬러그 + 언어로 단건 조회. 해당 언어에 없으면 다른 언어 버전이라도 찾아 준다
 *  (검색결과로 유입된 사용자가 404를 보지 않도록). */
export const getCardNewsServer = cache(async (slug: string, locale: string): Promise<CardNews | null> => {
  const client = publicClient()
  if (!client) return null
  const exact = await client.from("card_news").select(SELECT).eq("slug", slug).eq("locale", locale)
    .eq("published", true).lte("published_at", publishedBy()).maybeSingle()
  if (exact.data) return exact.data as CardNews

  const any = await client.from("card_news").select(SELECT).eq("slug", slug)
    .eq("published", true).lte("published_at", publishedBy()).limit(1)
  return ((any.data as CardNews[]) || [])[0] ?? null
})

/** 같은 슬러그가 존재하는 언어 목록 — hreflang 생성용.
 *  실제로 등록된 언어만 돌려주므로 없는 언어판을 가리키는 일이 없다. */
export const getCardNewsLocalesServer = cache(async (slug: string): Promise<string[]> => {
  const client = publicClient()
  if (!client) return []
  const { data } = await client
    .from("card_news")
    .select("locale")
    .eq("slug", slug)
    .eq("published", true)
    .lte("published_at", publishedBy())
  return [...new Set(((data as { locale: string }[]) || []).map((r) => r.locale))]
})

/** sitemap 생성용 — 전 언어 전체 목록. */
export const getAllCardNewsServer = cache(async (): Promise<Pick<CardNews, "slug" | "locale" | "updated_at">[]> => {
  const client = publicClient()
  if (!client) return []
  const { data, error } = await client
    .from("card_news")
    .select("slug, locale, updated_at")
    .eq("published", true)
    .lte("published_at", publishedBy())
    .order("published_at", { ascending: false })
  if (error) {
    console.error("[card-news] sitemap", error.message)
    return []
  }
  return data || []
})

/** 같은 태그를 공유하는 다른 글 — 내부 링크(크롤 경로) 확보용. */
export const getRelatedCardNewsServer = cache(async (current: CardNews, limit = 3): Promise<CardNews[]> => {
  const client = publicClient()
  if (!client) return []
  let rows: CardNews[] = []

  if (current.tags?.length) {
    const { data } = await client
      .from("card_news")
      .select(SELECT)
      .eq("locale", current.locale)
      .eq("published", true)
      .lte("published_at", publishedBy())
      .neq("id", current.id)
      .overlaps("tags", current.tags)
      .order("published_at", { ascending: false })
      .limit(limit)
    rows = (data as CardNews[]) || []
  }

  if (rows.length < limit) {
    const { data } = await client
      .from("card_news")
      .select(SELECT)
      .eq("locale", current.locale)
      .eq("published", true)
      .lte("published_at", publishedBy())
      .neq("id", current.id)
      .order("published_at", { ascending: false })
      .limit(limit)
    const seen = new Set(rows.map((r) => r.id))
    for (const r of ((data as CardNews[]) || [])) {
      if (rows.length >= limit) break
      if (!seen.has(r.id)) rows.push(r)
    }
  }

  return rows.slice(0, limit)
})
