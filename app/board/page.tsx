"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useT } from "@/lib/i18n-context"
import { useAuth } from "@/lib/auth-context"
import { getPosts, type BoardPost } from "@/lib/board"
import { MessageSquare, Eye, PenSquare, ImageIcon, AlertTriangle } from "lucide-react"

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
}

export default function BoardPage() {
  const { t } = useT()
  const { user } = useAuth()
  const b = t.board
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    getPosts()
      .then(p => { setPosts(p); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  return (
    <div className="max-w-3xl mx-auto w-full animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{b.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{b.subtitle}</p>
        </div>
        <Link
          href={user ? "/board/new" : "/login"}
          className="inline-flex items-center gap-1.5 shrink-0 bg-[#1E40AF] hover:bg-[#3B82F6] text-white text-sm font-semibold rounded-lg px-4 min-h-[44px] transition-colors"
        >
          <PenSquare className="w-4 h-4" />
          {b.newPost}
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#1E40AF] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center" role="alert">
          <AlertTriangle className="w-10 h-10 text-amber-500" />
          <p className="text-muted-foreground text-sm">{b.loadError}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground/40" />
          <p className="text-foreground font-semibold">{b.empty}</p>
          <p className="text-sm text-muted-foreground">{b.emptyMsg}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {posts.map(post => (
            <li key={post.id}>
              <Link
                href={`/board/${post.id}`}
                className="flex gap-4 bg-card border border-border rounded-xl p-4 hover:border-[#1E40AF]/40 hover:bg-[#1E40AF]/[0.03] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-foreground truncate">{post.title}</h2>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 whitespace-pre-line">{post.content}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground font-mono tabular-nums">
                    <span className="font-semibold text-foreground/70">{post.author_name}</span>
                    <span>{formatDate(post.created_at)}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.view_count}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{post.comment_count ?? 0}</span>
                  </div>
                </div>
                {post.image_url ? (
                  <div className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-muted border border-border">
                    <Image src={post.image_url} alt="" fill sizes="80px" className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="w-20 h-20 shrink-0 rounded-lg bg-muted/50 border border-border flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
