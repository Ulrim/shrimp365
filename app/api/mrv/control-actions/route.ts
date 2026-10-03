/**
 * 승인형 제어 액션 — 제안 등록 / 대기열 조회.
 * 원본: apps/api/app/routers/control_actions.py
 *
 * 이 흐름의 핵심은 "추천값을 사람이 승인하고, 실제 설비에 반영한 뒤, 그 사실과 결과를
 * 기록한다"는 것이다. 상태는 pending → approved → applied 로만 나아가며, 그 규칙은
 * API 검사와 DB CHECK 제약 두 곳에서 막힌다(DB 쪽이 최종 방어선이다).
 *
 * 권한: ENTERPRISE 플랜 + owner/operator. 조회는 viewer 도 가능하다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { CONTROL_ACTION_COLUMNS } from "@/lib/mrv/control-actions"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requirePlan(await authorizeMrv(req), "ENTERPRISE")
    const url = new URL(req.url)
    const siteId = url.searchParams.get("site_id")
    const statusFilter = url.searchParams.get("status")

    if (siteId) await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const rows = await fetchAll((f, t) => {
      let q = auth.db
        .from(T.controlActions)
        .select(CONTROL_ACTION_COLUMNS)
        .eq("org_id", auth.orgId)
      if (siteId) q = q.eq("site_id", siteId)
      if (statusFilter && statusFilter !== "all") q = q.eq("status", statusFilter)
      return q.order("created_at", { ascending: false }).range(f, t)
    })

    return NextResponse.json({ items: rows, total: rows.length })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requirePlan(requireWriter(await authorizeMrv(req)), "ENTERPRISE")

    const body = (await req.json()) as {
      tank_id?: string
      recipe_version_id?: string
    }
    if (!body.tank_id) throw new HttpError(422, "tank_id is required")
    if (!body.recipe_version_id) throw new HttpError(422, "recipe_version_id is required")

    const { data: tankData, error: tankError } = await auth.db
      .from(T.tanks)
      .select("id, site_id, org_id")
      .eq("id", body.tank_id)
      .maybeSingle()
    if (tankError) throw tankError
    const tank = tankData as { id: string; site_id: string; org_id: string } | null
    if (!tank) throw new HttpError(404, `tank not found: ${body.tank_id}`)
    if (tank.org_id !== auth.orgId) {
      throw new HttpError(403, "tank does not belong to your organization")
    }

    const { data: rvData, error: rvError } = await auth.db
      .from(T.recipeVersions)
      .select("id, recipe_id, org_id, params_json")
      .eq("id", body.recipe_version_id)
      .maybeSingle()
    if (rvError) throw rvError
    const recipeVersion = rvData as {
      id: string
      recipe_id: string
      org_id: string
      params_json: Record<string, unknown>
    } | null
    if (!recipeVersion) {
      throw new HttpError(404, `recipe version not found: ${body.recipe_version_id}`)
    }
    if (recipeVersion.org_id !== auth.orgId) {
      throw new HttpError(403, "recipe version does not belong to your organization")
    }

    const { data: recipeData, error: recipeError } = await auth.db
      .from(T.recipes)
      .select("id, site_id")
      .eq("id", recipeVersion.recipe_id)
      .maybeSingle()
    if (recipeError) throw recipeError
    const recipe = recipeData as { id: string; site_id: string } | null
    // 다른 사이트의 레시피를 이 수조에 걸면 엉뚱한 설비에 값이 적용된다.
    if (!recipe || recipe.site_id !== tank.site_id) {
      throw new HttpError(422, "tank and recipe_version belong to different sites")
    }

    const row = {
      id: newId("ca"),
      tank_id: tank.id,
      recipe_version_id: recipeVersion.id,
      site_id: tank.site_id,
      org_id: auth.orgId,
      // 제안 시점 파라미터를 그대로 박아 둔다 — 이후 레시피가 새 버전으로 바뀌어도
      // 이 액션이 무엇을 적용하려 했는지는 변하지 않아야 한다.
      recommended_json: { ...recipeVersion.params_json },
      status: "pending",
      approved_by: null,
      approved_at: null,
      applied_at: null,
      result_json: null,
      created_at: new Date().toISOString(),
    }
    const { error } = await auth.db.from(T.controlActions).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "control_actions",
      entityId: row.id,
      action: "propose",
      diff: {
        before: null,
        after: {
          tank_id: tank.id,
          recipe_version_id: recipeVersion.id,
          site_id: tank.site_id,
          status: "pending",
          recommended_json: row.recommended_json,
        },
      },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
