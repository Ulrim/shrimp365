"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { ShareBar } from "@/components/cardnews/share-bar"

type Props = {
  images: string[]
  title: string
  labels: { prev: string; next: string; cardIndex: string }
  /** 카드 아래 공유 버튼에 넘길 값 — 상세 화면의 canonical 주소와 요약. */
  share: { url: string; text?: string }
}

/**
 * 카드 뷰어. 이미지 자체는 서버 렌더된 <noscript> 폴백과 별개로
 * 여기서 한 장씩 넘겨 본다. 크롤러용 전체 이미지는 아래 목록에 그대로 남긴다.
 */
export function CardDeck({ images, title, labels, share }: Props) {
  const [idx, setIdx] = useState(0)
  const total = images.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1))
      if (e.key === "ArrowRight") setIdx((i) => Math.min(total - 1, i + 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [total])

  if (total === 0) return null

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden border border-border bg-muted">
        {/* 모든 카드를 DOM에 함께 렌더한다. 활성 카드만 보이지만 비활성 카드도
            마크업에 남아 있어 크롤러가 전체 이미지와 alt를 수집할 수 있다. */}
        <div className="relative aspect-square">
          {images.map((src, i) => (
            <Image
              key={src}
              src={src}
              alt={`${title} — ${i + 1}/${total} ${labels.cardIndex}`}
              fill
              sizes="(max-width: 768px) 100vw, 640px"
              className={`object-contain transition-opacity duration-200 ${
                i === idx ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              priority={i === 0}
              aria-hidden={i !== idx}
              unoptimized
            />
          ))}
        </div>

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={idx === 0}
              aria-label={labels.prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center disabled:opacity-0 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              disabled={idx === total - 1}
              aria-label={labels.next}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center disabled:opacity-0 transition-opacity"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <span className="absolute bottom-2 right-2 text-xs font-semibold bg-black/60 text-white rounded px-2 py-0.5 tabular-nums">
              {idx + 1} / {total}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 mt-3">
        {total > 1 ? (
          <div className="flex gap-1.5 overflow-x-auto py-1">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`${i + 1} ${labels.cardIndex}`}
                aria-current={i === idx}
                className={`relative w-12 h-12 shrink-0 rounded-md overflow-hidden border-2 transition-colors ${
                  i === idx ? "border-[#1E40AF]" : "border-transparent opacity-60 hover:opacity-100"
                }`}
              >
                <Image src={src} alt="" fill sizes="48px" className="object-cover" unoptimized />
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}

        <ShareBar url={share.url} title={title} text={share.text} />
      </div>
    </div>
  )
}
