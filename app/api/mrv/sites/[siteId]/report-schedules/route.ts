/**
 * GET/POST/PATCH /api/mrv/sites/{siteId}/report-schedules — 리포트 자동 생성 일정.
 * 원본: 없다. 사정은 lib/mrv/report-jobs.ts.
 *
 * 사이트마다 주기(weekly/monthly)별로 하나다(DB unique). 같은 주기를 두 번 걸면 같은
 * 기간이 두 번 발행된다.
 *
 * 권한: owner 전용. 리포트는 발행물이고 메일은 조직 바깥으로 나간다 — 누구에게 무엇을
 * 자동으로 보낼지는 운영 작업이 아니라 조직의 결정이다.
 *
 * PATCH 는 켜고 끄기·수신자·서식만 바꾼다. 주기는 못 바꾼다 — 바꾸면 `last_period_end`
 * 가 다른 주기의 경계라 중복이나 공백이 생긴다. 주기를 바꾸려면 끄고 새로 만든다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner, requirePlan } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { checkRecipients } from "@/lib/mrv/mailer"

const COLUMNS =
  "id, site_id, org_id, cadence, enabled, recipients, template_id, last_period_end, " +
  "last_run_at, last_status, last_error, created_at"
const CADENCES = ["weekly", "monthly"] as const

async function assertTemplate(auth: Awaited<ReturnType<typeof authorizeMrv>>, templateId: string) {
  const { data, error } = await auth.db
    .from(T.reportTemplates)
    .select("id, org_id")
    .eq("id", templateId)
    .maybeSingle()
  if (error) throw error
  const row = data as { id: string; org_id: string } | null
  if (!row) throw new HttpError(404, `report template not found: ${templateId}`)
  if (row.org_id !== auth.orgId) throw new HttpError(403, "template does not belong to your organization")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const rows = await fetchAll((f, t) =>
      auth.db.from(T.reportSchedules).select(COLUMNS).eq("site_id", siteId).order("cadence").range(f, t),
    )
    return NextResponse.json({ items: rows, total: rows.length })
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    // 리포트 생성 자체가 PRO 이상이므로 일정도 같다.
    const auth = requireOwner(requirePlan(await authorizeMrv(req), "PRO", "ENTERPRISE"))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      cadence?: string
      recipients?: unknown
      template_id?: string | null
      enabled?: boolean
    }
    if (!body.cadence || !(CADENCES as readonly string[]).includes(body.cadence)) {
      throw new HttpError(422, "cadence 는 weekly 또는 monthly 여야 합니다.")
    }
    const rec = checkRecipients(body.recipients)
    if (!rec.ok) throw new HttpError(422, rec.detail)
    if (body.template_id) {
      // 서식은 ENTERPRISE 기능 — 일정에 붙이는 것도 같다.
      requirePlan(auth, "ENTERPRISE")
      await assertTemplate(auth, body.template_id)
    }

    const row = {
      id: newId("rsch"),
      site_id: siteId,
      org_id: auth.orgId,
      cadence: body.cadence,
      enabled: body.enabled ?? true,
      recipients: rec.recipients,
      template_id: body.template_id ?? null,
      created_by: auth.userId,
    }
    const { error } = await auth.db.from(T.reportSchedules).insert(row)
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new HttpError(409, `이 사이트에는 이미 ${body.cadence} 일정이 있습니다. 끄거나 수신자를 바꾸려면 PATCH 를 쓰십시오.`)
      }
      throw error
    }

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "report_schedules",
      entityId: row.id,
      action: "create",
      diff: { before: null, after: { cadence: row.cadence, enabled: row.enabled, recipients: row.recipients, template_id: row.template_id } },
      note: "리포트 자동 생성 일정 — 메일이 조직 바깥으로 나갑니다.",
    })
    return NextResponse.json(row, { status: 201 })
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireOwner(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      id?: string
      enabled?: boolean
      recipients?: unknown
      template_id?: string | null
    }
    if (!body.id) throw new HttpError(422, "id 가 필요합니다.")
    const { data, error: readErr } = await auth.db
      .from(T.reportSchedules)
      .select(COLUMNS)
      .eq("id", body.id)
      .maybeSingle()
    if (readErr) throw readErr
    const before = data as { id: string; site_id: string; org_id: string; enabled: boolean; recipients: string[]; template_id: string | null } | null
    if (!before) throw new HttpError(404, `schedule not found: ${body.id}`)
    if (before.org_id !== auth.orgId) throw new HttpError(403, "schedule does not belong to your organization")
    if (before.site_id !== siteId) throw new HttpError(404, "schedule does not belong to this site")

    const patch: Record<string, unknown> = {}
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled)
    if (body.recipients !== undefined) {
      const rec = checkRecipients(body.recipients)
      if (!rec.ok) throw new HttpError(422, rec.detail)
      patch.recipients = rec.recipients
    }
    if (body.template_id !== undefined) {
      if (body.template_id) {
        requirePlan(auth, "ENTERPRISE")
        await assertTemplate(auth, body.template_id)
      }
      patch.template_id = body.template_id ?? null
    }
    if (Object.keys(patch).length === 0) throw new HttpError(422, "바꿀 내용이 없습니다.")

    const { error } = await auth.db.from(T.reportSchedules).update(patch).eq("id", body.id)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "report_schedules",
      entityId: body.id,
      action: "update",
      diff: {
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: patch,
      },
    })
    return NextResponse.json({ ...before, ...patch })
  })
}
