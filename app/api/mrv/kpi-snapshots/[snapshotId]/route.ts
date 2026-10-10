/**
 * GET /api/mrv/kpi-snapshots/{snapshotId} — 저장된 KPI 스냅샷 1건.
 * 원본: apps/api/app/routers/kpi_snapshots.py
 *
 * 리포트의 숫자를 클릭해 근거로 내려가는 drill-down 의 종착점이다. 저장된 행을 그대로
 * 반환하며 어떤 값도 다시 계산하지 않는다 — 그래야 언제 조회해도 리포트가 발행될 당시의
 * 근거가 그대로 보인다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  return handleRoute(async () => {
    const { snapshotId } = await params
    const auth = await authorizeMrv(req)

    const { data, error } = await auth.db
      .from(T.kpiSnapshots)
      .select("*")
      .eq("id", snapshotId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new HttpError(404, `kpi snapshot not found: ${snapshotId}`)

    const snap = data as {
      id: string
      site_id: string
      tank_id: string | null
      org_id: string
      period_start: string
      period_end: string
      ei_total: number | null
      ei_aeration: number | null
      oei: number | null
      fcr: number | null
      mortality_rate: number | null
      config_version: string
      inputs_json: Record<string, unknown>
      provenance_json: Record<string, unknown>
      generated_at: string
    }
    // 스냅샷이 가리키는 사이트로 org 를 재검증한다(3중 방어).
    await resolveSiteForOrg(auth.db, snap.site_id, auth.orgId)

    return NextResponse.json({
      id: snap.id,
      site_id: snap.site_id,
      tank_id: snap.tank_id,
      org_id: snap.org_id,
      period: {
        from: snap.period_start,
        to: snap.period_end,
        granularity: "period",
      },
      ei_total: snap.ei_total,
      ei_aeration: snap.ei_aeration,
      oei: snap.oei,
      fcr: snap.fcr,
      mortality_rate: snap.mortality_rate,
      config_version: snap.config_version,
      inputs_json: snap.inputs_json,
      provenance_json: snap.provenance_json,
      generated_at: snap.generated_at,
    })
  })
}
