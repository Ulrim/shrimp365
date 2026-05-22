import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "환불정책 | Shrimp365",
  description: "Shrimp365 구독 서비스 환불정책입니다. 결제일로부터 7일 이내 미사용 시 전액 환불 가능합니다.",
  alternates: { canonical: "https://www.shrimp365.kr/refund" },
}

export default function RefundLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
