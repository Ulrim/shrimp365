"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useT } from "@/lib/i18n-context"
import { createPost, uploadPostImage } from "@/lib/board"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ArrowLeft, ImagePlus, X, AlertCircle } from "lucide-react"

export default function NewPostPage() {
  const router = useRouter()
  const { t } = useT()
  const b = t.board
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError("이미지는 5MB 이하만 업로드할 수 있습니다."); return }
    setError("")
    setUploading(true)
    try {
      const url = await uploadPostImage(file)
      setImageUrl(url)
    } catch {
      setError("이미지 업로드에 실패했습니다.")
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError(b.fieldTitle); return }
    setError("")
    setSaving(true)
    try {
      const post = await createPost({ title, content, image_url: imageUrl })
      router.replace(`/board/${post.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : b.loadError)
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full animate-fade-in">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" />
        {b.back}
      </button>

      <h1 className="text-xl font-bold text-foreground mb-5">{b.formNewTitle}</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="post-title" className="text-sm font-medium">{b.fieldTitle}</Label>
          <Input
            id="post-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={b.fieldTitlePlaceholder}
            maxLength={200}
            className="min-h-[44px]"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="post-content" className="text-sm font-medium">{b.fieldContent}</Label>
          <Textarea
            id="post-content"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={b.fieldContentPlaceholder}
            rows={10}
            className="resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{b.fieldImage}</Label>
          {imageUrl ? (
            <div className="relative w-full max-w-xs">
              <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted">
                <Image src={imageUrl} alt="" fill sizes="320px" className="object-cover" unoptimized />
              </div>
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                aria-label={b.imageRemove}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 cursor-pointer border border-dashed border-border rounded-lg px-4 py-3 text-sm text-muted-foreground hover:border-ocean-300 hover:text-foreground transition-colors min-h-[44px]">
              <ImagePlus className="w-4 h-4" />
              {uploading ? b.imageUploading : b.imageAdd}
              <input type="file" accept="image/*" onChange={handleImage} disabled={uploading} className="hidden" />
            </label>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="submit"
            disabled={saving || uploading}
            className="bg-ocean-500 hover:bg-ocean-600 text-white min-h-[44px] px-6"
          >
            {saving ? b.submitting : b.submit}
          </Button>
        </div>
      </form>
    </div>
  )
}
