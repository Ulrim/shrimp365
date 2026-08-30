"use client"

import { useEffect } from "react"
import { incrementCardNewsView } from "@/lib/card-news"

/** 조회수 +1 (마운트 1회). 서버 렌더 결과에는 영향을 주지 않는다. */
export function CardNewsViewPing({ id }: { id: string }) {
  useEffect(() => {
    incrementCardNewsView(id)
  }, [id])
  return null
}
