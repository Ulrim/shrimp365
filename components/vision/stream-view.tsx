"use client"

import { useEffect, useRef, useState } from "react"
import { VideoOff } from "lucide-react"
import { streamUrl } from "@/lib/vision"
import { ageLabel, useVisionFrame } from "@/lib/use-vision-frame"
import type { LiveCount } from "@/lib/use-vision-live"
import type { VisionCamera, VisionCameraStatus } from "@/types"
import { cn } from "@/lib/utils"

// MJPEG 영상 + 탐지 박스 오버레이. 영상이 안 열리면 장비가 올려 둔 사진.
//
// 영상과 박스는 서로 다른 길로 온다. 영상은 <img> 가 물고 있는 MJPEG 스트림,
// 박스는 WebSocket 으로 오는 count_update 다. 둘의 프레임이 완벽히 같은 순간을
// 가리키지는 않지만(수백 ms 차이), 1초에 한 번 세는 화면에서는 눈에 띄지 않는다.
// 서버가 이미 영상에 박스를 그려 넣으므로, 이 캔버스는 **박스를 끌 수 있게**
// 하려고 얹는 것이 아니라 좌표를 화면 크기에 맞춰 다시 그려 확대해도 선명하게
// 보이도록 하는 것이다.
//
// 영상이 안 열리는 흔한 경우 — 그리고 그때 무엇을 보여 주는가
// ---------------------------------------------------------
// 농장 공유기 뒤에 있는 장비에는 바깥에서 **들어갈** 수 없다(NAT). 그래서
// 영상도 WebSocket 도 열리지 않는다 — 장비는 멀쩡히 돌고 개체수도 쌓이는
// 중인데. 그 자리에 장비가 **올려 둔** 사진을 띄운다. 개체수와 같은 방향
// (나가는 연결)으로 오므로 공유기를 그대로 두고 쓸 수 있다.
//
// 그 사진은 최대 15초 묵었다. 그래서 "N초 전"을 반드시 함께 적는다 — 멈춘
// 사진을 실시간이라고 보여 주는 것이 가장 나쁘다.

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

  // 영상이 열려 있으면 사진은 받지 않는다 — 같은 것을 두 길로 받을 이유가 없다.
  const frame = useVisionFrame(camera.id, streamError)
  const showFrame = streamError && frame.url !== null

  // "N초 전"이 멈춰 있으면 사진이 묵은 것을 알 수 없다. 사진을 띄우는 동안만
  // 1초마다 다시 그린다.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!showFrame) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [showFrame])

  // 카메라가 바뀌면 이 컴포넌트는 통째로 다시 마운트된다(부모가 key 를 준다).
  // 그래서 streamError 를 효과로 되돌릴 필요가 없다 — 새 인스턴스는 처음부터
  // 깨끗하게 시작한다.

  const effective: VisionCameraStatus =
    status ?? (live ? "running" : camera.is_active ? "online" : "offline")
  const meta = STATUS_META[effective]

  // 사진으로 내려앉으면 개체수도 그 사진에 딸려 온 값을 쓴다. 실시간 연결이
  // 없는 장비에서 "—" 만 띄우면, 사진 속 박스는 세 마리인데 숫자는 비어 있다.
  const shownCount = live ? live.count : showFrame ? frame.count : null

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

      // 올려 둔 사진에는 장비가 이미 박스를 그려 넣었다. 여기서 또 그리면
      // 사진 속 박스와 몇 초 어긋난 박스가 겹쳐 보인다.
      if (showFrame) return
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
  }, [live, showBoxes, showFrame, camera.id])

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-black", className)}>
      {showFrame ? (
        /* eslint-disable-next-line @next/next/no-img-element -- blob: 주소는
           next/image 가 다루지 못한다(원격 호스트 허용 목록 밖이고 최적화할
           원본도 없다). */
        <img
          ref={imgRef}
          src={frame.url!}
          alt={`${camera.name} 수조 사진`}
          className="block w-full"
        />
      ) : streamError ? (
        /* 세 경우를 가려서 말한다. 예전에는 전부 "카메라가 시작되어 있는지
           확인하세요" 라고 했는데, 터널을 안 깐 장비에서는 그 말이 **거짓**
           이다 — 카메라는 멀쩡히 돌고 개체수도 쌓이는 중인데 엉뚱한 곳을
           뒤지게 된다. 고치는 방법이 서로 다르다. */
        <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
          <VideoOff className="w-8 h-8" />
          {camera.host_url ? (
            <>
              <p className="text-xs">영상에 연결할 수 없습니다</p>
              <p className="text-[11px] text-muted-foreground/70">
                카메라가 시작되어 있는지, 장비가 인터넷에 붙어 있는지 확인하세요
              </p>
              <button
                onClick={() => { setStreamError(false); setAttempt(a => a + 1) }}
                className="mt-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
              >
                다시 시도
              </button>
            </>
          ) : !frame.checked ? (
            <p className="text-xs">수조 사진을 받는 중…</p>
          ) : (
            <>
              <p className="text-xs">아직 올라온 수조 사진이 없습니다</p>
              <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground/70">
                개체수는 정상으로 기록되고 있습니다. 이 장비는 농장 공유기 뒤에
                있어 영상을 바로 볼 수 없고, 대신 사진을 15초마다 올립니다 —
                카메라가 돌기 시작하면 곧 여기에 보입니다.
              </p>
              <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground/70">
                계속 비어 있으면 서버에
                <span className="font-mono"> vision_snapshot.sql </span>
                을 실행했는지 확인하세요. 끊김 없는 영상이 필요하면 장비에
                터널(Cloudflare Tunnel)을 깝니다.
              </p>
            </>
          )}
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
          {shownCount !== null ? shownCount.toLocaleString() : "—"}
        </span>
        <span className="text-[10px] text-white/60">마리</span>
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1.5 backdrop-blur">
        <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
        <span className="text-[10px] text-white/80">{meta.label}</span>
      </div>

      {live ? (
        <div className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-2 py-1 text-[10px] text-white/70 backdrop-blur">
          신뢰도 {live.confidence_avg !== null ? `${Math.round(live.confidence_avg * 100)}%` : "—"}
          {" · "}추론 {live.inference_ms}ms
        </div>
      ) : showFrame ? (
        /* 사진이 얼마나 묵었는지 숨기지 않는다. 이 한 줄이 없으면 15초 전
           사진을 지금 수조로 믿게 된다. */
        <div className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-2 py-1 text-[10px] text-white/70 backdrop-blur">
          사진 {ageLabel(frame.takenAt, now) ?? "방금"}
          {frame.lengthCm !== null && <> {" · "}체장 {frame.lengthCm.toFixed(1)}cm</>}
        </div>
      ) : null}
    </div>
  )
}
