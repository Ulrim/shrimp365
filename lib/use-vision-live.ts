"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getVisionSession } from "@/lib/vision"
import type { VisionCameraStatus, VisionEvent } from "@/types"

// 개체수 실시간 연결.
//
// WebSocket 은 Next.js 라우트로 중계할 수 없어(라우트 핸들러가 업그레이드를
// 처리하지 못한다) 브라우저가 비전 서비스에 직접 붙는다. 그래서 붙기 직전에
// /api/vision/session 으로 짧은 서명 토큰과 장비 목록을 받아 온다.
//
// **장비마다 연결을 하나씩 연다.** CSI 카메라는 보드에 리본으로 붙어 있어 그
// 보드에서만 열린다 — 파이가 여러 대면 개체수도 각 파이가 따로 밀어 준다.
// 연결 하나로 묶으려면 어느 한 파이가 다른 파이의 이벤트를 중계해야 하는데,
// 그러면 그 파이가 죽을 때 전부 멎는다. 파이가 한 대뿐이면 연결도 하나다.
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
  /** 장비 하나라도 붙어 있으면 open. 전부 끊기면 closed. */
  wsState: WsState
  /** 카메라별 마지막 프레임 결과. 아직 안 온 카메라는 없다. */
  latest: Record<string, LiveCount>
  /** 카메라별 연결 상태. 서버가 바뀔 때만 보내므로 없으면 "모름"이다. */
  statuses: Record<string, VisionCameraStatus>
  /** 방금 올라온 경보들(최신 우선). 이력은 알림함(alerts)에 남는다. */
  alerts: LiveAlert[]
  /** 이 사용자가 볼 수 있는 카메라 id — 토큰이 허용한 범위와 같다. */
  cameraIds: string[]
  /** 영상 주소를 만들 때 쓴다. streamUrl(camera, …) 에 그대로 넘긴다. */
  stream: { streamBase: string | null; token: string | null }
}

/**
 * 한 장비의 실시간 연결 주소.
 *
 * `wsUrl` 은 두 모양으로 온다 — 직결 배포는 절대 주소(`wss://vision-1…/ws`),
 * 같은 호스트 배포는 경로(`/vision-ws`). 경로면 지금 보고 있는 출처에
 * 붙이고, 절대 주소면 그대로 쓴다.
 *
 * 끝의 `all` 은 "토큰이 허락하는 카메라 전부"를 뜻한다. 각 장비는 자기가 맡은
 * 카메라의 이벤트만 갖고 있고, 남의 카메라 구독은 서버가 잘라 낸다.
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

    // 장비마다 소켓 하나. 파이가 한 대뿐이면 원소도 하나다.
    let sockets: WebSocket[] = []
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    /** 붙어 있는 소켓이 하나라도 있으면 open 으로 본다.
     *  한 장비가 잠깐 끊겨도 나머지 화면이 "연결 끊김"으로 바뀌면 안 된다. */
    const refreshState = () => {
      if (disposed) return
      setSocketState(
        sockets.some(s => s.readyState === WebSocket.OPEN) ? "open" : "closed"
      )
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attemptRef.current, BACKOFF_CAP_MS)
      attemptRef.current += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        connect()
      }, delay)
    }

    /** 열려 있는 소켓을 전부 닫는다. 재접속 고리가 돌지 않게 핸들러를 먼저 뗀다. */
    const closeAll = () => {
      for (const socket of sockets) {
        socket.onclose = null
        socket.onerror = null
        socket.close()
      }
      sockets = []
    }

    const connect = async () => {
      if (disposed) return
      setSocketState("connecting")

      // 토큰은 붙을 때마다 새로 받는다 — 3분이면 만료되기 때문이다.
      // 장비 목록도 같이 온다(그 사이 카메라가 늘었을 수 있다).
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

      if (!session.enabled || !session.token || session.hosts.length === 0) {
        // 아직 카메라가 없거나 서비스가 꺼져 있다. 계속 두드릴 이유가 없다.
        setSocketState("disabled")
        return
      }

      // 앞선 시도가 남긴 소켓이 있으면 먼저 정리한다.
      closeAll()
      const token = session.token

      sockets = session.hosts.map(host => {
        const ws = new WebSocket(socketUrl(host.wsUrl, token))

        ws.onopen = () => {
          attemptRef.current = 0
          refreshState()
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
          refreshState()
          // 한 장비만 끊겨도 다음 시도에서 전부 새 토큰으로 다시 붙인다.
          // 장비별로 따로 되살리면 토큰 만료 시각이 제각각이 되어, 어느
          // 소켓이 왜 안 붙는지 알기 어려워진다.
          scheduleReconnect()
        }

        ws.onerror = () => ws.close()
        return ws
      })
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      closeAll()
      setSocketState("closed")
    }
  }, [enabled, handle])

  const wsState: WsState = enabled ? socketState : "disabled"
  return { wsState, latest, statuses, alerts, cameraIds, stream }
}
