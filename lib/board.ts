import { supabase } from "@/lib/supabase"

export interface BoardPost {
  id: string
  user_id: string
  author_name: string
  title: string
  content: string
  image_url: string | null
  view_count: number
  created_at: string
  updated_at: string
  comment_count?: number
}

export interface BoardComment {
  id: string
  post_id: string
  user_id: string
  author_name: string
  content: string
  created_at: string
}

async function currentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")
  return user
}

async function authorName(userId: string, email?: string | null): Promise<string> {
  const { data } = await supabase.from("profiles").select("name").eq("id", userId).single()
  return data?.name || email?.split("@")[0] || "익명"
}

// ── Posts ────────────────────────────────────────────────────
export async function getPosts(): Promise<BoardPost[]> {
  const { data, error } = await supabase
    .from("board_posts")
    .select("*, board_comments(count)")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data || []).map((p: BoardPost & { board_comments: { count: number }[] }) => ({
    ...p,
    comment_count: p.board_comments?.[0]?.count ?? 0,
  }))
}

export async function getPost(id: string): Promise<BoardPost | null> {
  const { data, error } = await supabase.from("board_posts").select("*").eq("id", id).single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data
}

export async function createPost(values: { title: string; content: string; image_url?: string | null }) {
  const user = await currentUser()
  const name = await authorName(user.id, user.email)
  const { data, error } = await supabase
    .from("board_posts")
    .insert({
      user_id: user.id,
      author_name: name,
      title: values.title.trim(),
      content: values.content.trim(),
      image_url: values.image_url ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as BoardPost
}

export async function updatePost(id: string, values: { title: string; content: string; image_url?: string | null }) {
  const { error } = await supabase
    .from("board_posts")
    .update({
      title: values.title.trim(),
      content: values.content.trim(),
      image_url: values.image_url ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw error
}

export async function deletePost(id: string) {
  const { error } = await supabase.from("board_posts").delete().eq("id", id)
  if (error) throw error
}

export async function incrementView(id: string) {
  // RPC — 실패해도 조회 흐름을 막지 않는다.
  await supabase.rpc("increment_post_view", { p_id: id })
}

// ── Comments ─────────────────────────────────────────────────
export async function getComments(postId: string): Promise<BoardComment[]> {
  const { data, error } = await supabase
    .from("board_comments")
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data || []
}

export async function createComment(postId: string, content: string) {
  const user = await currentUser()
  const name = await authorName(user.id, user.email)
  const { data, error } = await supabase
    .from("board_comments")
    .insert({ post_id: postId, user_id: user.id, author_name: name, content: content.trim() })
    .select()
    .single()
  if (error) throw error
  return data as BoardComment
}

export async function deleteComment(id: string) {
  const { error } = await supabase.from("board_comments").delete().eq("id", id)
  if (error) throw error
}

// ── Image upload ─────────────────────────────────────────────
export async function uploadPostImage(file: File): Promise<string> {
  const user = await currentUser()
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase()
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from("post-images").upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from("post-images").getPublicUrl(path)
  return data.publicUrl
}
