import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "회원가입",
  description: "Shrimp365에 가입하고 AI 기반 새우 양식 관리를 시작하세요. 무료로 시작 가능합니다.",
  alternates: { canonical: "https://www.shrimp365.kr/signup" },
  openGraph: {
    url: "https://www.shrimp365.kr/signup",
    title: "회원가입",
    description: "Shrimp365에 가입하고 AI 기반 새우 양식 관리를 시작하세요.",
  },
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
