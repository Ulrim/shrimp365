// 서버 컴포넌트 전용 — 게시판 공개 읽기(anon RLS SELECT 정책에 의존).
// 브라우저로 번들되지 않도록 반드시 Server Component/generateMetadata에서만 import할 것.
import { cache } from "react"
import { createClient } from "@supabase/supabase-js"
import type { BoardPost, BoardComment } from "@/lib/board"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function publicClient() {
  return createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
}

// React cache()로 같은 요청 안에서 generateMetadata와 페이지 컴포넌트가
// 중복 조회하지 않도록 메모이즈.
export const getPostsServer = cache(async (): Promise<BoardPost[]> => {
  const { data, error } = await publicClient()
    .from("board_posts")
    .select("*, board_comments(count)")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []).map((p: BoardPost & { board_comments: { count: number }[] }) => ({
    ...p,
    comment_count: p.board_comments?.[0]?.count ?? 0,
  }))
})

export const getPostServer = cache(async (id: string): Promise<BoardPost | null> => {
  const { data, error } = await publicClient().from("board_posts").select("*").eq("id", id).single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data
})

export const getCommentsServer = cache(async (postId: string): Promise<BoardComment[]> => {
  const { data, error } = await publicClient()
    .from("board_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data || []
})
