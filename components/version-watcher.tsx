"use client"

import { useEffect, useRef, useState } from "react"

const POLL_INTERVAL_MS = 60_000

export function VersionWatcher() {
  const initialBuildId = useRef<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" })
        if (!res.ok) return
        const { buildId } = await res.json() as { buildId: string }
        if (!buildId || buildId === "dev") return
        if (initialBuildId.current === null) {
          initialBuildId.current = buildId
          return
        }
        if (!cancelled && buildId !== initialBuildId.current) {
          setUpdateAvailable(true)
        }
      } catch {
        // network blip — ignore
      }
    }

    check()
    const interval = setInterval(check, POLL_INTERVAL_MS)
    const onFocus = () => check()
    window.addEventListener("focus", onFocus)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 bg-ocean-600 text-white rounded-xl shadow-2xl border border-ocean-400">
      <span className="text-sm font-medium">새 버전이 배포되었습니다</span>
      <button
        onClick={() => window.location.reload()}
        className="px-3 py-1 bg-white text-ocean-700 rounded-md text-sm font-bold hover:bg-ocean-50 transition-colors"
      >
        새로고침
      </button>
    </div>
  )
}
