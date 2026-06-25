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
    theme_color: "#0ea5e9",
    orientation: "portrait",
    lang: "ko",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { src: "/opengraph-image", sizes: "1200x630", type: "image/png", purpose: "any" },
    ],
  }
}
