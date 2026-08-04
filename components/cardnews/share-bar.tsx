"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Share2, Link2, Check } from "lucide-react"
import { useT } from "@/lib/i18n-context"

/** 공유 시트 지원 여부는 런타임 중 바뀌지 않으므로 구독할 것이 없다. */
const subscribeNever = () => () => {}

type Props = {
  /** 공유할 정규 주소(절대경로). 상세 화면이 canonical과 같은 값을 넘긴다. */
  url: string
  title: string
  /** 공유 시트에 함께 실릴 설명 — 보통 summary. */
  text?: string
  className?: string
}

/**
 * 카드뉴스 공유 버튼.
 *
 * 모바일에서는 OS 공유 시트를 연다(카카오톡·인스타그램 등 설치된 앱이 모두 나온다).
 * 공유 시트가 없는 데스크톱 브라우저에서는 링크 복사만 보여준다.
 *
 * 링크를 붙였을 때 제목·요약·커버 이미지가 함께 펼쳐지는 것은 상세 페이지의
 * OG/Twitter 메타데이터가 담당한다(app/cardnews/[slug]/page.tsx). 여기서는
 * 그 주소를 건네주기만 한다.
 */
export function ShareBar({ url, title, text, className = "" }: Props) {
  const { t } = useT()
  const c = t.cardNews

  const [copied, setCopied] = useState(false)

  // 서버에서는 false, 클라이언트에서는 실제 지원 여부.
  // 서버 렌더 결과와 어긋나면 hydration이 깨지므로 렌더 중에 navigator를 직접 보지 않는다.
  const canShare = useSyncExternalStore(
    subscribeNever,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false
  )

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // 비보안 컨텍스트(http)나 권한 거부 시 클립보드 API가 실패한다.
      // 사용자가 주소창에서 복사하면 되므로 조용히 넘어간다.
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url })
    } catch {
      // 사용자가 공유 시트를 닫으면 reject된다 — 오류가 아니다.
    }
  }

  const btn =
    "inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-border hover:bg-muted text-foreground text-sm font-semibold transition-colors"

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {canShare && (
        <button type="button" onClick={nativeShare} className={btn}>
          <Share2 className="w-4 h-4" aria-hidden="true" />
          {c.share}
        </button>
      )}

      <button type="button" onClick={copyLink} className={btn} aria-live="polite">
        {copied ? (
          <Check className="w-4 h-4 text-[#1E40AF]" aria-hidden="true" />
        ) : (
          <Link2 className="w-4 h-4" aria-hidden="true" />
        )}
        {copied ? c.linkCopied : c.copyLink}
      </button>
    </div>
  )
}
