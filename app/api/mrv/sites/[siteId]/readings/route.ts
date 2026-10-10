/**
 * GET  /api/mrv/sites/{siteId}/readings — 대시보드 차트용 시계열.
 * POST /api/mrv/sites/{siteId}/readings — **사람이 넣는 계측값**(수기 입력·기록지 CSV).
 * 원본: apps/api/app/routers/readings.py (GET 만. POST 는 원본에 없다.)
 *
 * GET: meter_id 단일 조회이거나 tank_id+type 조합이어야 한다 — 둘 다 없으면 사이트의 모든
 * 계측값을 뜻하게 되는데, 그건 차트가 쓸 수 있는 형태가 아니다(422 로 되돌린다).
 *
 * ── POST 를 새로 둔 이유 ──────────────────────────────────────────────────
 * 전력(kWh)은 EI·폭기 EI·Scope2·기준선·전후 비교의 **유일한 근거**다. 그런데 계측값이
 * 들어올 창구는 게이트웨이 수집(`POST /api/mrv/ingest/readings`, `X-API-Key`) 하나뿐이었다
 * — 즉 **사람이 전력을 넣을 방법이 없었다.** 전력계가 붙기 전까지 전력 지표 전부가
 * 구조적으로 빈칸이라는 뜻이고, 기준선을 잠글 수도 없었다(산입된 전력 계측값 0건).
 * 이 창구가 그 구멍을 메운다.
 *
 * **정규화는 다시 쓰지 않는다.** 적산 지침(cumulative_kwh)·순시(instant_kw)·구간
 * (interval_kwh)을 저장 규약인 구간 kWh 로 옮기는 규칙은 ADR 0001 이고 구현은
 * `lib/mrv/ingestion.ts` 한 곳뿐이다. 이 라우트는 입력을 검증해 **같은 `processBatch` 에
 * 넘긴다.** 수기 경로가 자기 변환을 들고 있으면 같은 kWh 가 창구에 따라 다른 값으로
 * 저장된다 — MRV 에서 그건 데이터 오염이다.
 *
 * **게이트웨이 창구와 다른 점은 셋이다.**
 *   1) 테넌시의 진실이 API 키가 아니라 **세션 + `resolveSiteForOrg`** 다.
 *   2) 쓰기 권한을 요구한다(`requireWriter`) — viewer 는 증빙을 만들 수 없다.
 *   3) **감사 로그를 남긴다.** 게이트웨이 수집은 기계 볼륨이라 감사 대상이 아니지만,
 *      사람이 손으로 적어 넣은 전력은 되돌릴 수 없는 기준선의 근거가 된다. "누가 언제
 *      어느 계측기에 몇 건을 어떤 표현으로 넣었나" 가 남아야 증빙이다. 행마다 남기면
 *      기록지 한 장에 수십 건이 쌓이므로 **요청 하나당 한 건**으로 요약해 남긴다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant, parsePeriod } from "@/lib/mrv/http"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { RECOGNIZED_KINDS, processBatch, type RawReading } from "@/lib/mrv/ingestion"
import {
  VALID_GRANULARITIES,
  getSiteReadings,
  type Granularity,
} from "@/lib/mrv/readings-service"

/**
 * 한 요청에 받는 최대 건수. 기록지 CSV 업로드 상한(1,000줄)과 같은 자리의 숫자다.
 * 상한이 없으면 브라우저 하나가 임의 크기의 본문을 밀어 넣을 수 있고, 그 요청이
 * 중간에 끊기면 운영자는 어디까지 들어갔는지 모르는 채 같은 파일을 다시 올린다.
 */
const MAX_READINGS_PER_REQUEST = 1000

/** 사람이 넣을 수 있는 출처. 'device' 는 게이트웨이 창구 전용이라 받지 않는다. */
const HUMAN_SOURCES = new Set(["manual", "csv"])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    const url = new URL(req.url)

    const meterId = url.searchParams.get("meter_id")
    const tankId = url.searchParams.get("tank_id")
    const type = url.searchParams.get("type")
    const granularity = (url.searchParams.get("granularity") ?? "raw") as Granularity

    if (!meterId && !(tankId && type)) {
      throw new HttpError(
        422,
        "either 'meter_id' or both 'tank_id' and 'type' are required",
      )
    }
    if (!(VALID_GRANULARITIES as readonly string[]).includes(granularity)) {
      throw new HttpError(
        422,
        `granularity must be one of ${VALID_GRANULARITIES.join(", ")}`,
      )
    }
    const { from, to } = parsePeriod(url)

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    return NextResponse.json(
      await getSiteReadings({
        db: auth.db,
        siteId,
        orgId: auth.orgId,
        meterId,
        tankId,
        type,
        from,
        to,
        granularity,
      }),
    )
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    // 산출 비용을 쓰기 전에 소유권부터 본다(집 양식).
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      source?: unknown
      readings?: unknown
    }

    // 출처는 필수다. 기본값을 두면 기록지 업로드가 수기 입력으로 둔갑하고, 그러면
    // 증빙에서 "누가 어떻게 넣은 값인가" 가 사라진다(mrv_feed_logs 와 같은 태도).
    if (typeof body.source !== "string" || !HUMAN_SOURCES.has(body.source)) {
      throw new HttpError(422, "source must be one of manual, csv")
    }
    const source = body.source as "manual" | "csv"

    if (!Array.isArray(body.readings)) {
      throw new HttpError(422, "readings array is required")
    }
    if (body.readings.length === 0) {
      throw new HttpError(422, "readings must not be empty")
    }
    if (body.readings.length > MAX_READINGS_PER_REQUEST) {
      throw new HttpError(
        422,
        `readings must contain at most ${MAX_READINGS_PER_REQUEST} entries, got ${body.readings.length}`,
      )
    }

    const raws: RawReading[] = body.readings.map((entry, index) => {
      const r = entry as {
        meter_id?: unknown
        ts?: unknown
        value?: unknown
        reading_kind?: unknown
      }
      if (typeof r.meter_id !== "string" || !r.meter_id) {
        throw new HttpError(422, `readings[${index}].meter_id is required`)
      }
      if (typeof r.ts !== "string" || !r.ts) {
        throw new HttpError(422, `readings[${index}].ts is required`)
      }
      // 숫자 문자열("12.5")을 받아 주지 않는다. 받아 주면 빈 셀이 Number("") = 0 으로
      // 둔갑해 "그 시각에 0 kWh 를 썼다" 는 거짓 증빙이 조용히 저장된다.
      if (typeof r.value !== "number" || !Number.isFinite(r.value)) {
        throw new HttpError(422, `readings[${index}].value must be a finite number`)
      }
      // 표현은 여기서 거른다. processBatch 도 모르는 표현을 그 건만 거부하지만, 사람이
      // 넣는 경로에서는 **한 건도 조용히 빠지지 않는 쪽**이 맞다 — 운영자는 '수락 19건'
      // 을 성공으로 읽고 빠진 1건을 알아채지 못한다.
      if (typeof r.reading_kind !== "string" || !RECOGNIZED_KINDS.has(r.reading_kind)) {
        throw new HttpError(
          422,
          `readings[${index}].reading_kind must be one of ${[...RECOGNIZED_KINDS].sort().join(", ")}`,
        )
      }
      return {
        index,
        meterId: r.meter_id,
        ts: parseInstant(r.ts, `readings[${index}].ts`),
        value: r.value,
        readingKind: r.reading_kind,
        // seq 는 게이트웨이가 같은 시각의 순서를 알릴 때 쓰는 값이다. 사람이 넣는
        // 기록에는 그런 순서가 없으므로 받지 않는다.
        seq: null,
      }
    })

    const result = await processBatch(auth.db, {
      orgId: auth.orgId,
      siteId,
      raws,
      source,
    })

    // 요약만 남긴다. 건마다 남기면 기록지 한 장이 감사 로그 수십 줄이 되어, 정작
    // 읽어야 하는 제어·설정 변경 기록이 묻힌다.
    const times = raws.map((r) => r.ts.getTime())
    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "readings",
      entityId: siteId,
      action: "create",
      diff: {
        before: null,
        after: {
          source,
          submitted: raws.length,
          accepted: result.accepted,
          deduped: result.deduped,
          rejected: result.rejected.length,
          // 산입 가능 여부까지 남긴다. 'suspect'/'bad' 는 EI 산입 목록에서 빠지므로,
          // 나중에 "그때 올린 20건 중 몇 건이 실제로 KPI 에 들어갔나" 를 되짚을 수 있다.
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

    return NextResponse.json(result, { status: 201 })
  })
}
