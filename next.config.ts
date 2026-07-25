import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Google ad/analytics domains — only widened in CSP when AdSense is enabled.
const adsEnabled = !!process.env.NEXT_PUBLIC_ADSENSE_CLIENT
const adScript = adsEnabled
  ? " https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googleadservices.com https://partner.googleadservices.com https://*.google.com"
  : ""
const adFrame = adsEnabled
  ? " https://googleads.g.doubleclick.net https://*.doubleclick.net https://*.google.com"
  : ""
const adImg = adsEnabled
  ? " https://*.googlesyndication.com https://*.g.doubleclick.net https://*.google.com"
  : ""
const adConnect = adsEnabled
  ? " https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.g.doubleclick.net https://*.google.com"
  : ""

// Daum(카카오) 우편번호 서비스 — 주소 검색 위젯에 필요한 도메인.
// 카카오 통합으로 daum + kakao CDN 도메인을 모두 허용해야 한다.
const daumScript = " https://t1.daumcdn.net https://*.daumcdn.net https://*.kakaocdn.net"
const daumFrame = " https://postcode.map.daum.net https://*.daum.net https://*.kakao.com"
const daumImg = " https://*.daumcdn.net https://*.daum.net https://*.kakaocdn.net https://*.kakao.com"
const daumConnect = " https://*.daumcdn.net https://*.daum.net https://*.kakaocdn.net https://dapi.kakao.com"

// Google Analytics (gtag.js) — 항상 허용.
const gaScript = " https://www.googletagmanager.com"
const gaImg = " https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com"
const gaConnect = " https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com"

// Sentry — DSN이 설정된 경우에만 정확한 ingest 호스트를 connect-src에 허용.
// (CSP가 없으면 브라우저가 에러 리포트 전송 자체를 차단해 Sentry가 조용히 무동작함)
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const sentryIngestHost = (() => {
  if (!sentryDsn) return null
  try { return new URL(sentryDsn).host } catch { return null }
})()
const sentryConnect = sentryIngestHost ? ` https://${sentryIngestHost}` : ""

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval'${adScript}${daumScript}${gaScript}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://*.supabase.co${adImg}${daumImg}${gaImg}`,
      "font-src 'self'",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${adConnect}${daumConnect}${gaConnect}${sentryConnect}`,
      `frame-src 'self'${adFrame}${daumFrame}`,
      "frame-ancestors 'none'",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
  // standalone은 Docker(NAS) 전용 — Vercel 환경에서는 자동 비활성화
  output: process.env.VERCEL ? undefined : "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },
};

export default withSentryConfig(nextConfig, {
  // Only upload source maps if SENTRY_AUTH_TOKEN is available (CI/CD env).
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  automaticVercelMonitors: !!process.env.VERCEL,
});
