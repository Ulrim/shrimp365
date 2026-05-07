import { createClient } from "@supabase/supabase-js"

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://okecfkqpoigxvlsomqjc.supabase.co"

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

// Service-role 클라이언트 — RLS 우회, 서버 API Route 전용
// 절대 브라우저 번들에 포함하거나 클라이언트 컴포넌트에서 import하지 말 것
export function createAdminClient() {
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.")
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
