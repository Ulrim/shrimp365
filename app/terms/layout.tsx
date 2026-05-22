import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "이용약관",
  description: "Shrimp365 서비스 이용약관입니다. 서비스 이용 조건 및 규정을 확인하세요.",
  alternates: { canonical: "https://www.shrimp365.kr/terms" },
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
