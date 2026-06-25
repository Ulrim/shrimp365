"use client"

import Script from "next/script"

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT

/**
 * Loads the Google AdSense library — only when NEXT_PUBLIC_ADSENSE_CLIENT is set.
 * Until the publisher ID is configured this renders nothing (no network calls),
 * so the site ships ad-ready but ad-free by default.
 *
 * NOTE (EEA/UK): personalized ads require a Google-certified CMP for consent.
 * Configure that before enabling ads for European traffic.
 */
export function AdSenseScript() {
  if (!CLIENT) return null
  return (
    <Script
      id="adsbygoogle-init"
      async
      strategy="afterInteractive"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`}
    />
  )
}
