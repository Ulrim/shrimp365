/*
 * JWT 디버그 디코더. 서명 검증은 하지 않는다(그 책임은 백엔드).
 * Supabase JWT에는 org_id/role/user_id 클레임이 없다(ADR 0005 2절 — Auth Hook 미채택,
 * 매 요청 GET /auth/me로 조회). 이 함수는 exp/sub/email 등 UI 디버그 용도로만 남긴다.
 * role/org_id/user_id 게이팅은 useAuth.ts(useAuthMe 기반)를 사용할 것.
 */
import type { AuthClaims } from "@/types/api";

/** base64url → JSON payload 디코드. 실패 시 null. */
export function decodeJwtClaims(token: string | null | undefined): AuthClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4),
      "=",
    );
    const json = atob(padded);
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object") return parsed as AuthClaims;
    return null;
  } catch {
    return null;
  }
}
