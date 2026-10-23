import { AdminUserDetailView } from "@/components/admin/user-detail-view"

// 사용자 상세 — 화면 권한은 관리자 레이아웃이 `users` 키로 판정한다
// (lib/admin-access.ts 의 adminPageOf 가 하위 주소를 부모 화면으로 본다).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminUserDetailView id={id} />
}
