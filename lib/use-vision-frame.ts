"use client"

import { useEffect, useRef, useState } from "react"

// 장비가 올려 둔 수조 사진을 주기적으로 받아 온다 — 영상이 안 열릴 때의 대안.
//
// 왜 필요한가
// -----------
// 영상(MJPEG)은 브라우저가 장비로 **들어가는** 연결이고, 농장 공유기는 들어오는
// 연결을 막는다(NAT). 개체수는 장비가 서버로 **나가는** 연결이라 막히지 않는다.
// 그래서 "개체수는 보이는데 영상은 안 보인다"가 된다 — 장비는 멀쩡한데.
//
// 장비가 사진 한 장을 개체수와 같은 방향으로 올려 두면, 이 훅이 그것을 받아
// 온다. 진짜 실시간은 아니다. 그래서 `takenAt` 을 함께 돌려주고 화면이 "N초 전"
// 이라고 분명히 말한다 — 멈춘 사진을 실시간이라고 보여 주는 것이 가장 나쁘다.

/** 사진을 다시 묻는 주기(ms). 장비가 15초마다 올리므로 그보다 촘촘히 묻는다. */
const POLL_MS = 5_000

export interface VisionFrame {
  /** `<img src>` 에 그대로 넣는다. 사진이 없으면 null. */
  url: string | null
  /** 그 사진을 찍은 시각. 없으면 null. */
  takenAt: Date | null
  /** 그 사진을 찍은 순간의 개체수. 사진과 숫자가 어긋나 보이지 않게 함께 온다. */
  count: number | null
  /** 그 순간의 추정 체장(cm). 축척을 안 잡은 장비는 null. */
  lengthCm: number | null
  /** 한 번이라도 물어봤는가. false 면 아직 "없다"고 말할 수 없다. */
  checked: boolean
}

const EMPTY: VisionFrame = { url: null, takenAt: null, count: null, lengthCm: null, checked: false }

/** 들고 있는 사진이 **어느 카메라의 것인지** 함께 적는다.
 *
 *  카메라를 바꾸면 효과가 다시 돌면서 앞 사진의 blob 주소를 놓아 준다. 그
 *  주소를 그대로 돌려주면 화면이 이미 없어진 주소를 물게 되어 깨진 그림이
 *  뜬다. 효과 안에서 상태를 비우는 대신(그러면 렌더가 한 번 더 돈다) 꺼낼 때
 *  카메라가 맞는지 본다. */
type Held = VisionFrame & { key: string | null }

function numberOf(res: Response, header: string): number | null {
  const raw = res.headers.get(header)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * @param cameraId 볼 카메라. null 이면 아무것도 묻지 않는다.
 * @param enabled  영상이 열려 있을 때는 끈다 — 같은 것을 두 길로 받을 이유가 없다.
 */
export function useVisionFrame(cameraId: string | null, enabled: boolean): VisionFrame {
  const [held, setHeld] = useState<Held>({ ...EMPTY, key: null })
  // blob 주소는 쓰고 나서 반드시 놓아 주어야 한다. 5초마다 하나씩 만들면서
  // 안 놓으면 탭을 켜 둔 하루 동안 수백 MB 가 브라우저에 남는다.
  const objectUrl = useRef<string | null>(null)

  // 놓아 주는 자리는 **새 사진을 받을 때와 화면에서 사라질 때** 둘뿐이다.
  //
  // 한때 아래 폴링 효과의 정리 단계에서 놓아 주었다. 그랬더니 효과가 다시
  // 도는 순간(영상 재시도가 또 실패해 사진으로 되돌아올 때) 화면이 이미
  // 없어진 주소를 물고 있어 깨진 그림이 떴다. 많아야 한 장이 다음 사진이 올
  // 때까지 남는 것은 감당할 수 있는 값이다.
  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }, [])

  useEffect(() => {
    if (!cameraId || !enabled) return

    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/vision/cameras/${cameraId}/frame`, { cache: "no-store" })
        if (cancelled) return
        // 204 = 아직 올라온 사진이 없다. 오류가 아니다 — 방금 켠 장비이거나
        // 서버에 vision_snapshot.sql 을 아직 안 돌렸다.
        if (res.status === 204 || !res.ok) {
          setHeld(f => ({ ...f, key: cameraId, checked: true }))
          return
        }
        const blob = await res.blob()
        if (cancelled) return
        const takenAtRaw = res.headers.get("X-Frame-At")
        const takenAt = takenAtRaw ? new Date(takenAtRaw) : null
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
        objectUrl.current = URL.createObjectURL(blob)
        setHeld({
          key: cameraId,
          url: objectUrl.current,
          takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
          count: numberOf(res, "X-Frame-Count"),
          lengthCm: numberOf(res, "X-Frame-Length-Cm"),
          checked: true,
        })
      } catch {
        // 네트워크가 끊겼다. 들고 있는 사진은 그대로 두고 — 지우면 화면이
        // 깜빡이기만 하고 나아지는 것이 없다 — 다음 주기에 다시 묻는다.
        if (!cancelled) setHeld(f => ({ ...f, key: cameraId, checked: true }))
      }
    }

    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cameraId, enabled])

  // 다른 카메라의 사진이나 꺼진 상태에서는 들고 있는 것을 내보내지 않는다.
  return cameraId && enabled && held.key === cameraId ? held : EMPTY
}

/** "12초 전" / "3분 전". 사진이 얼마나 묵었는지 숨기지 않는다. */
export function ageLabel(takenAt: Date | null, now: number): string | null {
  if (!takenAt) return null
  const seconds = Math.max(0, Math.round((now - takenAt.getTime()) / 1000))
  if (seconds < 60) return `${seconds}초 전`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`
}
