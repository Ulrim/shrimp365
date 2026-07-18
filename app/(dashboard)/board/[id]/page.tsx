"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import {
  getPost, deletePost, updatePost, incrementView, uploadPostImage,
  getComments, createComment, deleteComment,
  type BoardPost, type BoardComment,
} from "@/lib/board"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeft, Eye, MessageSquare, Trash2, Pencil, Send, X, ImagePlus, AlertTriangle,
} from "lucide-react"

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { t } = useT()
  const b = t.board

  const [post, setPost] = useState<BoardPost | null>(null)
  const [comments, setComments] = useState<BoardComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [comment, setComment] = useState("")
  const [posting, setPosting] = useState(false)

  // edit mode
  const [editing, setEditing] = useState(false)
  const [eTitle, setETitle] = useState("")
  const [eContent, setEContent] = useState("")
  const [eImage, setEImage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)

  const isAdmin = user?.role === "admin"
  const isOwner = !!user && !!post && user.id === post.user_id

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([getPost(id), getComments(id)])
      if (!p) { setError(true); setLoading(false); return }
      setPost(p)
      setComments(c)
      setLoading(false)
    } catch {
      setError(true); setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
    incrementView(id).catch(() => {})
  }, [id, load])

  const startEdit = () => {
    if (!post) return
    setETitle(post.title)
    setEContent(post.content)
    setEImage(post.image_url)
    setEditing(true)
  }

  const handleEditImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try { setEImage(await uploadPostImage(file)) } catch {} finally { setUploading(false) }
  }

  const saveEdit = async () => {
    if (!post || !eTitle.trim()) return
    setSavingEdit(true)
    try {
      await updatePost(post.id, { title: eTitle, content: eContent, image_url: eImage })
      setPost({ ...post, title: eTitle.trim(), content: eContent.trim(), image_url: eImage })
      setEditing(false)
    } catch {} finally { setSavingEdit(false) }
  }

  const handleDelete = async () => {
    if (!post || !confirm(b.deleteConfirm)) return
    try { await deletePost(post.id); router.replace("/board") } catch {}
  }

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!comment.trim()) return
    setPosting(true)
    try {
      const c = await createComment(id, comment)
      setComments(prev => [...prev, c])
      setComment("")
    } catch {} finally { setPosting(false) }
  }

  const handleDeleteComment = async (cid: string) => {
    if (!confirm(b.deleteCommentConfirm)) return
    try { await deleteComment(cid); setComments(prev => prev.filter(c => c.id !== cid)) } catch {}
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (error || !post) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-2xl mx-auto" role="alert">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="text-muted-foreground text-sm">{b.loadError}</p>
        <Button onClick={() => router.replace("/board")} variant="outline" className="min-h-[44px]">{b.back}</Button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto w-full animate-fade-in">
      <button
        onClick={() => router.replace("/board")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" />
        {b.back}
      </button>

      {editing ? (
        /* ── Edit form ── */
        <div className="space-y-4">
          <Input value={eTitle} onChange={e => setETitle(e.target.value)} maxLength={200} className="min-h-[44px]" />
          <Textarea value={eContent} onChange={e => setEContent(e.target.value)} rows={10} className="resize-y" />
          {eImage ? (
            <div className="relative w-full max-w-xs">
              <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted">
                <Image src={eImage} alt="" fill sizes="320px" className="object-cover" unoptimized />
              </div>
              <button type="button" onClick={() => setEImage(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 cursor-pointer border border-dashed border-border rounded-lg px-4 py-3 text-sm text-muted-foreground hover:text-foreground min-h-[44px]">
              <ImagePlus className="w-4 h-4" />
              {uploading ? b.imageUploading : b.imageAdd}
              <input type="file" accept="image/*" onChange={handleEditImage} disabled={uploading} className="hidden" />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)} className="min-h-[44px]">{t.common.cancel}</Button>
            <Button onClick={saveEdit} disabled={savingEdit || uploading} className="bg-ocean-500 hover:bg-ocean-600 text-white min-h-[44px]">
              {savingEdit ? b.submitting : t.common.save}
            </Button>
          </div>
        </div>
      ) : (
        /* ── View ── */
        <article>
          <h1 className="text-2xl font-bold text-foreground break-words">{post.title}</h1>
          <div className="flex items-center gap-3 mt-2 mb-4 text-xs text-muted-foreground border-b border-border pb-4">
            <span className="font-medium text-foreground/70">{post.author_name}</span>
            <span>{formatDateTime(post.created_at)}</span>
            <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.view_count}</span>
            <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{comments.length}</span>
            {(isOwner || isAdmin) && (
              <span className="ml-auto flex items-center gap-2">
                {isOwner && (
                  <button onClick={startEdit} className="flex items-center gap-1 hover:text-foreground">
                    <Pencil className="w-3.5 h-3.5" />{b.edit}
                  </button>
                )}
                <button onClick={handleDelete} className="flex items-center gap-1 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />{b.delete}
                </button>
              </span>
            )}
          </div>

          {post.image_url && (
            <div className="relative w-full rounded-xl overflow-hidden bg-muted mb-4">
              <Image src={post.image_url} alt="" width={800} height={600} sizes="(max-width:768px) 100vw, 672px" className="w-full h-auto object-contain" unoptimized />
            </div>
          )}

          <p className="text-foreground/90 leading-relaxed whitespace-pre-line break-words">{post.content}</p>
        </article>
      )}

      {/* ── Comments ── */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-ocean-500" />
          {b.comments} {comments.length}
        </h2>

        <ul className="space-y-3 mb-4">
          {comments.length === 0 ? (
            <li className="text-sm text-muted-foreground py-4 text-center">{b.commentEmpty}</li>
          ) : comments.map(c => (
            <li key={c.id} className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-foreground/80">{c.author_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatDateTime(c.created_at)}</span>
                  {(user?.id === c.user_id || isAdmin) && (
                    <button onClick={() => handleDeleteComment(c.id)} aria-label={b.delete} className="text-muted-foreground hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-foreground/90 whitespace-pre-line break-words">{c.content}</p>
            </li>
          ))}
        </ul>

        <form onSubmit={handleComment} className="flex gap-2 items-end">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={b.commentPlaceholder}
            rows={2}
            className="resize-none flex-1"
          />
          <Button type="submit" disabled={posting || !comment.trim()} className="bg-ocean-500 hover:bg-ocean-600 text-white shrink-0 min-h-[44px] gap-1.5">
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">{b.commentSubmit}</span>
          </Button>
        </form>
      </section>
    </div>
  )
}
