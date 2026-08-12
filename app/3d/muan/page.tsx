import type { Metadata } from "next"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { MuanPublicView } from "@/components/farm3d/muan-public-view"
import { BASE } from "@/lib/marketing-locale"

// 로그인 없이 열리는 공개 페이지다. middleware 의 PROTECTED_PATHS 에 없으므로
// 인증 검사를 거치지 않고, DB 도 부르지 않는다 — 그릴 수치가 전부
// lib/farm3d/layout.ts 안에 있다.
//
// 한국어 전용이라 /en·/vi·/id 짝이 없다. 없는 언어판을 hreflang 으로
// 광고하면 잘못된 신호가 되므로 canonical 만 건다.
export const metadata: Metadata = {
  title: "무안 양식장 3D 도면 | Shrimp365",
  description:
    "무안 새우양식장 가설건축물 도면(지상 1층 평면도)을 3D로 세운 모형입니다. 대지 63 × 27 m, 연면적 1,342.5 m², 사각 수조 2기의 치수를 돌려 보며 확인할 수 있습니다.",
  alternates: { canonical: `${BASE}/3d/muan` },
  openGraph: {
    title: "무안 양식장 3D 도면",
    description: "건축허가 도면을 그대로 세운 3D 모형 — 대지 63 × 27 m, 연면적 1,342.5 m², 사각 수조 2기.",
    url: `${BASE}/3d/muan`,
    type: "website",
  },
}

export default function Muan3DPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-5xl" />
      <MuanPublicView />
      <PublicFooter maxWidth="max-w-5xl" />
    </main>
  )
}
