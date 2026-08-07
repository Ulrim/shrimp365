"use client"

import { useEffect, useRef, useState } from "react"

/** 화면을 주기적으로 다시 불러온다.
 *
 *  센서가 1분마다 값을 올리므로 화면도 그 주기를 따라간다. 다만 단순히
 *  setInterval 만 걸면 두 가지가 어긋난다.
 *
 *  1. 탭을 다른 곳에 두면 브라우저가 타이머를 크게 늦춘다(절전). 몇 시간 뒤
 *     돌아왔을 때 옛 값이 그대로 떠 있고, 다음 주기까지 또 기다려야 한다.
 *     그래서 탭으로 돌아오는 순간 한 번 당겨서 불러온다.
 *  2. 안 보이는 동안 계속 요청하는 것은 낭비다. 숨어 있으면 건너뛴다.
 *
 *  갱신이 실제로 되고 있는지 사람이 알 수 있도록 마지막 시각을 함께 돌려준다.
 *  "자동갱신" 이라고 적어 두고 정작 도는지 알 수 없으면 믿을 수가 없다.
 */
export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  seconds = 60,
  enabled = true,
) {
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // 최신 콜백을 담아 둔다. 이렇게 하지 않으면 refresh 가 새로 만들어질 때마다
  // 타이머가 처음부터 다시 시작되어, 자주 바뀌면 영영 안 돈다.
  const latest = useRef(refresh)
  useEffect(() => { latest.current = refresh }, [refresh])

  // 이전 요청이 아직 안 끝났는데 다음 주기가 오면 겹친다. 하나만 돌린다.
  const running = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let alive = true

    const run = async () => {
      if (running.current || document.visibilityState === "hidden") return
      running.current = true
      if (alive) setRefreshing(true)
      try {
        await latest.current()
        if (alive) setLastRefreshed(new Date())
      } catch {
        // 한 번 실패해도 다음 주기에 다시 시도한다. 화면을 망가뜨리지 않는다.
      } finally {
        running.current = false
        if (alive) setRefreshing(false)
      }
    }

    const timer = setInterval(run, seconds * 1000)

    // 탭으로 돌아왔을 때 곧바로 최신값을 보여 준다.
    const onVisible = () => { if (document.visibilityState === "visible") run() }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)

    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [seconds, enabled])

  return { lastRefreshed, refreshing }
}

/** "방금 전", "3분 전" 처럼 사람이 읽는 형태로. */
export function sinceLabel(at: Date | null): string {
  if (!at) return ""
  const secs = Math.floor((Date.now() - at.getTime()) / 1000)
  if (secs < 10) return "방금 전"
  if (secs < 60) return `${secs}초 전`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}분 전`
  return `${Math.floor(mins / 60)}시간 전`
}
