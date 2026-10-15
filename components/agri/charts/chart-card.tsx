"use client"

// 차트 카드 껍데기 — 헤더(제목·액션), 전체화면, 전광판 토글, 15초 순환 진행 바(시안 5-6).
//
// 추세 카드와 센서별 비교 카드가 같은 껍데기를 쓴다. 전체화면이면 카드가
// `fixed inset-0` 으로 바뀌고 Escape 로 닫히며 뒤 페이지 스크롤을 잠근다.
// 전광판(big)은 전체화면 안에서만 켤 수 있고, 닫으면 부모가 함께 끈다(onClose).
import { useEffect, useState, type ReactNode } from "react"
import { Maximize2, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** 전광판 자동 순환 간격(ms). 데이터가 없는 항목은 부모가 건너뛴다. */
export const BOARD_CYCLE_MS = 15_000

interface ChartCardProps {
  title: ReactNode
  /** 제목 오른쪽, 전체화면 버튼 왼쪽에 들어가는 것(기간·자동 갱신 표시 등). */
  meta?: ReactNode
  /** 헤더 아래, 차트 위에 들어가는 것(탭·비교 항목 칩). */
  toolbar?: ReactNode
  /** 전광판 상단 수치 줄 — big 일 때만 그린다. */
  headline?: ReactNode
  /** 차트 아래 캡션. */
  caption?: ReactNode
  fullscreen: boolean
  onOpenFullscreen: () => void
  onClose: () => void
  board: boolean
  onToggleBoard: () => void
  /** 순환이 한 번 넘어갈 때마다 바뀌는 값 — 진행 바를 처음부터 다시 채운다. */
  cycleTick: number
  labels: { fullscreen: string; close: string; board: string; cycleNote: string }
  children: ReactNode
  className?: string
}

export function ChartCard({
  title, meta, toolbar, headline, caption, fullscreen, onOpenFullscreen, onClose, board, onToggleBoard, cycleTick,
  labels, children, className,
}: ChartCardProps) {
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [fullscreen, onClose])

  const big = fullscreen && board
  const iconBtn = "p-2 min-w-[44px] min-h-[44px] rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center justify-center transition-colors duration-200"

  return (
    <Card className={cn(
      "bg-card border-border",
      fullscreen && "fixed inset-0 z-50 rounded-none border-0 flex flex-col overflow-hidden",
      className,
    )}>
      <CardHeader className={cn("pb-2", fullscreen && "shrink-0")}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-foreground text-base flex items-center gap-2 min-w-0">{title}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {meta}
            {fullscreen && (
              <button type="button" onClick={onToggleBoard} aria-pressed={board}
                className={cn(
                  "min-h-[44px] px-3 rounded-lg border text-xs font-medium transition-colors duration-200",
                  board ? "bg-brand text-white border-brand" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}>
                {labels.board}
              </button>
            )}
            <button type="button" onClick={fullscreen ? onClose : onOpenFullscreen}
              aria-label={fullscreen ? labels.close : labels.fullscreen} title={fullscreen ? labels.close : labels.fullscreen}
              className={iconBtn}>
              {fullscreen ? <X className="w-4 h-4" aria-hidden="true" /> : <Maximize2 className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("pt-0", fullscreen && "flex-1 min-h-0 flex flex-col overflow-auto")}>
        {toolbar && <div className="mb-2 shrink-0">{toolbar}</div>}
        {big && (
          <div className="shrink-0 mb-1">
            <CycleProgress tick={cycleTick} note={labels.cycleNote} />
          </div>
        )}
        {big && headline && (
          <div className="shrink-0 mb-2 text-3xl font-bold tabular-nums text-foreground flex items-baseline gap-3 flex-wrap">
            {headline}
          </div>
        )}
        <div className={cn(fullscreen && "flex-1 min-h-0")}>{children}</div>
        {caption && <div className="mt-2 text-xs text-muted-foreground text-center shrink-0">{caption}</div>}
      </CardContent>
    </Card>
  )
}

/** 15초 동안 채워지는 진행 바. width 애니메이션은 장식이 아니라 "언제 넘어가는지"를
 *  알리는 정보라 예외로 허용(시안 5-6). motion-reduce 에서는 바 대신 글로 알린다. */
function CycleProgress({ tick, note }: { tick: number; note: string }) {
  return (
    <>
      <div className="h-0.5 w-full bg-muted rounded-full overflow-hidden motion-reduce:hidden" aria-hidden="true">
        <CycleFill key={tick} />
      </div>
      <p className="hidden motion-reduce:block text-xs text-muted-foreground">{note}</p>
    </>
  )
}

function CycleFill() {
  const [started, setStarted] = useState(false)
  useEffect(() => {
    // 마운트 직후 한 프레임 뒤에 100% 로 — 그래야 0 → 100 전환이 그려진다.
    const id = requestAnimationFrame(() => setStarted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="h-full bg-brand/30 ease-linear transition-[width]"
      style={{ width: started ? "100%" : "0%", transitionDuration: `${BOARD_CYCLE_MS}ms` }} />
  )
}
