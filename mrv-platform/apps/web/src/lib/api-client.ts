/*
 * fetch 래퍼. JWT를 Authorization 헤더에 주입하고 base URL은 VITE_API_BASE 사용.
 * 산식/집계 로직은 절대 여기서 하지 않는다 — 백엔드 응답을 그대로 전달만 한다.
 */
import { getCachedAccessToken } from "./supabase-client";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

/** 인증 실패(401) 등 HTTP 오류를 구조화해 전달한다. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/**
 * JWT 조회 훅 지점. Supabase 세션 캐시(supabase-client.ts의 onAuthStateChange 구독)에서
 * access_token을 동기 반환한다. 세션이 없으면 null(미인증 처리, 401 유도) — 함수 시그니처는
 * 기존과 동일(`(): string | null`).
 */
function getAuthToken(): string | null {
  return getCachedAccessToken();
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** 쿼리스트링으로 직렬화할 파라미터 */
  query?: Record<string, string | number | undefined | null>;
  /** JSON 본문 (자동 직렬화) */
  json?: unknown;
}

function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** 인증된 fetch. 401은 ApiError(isUnauthorized)로 표면화한다. */
export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { query, json, headers, ...init } = options;
  const token = getAuthToken();

  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  if (json !== undefined) finalHeaders.set("Content-Type", "application/json");

  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      /* 본문 없음 */
    }
    const message =
      (body as { detail?: string } | undefined)?.detail ??
      `요청 실패 (HTTP ${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * 인증된 fetch(바이너리 응답 전용, 예: MRV 리포트 PDF). apiFetch와 동일한 인증/에러 처리를
 * 공유하되 JSON 파싱 대신 Blob을 반환한다. 산식/데이터 가공 없음(순수 전송 계층).
 */
export async function apiFetchBlob(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Blob> {
  const { query, headers, ...init } = options;
  const token = getAuthToken();

  const finalHeaders = new Headers(headers);
  if (token) finalHeaders.set("Authorization", `Bearer ${token}`);

  const res = await fetch(buildUrl(path, query), { ...init, headers: finalHeaders });

  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      /* 본문 없음(바이너리 오류 응답 등) */
    }
    const message =
      (body as { detail?: string } | undefined)?.detail ??
      `요청 실패 (HTTP ${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  return await res.blob();
}
