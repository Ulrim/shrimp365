/**
 * 현장 장비 인증 — `X-API-Key` → (org, site).
 *
 * 사람이 아닌 호출자의 자격 확인을 한 곳에 둔다. 창구가 둘(`/ingest/readings` 수집,
 * `/ingest/meters` 계측기 조회)로 늘면서 같은 조회가 복사되려 했고, **테넌시 확정 코드가
 * 두 곳에 있으면 한쪽만 고쳐지는 날 그 틈으로 남의 사이트가 열린다.**
 *
 * ★ 테넌시의 진실은 **매칭된 API 키의 (org_id, site_id)** 이며, 요청 본문이나 쿼리의
 * 어떤 값도 믿지 않는다. 그렇지 않으면 키 하나로 남의 사이트를 읽고 쓸 수 있다.
 */

import type { NextRequest } from "next/server"
import { after } from "next/server"
import { HttpError } from "./http"
import { T, mrvDb, type MrvDb } from "./db"

export type DeviceAuth = {
  /** service-role 클라이언트. RLS 를 우회하므로 아래 orgId/siteId 로 좁히는 것이 유일한 방어선이다. */
  db: MrvDb
  orgId: string
  siteId: string
  apiKeyId: string
}

/** 원문 키 → sha256 hex. 단방향·결정론. DB 에는 해시만 저장되어 있다. */
export async function hashApiKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * `last_used_at` 을 다시 쓰기까지 두는 최소 간격(5분).
 *
 * ── 왜 매 요청이 아닌가 ─────────────────────────────────────────────────────
 * 게이트웨이는 계측값을 1분 간격으로도 올린다. 인증마다 UPDATE 를 치면 수집 경로의
 * 쓰기가 두 배가 되는데, 그 절반은 **아무도 1분 단위로 읽지 않는 칸**을 갱신하는 데
 * 쓰인다. 이 열이 답하는 질문은 하나다: 「이 장비가 아직 살아 있는가 — 끊어도 되는가」.
 * 거기에 1분 해상도는 필요 없다.
 *
 * ── 왜 5분인가 ──────────────────────────────────────────────────────────────
 * 1분 주기 장비 기준으로 쓰기를 1/5 로 줄이면서, 화면이 보여 주는 "마지막 사용" 의
 * 오차는 최대 5분이다. 운영자가 단말을 분실하고 키를 끊으러 들어오는 상황의 시간
 * 단위는 분이 아니라 시간·일이므로 5분 오차는 판단을 바꾸지 않는다. 더 늘리면
 * (예: 1시간) 방금 설치한 장비가 목록에 "사용 기록 없음" 으로 남아 설치 확인에
 * 쓸 수 없게 된다 — 그 쓸모를 지키는 상한이 이 값이다.
 *
 * 설정으로 빼지 않았다: 운영자가 조절할 이유가 없고, 조절할 수 있게 하면 0 으로
 * 두어 수집 경로를 느리게 만드는 길이 열린다.
 */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000

/**
 * `last_used_at` 을 갱신한다 — **응답을 보낸 뒤에, 실패해도 조용히.**
 *
 * `after()` 로 미루는 이유: 이 갱신은 수집의 일부가 아니라 운영 편의용 부가 기능이다.
 * 응답 경로에 넣으면 계측값 수집이 이 UPDATE 를 기다리고, DB 가 느린 날에는 증빙
 * 데이터가 부가 기능 때문에 늦거나 유실된다. 오류를 삼키는 것도 같은 이유다 —
 * **이 칸을 못 적는 것이 계측값을 못 받는 이유가 되어서는 안 된다.**
 * (그래서 throw 하지 않고 로그만 남긴다. 로그가 쌓이면 원인을 쫓을 수 있다.)
 */
function touchLastUsedAt(db: MrvDb, apiKeyId: string, lastUsedAt: string | null): void {
  if (lastUsedAt !== null) {
    const age = Date.now() - new Date(lastUsedAt).getTime()
    // NaN(값이 깨진 경우)은 비교가 모두 false 라 갱신 쪽으로 떨어진다 — 의도한 방향이다.
    if (age < LAST_USED_REFRESH_MS) return
  }

  after(async () => {
    try {
      const { error } = await db
        .from(T.apiKeys)
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKeyId)
      if (error) throw error
    } catch (err) {
      console.error("[mrv] failed to touch api key last_used_at", apiKeyId, err)
    }
  })
}

/**
 * `X-API-Key` 헤더로 장비를 인증한다.
 *
 * @throws HttpError 401 키가 없거나, 모르는 키거나, 폐기된 키일 때.
 */
export async function authorizeDevice(req: NextRequest): Promise<DeviceAuth> {
  const rawKey = req.headers.get("x-api-key")
  if (!rawKey) throw new HttpError(401, "missing api key")

  const db = mrvDb()
  const { data, error } = await db
    .from(T.apiKeys)
    .select("id, org_id, site_id, revoked, last_used_at")
    .eq("key_hash", await hashApiKey(rawKey))
    .maybeSingle()
  if (error) throw error

  const apiKey = data as {
    id: string
    org_id: string
    site_id: string
    revoked: boolean
    last_used_at: string | null
  } | null
  // 폐기된 키와 없는 키를 구분해 알리지 않는다 — 구분해 주면 키 존재 여부를 캐낼 수 있다.
  if (!apiKey || apiKey.revoked) {
    throw new HttpError(401, "invalid or revoked api key")
  }

  // 통과한 뒤에만 적는다. 폐기된 키의 시도까지 "마지막 사용" 으로 적으면, 운영자가
  // 끊어 둔 장비를 아직 살아 있는 것으로 읽는다.
  touchLastUsedAt(db, apiKey.id, apiKey.last_used_at)

  return { db, orgId: apiKey.org_id, siteId: apiKey.site_id, apiKeyId: apiKey.id }
}
