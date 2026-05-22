import { ImageResponse } from "next/og"
export const runtime = "edge"
export const alt = "Shrimp365 요금제 — Pro 3개월 무료"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    <div style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #0d9488 100%)", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "white", padding: "60px" }}>
      <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 16, opacity: 0.9 }}>🦐 Shrimp365</div>
      <div style={{ fontSize: 56, fontWeight: 900, textAlign: "center", lineHeight: 1.2, marginBottom: 24 }}>Pro 플랜 3개월 무료</div>
      <div style={{ fontSize: 28, opacity: 0.85, textAlign: "center" }}>새우 양식장 AI 관리 플랫폼 · Free ~ Enterprise</div>
      <div style={{ marginTop: 40, fontSize: 22, background: "rgba(255,255,255,0.2)", padding: "12px 32px", borderRadius: 50 }}>지금 무료로 시작하기 →</div>
    </div>,
    size
  )
}
