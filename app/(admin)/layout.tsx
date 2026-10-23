// 관리자 콘솔 레이아웃 — 서버 컴포넌트. 탭 제목만 정하고 가드·셸은 클라이언트
// 컴포넌트(components/admin/admin-guard.tsx)에 맡긴다. metadata 는 서버 파일에서만
// 내보낼 수 있다. 루트 템플릿("%s | Shrimp365")이 붙어 "관리자 콘솔 | Shrimp365".
import type { Metadata } from "next"
import { AdminGuard } from "@/components/admin/admin-guard"

export const metadata: Metadata = {
  title: "관리자 콘솔",
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>
}
