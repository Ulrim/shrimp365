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
    .select("id, org_id, site_id, revoked")
    .eq("key_hash", await hashApiKey(rawKey))
    .maybeSingle()
  if (error) throw error

  const apiKey = data as {
    id: string
    org_id: string
    site_id: string
    revoked: boolean
  } | null
  // 폐기된 키와 없는 키를 구분해 알리지 않는다 — 구분해 주면 키 존재 여부를 캐낼 수 있다.
  if (!apiKey || apiKey.revoked) {
    throw new HttpError(401, "invalid or revoked api key")
  }

  return { db, orgId: apiKey.org_id, siteId: apiKey.site_id, apiKeyId: apiKey.id }
}
