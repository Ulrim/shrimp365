import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "개인정보처리방침 | Shrimp365",
  description: "Shrimp365의 개인정보처리방침입니다. 수집 항목, 이용 목적, 보유 기간 등 개인정보 처리에 관한 사항을 안내합니다.",
  alternates: { canonical: "https://www.shrimp365.kr/privacy" },
}

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
