import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase-server"

const LOCALES = ["ko", "en", "vi", "id"]

/** 호출자가 admin 역할인지 확인하고, 통과하면 service-role 클라이언트를 돌려준다. */
async function requireAdmin(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 }) }
  }

  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { admin }
}

type Body = Record<string, unknown>

function normalize(body: Body, { partial }: { partial: boolean }) {
  const out: Record<string, unknown> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  const str = (k: string, max: number) => {
    const v = typeof body[k] === "string" ? (body[k] as string).trim() : ""
    return v.slice(0, max)
  }

  if (!partial || has("slug")) {
    const slug = str("slug", 80)
    if (!slug) return { error: "slug는 필수입니다." }
    out.slug = slug
  }
  if (!partial || has("locale")) {
    const locale = str("locale", 2) || "ko"
    if (!LOCALES.includes(locale)) return { error: "지원하지 않는 언어입니다." }
    out.locale = locale
  }
  if (!partial || has("title")) {
    const title = str("title", 200)
    if (!title) return { error: "제목은 필수입니다." }
    out.title = title
  }
  if (!partial || has("summary")) out.summary = str("summary", 300)
  if (!partial || has("body")) out.body = str("body", 20000)

  // 이미지 주소는 Storage 공개 URL(https) 또는 앱 자체 정적 경로(/cardnews/…)만 허용.
  // javascript:, data: 같은 스킴이 그대로 <img src>로 들어가지 않게 막는다.
  const isSafeUrl = (u: unknown): u is string =>
    typeof u === "string" && (u.startsWith("https://") || /^\/[^/]/.test(u))

  if (!partial || has("images")) {
    const images = Array.isArray(body.images) ? (body.images as unknown[]).filter(isSafeUrl).slice(0, 30) : []
    if (!partial && images.length === 0) return { error: "카드 이미지를 1장 이상 올려 주세요." }
    out.images = images
  }
  if (has("cover_url")) {
    out.cover_url = isSafeUrl(body.cover_url) ? body.cover_url : null
  }
  if (!partial || has("tags")) {
    out.tags = Array.isArray(body.tags)
      ? (body.tags as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim().replace(/^#/, ""))
          .filter(Boolean)
          .slice(0, 12)
      : []
  }
  if (!partial || has("published")) out.published = body.published !== false

  return { values: out }
}

/** 목록/상세 페이지 캐시를 즉시 갱신 — 등록 직후 사이트에 반영되도록. */
function revalidateCardNews(slug?: string) {
  revalidatePath("/cardnews")
  if (slug) revalidatePath(`/cardnews/${slug}`)
  revalidatePath("/sitemap.xml")
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => ({}))) as Body
  const parsed = normalize(body, { partial: false })
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const values = parsed.values as Record<string, unknown>
  if (!values.cover_url) values.cover_url = (values.images as string[])[0] ?? null

  const { data, error } = await gate.admin!.from("card_news").insert(values).select().single()
  if (error) {
    const msg = error.code === "23505" ? "같은 언어에 동일한 주소(slug)가 이미 있습니다." : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  revalidateCardNews(data.slug)
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => ({}))) as Body
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 })

  const parsed = normalize(body, { partial: true })
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const values = { ...(parsed.values as Record<string, unknown>), updated_at: new Date().toISOString() }
  const { data, error } = await gate.admin!.from("card_news").update(values).eq("id", id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  revalidateCardNews(data.slug)
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate.error) return gate.error

  const body = (await req.json().catch(() => ({}))) as Body
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 })

  const { data } = await gate.admin!.from("card_news").select("slug").eq("id", id).single()
  const { error } = await gate.admin!.from("card_news").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  revalidateCardNews(data?.slug)
  return NextResponse.json({ ok: true })
}
