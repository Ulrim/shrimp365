import { ImageResponse } from "next/og"
export const runtime = "edge"
export const alt = "Shrimp365 사용 가이드"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #0ea5e9 100%)", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "white", padding: "60px" }}>
      <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 16, opacity: 0.9 }}>🦐 Shrimp365</div>
      <div style={{ fontSize: 56, fontWeight: 900, textAlign: "center", lineHeight: 1.2, marginBottom: 24 }}>사용 가이드</div>
      <div style={{ fontSize: 28, opacity: 0.85, textAlign: "center" }}>5분 만에 양식장 등록부터 수질 모니터링까지</div>
      <div style={{ marginTop: 24, display: "flex", gap: 16 }}>
        {["1단계 가입", "2단계 등록", "3단계 기록", "4단계 분석"].map((step, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.15)", padding: "8px 20px", borderRadius: 20, fontSize: 18 }}>{step}</div>
        ))}
      </div>
    </div>,
    size
  )
}
