"use client"

/**
 * MRV 화면의 세션 컨텍스트 — 원본 `hooks/useAuth.ts` + `hooks/useAuthMe.ts` + `usePlan.ts`.
 *
 * 원본은 Supabase 세션에서 JWT 를 꺼내 role 을 읽고, plan 은 GET /auth/me 로 따로 받았다.
 * 이식본은 그 둘을 한 번의 /auth/me 호출로 합친다 — 서버가 이미 세션에서 org/role/plan 을
 * 모두 확정해 돌려주므로 클라이언트가 토큰을 해석할 이유가 없어졌다.
 *
 * plan 을 토큰이 아니라 매 요청 확인하는 원본의 판단은 그대로 유지한다: 플랜이 바뀌면
 * 재로그인 없이 곧바로 반영된다.
 */

import { createContext, useContext, type ReactNode } from "react"
import { ApiError, apiFetch, useApiQuery, type QueryState } from "@/lib/mrv/client"
import type { AuthMeResponse, Plan } from "@/lib/mrv/api-types"

export type MrvSession = QueryState<AuthMeResponse> & {
  plan: Plan | null
  role: string | null
  orgId: string | null
  /** PRO 또는 ENTERPRISE. 확정 전(로딩 중)에는 false — 성급히 노출하지 않는다. */
  isPro: boolean
  isEnterprise: boolean
  /**
   * 인증은 됐으나 초대가 없어(403) 또는 여러 조직에 초대돼(409) 진입할 수 없는 상태.
   * 이 값이 있으면 셸 대신 안내 화면을 띄운다.
   */
  gateStatus: 403 | 409 | null
  /** 세션 자체가 없다(401). 로그인 화면으로 보내야 한다. */
  isUnauthenticated: boolean
}

const SessionContext = createContext<MrvSession | null>(null)

const PRO_OR_ABOVE: ReadonlySet<Plan> = new Set<Plan>(["PRO", "ENTERPRISE"])

export function MrvSessionProvider({ children }: { children: ReactNode }) {
  const query = useApiQuery<AuthMeResponse>(
    (signal) => apiFetch<AuthMeResponse>("/auth/me", { signal }),
    [],
  )

  const plan = query.data?.plan ?? null
  const error = query.error
  const status = error instanceof ApiError ? error.status : null

  const value: MrvSession = {
    ...query,
    plan,
    role: query.data?.role ?? null,
    orgId: query.data?.org_id ?? null,
    isPro: !query.isLoading && plan !== null && PRO_OR_ABOVE.has(plan),
    isEnterprise: !query.isLoading && plan === "ENTERPRISE",
    gateStatus: status === 403 || status === 409 ? status : null,
    isUnauthenticated: status === 401,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useMrvSession(): MrvSession {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error("useMrvSession must be used inside <MrvSessionProvider>")
  }
  return ctx
}
