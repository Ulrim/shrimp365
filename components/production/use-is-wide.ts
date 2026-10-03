"use client"

// 폭이 sm(640px) 이상인가.
//
// **CSS 로 갈라서는 안 되는 자리가 있다.** recharts 차트를 두 개 다 렌더해 놓고
// `hidden sm:block` 으로 감추면, 감춰진 쪽이 폭 0 인 컨테이너에서 한 번
// 계산되고 그 뒤로 차트가 사라진다(globals.css 186~189행에 같은 함정이 기록돼
// 있다). 그래서 **조건부 렌더**가 필요하고, 그러려면 폭을 상태로 알아야 한다.
//
// 첫 렌더에서는 false 다 — 서버에는 window 가 없고, 모바일 우선이 맞다. 좁은
// 쪽(리본)이 먼저 그려지고 넓은 화면에서 차트로 바뀐다.

import { useEffect, useState } from "react"

export function useIsWide(minWidthPx = 640): boolean {
  const [wide, setWide] = useState(false)

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return
    const mq = globalThis.matchMedia(`(min-width: ${minWidthPx}px)`)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [minWidthPx])

  return wide
}
