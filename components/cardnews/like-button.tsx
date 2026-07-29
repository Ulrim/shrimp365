"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Heart } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { hasLikedCardNews, toggleCardNewsLike } from "@/lib/card-news"

type Props = { id: string; initialCount: number }

/**
 * 좋아요 버튼. 서버가 렌더한 초기 카운트에서 출발하고, 로그인 사용자에 한해
 * 내가 눌렀는지를 마운트 후 확인한다. 비로그인은 누르면 로그인으로 보낸다.
 */
export function CardNewsLikeButton({ id, initialCount }: Props) {
  const { user } = useAuth()
  const { t } = useT()
  const router = useRouter()
  const c = t.cardNews

  const [count, setCount] = useState(initialCount)
  // 어느 사용자에 대해 확인된 결과인지 함께 들고 있는다.
  // 로그아웃하거나 계정이 바뀌면 이전 결과가 그대로 남지 않는다.
  const [likedBy, setLikedBy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const liked = !!user && likedBy === user.id

  useEffect(() => {
    if (!user) return
    let alive = true
    hasLikedCardNews(id)
      .then((v) => { if (alive && v) setLikedBy(user.id) })
      .catch(() => {})
    return () => { alive = false }
  }, [id, user])

  async function onClick() {
    if (!user) { router.push("/login"); return }
    if (busy) return

    // 낙관적 갱신 — 네트워크를 기다리지 않고 즉시 반영하고, 실패하면 되돌린다.
    const prevLiked = liked
    const prevLikedBy = likedBy
    const prevCount = count
    setLikedBy(prevLiked ? null : user.id)
    setCount(prevCount + (prevLiked ? -1 : 1))
    setBusy(true)
    try {
      const now = await toggleCardNewsLike(id)
      setLikedBy(now ? user.id : null)
    } catch {
      setLikedBy(prevLikedBy)
      setCount(prevCount)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={liked}
      aria-label={liked ? c.unlike : c.like}
      className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border text-sm font-semibold transition-colors ${
        liked
          ? "border-[#1E40AF] bg-[#1E40AF] text-white"
          : "border-border hover:bg-muted text-foreground"
      }`}
    >
      <Heart className="w-4 h-4" fill={liked ? "currentColor" : "none"} aria-hidden="true" />
      <span>{liked ? c.liked : c.like}</span>
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  )
}
