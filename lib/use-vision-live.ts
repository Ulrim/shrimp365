"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getVisionSession } from "@/lib/vision"
import type { VisionCameraStatus, VisionEvent } from "@/types"

// 개체수 실시간 연결 — 앱에서 딱 한 번만 연다.
//
// WebSocket 은 Next.js 라우트로 중계할 수 없어(라우트 핸들러가 업그레이드를
// 처리하지 못한다) 브라우저가 비전 서비스에 직접 붙는다. 그래서 붙기 직전에
// /api/vision/session 으로 짧은 서명 토큰을 받아 온다.
//
// 토큰은 3분짜리다. 연결이 살아 있는 동안에는 다시 확인하지 않으므로(인증은
// 접속 순간에 한 번) 오래 열려 있어도 끊기지 않고, **재접속할 때마다 새로
// 받아 온다.** 그래서 connect() 안에서 매번 세션을 조회한다.

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000

/** 화면에 남겨 두는 최근 경보 개수. 알림함이 따로 있으므로 여기선 맛보기만. */
const LIVE_ALERT_LIMIT = 20

export type WsState = "connecting" | "open" | "closed" | "disabled"

export interface LiveCount {
  count: number
  confidence_avg: number | null
  timestamp: string
  bboxes: { x1: number; y1: number; x2: number; y2: number; confidence: number }[]
  frame_width: number
  frame_height: number
  inference_ms: number
}

export interface LiveAlert {
  camera_id: string
  tank_id: string
  alert_type: string
  severity: "danger" | "warning"
  message: string
  timestamp: string
}

export interface VisionLive {
  wsState: WsState
  /** 카메라별 마지막 프레임 결과. 아직 안 온 카메라는 없다. */
  latest: Record<string, LiveCount>
  /** 카메라별 연결 상태. 서버가 바뀔 때만 보내므로 없으면 "모름"이다. */
  statuses: Record<string, VisionCameraStatus>
  /** 방금 올라온 경보들(최신 우선). 이력은 알림함(alerts)에 남는다. */
  alerts: LiveAlert[]
  /** 이 사용자가 볼 수 있는 카메라 id — 토큰이 허용한 범위와 같다. */
  cameraIds: string[]
  /** 영상 주소를 만들 때 쓴다(직결 배포에서만 값이 있다). streamUrl() 에 넘긴다. */
  stream: { streamBase: string | null; token: string | null }
}

/**
 * 실시간 연결 주소.
 *
 * `wsUrl` 은 두 모양으로 온다 — 직결 배포는 절대 주소(`wss://vision…/ws`),
 * 같은 호스트 배포는 경로(`/vision-ws`). 경로면 지금 보고 있는 출처에
 * 붙이고, 절대 주소면 그대로 쓴다.
 *
 * 끝의 `all` 은 "토큰이 허락하는 카메라 전부"를 뜻한다. 남의 카메라는 서버가
 * 잘라 내므로 여기서 목록을 나열할 필요가 없다.
 */
function socketUrl(wsUrl: string, token: string): string {
  const base = /^wss?:\/\//.test(wsUrl)
    ? wsUrl
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${wsUrl}`
  return `${base.replace(/\/+$/, "")}/stream/all?token=${encodeURIComponent(token)}`
}

export function useVisionLive(enabled = true): VisionLive {
  // enabled 가 false 인 동안에는 "꺼짐"이 상태가 아니라 **입력**이다. 효과에서
  // 밀어 넣지 않고 읽는 자리에서 정한다.
  const [socketState, setSocketState] = useState<WsState>("closed")
  const [latest, setLatest] = useState<Record<string, LiveCount>>({})
  const [statuses, setStatuses] = useState<Record<string, VisionCameraStatus>>({})
  const [alerts, setAlerts] = useState<LiveAlert[]>([])
  const [cameraIds, setCameraIds] = useState<string[]>([])
  // 영상 주소를 만드는 데 필요한 값. 직결 배포에서만 채워진다.
  const [stream, setStream] = useState<{ streamBase: string | null; token: string | null }>({
    streamBase: null,
    token: null,
  })

  const attemptRef = useRef(0)

  const handle = useCallback((event: VisionEvent) => {
    switch (event.type) {
      case "count_update":
        setLatest(prev => ({
          ...prev,
          [event.camera_id]: {
            count: event.count,
            confidence_avg: event.confidence_avg,
            timestamp: event.timestamp,
            bboxes: event.bboxes ?? [],
            frame_width: event.frame_width,
            frame_height: event.frame_height,
            inference_ms: event.inference_ms,
          },
        }))
        // 프레임이 오고 있으면 그 카메라는 살아 있다. camera_status 는 상태가
        // 바뀔 때만 오므로, 화면을 새로 연 사용자는 이 신호로 먼저 안다.
        setStatuses(prev => (prev[event.camera_id] === "running"
          ? prev
          : { ...prev, [event.camera_id]: "running" }))
        break
      case "camera_status":
        setStatuses(prev => ({ ...prev, [event.camera_id]: event.status }))
        break
      case "alert":
        setAlerts(prev => [
          {
            camera_id: event.camera_id,
            tank_id: event.tank_id,
            alert_type: event.alert_type,
            severity: event.severity,
            message: event.message,
            timestamp: event.timestamp,
          },
          ...prev,
        ].slice(0, LIVE_ALERT_LIMIT))
        break
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const scheduleReconnect = () => {
      if (disposed) return
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attemptRef.current, BACKOFF_CAP_MS)
      attemptRef.current += 1
      reconnectTimer = setTimeout(connect, delay)
    }

    const connect = async () => {
      if (disposed) return
      setSocketState("connecting")

      // 토큰은 붙을 때마다 새로 받는다 — 3분이면 만료되기 때문이다.
      let session
      try {
        session = await getVisionSession()
      } catch {
        scheduleReconnect()
        return
      }
      if (disposed) return

      setCameraIds(session.cameraIds)
      setStream({ streamBase: session.streamBase, token: session.token })
      if (!session.enabled || !session.token || !session.wsUrl) {
        // 아직 카메라가 없거나 서비스가 꺼져 있다. 계속 두드릴 이유가 없다.
        setSocketState("disabled")
        return
      }

      ws = new WebSocket(socketUrl(session.wsUrl, session.token))

      ws.onopen = () => {
        attemptRef.current = 0
        setSocketState("open")
      }

      ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          const message = JSON.parse(ev.data) as VisionEvent
          if (message && typeof message === "object" && "type" in message) handle(message)
        } catch {
          // 깨진 프레임은 버린다.
        }
      }

      ws.onclose = () => {
        if (disposed) return
        setSocketState("closed")
        scheduleReconnect()
      }

      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      // 닫는 쪽에서 onclose 가 다시 재접속을 걸지 않도록 핸들러를 먼저 뗀다.
      if (ws) {
        ws.onclose = null
        ws.close()
      }
      setSocketState("closed")
    }
  }, [enabled, handle])

  const wsState: WsState = enabled ? socketState : "disabled"
  return { wsState, latest, statuses, alerts, cameraIds, stream }
}
