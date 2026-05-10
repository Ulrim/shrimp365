import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Shrimp365 — AI 새우 양식 관리 플랫폼"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: 1200,
        height: 630,
        background: "linear-gradient(135deg, #0f172a 0%, #0c3a5e 50%, #0f172a 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 배경 장식 원 */}
      <div style={{ position: "absolute", top: -100, right: -100, width: 450, height: 450, borderRadius: "50%", background: "rgba(14,165,233,0.08)", display: "flex" }} />
      <div style={{ position: "absolute", bottom: -80, left: -80, width: 350, height: 350, borderRadius: "50%", background: "rgba(20,184,166,0.07)", display: "flex" }} />
      <div style={{ position: "absolute", top: 60, left: 80, width: 6, height: 6, borderRadius: "50%", background: "rgba(56,189,248,0.5)", display: "flex" }} />
      <div style={{ position: "absolute", top: 120, left: 200, width: 4, height: 4, borderRadius: "50%", background: "rgba(56,189,248,0.3)", display: "flex" }} />
      <div style={{ position: "absolute", bottom: 80, right: 160, width: 5, height: 5, borderRadius: "50%", background: "rgba(20,184,166,0.5)", display: "flex" }} />

      {/* 로고 아이콘 */}
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: 22,
          background: "linear-gradient(135deg, #0ea5e9, #14b8a6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
          marginBottom: 28,
          boxShadow: "0 0 40px rgba(14,165,233,0.3)",
        }}
      >
        🦐
      </div>

      {/* 브랜드명 */}
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16 }}>
        <span style={{ fontSize: 76, fontWeight: 800, color: "white", letterSpacing: -3 }}>
          Shrimp
        </span>
        <span style={{ fontSize: 76, fontWeight: 800, color: "#38bdf8", letterSpacing: -3 }}>
          365
        </span>
      </div>

      {/* 태그라인 */}
      <div style={{ fontSize: 30, color: "#94a3b8", marginBottom: 48, letterSpacing: -0.5 }}>
        AI 새우 양식 관리 플랫폼
      </div>

      {/* 기능 배지 */}
      <div style={{ display: "flex", gap: 14 }}>
        {["🌊  수질 모니터링", "📈  생산 관리", "🤖  AI 어드바이저"].map((f) => (
          <div
            key={f}
            style={{
              padding: "12px 26px",
              borderRadius: 100,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#cbd5e1",
              fontSize: 20,
              display: "flex",
            }}
          >
            {f}
          </div>
        ))}
      </div>

      {/* 하단 URL */}
      <div style={{ position: "absolute", bottom: 36, color: "#334155", fontSize: 18, letterSpacing: 1 }}>
        www.shrimp365.kr
      </div>
    </div>
  )
}
