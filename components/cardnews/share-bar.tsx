"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Share2, Check, Copy } from "lucide-react"
import { useT } from "@/lib/i18n-context"

/** 공유 시트 지원 여부는 런타임 중 바뀌지 않으므로 구독할 것이 없다. */
const subscribeNever = () => () => {}

// lucide에는 브랜드 마크가 없어(X 아이콘은 '닫기'다) 로고를 직접 그린다.
const XMark = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]" aria-hidden="true">
    <path d="M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </svg>
)

const FacebookMark = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]" aria-hidden="true">
    <path d="M24 12.073C24 5.446 18.627 0 12 0S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z" />
  </svg>
)

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
 * 누르면 SNS 대상과 주소가 함께 펼쳐진다.
 *  · 모바일: OS 공유 시트(카카오톡·인스타그램 등 설치된 앱이 그대로 뜬다)
 *  · X·페이스북: SDK 없이 웹 인텐트 주소로 연다
 *  · 주소는 눈으로 확인하고 복사할 수 있게 그대로 보여준다
 *
 * 링크를 붙였을 때 제목·요약·커버 이미지가 함께 펼쳐지는 것은 상세 페이지의
 * OG/Twitter 메타데이터가 담당한다(app/cardnews/[slug]/page.tsx).
 */
export function ShareBar({ url, title, text, className = "" }: Props) {
  const { t } = useT()
  const c = t.cardNews

  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // 서버에서는 false, 클라이언트에서는 실제 지원 여부.
  // 렌더 중에 navigator를 직접 보면 서버 결과와 어긋나 hydration이 깨진다.
  const canShare = useSyncExternalStore(
    subscribeNever,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false
  )

  // 바깥을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

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
      // 비보안 컨텍스트(http)나 권한 거부 시 실패한다.
      // 주소를 그대로 보여주고 있으므로 직접 복사하면 된다.
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url })
      setOpen(false)
    } catch {
      // 사용자가 공유 시트를 닫으면 reject된다 — 오류가 아니다.
    }
  }

  // 페이스북 sharer는 본문 파라미터를 무시하고 대상 주소의 OG 태그를 읽는다.
  const xHref = `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`

  const target =
    "flex items-center gap-2.5 w-full min-h-[44px] px-3 rounded-lg text-sm font-medium hover:bg-muted transition-colors text-foreground"

  return (
    <div ref={boxRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 text-sm border border-border rounded-lg px-3 min-h-[44px] hover:bg-muted transition-colors"
      >
        <Share2 className="w-4 h-4" aria-hidden="true" />
        {c.share}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={c.share}
          className="absolute right-0 bottom-full mb-2 z-20 w-[280px] rounded-xl border border-border bg-card shadow-lg p-2"
        >
          {canShare && (
            <button type="button" onClick={nativeShare} className={target}>
              <Share2 className="w-[18px] h-[18px]" aria-hidden="true" />
              {c.shareOther}
            </button>
          )}

          <a href={xHref} target="_blank" rel="noopener noreferrer" className={target}>
            <XMark />
            {c.shareOnX}
          </a>

          <a href={fbHref} target="_blank" rel="noopener noreferrer" className={target}>
            <FacebookMark />
            {c.shareOnFacebook}
          </a>

          <div className="border-t border-border mt-2 pt-2">
            <p className="text-xs text-muted-foreground px-1 pb-1.5">{c.linkLabel}</p>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={c.linkLabel}
                className="flex-1 min-w-0 text-xs bg-muted border border-border rounded-md px-2 h-9 text-muted-foreground"
              />
              <button
                type="button"
                onClick={copyLink}
                aria-label={c.copyLink}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold border border-border rounded-md px-2.5 h-9 hover:bg-muted transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-[#1E40AF]" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {copied ? c.linkCopied : c.copyLink}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
