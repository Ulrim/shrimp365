import type { NextConfig } from "next";

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
      `script-src 'self' 'unsafe-inline' 'unsafe-eval'${adScript}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob:${adImg}`,
      "font-src 'self'",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${adConnect}`,
      `frame-src 'self'${adFrame}`,
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

export default nextConfig;
