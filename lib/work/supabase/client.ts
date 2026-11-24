"use client";

import { supabase } from "@/lib/supabase";

/**
 * 브라우저용 클라이언트. 사진 업로드처럼 브라우저에서 직접 보내야 하는 작업에만 쓴다.
 * 새 클라이언트를 만들지 않고 shrimp365 의 싱글톤(@/lib/supabase)을 돌려준다 —
 * 원본 화면 코드의 `createClient()` 호출 형태를 그대로 두기 위한 얇은 재수출이다.
 */
export function createClient() {
  return supabase;
}

export { supabase };
