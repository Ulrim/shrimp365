"use client"

import Script from "next/script"

// 사용자가 제공한 측정 ID를 기본값으로 사용하되, 환경변수로 덮어쓸 수 있다.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-463S4HVXZ1"

/**
 * Google Analytics 4 (gtag.js).
 * NEXT_PUBLIC_GA_ID를 빈 값으로 설정하면 비활성화된다.
 */
export function GoogleAnalytics() {
  if (!GA_ID) return null
  return (
    <>
      <Script
        id="ga-lib"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
    </>
  )
}
