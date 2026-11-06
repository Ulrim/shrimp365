"use client"

/**
 * MRV 화면의 브라우저 측 API 접근 계층.
 * 원본: mrv-platform/apps/web/src/lib/api-client.ts + hooks/* (TanStack Query 래퍼들)
 *
 * 원본은 TanStack Query 로 조회 상태를 관리했다. 이식본은 그 의존성을 shrimp365 에
 * 새로 들이지 않고, 훅들이 실제로 쓰던 기능(로딩·에러·재조회·중복 요청 취소)만 담은
 * 작은 훅으로 대신한다 — 원본 훅들이 전부 apiFetch 한 번을 감싸는 얇은 층이었기 때문에
 * 잃는 것이 없다.
 *
 * 인증 토큰을 직접 다루지 않는다. 요청은 같은 출처(/api/mrv/**)로 나가고 세션은
 * shrimp365 가 이미 쓰는 쿠키가 실어 보낸다 — 원본이 Authorization 헤더에 JWT 를
 * 붙이던 자리를, 서버가 쿠키 세션으로 대신 확인한다.
 *
 * ★ 산식/집계 로직은 여기에도, 화면 어디에도 두지 않는다. 서버 응답을 그대로 표시한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const API_BASE = "/api/mrv"

/** 서버가 낸 HTTP 오류. 화면이 status 로 분기한다(403 → 미초대 안내 등). */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  query?: Record<string, string | number | boolean | undefined | null>
  json?: unknown
}

function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

/** 인증된 fetch. 오류는 서버가 준 detail 문구를 담아 ApiError 로 표면화한다. */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { query, json, headers, ...init } = options

  const finalHeaders = new Headers(headers)
  finalHeaders.set("Accept", "application/json")
  if (json !== undefined) finalHeaders.set("Content-Type", "application/json")

  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  })

  if (!res.ok) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      /* 본문 없음 */
    }
    const message =
      (body as { detail?: string } | undefined)?.detail ?? `요청 실패 (HTTP ${res.status})`
    throw new ApiError(res.status, message, body)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export type QueryState<T> = {
  data: T | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  /** 같은 인자로 다시 조회한다(수정 후 갱신 등). */
  refetch: () => void
}

type Settled<T> = { key: string; data?: T; error?: unknown }

/**
 * 조회 훅. `enabled` 가 false 면 요청하지 않고 로딩 상태로도 두지 않는다.
 *
 * `deps` 가 바뀌면 이전 요청을 취소하고 다시 조회한다. 취소하지 않으면 필터를 빠르게
 * 바꿀 때 늦게 도착한 옛 응답이 새 응답을 덮어써 화면이 과거 데이터로 되돌아간다.
 *
 * 로딩 여부는 따로 저장하지 않고 "지금 요청 키의 결과가 아직 도착하지 않았는가"로
 * 판단한다. 로딩 플래그를 effect 안에서 켜면 렌더가 한 번 더 도는데, 그럴 이유가 없다.
 */
export function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean } = {},
): QueryState<T> {
  const enabled = options.enabled ?? true
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<Settled<T>>({ key: "" })

  // 요청 하나를 가리키는 키. deps 나 refetch 로만 바뀐다.
  const key = useMemo(() => JSON.stringify(deps) + "#" + nonce, [deps, nonce])

  // fetcher 는 매 렌더 새로 만들어지는 화살표 함수라 의존성에 넣을 수 없다. 최신 참조만
  // 붙들어 두되, 갱신은 렌더 중이 아니라 effect 에서 한다(렌더 중 ref 쓰기 금지 규칙).
  // 이 effect 가 아래 조회 effect 보다 먼저 선언돼 있어 마운트 시에도 먼저 실행된다.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let cancelled = false

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (cancelled) return
        setSettled({ key, data: result })
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return
        setSettled({ key, error: err })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, key])

  const isSettled = settled.key === key
  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  return {
    // 새 요청이 도는 동안에도 직전 결과를 그대로 보여 준다(화면이 비었다가 다시 차지 않는다).
    data: settled.data,
    isLoading: enabled && !isSettled,
    isError: isSettled && settled.error !== undefined,
    error: isSettled ? settled.error : undefined,
    refetch,
  }
}

export type MutationState<TArgs, TResult> = {
  mutate: (args: TArgs) => Promise<TResult>
  isPending: boolean
  error: unknown
  reset: () => void
}

/**
 * 쓰기 훅. 진행 중 상태와 마지막 오류만 들고 있는다.
 * 성공 후 갱신은 호출부가 refetch 를 부르는 방식으로 명시한다 — 무엇이 다시 조회되는지가
 * 코드에 드러나는 편이 캐시 무효화 규칙을 숨기는 것보다 낫다.
 */
export function useApiMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): MutationState<TArgs, TResult> {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  const mutate = useCallback(async (args: TArgs) => {
    setIsPending(true)
    setError(undefined)
    try {
      return await fnRef.current(args)
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setIsPending(false)
    }
  }, [])

  const reset = useCallback(() => setError(undefined), [])
  return { mutate, isPending, error, reset }
}

/** 오류 객체에서 사용자에게 보여 줄 문구를 뽑는다. */
export function errorMessage(error: unknown, fallback = "요청에 실패했습니다."): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}
