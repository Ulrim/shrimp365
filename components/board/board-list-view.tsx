import Link from "next/link"
import Image from "next/image"
import { MessageSquare, Eye, Heart, ImageIcon } from "lucide-react"
import { getPostsServer } from "@/lib/board-server"
import { NewPostButton } from "@/components/board/new-post-button"
import { localePrefix } from "@/lib/marketing-locale"
import type { Dict } from "@/lib/i18n"

function formatDate(iso: string, locale: string) {
  const tag = locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"
  return new Date(iso).toLocaleDateString(tag, { year: "numeric", month: "2-digit", day: "2-digit" })
}

/**
 * 게시판 목록 본문. 한국어(/board)와 언어별 주소(/en/board 등)가 같은 화면을 쓴다.
 * 서버 컴포넌트라 초기 HTML에 게시글이 모두 포함되어 크롤러가 JS 없이 색인한다.
 */
export async function BoardListView({ locale, t }: { locale: string; t: Dict }) {
  const posts = await getPostsServer(locale)
  const b = t.board
  const prefix = localePrefix(locale)

  return (
    <div className="max-w-3xl mx-auto w-full animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{b.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{b.subtitle}</p>
          {/* 언어별 분리 — 어느 언어의 글을 보고 있는지 명시해 혼란을 막는다. */}
          <p className="text-xs text-muted-foreground/80 mt-1.5">{b.localeNotice}</p>
        </div>
        <NewPostButton label={b.newPost} />
      </div>

      {posts.length === 0 ? (
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
                href={`${prefix}/board/${post.id}`}
                className="flex gap-4 bg-card border border-border rounded-xl p-4 hover:border-[#1E40AF]/40 hover:bg-[#1E40AF]/[0.03] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-foreground truncate">{post.title}</h2>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 whitespace-pre-line">{post.content}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground font-mono tabular-nums">
                    <span className="font-semibold text-foreground/70">{post.author_name}</span>
                    <span>{formatDate(post.created_at, locale)}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.view_count}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{post.like_count ?? 0}</span>
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
