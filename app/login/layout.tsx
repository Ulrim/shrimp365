import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "로그인",
  description: "Shrimp365에 로그인하여 양식장을 관리하세요.",
  alternates: { canonical: "https://www.shrimp365.kr/login" },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
