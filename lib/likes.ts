import { supabase } from "@/lib/supabase"

/** 좋아요를 쓰는 콘텐츠 종류. 테이블과 참조 컬럼만 다르고 동작은 같다. */
export type LikeKind = "cardnews" | "board"

const TABLES: Record<LikeKind, { table: string; column: string }> = {
  cardnews: { table: "card_news_likes", column: "card_news_id" },
  board: { table: "board_post_likes", column: "post_id" },
}

/** 내가 이 글에 좋아요를 눌렀는지. 비로그인이면 false. */
export async function hasLiked(kind: LikeKind, id: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { table, column } = TABLES[kind]
  const { data } = await supabase
    .from(table)
    .select(column)
    .eq(column, id)
    .eq("user_id", user.id)
    .maybeSingle()
  return !!data
}

/** 좋아요 토글. 반환값은 토글 후 상태(true = 누른 상태). 비로그인이면 예외. */
export async function toggleLike(kind: LikeKind, id: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("LOGIN_REQUIRED")
  const { table, column } = TABLES[kind]

  const liked = await hasLiked(kind, id)
  if (liked) {
    const { error } = await supabase.from(table).delete().eq(column, id).eq("user_id", user.id)
    if (error) throw error
    return false
  }

  const { error } = await supabase.from(table).insert({ [column]: id, user_id: user.id })
  // 동시 클릭 등으로 이미 행이 있으면(23505) 눌린 상태로 취급한다.
  if (error && error.code !== "23505") throw error
  return true
}
