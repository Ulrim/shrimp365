/*
 * Supabase Auth 클라이언트 싱글턴 (Phase 3 슬라이스 O, ADR 0005 6절 / phase-3-auth.md 5절).
 * anon key는 공개 가능한 값(Supabase 설계상 클라이언트 노출 전제, RLS/서버 검증이 실제
 * 방어선) — Rule 7 "비밀값" 범주 아님.
 *
 * getAuthToken()(api-client.ts)이 동기적으로 토큰을 반환해야 하므로, 이 모듈이
 * onAuthStateChange를 구독해 access_token을 모듈 스코프 캐시(session snapshot)에
 * 보관한다. 부트스트랩 시 supabase.auth.getSession()으로 캐시를 1회 선반영한다.
 *
 * `ready`: 최초 세션 복원(getSession)이 끝났는지 여부. 새로고침 직후에는 로컬 저장소에
 * 유효한 세션이 있어도 이 조회가 끝나기 전까지 token이 null이므로, ready 없이 바로
 * "미인증"으로 단정하면 인증된 사용자가 새로고침 시 잠깐 /login으로 튕기는 문제가 생긴다
 * (phase-3-auth.md 8절 "새로고침 후 세션 유지" 수용 기준과 직결 — 라우트 가드가 ready를
 * 반드시 함께 확인해야 한다).
 *
 * VITE_SUPABASE_URL/ANON_KEY가 아직 설정되지 않은 로컬/테스트 환경(운영 키 발급은 사용자
 * 몫 — ADR 0005 실행 전제)에서도 모듈 임포트 자체가 실패하지 않도록 플레이스홀더 값으로
 * 폴백한다(createClient는 빈 문자열을 거부한다). 실제 로그인 호출은 진짜 값이 없으면
 * Supabase 서버 오류로 실패할 뿐, 임포트 시점 크래시는 발생하지 않는다.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface SessionSnapshot {
  token: string | null;
  /** 최초 세션 복원이 끝났는가. */
  ready: boolean;
}

let snapshot: SessionSnapshot = { token: null, ready: false };
const listeners = new Set<() => void>();

function updateSnapshot(patch: Partial<SessionSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

/** api-client.ts::getAuthToken()의 동기 소스. */
export function getCachedAccessToken(): string | null {
  return snapshot.token;
}

/** 최초 세션 복원 완료 여부(동기 조회). */
export function isSessionReady(): boolean {
  return snapshot.ready;
}

/** useSyncExternalStore 등 리액트 구독용. 세션 변경 시(로그인/로그아웃/갱신) 호출된다. */
export function subscribeAccessToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 부트스트랩: 현재 세션이 있으면 캐시를 즉시 선반영.
supabase.auth
  .getSession()
  .then(({ data }) => updateSnapshot({ token: data.session?.access_token ?? null, ready: true }))
  .catch(() => updateSnapshot({ token: null, ready: true }));

// 이후 로그인/로그아웃/토큰 갱신 시 캐시를 계속 최신화.
supabase.auth.onAuthStateChange((_event, session) => {
  updateSnapshot({ token: session?.access_token ?? null, ready: true });
});
