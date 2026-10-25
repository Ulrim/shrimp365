/**
 * PATCH /api/mrv/sites/{siteId}/tanks/{tankId} — **DO 목표대역 설정·해제.**
 * 원본: 없다(`../route.ts` 머리말 참고).
 *
 * 온보딩으로 이미 만들어진 수조가 대부분이므로, 실제로 많이 쓰이는 창구는 등록이 아니라
 * **이 수정**이다. 바꿀 수 있는 것은 이름 · 용량 · DO 목표대역 셋뿐이다. `site_id` ·
 * `org_id` 는 받지 않는다 — 수조를 다른 사이트로 옮기면 그 수조에 매달린 계측값·배치의
 * 소속이 소급해서 바뀌고, 그것은 수정이 아니라 과거 KPI 의 근거 변조다.
 *
 * 부분 수정이다. **보낸 칸만 바꾼다.** DO 목표대역은 하한·상한이 한 쌍이므로 둘 중
 * 하나라도 보내면 쌍으로 해석하고(`parseDoBand`), 둘 다 빈 값이면 **대역 해제**다 —
 * 해제하면 그 수조는 OEI 기준에서 빠진다. 값이 지표를 움직이므로 감사 로그에 before/after
 * 를 남긴다(AGENTS.md 절대규칙 9).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { resolveSiteForOrg, resolveTankForSite } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { parseDoBand } from "@/lib/mrv/do-band"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string; tankId: string }> },
) {
  return handleRoute(async () => {
    const { siteId, tankId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)
    const before = await resolveTankForSite(auth.db, tankId, siteId, auth.orgId)

    const body = (await req.json()) as {
      name?: string
      volume_m3?: number | string | null
      target_do_min?: number | string | null
      target_do_max?: number | string | null
    }

    const patch: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (name === "") throw new HttpError(422, "수조 이름을 비울 수 없습니다.")
      patch.name = name
    }

    if (body.volume_m3 !== undefined) {
      if (body.volume_m3 === null || body.volume_m3 === "") {
        patch.volume_m3 = null
      } else {
        const v = Number(body.volume_m3)
        if (!Number.isFinite(v) || v <= 0) {
          throw new HttpError(422, "수조 용량(m³)은 0보다 큰 숫자여야 합니다.")
        }
        patch.volume_m3 = v
      }
    }

    // 하한·상한은 한 쌍이다. 한쪽만 와도 쌍으로 해석해야 "상한만 바꿨더니 하한이 옛
    // 값으로 남아 대역이 뒤집히는" 일이 없다.
    if (body.target_do_min !== undefined || body.target_do_max !== undefined) {
      const band = parseDoBand({
        target_do_min:
          body.target_do_min !== undefined ? body.target_do_min : before.target_do_min,
        target_do_max:
          body.target_do_max !== undefined ? body.target_do_max : before.target_do_max,
      })
      if (!band.ok) throw new HttpError(422, band.detail)
      patch.target_do_min = band.band?.target_do_min ?? null
      patch.target_do_max = band.band?.target_do_max ?? null
    }

    if (Object.keys(patch).length === 0) {
      throw new HttpError(422, "바꿀 내용이 없습니다.")
    }

    const { error } = await auth.db.from(T.tanks).update(patch).eq("id", tankId)
    if (error) throw error

    const after = { ...before, ...patch }

    // 바뀐 칸만 적는다 — 안 바뀐 칸까지 적으면 나중에 로그를 읽을 때 무엇이 움직였는지
    // 보이지 않는다.
    const changed = (key: "name" | "volume_m3" | "target_do_min" | "target_do_max") =>
      key in patch && patch[key] !== before[key]
    const keys = (["name", "volume_m3", "target_do_min", "target_do_max"] as const).filter(
      changed,
    )
    if (keys.length > 0) {
      await recordAudit(auth.db, {
        orgId: auth.orgId,
        actorId: auth.userId,
        entity: "tanks",
        entityId: tankId,
        action: "update",
        diff: {
          before: Object.fromEntries(keys.map((k) => [k, before[k]])),
          after: Object.fromEntries(keys.map((k) => [k, after[k as keyof typeof after]])),
        },
        note:
          keys.includes("target_do_min") || keys.includes("target_do_max")
            ? "DO 목표대역 변경 — OEI(산소효율지수)의 산출 조건이 바뀝니다."
            : null,
      })
    }

    return NextResponse.json(after)
  })
}
