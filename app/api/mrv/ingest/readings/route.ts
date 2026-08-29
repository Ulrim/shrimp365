/**
 * POST /api/mrv/ingest/readings — 게이트웨이 계측 수집.
 * 원본: apps/api/app/routers/ingest.py
 *
 * 인증은 세션이 아니라 X-API-Key 다(현장 게이트웨이에는 사람 세션이 없다).
 * ★ 테넌시의 진실은 매칭된 API 키의 (org_id, site_id) 이며, 요청 본문의 어떤 값도
 * 믿지 않는다 — 그렇지 않으면 키 하나로 남의 사이트에 계측값을 밀어 넣을 수 있다.
 *
 * 응답은 항상 200 이고 {accepted, deduped, rejected} 로 결과를 알린다. 일부 건이
 * 거부돼도 나머지는 저장된다 — 배치 하나가 통째로 실패하면 현장 데이터가 통째로 유실된다.
 *
 * 계측값 수집은 감사 로그 대상이 아니다(감사는 제어/설정 변경을 남긴다).
 */

import { NextRequest, NextResponse } from "next/server"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, mrvDb } from "@/lib/mrv/db"
import { processBatch, type RawReading } from "@/lib/mrv/ingestion"

/** 원문 키 → sha256 hex. 단방향·결정론. DB 에는 해시만 저장되어 있다. */
async function hashApiKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
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

    const body = (await req.json()) as {
      readings?: {
        meter_id?: string
        ts?: string
        value?: number
        reading_kind?: string
        seq?: number | null
      }[]
    }
    if (!Array.isArray(body.readings)) {
      throw new HttpError(422, "readings array is required")
    }

    const raws: RawReading[] = body.readings.map((r, index) => {
      if (!r.meter_id) throw new HttpError(422, `readings[${index}].meter_id is required`)
      if (!r.ts) throw new HttpError(422, `readings[${index}].ts is required`)
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) {
        throw new HttpError(422, `readings[${index}].value must be a finite number`)
      }
      if (!r.reading_kind) {
        throw new HttpError(422, `readings[${index}].reading_kind is required`)
      }
      return {
        index,
        meterId: r.meter_id,
        ts: parseInstant(r.ts, `readings[${index}].ts`),
        value: r.value,
        readingKind: r.reading_kind,
        seq: r.seq ?? null,
      }
    })

    const result = await processBatch(db, {
      orgId: apiKey.org_id,
      siteId: apiKey.site_id,
      raws,
    })

    return NextResponse.json(result)
  })
}
