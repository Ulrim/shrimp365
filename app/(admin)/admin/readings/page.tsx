import { AdminReadingsView } from "@/components/admin/readings-view"

// 수질 기록 — 화면 권한은 관리자 레이아웃이 `readings` 키로 판정한다(lib/admin-access.ts).
export default function Page() { return <AdminReadingsView /> }
