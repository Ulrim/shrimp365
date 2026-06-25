"use client"

import { useEffect, useRef } from "react"

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT

interface AdSlotProps {
  /** AdSense ad unit slot ID (from your AdSense dashboard). */
  slot: string
  className?: string
  format?: string
  /** Set false for fixed-size units. */
  responsive?: boolean
}

/**
 * A single AdSense ad unit. Renders nothing unless NEXT_PUBLIC_ADSENSE_CLIENT
 * is configured, so it is safe to place anywhere now and "turns on" once the
 * publisher ID + a real slot ID are provided.
 *
 * Usage:  <AdSlot slot="1234567890" className="my-4" />
 */
export function AdSlot({ slot, className = "", format = "auto", responsive = true }: AdSlotProps) {
  const pushed = useRef(false)

  useEffect(() => {
    if (!CLIENT || pushed.current) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({})
      pushed.current = true
    } catch {
      /* AdSense not ready yet — ignore */
    }
  }, [])

  if (!CLIENT) return null

  return (
    <ins
      className={`adsbygoogle block ${className}`}
      style={{ display: "block" }}
      data-ad-client={CLIENT}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive={responsive ? "true" : "false"}
    />
  )
}
