// 시스템 모니터링 통계의 로딩·키 미설정 화면 — 개요와 사용자가 함께 쓴다.
// 옛 app/(dashboard)/admin/page.tsx 의 두 분기를 그대로 옮겼다.
import { ShieldCheck } from "lucide-react"

export function StatsLoading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-ocean-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function ServiceKeyMissing() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <ShieldCheck className="w-12 h-12 text-amber-500" />
      <p className="text-foreground font-semibold">서비스 롤 키 미설정</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        서버에 <code className="bg-muted px-1 rounded text-ocean-500">SUPABASE_SERVICE_ROLE_KEY</code> 환경변수가 설정되지 않아 관리자 데이터를 조회할 수 없습니다.
      </p>
    </div>
  )
}
