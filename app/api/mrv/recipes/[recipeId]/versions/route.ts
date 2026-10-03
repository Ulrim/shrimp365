/**
 * POST /api/mrv/recipes/{recipeId}/versions — 레시피 수동 버전 추가.
 * 원본: apps/api/app/routers/recommendations.py::create_recipe_version
 *
 * 운영자가 엔진 추천과 다른 값을 쓰기로 정했을 때 그 결정을 이력으로 남기는 자리다.
 * 그래서 rationale 이 필수다 — 근거 없는 버전은 나중에 아무도 해석할 수 없다.
 * 권한: PRO 이상 + owner/operator.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requirePlan, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ recipeId: string }> },
) {
  return handleRoute(async () => {
    const { recipeId } = await params
    const auth = requirePlan(requireWriter(await authorizeMrv(req)), "PRO", "ENTERPRISE")

    const body = (await req.json()) as {
      params?: Record<string, unknown>
      rationale?: string
    }
    if (!body.params || typeof body.params !== "object") {
      throw new HttpError(422, "params object is required")
    }
    if (!body.rationale) throw new HttpError(422, "rationale is required")

    const { data, error } = await auth.db
      .from(T.recipes)
      .select("id, org_id, current_version")
      .eq("id", recipeId)
      .maybeSingle()
    if (error) throw error
    const recipe = data as { id: string; org_id: string; current_version: number } | null
    if (!recipe) throw new HttpError(404, `recipe not found: ${recipeId}`)
    if (recipe.org_id !== auth.orgId) {
      throw new HttpError(403, "recipe does not belong to your organization")
    }

    const beforeVersion = recipe.current_version
    const newVersion = beforeVersion + 1
    const row = {
      id: newId("recipever"),
      recipe_id: recipe.id,
      org_id: recipe.org_id, // 항상 부모 recipe 와 동일(RLS 앵커).
      version: newVersion,
      params_json: body.params,
      rationale: body.rationale,
      created_by: auth.userId,
      created_at: new Date().toISOString(),
    }
    const { error: insertError } = await auth.db.from(T.recipeVersions).insert(row)
    if (insertError) throw insertError

    const { error: updateError } = await auth.db
      .from(T.recipes)
      .update({ current_version: newVersion })
      .eq("id", recipe.id)
    if (updateError) throw updateError

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "recipes",
      entityId: recipe.id,
      action: "add_version",
      diff: {
        before: { current_version: beforeVersion },
        after: {
          current_version: newVersion,
          params: body.params,
          rationale: body.rationale,
        },
      },
    })

    return NextResponse.json(
      {
        id: row.id,
        recipe_id: row.recipe_id,
        version: row.version,
        params: row.params_json,
        rationale: row.rationale,
        created_by: row.created_by,
        created_at: row.created_at,
      },
      { status: 201 },
    )
  })
}
