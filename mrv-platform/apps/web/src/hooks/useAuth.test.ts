import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AuthMeResponse } from "@/types/api";

/*
 * useAuth: role/orgId/userId가 useAuthMe(GET /auth/me) 결과에서 파생되는지,
 * isAuthenticated/sessionReady가 Supabase 세션 캐시에서 파생되는지 검증한다
 * (ADR 0005 2절/6절 — Supabase JWT에는 org_id/role이 없음).
 */

const authMeState: {
  data: AuthMeResponse | undefined;
} = { data: undefined };

const sessionState: { token: string | null; ready: boolean } = {
  token: null,
  ready: false,
};

vi.mock("@/hooks/useAuthMe", () => ({
  useAuthMe: () => ({ data: authMeState.data }),
}));

vi.mock("@/lib/supabase-client", () => ({
  getCachedAccessToken: () => sessionState.token,
  isSessionReady: () => sessionState.ready,
  subscribeAccessToken: () => () => {},
}));

import { useAuth } from "./useAuth";

describe("useAuth", () => {
  beforeEach(() => {
    authMeState.data = undefined;
    sessionState.token = null;
    sessionState.ready = false;
  });

  it("세션 복원 전(sessionReady=false)에는 미인증으로 보고한다", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.sessionReady).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("세션이 있으면 isAuthenticated=true, sessionReady=true를 보고한다", () => {
    sessionState.token = "fake.jwt.token";
    sessionState.ready = true;
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.sessionReady).toBe(true);
  });

  it("useAuthMe 결과가 없으면(role 미확정) 쓰기 권한을 모두 false로 둔다", () => {
    sessionState.token = "fake.jwt.token";
    sessionState.ready = true;
    authMeState.data = undefined;
    const { result } = renderHook(() => useAuth());
    expect(result.current.role).toBeNull();
    expect(result.current.canWriteLogs).toBe(false);
    expect(result.current.canLockBaseline).toBe(false);
    expect(result.current.isViewer).toBe(false);
  });

  it("role=viewer이면 isViewer=true, 쓰기 권한 false", () => {
    sessionState.token = "fake.jwt.token";
    sessionState.ready = true;
    authMeState.data = { org_id: "org_1", role: "viewer", user_id: "user_1", plan: "START" };
    const { result } = renderHook(() => useAuth());
    expect(result.current.isViewer).toBe(true);
    expect(result.current.canWriteLogs).toBe(false);
    expect(result.current.canLockBaseline).toBe(false);
    expect(result.current.orgId).toBe("org_1");
    expect(result.current.userId).toBe("user_1");
  });

  it.each(["owner", "operator"] as const)(
    "role=%s이면 잠금·입력 권한이 true다",
    (role) => {
      sessionState.token = "fake.jwt.token";
      sessionState.ready = true;
      authMeState.data = { org_id: "org_1", role, user_id: "user_1", plan: "PRO" };
      const { result } = renderHook(() => useAuth());
      expect(result.current.canWriteLogs).toBe(true);
      expect(result.current.canLockBaseline).toBe(true);
      expect(result.current.isViewer).toBe(false);
    },
  );
});
