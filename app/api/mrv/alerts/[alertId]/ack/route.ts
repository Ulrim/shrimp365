/**
 * POST /api/mrv/alerts/{alertId}/ack — 알림 확인 처리.
 * 원본: apps/api/app/routers/alerts.py::ack_alert
 *
 * 멱등하다: 이미 ack 된 알림에 다시 호출해도 그대로 돌려주고 감사 로그를 중복으로 남기지
 * 않는다(같은 확인 행위가 여러 번 기록되면 이력이 사실과 달라진다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import { alertRowToItem, type AlertRow } from "@/lib/mrv/alerts"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ alertId: string }> },
) {
  return handleRoute(async () => {
    const { alertId } = await params
    const auth = requireWriter(await authorizeMrv(req))

    const { data, error } = await auth.db
      .from(T.alerts)
      .select("*")
      .eq("id", alertId)
      .maybeSingle()
    if (error) throw error

    const alert = data as AlertRow | null
    // 알림은 사이트 내부 운영 정보다. 타 org 에는 존재 사실조차 숨긴다(403 이 아니라 404).
    if (!alert || alert.org_id !== auth.orgId) {
      throw new HttpError(404, `alert not found: ${alertId}`)
    }
    if (alert.status === "ack") return NextResponse.json(alertRowToItem(alert))

    const ackedAt = new Date().toISOString()
    const { error: updateError } = await auth.db
      .from(T.alerts)
      .update({ status: "ack", acked_by: auth.userId, acked_at: ackedAt })
      .eq("id", alert.id)
    if (updateError) throw updateError

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "alerts",
      entityId: alert.id,
      action: "ack",
      diff: { before: { status: alert.status }, after: { status: "ack" } },
    })

    return NextResponse.json(
      alertRowToItem({
        ...alert,
        status: "ack",
        acked_by: auth.userId,
        acked_at: ackedAt,
      }),
    )
  })
}
