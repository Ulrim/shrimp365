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
import { authorizeDevice } from "@/lib/mrv/device-auth"
import { recordAudit } from "@/lib/mrv/audit"
import { processBatch, type RawReading } from "@/lib/mrv/ingestion"

/**
 * 장비가 선언할 수 있는 출처.
 *
 * `manual` 을 받는 이유: 전력은 이 운영에서 **사람이 계량기를 읽어 넣는다.** 그 입력이
 * 사무실 웹 화면에서 오든 기계실 터치스크린에서 오든 **사람이 적은 값**이고, DB 에서
 * 그렇게 보여야 증빙이 된다. 창구(세션 vs 장치 키)가 아니라 **입력한 주체**가 출처다.
 */
const DEVICE_SOURCES = new Set(["device", "manual"])

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const device = await authorizeDevice(req)

    const body = (await req.json()) as {
      source?: unknown
      readings?: {
        meter_id?: string
        ts?: string
        value?: number
        reading_kind?: string
        seq?: number | null
      }[]
    }
    // 적지 않으면 게이트웨이 수집으로 본다(기존 장비는 이 칸을 모른다).
    const source = body.source === undefined ? "device" : body.source
    if (typeof source !== "string" || !DEVICE_SOURCES.has(source)) {
      throw new HttpError(422, "source must be one of device, manual")
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

    const result = await processBatch(device.db, {
      orgId: device.orgId,
      siteId: device.siteId,
      raws,
      source: source as "device" | "manual",
    })

    // 사람이 적은 값만 감사 로그에 남긴다. 게이트웨이 수집은 기계 볼륨이라 남기면
    // 정작 읽어야 하는 제어·설정 변경 기록이 묻힌다(머리말 참고). 반면 수기 입력은
    // 되돌릴 수 없는 기준선의 근거라 "누가 언제 무엇을 넣었나" 가 남아야 한다.
    //
    // 행위자는 사람의 id 가 아니라 **장비 키 id** 다 — 터치스크린 앞에 선 사람이
    // 누구인지는 장비가 알지 못한다. 그 한계를 숨기지 않고 그대로 적는다.
    if (source === "manual" && raws.length > 0) {
      const times = raws.map((r) => r.ts.getTime())
      await recordAudit(device.db, {
        orgId: device.orgId,
        actorId: device.apiKeyId,
        entity: "readings",
        entityId: device.siteId,
        action: "create",
        diff: {
          before: null,
          after: {
            source,
            via: "field_device",
            submitted: raws.length,
            accepted: result.accepted,
            deduped: result.deduped,
            rejected: result.rejected.length,
            quality: result.quality,
            meter_ids: Array.from(new Set(raws.map((r) => r.meterId))).sort(),
            reading_kinds: Array.from(new Set(raws.map((r) => r.readingKind))).sort(),
            period: {
              from: new Date(Math.min(...times)).toISOString(),
              to: new Date(Math.max(...times)).toISOString(),
            },
          },
        },
      })
    }

    return NextResponse.json(result)
  })
}
