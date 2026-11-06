/**
 * POST   /api/mrv/sites/{siteId}/harvests/{harvestId}/void — 생산량 기록 **무효 처리**
 * DELETE /api/mrv/sites/{siteId}/harvests/{harvestId}/void — 무효 처리 **되돌리기**
 * 원본: 없다.
 *
 * ── 왜 DELETE 라우트가 아닌가 ──────────────────────────────────────────────
 * 잘못 넣은 생산량을 되돌릴 길이 없어 DB 를 직접 고쳐야 했다. 그렇다고 행을 지우면
 * **이미 발행된 리포트가 참조한 근거가 흔적 없이 사라진다** — 같은 기간을 다시 조회했을 때
 * 전에 인쇄된 숫자가 재현되지 않는데 왜 달라졌는지 설명할 자리가 없다. 그래서 행은 남기고
 * KPI 산입에서만 빼며, 누가 언제 왜 뺐는지를 함께 남긴다. 사정은 `lib/mrv/harvest-void.ts`.
 *
 * `DELETE` 메서드를 **되돌리기**에 쓴다. 이 라우트의 자원은 '무효 표시' 이고, 그것을
 * 없애는 것이 되돌리기다. `app/api/mrv` 어디에서도 기록 자체를 지우지 않는다는 원칙은
 * 그대로다.
 *
 * ── 권한 ───────────────────────────────────────────────────────────────────
 * `requireWriter`(owner/operator). 생산량을 넣은 사람이 자기 오타를 고칠 수 있어야 한다.
 * 무효화는 되돌릴 수 있고 전 과정이 감사 로그에 남으므로 owner 한정으로 좁히지 않는다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { checkVoidReason, harvestVoidColumns } from "@/lib/mrv/harvest-void"

type HarvestRow = {
  id: string
  site_id: string
  org_id: string
  ts: string
  biomass_kg: number
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

/** 이 사이트의 기록인지 확인하고 현재 상태를 읽는다. */
async function loadHarvest(
  auth: Awaited<ReturnType<typeof authorizeMrv>>,
  siteId: string,
  harvestId: string,
): Promise<HarvestRow> {
  const { data, error } = await auth.db
    .from(T.harvestLogs)
    .select("id, site_id, org_id, ts, biomass_kg, voided_at, voided_by, void_reason")
    .eq("id", harvestId)
    .maybeSingle()

  if (error) {
    // 열이 없으면 **거절한다.** 칸만 빼고 update 하면 사람이 무효로 만들었다고 믿는
    // 기록이 그대로 산입된 채 남는다 — 읽기 경로와 반대 판단이고, 생산량 산정 근거
    // 쓰기 창구와 같은 기준이다.
    if (harvestVoidColumns.isMissingError(error)) {
      throw new HttpError(
        503,
        "생산량 정정 열(voided_at / voided_by / void_reason)이 아직 없습니다. " +
          "supabase/migrations/mrv_remaining_scope.sql 을 실행한 뒤 다시 시도하십시오. " +
          "칸을 빼고 처리하면 무효로 만들었다고 믿는 기록이 그대로 KPI 에 산입됩니다.",
      )
    }
    throw error
  }

  const row = data as HarvestRow | null
  if (!row) throw new HttpError(404, `harvest log not found: ${harvestId}`)
  if (row.org_id !== auth.orgId) {
    throw new HttpError(403, "harvest log does not belong to your organization")
  }
  if (row.site_id !== siteId) {
    throw new HttpError(404, "harvest log does not belong to this site")
  }
  return row
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; harvestId: string }> },
) {
  return handleRoute(async () => {
    const { siteId, harvestId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const before = await loadHarvest(auth, siteId, harvestId)

    if (before.voided_at !== null) {
      throw new HttpError(
        409,
        `이미 무효 처리된 기록입니다(${before.voided_at}). 되돌리려면 같은 주소로 ` +
          "DELETE 를 보내십시오.",
      )
    }

    const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
    const checked = checkVoidReason(body.reason)
    if (!checked.ok) throw new HttpError(422, checked.detail)

    const voidedAt = new Date().toISOString()
    const { error } = await auth.db
      .from(T.harvestLogs)
      .update({ voided_at: voidedAt, voided_by: auth.userId, void_reason: checked.reason })
      .eq("id", harvestId)
      // 그 사이 누가 먼저 무효화했으면 이 갱신은 0행을 고친다(409 를 뒤늦게라도 맞춘다).
      .is("voided_at", null)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "harvest_logs",
      entityId: harvestId,
      action: "void",
      diff: {
        before: { voided_at: null, biomass_kg: before.biomass_kg, ts: before.ts },
        after: { voided_at: voidedAt, void_reason: checked.reason },
      },
      note:
        "생산량 기록 무효 처리 — 이 기록은 EI · 폭기 EI · FCR · OEI 의 분모에서 빠집니다. " +
        "행은 지워지지 않습니다.",
    })

    return NextResponse.json({
      id: harvestId,
      voided_at: voidedAt,
      voided_by: auth.userId,
      void_reason: checked.reason,
    })
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; harvestId: string }> },
) {
  return handleRoute(async () => {
    const { siteId, harvestId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const before = await loadHarvest(auth, siteId, harvestId)

    if (before.voided_at === null) {
      throw new HttpError(409, "무효 처리된 기록이 아닙니다 — 되돌릴 것이 없습니다.")
    }

    const { error } = await auth.db
      .from(T.harvestLogs)
      .update({ voided_at: null, voided_by: null, void_reason: null })
      .eq("id", harvestId)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "harvest_logs",
      entityId: harvestId,
      action: "unvoid",
      diff: {
        // 되돌리기 전의 사유를 남긴다 — 지우고 나면 "무엇을 되돌렸는가" 가 사라진다.
        before: { voided_at: before.voided_at, void_reason: before.void_reason },
        after: { voided_at: null },
      },
      note: "생산량 기록 무효 처리 되돌림 — 이 기록이 다시 분모에 산입됩니다.",
    })

    return NextResponse.json({ id: harvestId, voided_at: null })
  })
}
