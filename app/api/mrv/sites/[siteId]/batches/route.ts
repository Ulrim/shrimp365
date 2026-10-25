/**
 * GET/POST /api/mrv/sites/{siteId}/batches — 배치(입식 사이클) 조회·등록.
 * 원본: apps/api/app/routers/batches.py (GET 만 있다. POST 는 원본에 없다.)
 *
 * batches 는 site 를 직접 갖지 않고 tank 를 경유하므로, 이 사이트의 수조를 먼저 찾아
 * 그 수조들의 배치만 모은다. 읽기이므로 역할 제한은 없다.
 *
 * ── POST 를 더하는 이유 ─────────────────────────────────────────────────────
 * `stocked_count` 가 **폐사율의 분모**다(`lib/mrv/kpi/mortality.ts` —
 * cumulativeRatePct = Σdead / stockedCount × 100). 그런데 배치를 만드는 창구가 API 에도
 * 화면에도 없었다. 즉 폐사를 아무리 기록해도 **분모가 없어 폐사율이 비고**, 기준선 잠금의
 * 충분성 판정도 `stockedCount` 를 보므로(`lib/mrv/baseline-readiness.ts`) 통과할 수
 * 없었다. 생산량 창구가 EI 의 분모에 대해, 수조 창구가 OEI 의 조건에 대해 메운 것과
 * 같은 구멍이다.
 *
 * ── 수정·삭제는 두지 않는다 ────────────────────────────────────────────────
 * 입식 수를 나중에 고치면 **이미 발행된 폐사율이 소급해서 달라진다.** 입식은 한 번
 * 일어난 사실이므로, 잘못 적었으면 새 배치를 만들고 잘못된 배치를 닫는(`closed_at`)
 * 편이 증빙으로 옳다. 계측기 창구와 같은 판단이다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import { resolveSiteForOrg, resolveTankForSite } from "@/lib/mrv/tenancy"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const tanks = await fetchAll<{ id: string }>((f, t) =>
      auth.db
        .from(T.tanks)
        .select("id")
        .eq("site_id", siteId)
        .order("id", { ascending: true })
        .range(f, t),
    )
    if (tanks.length === 0) return NextResponse.json([])

    const rows = await fetchAll<{
      id: string
      tank_id: string
      species: string
      stocked_count: number
      stocked_at: string
      closed_at: string | null
    }>((f, t) =>
      auth.db
        .from(T.batches)
        .select("id, tank_id, species, stocked_count, stocked_at, closed_at")
        .in(
          "tank_id",
          tanks.map((x) => x.id),
        )
        .order("stocked_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json(rows)
  })
}

/** 입식 수의 상한. 이보다 크면 단위를 잘못 적었을 가능성이 훨씬 높다(만 마리 ↔ 마리). */
const STOCKED_COUNT_MAX = 100_000_000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      tank_id?: string
      species?: string
      stocked_count?: number | string
      stocked_at?: string
    }

    if (!body.tank_id) throw new HttpError(422, "수조를 선택하세요.")
    // 이 사이트의 수조인지 본다 — 다른 조직의 수조 id 로 배치를 만들 수 없다.
    await resolveTankForSite(auth.db, body.tank_id, siteId, auth.orgId)

    const species = (body.species ?? "").trim()
    if (species === "") throw new HttpError(422, "품종을 적어야 합니다.")

    const count = Number(body.stocked_count)
    if (!Number.isInteger(count) || count <= 0) {
      throw new HttpError(422, "입식 수는 0보다 큰 정수여야 합니다 — 폐사율의 분모입니다.")
    }
    if (count > STOCKED_COUNT_MAX) {
      throw new HttpError(
        422,
        `입식 수가 ${count.toLocaleString("ko-KR")}마리입니다 — ` +
          `${STOCKED_COUNT_MAX.toLocaleString("ko-KR")}마리를 넘습니다. 단위를 확인하십시오.`,
      )
    }

    if (!body.stocked_at) throw new HttpError(422, "입식 시각을 적어야 합니다.")
    const stockedAt = parseInstant(body.stocked_at, "stocked_at")

    const row = {
      id: newId("batch"),
      tank_id: body.tank_id,
      org_id: auth.orgId,
      species,
      stocked_count: count,
      stocked_at: stockedAt.toISOString(),
      closed_at: null as string | null,
    }
    const { error } = await auth.db.from(T.batches).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "batches",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          tank_id: row.tank_id,
          species: row.species,
          stocked_count: row.stocked_count,
          stocked_at: row.stocked_at,
        },
      },
      note: "입식 수는 폐사율의 분모입니다.",
    })

    return NextResponse.json(row, { status: 201 })
  })
}
