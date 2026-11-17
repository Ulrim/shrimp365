import { AdminBackupView } from "@/components/admin/backup-view"

// 전체 백업 — 화면 권한은 관리자 레이아웃이 `backup` 키로 판정한다(lib/admin-access.ts).
export default function Page() { return <AdminBackupView /> }
