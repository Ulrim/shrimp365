/**
 * POST /api/mrv/sites/{siteId}/baseline/lock — 기준선 잠금.
 * 원본: apps/api/app/routers/baseline.py::lock_baseline
 *
 * 순서: 소유권 확인 → 기존 잠금 확인(409) → 4종 KPI 산출 → 스냅샷 영속화 →
 *       locked 행 삽입 → 감사 로그.
 *
 * 원본은 이 전체를 한 트랜잭션으로 묶었다. PostgREST 에는 그런 트랜잭션 경계가 없으므로,
 * 대신 부분 유니크 인덱스(사이트당 잠긴 기준선 1개)를 최종 방어선으로 삼는다 — 사전
 * 조회와 삽입 사이에 다른 요청이 끼어들어도 DB 가 두 번째 잠금을 거부하고, 그 오류를
 * 원본과 같은 409 로 되돌린다. 스냅샷 행이 먼저 만들어졌다가 잠금이 실패하면 고아
 * 스냅샷이 하나 남지만, 스냅샷은 append-only 기록이라 남아 있어도 해가 없다
 * (어떤 산출도 스냅샷 개수에 의존하지 않는다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { computeSiteKpiResults } from "@/lib/mrv/kpi-service"
import { persistKpiSnapshot } from "@/lib/mrv/snapshots"
import { recordAudit } from "@/lib/mrv/audit"
import { baselineRowToResponse, type BaselineRow } from "@/lib/mrv/baseline"

/** Postgres 유니크 위반. 사이트당 잠긴 기준선이 이미 있다는 뜻이다. */
const UNIQUE_VIOLATION = "23505"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))

    const body = (await req.json()) as { period?: { from?: string; to?: string } }
    if (!body.period?.from || !body.period?.to) {
      throw new HttpError(422, "period.from and period.to are required")
    }
    const periodFrom = parseInstant(body.period.from, "period.from")
    const periodTo = parseInstant(body.period.to, "period.to")
    if (periodFrom.getTime() >= periodTo.getTime()) {
      throw new HttpError(422, "'from' must be strictly before 'to'")
    }

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const { data: existing, error: existingError } = await auth.db
      .from(T.baselines)
      .select("id")
      .eq("site_id", siteId)
      .eq("status", "locked")
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) {
      throw new HttpError(409, "a locked baseline already exists for this site")
    }

    const comp = await computeSiteKpiResults(auth.db, siteId, periodFrom, periodTo)
    const snapshotId = await persistKpiSnapshot(auth.db, {
      siteId,
      orgId: auth.orgId,
      periodStart: periodFrom,
      periodEnd: periodTo,
      comp,
    })

    const row: BaselineRow = {
      id: newId("bsl"),
      site_id: siteId,
      org_id: auth.orgId,
      period_start: periodFrom.toISOString(),
      period_end: periodTo.toISOString(),
      ei_total: comp.ei.eiTotal,
      ei_aeration: comp.ei.eiAeration,
      oei: comp.oei?.oei ?? null,
      fcr: comp.fcr.fcr,
      mortality_rate: comp.mortality.cumulativeRatePct,
      config_version: comp.configVersion,
      kpi_snapshot_id: snapshotId,
      status: "locked",
      locked_by: auth.userId,
      locked_at: new Date().toISOString(),
    }

    const { error } = await auth.db.from(T.baselines).insert(row)
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new HttpError(409, "a locked baseline already exists for this site")
      }
      throw error
    }

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "baselines",
      entityId: row.id,
      action: "lock",
      diff: {
        before: null,
        after: {
          id: row.id,
          status: "locked",
          period: { from: row.period_start, to: row.period_end },
          config_version: row.config_version,
          kpi_snapshot_id: snapshotId,
          metrics: {
            ei_total: row.ei_total,
            ei_aeration: row.ei_aeration,
            oei: row.oei,
            fcr: row.fcr,
            mortality_rate: row.mortality_rate,
          },
        },
      },
    })

    return NextResponse.json(baselineRowToResponse(row), { status: 201 })
  })
}
