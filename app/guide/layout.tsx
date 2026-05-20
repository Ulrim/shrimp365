import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Shrimp365 사용 가이드 — 흰다리새우 양식 관리 시작하기",
  description: "Shrimp365 사용 방법을 단계별로 안내합니다. 수질 기록, 양식 일지 작성, AI 어드바이저 활용, 재고 관리까지 — 흰다리새우 양식장을 5분 만에 시작하세요.",
  keywords: [
    "shrimp365 사용법", "새우 양식 앱 사용법",
    "수질 모니터링 방법", "양식 일지 작성법",
    "흰다리새우 수질 기준", "새우 양식 수질 관리",
    "수온 pH DO 기준", "암모니아 수질 기준",
    "새우 양식 AI", "양식장 관리 앱",
  ],
  openGraph: {
    title: "Shrimp365 사용 가이드 — 흰다리새우 양식 관리 시작하기",
    description: "수질 기록부터 AI 어드바이저, 재고 관리까지 — 처음 사용하시는 분도 5분이면 시작할 수 있습니다.",
    url: "https://www.shrimp365.kr/guide",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  alternates: {
    canonical: "https://www.shrimp365.kr/guide",
  },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": "Shrimp365로 흰다리새우 양식장 관리 시작하기",
    "description": "Shrimp365를 사용해 수질 모니터링, 양식 일지, AI 어드바이저, 재고 관리를 설정하는 방법",
    "step": [
      { "@type": "HowToStep", "position": 1, "name": "가입 & 로그인", "text": "shrimp365.kr에서 이메일로 가입 후 인증 메일을 클릭합니다." },
      { "@type": "HowToStep", "position": 2, "name": "양식장 & 수조 등록", "text": "양식장 이름·지역을 입력하고 수조를 추가합니다." },
      { "@type": "HowToStep", "position": 3, "name": "수질 기록", "text": "매일 수온·pH·DO 등을 단계별 입력 화면에서 기록합니다." },
      { "@type": "HowToStep", "position": 4, "name": "양식 일지 작성", "text": "급이량·폐사 수·환수율을 단계별로 입력합니다." },
      { "@type": "HowToStep", "position": 5, "name": "AI 어드바이저 활용", "text": "수질 이상 시 AI에게 한국어로 상황을 설명하면 대처 방법을 안내받습니다." },
    ],
    "totalTime": "PT5M",
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  )
}
