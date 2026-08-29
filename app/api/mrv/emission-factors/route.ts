/**
 * 전력 배출계수 목록/등록.
 * 원본: apps/api/app/routers/emission_factors.py
 *
 * 배출계수를 코드에 박지 않는 이유가 이 테이블이다 — 출처·연도·버전을 함께 저장해
 * 리포트에 명시하고 제3자가 검증할 수 있게 한다.
 *
 * append-only: 수정/삭제 경로를 두지 않는다. 과거 리포트가 참조한 값이 사후에 바뀌면
 * 증빙 무결성이 깨지므로, 값이 갱신되면 새 version 행을 추가한다.
 * 등록은 owner 전용이다(조직 전역 설정이라 operator 까지 열지 않는다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"

const UNIQUE_VIOLATION = "23505"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    const rows = await fetchAll((f, t) =>
      auth.db
        .from(T.emissionFactors)
        .select("id, factor_tco2e_per_mwh, source, year, version, effective_from")
        .order("effective_from", { ascending: false })
        .range(f, t),
    )
    return NextResponse.json({ items: rows })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(await authorizeMrv(req))

    const body = (await req.json()) as {
      factor_tco2e_per_mwh?: number
      source?: string
      year?: number
      version?: string
      effective_from?: string
    }
    // 배출계수는 0 이하일 수 없다. 0 을 받아들이면 감축량이 언제나 0 으로 나온다.
    if (typeof body.factor_tco2e_per_mwh !== "number" || !(body.factor_tco2e_per_mwh > 0)) {
      throw new HttpError(422, "factor_tco2e_per_mwh must be greater than 0")
    }
    if (!body.source) throw new HttpError(422, "source is required")
    if (!Number.isInteger(body.year)) throw new HttpError(422, "year must be an integer")
    if (!body.version) throw new HttpError(422, "version is required")
    if (!body.effective_from) throw new HttpError(422, "effective_from is required")
    const effectiveFrom = parseInstant(body.effective_from, "effective_from")

    const row = {
      id: newId("ef"),
      factor_tco2e_per_mwh: body.factor_tco2e_per_mwh,
      source: body.source,
      year: body.year as number,
      version: body.version,
      effective_from: effectiveFrom.toISOString(),
    }
    const { error } = await auth.db.from(T.emissionFactors).insert(row)
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new HttpError(409, "an emission factor with this version already exists")
      }
      throw error
    }

    // 배출계수 자체는 조직 전역 설정이지만, 누가 등록했는지는 요청자의 org 로 남긴다.
    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "emission_factors",
      entityId: row.id,
      action: "create",
      diff: { before: null, after: row },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
