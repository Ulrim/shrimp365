import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import { getPostServer, getCommentsServer } from "@/lib/board-server"
import { getServerDict } from "@/lib/i18n-server"
import { PostArticle } from "@/components/board/post-article"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

function excerpt(content: string, max = 150): string {
  const flat = content.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

type Props = { params: Promise<{ id: string }> }

// 게시글별 title/description/OG — 공유 링크(카카오톡·슬랙 등)와 검색 스니펫이
// 게시글마다 달라지도록 한다. getPostServer는 React cache()로 메모이즈되어
// 아래 페이지 컴포넌트와 동일 요청 내에서 중복 조회되지 않는다.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const post = await getPostServer(id)

  if (!post) {
    return { title: "게시글을 찾을 수 없습니다", robots: { index: false, follow: false } }
  }

  const description = excerpt(post.content) || "Shrimp365 커뮤니티 게시판"
  const url = `${BASE}/board/${id}`

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: "article",
      images: post.image_url ? [{ url: post.image_url }] : undefined,
    },
    twitter: {
      card: post.image_url ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: post.image_url ? [post.image_url] : undefined,
    },
  }
}

export default async function PostDetailPage({ params }: Props) {
  const { id } = await params
  const [post, comments, { t }] = await Promise.all([
    getPostServer(id),
    getCommentsServer(id),
    getServerDict(),
  ])
  const b = t.board

  if (!post) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-2xl mx-auto" role="alert">
        <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
        <p className="text-muted-foreground text-sm">{b.loadError}</p>
        <Link
          href="/board"
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
        >
          {b.back}
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto w-full animate-fade-in">
      <Link
        href="/board"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" />
        {b.back}
      </Link>
      <PostArticle post={post} initialComments={comments} />
    </div>
  )
}
