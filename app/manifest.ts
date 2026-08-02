import { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shrimp365 — AI 새우 양식 관리",
    short_name: "Shrimp365",
    description:
      "AI 기반 새우 양식 수질 모니터링·양식 일지·질병 진단 통합 플랫폼. 완전 무료.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1E40AF",
    orientation: "portrait",
    lang: "ko",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/favicon.ico", sizes: "16x16 32x32 48x48 64x64", type: "image/x-icon" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable — 안드로이드가 원형·물방울 등으로 잘라내므로 여백을 둔 별도 이미지.
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
