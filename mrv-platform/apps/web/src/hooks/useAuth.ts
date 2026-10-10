/*
 * 인증/권한 훅. Supabase JWT는 org_id/role/user_id 클레임을 담지 않는다(ADR 0005 2절 —
 * Auth Hook 미채택, stale-permission 방지). 대신 useAuthMe()(`GET /auth/me`, 매 조회 시
 * DB에서 role을 읽음)를 role/orgId/userId의 소스로 삼는다.
 * isAuthenticated(세션 존재 여부)만 Supabase 세션 캐시(supabase-client.ts)에서 얻는다 —
 * "신원 확인 여부"와 "이 조직에서의 권한"을 분리해 다루는 것이 정확하다.
 *
 * 권한 게이팅 규약(phase-1 2.3, MASTER):
 *   - owner / operator : 기준선 잠금·수기 입력 가능
 *   - viewer           : 읽기 전용(잠금·입력 버튼 비활성/숨김)
 * 서버가 최종 강제(403)하며, 이 훅은 UI 힌트만 제공한다.
 */
import { useSyncExternalStore } from "react";
import type { AuthClaims, UserRole } from "@/types/api";
import { decodeJwtClaims } from "@/lib/jwt";
import { getCachedAccessToken, isSessionReady, subscribeAccessToken } from "@/lib/supabase-client";
import { useAuthMe } from "./useAuthMe";

export interface AuthState {
  token: string | null;
  claims: AuthClaims | null;
  role: UserRole | null;
  orgId: string | null;
  userId: string | null;
  /** Supabase 세션이 존재하는가(신원 확인 여부). role 로딩 완료 여부와는 별개. */
  isAuthenticated: boolean;
  /** 최초 세션 복원(새로고침 직후 등)이 끝났는가. 라우트 가드는 이 값을 먼저 확인해야
   *  false일 때 성급히 미인증으로 판단해 /login으로 튕기지 않는다. */
  sessionReady: boolean;
  isViewer: boolean;
  /** 기준선 잠금 권한(owner/operator). role 미확정(로딩/오류) 시 false. */
  canLockBaseline: boolean;
  /** 수기 입력 권한(owner/operator). role 미확정(로딩/오류) 시 false. */
  canWriteLogs: boolean;
}

const WRITE_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["owner", "operator"]);

const getServerSnapshot = () => null;
const getServerReadySnapshot = () => false;

export function useAuth(): AuthState {
  // Supabase 세션 토큰(신원 확인 여부) — 로그인/로그아웃/토큰 갱신 시 리렌더 트리거.
  const token = useSyncExternalStore(subscribeAccessToken, getCachedAccessToken, getServerSnapshot);
  const sessionReady = useSyncExternalStore(subscribeAccessToken, isSessionReady, getServerReadySnapshot);
  const claims = decodeJwtClaims(token);

  // 도메인 권한(role/orgId/userId)의 유일한 출처 — GET /auth/me.
  const { data } = useAuthMe();
  const role = data?.role ?? null;
  const canWrite = role !== null && WRITE_ROLES.has(role);

  return {
    token,
    claims,
    role,
    orgId: data?.org_id ?? null,
    userId: data?.user_id ?? null,
    isAuthenticated: Boolean(token),
    sessionReady,
    isViewer: role === "viewer",
    canLockBaseline: canWrite,
    canWriteLogs: canWrite,
  };
}
