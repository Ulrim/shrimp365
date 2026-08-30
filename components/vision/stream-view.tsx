"use client"

import { useEffect, useRef, useState } from "react"
import { VideoOff } from "lucide-react"
import { streamUrl } from "@/lib/vision"
import type { LiveCount } from "@/lib/use-vision-live"
import type { VisionCamera, VisionCameraStatus } from "@/types"
import { cn } from "@/lib/utils"

// MJPEG 영상 + 탐지 박스 오버레이.
//
// 영상과 박스는 서로 다른 길로 온다. 영상은 <img> 가 물고 있는 MJPEG 스트림,
// 박스는 WebSocket 으로 오는 count_update 다. 둘의 프레임이 완벽히 같은 순간을
// 가리키지는 않지만(수백 ms 차이), 1초에 한 번 세는 화면에서는 눈에 띄지 않는다.
// 서버가 이미 영상에 박스를 그려 넣으므로, 이 캔버스는 **박스를 끌 수 있게**
// 하려고 얹는 것이 아니라 좌표를 화면 크기에 맞춰 다시 그려 확대해도 선명하게
// 보이도록 하는 것이다.

const STATUS_META: Record<VisionCameraStatus, { label: string; dot: string }> = {
  running: { label: "분석 중", dot: "bg-emerald-400" },
  online:  { label: "연결됨",  dot: "bg-ocean-400" },
  offline: { label: "중지됨",  dot: "bg-muted-foreground/50" },
  error:   { label: "오류",    dot: "bg-red-400" },
}

interface Props {
  camera: VisionCamera
  live?: LiveCount
  status?: VisionCameraStatus
  showBoxes?: boolean
  /** 영상 주소를 만드는 데 필요한 값(useVisionLive().stream). 직결 배포에서만 쓰인다. */
  stream?: { streamBase: string | null; token: string | null }
  className?: string
}

export function StreamView({ camera, live, status, showBoxes = true, stream, className }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [streamError, setStreamError] = useState(false)
  // 재시도 때 <img> 를 새로 만들어야 브라우저가 끊긴 스트림을 다시 문다.
  const [attempt, setAttempt] = useState(0)

  // 카메라가 바뀌면 이 컴포넌트는 통째로 다시 마운트된다(부모가 key 를 준다).
  // 그래서 streamError 를 효과로 되돌릴 필요가 없다 — 새 인스턴스는 처음부터
  // 깨끗하게 시작한다.

  const effective: VisionCameraStatus =
    status ?? (live ? "running" : camera.is_active ? "online" : "offline")
  const meta = STATUS_META[effective]

  // 새 값이 오거나 창 크기가 바뀔 때마다 박스를 다시 그린다.
  useEffect(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return

    const draw = () => {
      const w = img.clientWidth
      const h = img.clientHeight
      if (w === 0 || h === 0) return
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)

      if (!showBoxes || !live?.bboxes.length || !live.frame_width || !live.frame_height) return
      // 추론 프레임 좌표 → 화면에 그려진 크기로 환산.
      const sx = w / live.frame_width
      const sy = h / live.frame_height
      ctx.strokeStyle = "#2dd4bf"
      ctx.lineWidth = 1.5
      for (const b of live.bboxes) {
        ctx.strokeRect(b.x1 * sx, b.y1 * sy, (b.x2 - b.x1) * sx, (b.y2 - b.y1) * sy)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(img)
    return () => observer.disconnect()
  }, [live, showBoxes, camera.id])

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-black", className)}>
      {streamError ? (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 text-muted-foreground">
          <VideoOff className="w-8 h-8" />
          <p className="text-xs">영상에 연결할 수 없습니다</p>
          <p className="text-[11px] text-muted-foreground/70">카메라가 시작되어 있는지 확인하세요</p>
          <button
            onClick={() => { setStreamError(false); setAttempt(a => a + 1) }}
            className="mt-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
          >
            다시 시도
          </button>
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- MJPEG 스트림은
           next/image 로 다룰 수 없다. 끝나지 않는 multipart 응답이라 최적화
           파이프라인이 처리하지 못하고, 크기도 미리 알 수 없다. */
        <img
          ref={imgRef}
          key={`${camera.id}-${camera.host_url ?? ""}-${attempt}-${stream?.token ?? ""}`}
          src={streamUrl(camera, stream)}
          alt={`${camera.name} 실시간 영상`}
          className="block w-full"
          onError={() => setStreamError(true)}
        />
      )}

      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />

      <div className="absolute left-3 top-3 flex items-baseline gap-1.5 rounded-lg bg-black/70 px-2.5 py-1.5 backdrop-blur">
        <span className="text-lg font-bold tabular-nums leading-none text-teal-300">
          {live ? live.count.toLocaleString() : "—"}
        </span>
        <span className="text-[10px] text-white/60">마리</span>
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1.5 backdrop-blur">
        <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
        <span className="text-[10px] text-white/80">{meta.label}</span>
      </div>

      {live && (
        <div className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-2 py-1 text-[10px] text-white/70 backdrop-blur">
          신뢰도 {live.confidence_avg !== null ? `${Math.round(live.confidence_avg * 100)}%` : "—"}
          {" · "}추론 {live.inference_ms}ms
        </div>
      )}
    </div>
  )
}
