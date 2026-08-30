"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowLeft, ArrowUp, ArrowDown, ImagePlus, Loader2, X } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { supabase } from "@/lib/supabase"
import { createCardNews, slugify, uploadCardImage } from "@/lib/card-news"

const LOCALES = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
]

export default function NewCardNewsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { t } = useT()
  const c = t.cardNews

  const [checking, setChecking] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const [title, setTitle] = useState("")
  const [slugInput, setSlugInput] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [locale, setLocale] = useState("ko")
  const [summary, setSummary] = useState("")
  const [body, setBody] = useState("")
  const [tags, setTags] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [published, setPublished] = useState(true)

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // 제목을 고치면, 사용자가 슬러그를 직접 손대기 전까지 자동으로 따라간다(파생 값).
  const slug = slugTouched ? slugInput : slugify(title)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    let alive = true
    supabase.from("profiles").select("role").eq("id", user.id).single().then(({ data }) => {
      if (!alive) return
      setIsAdmin(data?.role === "admin")
      setChecking(false)
    })
    return () => { alive = false }
  }, [user, loading, router])

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setError("")
    try {
      // 선택 순서를 유지하기 위해 순차 업로드
      const urls: string[] = []
      for (const f of files) urls.push(await uploadCardImage(f))
      setImages((prev) => [...prev, ...urls])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  function move(i: number, dir: -1 | 1) {
    setImages((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSaving(true)
    try {
      const post = await createCardNews({
        slug,
        locale,
        title,
        summary,
        body,
        images,
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        published,
      })
      router.push(`/cardnews/${encodeURIComponent(post.slug)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  if (loading || checking) {
    return (
      <div className="py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center" role="alert">
        <p className="text-muted-foreground">{c.adminOnly}</p>
        <Link href="/cardnews" className="inline-flex items-center justify-center mt-4 px-4 min-h-[44px] border border-border rounded-lg text-sm hover:bg-muted transition-colors">
          {c.back}
        </Link>
      </div>
    )
  }

  const field = "w-full border border-border rounded-lg bg-card px-3 py-2.5 text-sm focus:outline-none focus:border-[#1E40AF]"
  const label = "block text-sm font-semibold mb-1.5"

  return (
    <div className="max-w-2xl mx-auto w-full animate-fade-in">
      <Link href="/cardnews" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 min-h-[44px]">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {c.back}
      </Link>

      <h1 className="text-xl font-bold mb-5">{c.formTitle}</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={label} htmlFor="cn-title">{c.fieldTitle}</label>
          <input id="cn-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={c.fieldTitlePlaceholder} required maxLength={200} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
          <div>
            <label className={label} htmlFor="cn-slug">{c.fieldSlug}</label>
            <input
              id="cn-slug"
              className={`${field} font-mono`}
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlugInput(e.target.value) }}
              required
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground mt-1.5">{c.fieldSlugHelp}</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">/cardnews/{slug || "…"}</p>
          </div>
          <div>
            <label className={label} htmlFor="cn-locale">{c.fieldLocale}</label>
            <select id="cn-locale" className={field} value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="cn-summary">{c.fieldSummary}</label>
          <input id="cn-summary" className={field} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={c.fieldSummaryPlaceholder} maxLength={300} />
        </div>

        <div>
          <label className={label}>{c.fieldImages}</label>
          <p className="text-xs text-muted-foreground mb-2">{c.fieldImagesHelp}</p>

          {images.length > 0 && (
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
              {images.map((src, i) => (
                <li key={src} className="relative group">
                  <div className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                    <Image src={src} alt="" fill sizes="120px" className="object-cover" unoptimized />
                    <span className="absolute top-1 left-1 text-[10px] font-bold bg-black/60 text-white rounded px-1.5 py-0.5 tabular-nums">{i + 1}</span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    <button type="button" onClick={() => move(i, -1)} aria-label={c.moveUp} disabled={i === 0} className="flex-1 border border-border rounded py-1 disabled:opacity-30 hover:bg-muted transition-colors">
                      <ArrowUp className="w-3 h-3 mx-auto" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} aria-label={c.moveDown} disabled={i === images.length - 1} className="flex-1 border border-border rounded py-1 disabled:opacity-30 hover:bg-muted transition-colors">
                      <ArrowDown className="w-3 h-3 mx-auto" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setImages((p) => p.filter((_, j) => j !== i))} aria-label={c.imageRemove} className="flex-1 border border-border rounded py-1 hover:bg-muted transition-colors">
                      <X className="w-3 h-3 mx-auto" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <label className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-4 min-h-[44px] cursor-pointer hover:bg-muted transition-colors">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="w-4 h-4" aria-hidden="true" />}
            {uploading ? c.imageUploading : c.imageAdd}
            <input type="file" accept="image/*" multiple onChange={handleFiles} disabled={uploading} className="hidden" />
          </label>
        </div>

        <div>
          <label className={label} htmlFor="cn-body">{c.fieldBody}</label>
          <textarea id="cn-body" className={`${field} min-h-[220px] leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} placeholder={c.fieldBodyPlaceholder} maxLength={20000} />
        </div>

        <div>
          <label className={label} htmlFor="cn-tags">{c.fieldTags}</label>
          <input id="cn-tags" className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={c.fieldTagsPlaceholder} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="w-4 h-4 accent-[#1E40AF]" />
          {published ? c.published : c.draft}
        </label>

        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

        <button
          type="submit"
          disabled={saving || uploading || images.length === 0}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-[#3B82F6] disabled:opacity-50 text-white text-sm font-semibold px-6 min-h-[44px] rounded-lg transition-colors"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {saving ? c.submitting : c.submit}
        </button>
      </form>
    </div>
  )
}
