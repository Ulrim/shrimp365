"use client"

import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function TossFailPage() {
  const searchParams = useSearchParams()
  const code    = searchParams.get("code") ?? ""
  const message = searchParams.get("message") ?? "결제가 취소되었거나 실패했습니다."

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8" role="alert">
        <div className="w-24 h-24 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
          <XCircle aria-hidden="true" className="w-12 h-12 text-red-400" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-foreground mb-3">결제 실패</h1>
          <p className="text-muted-foreground">{message}</p>
          {code && <p className="text-muted-foreground text-xs mt-1">오류 코드: {code}</p>}
        </div>

        <div className="space-y-3">
          <Link href="/pricing">
            <Button className="w-full min-h-[44px] bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-medium">
              요금제 다시 보기
            </Button>
          </Link>
          <Link href="/home">
            <Button variant="ghost" className="w-full min-h-[44px] text-muted-foreground hover:text-foreground">
              대시보드로 이동
            </Button>
          </Link>
        </div>

        <div className="text-muted-foreground text-sm">Shrimp365</div>
      </div>
    </div>
  )
}
