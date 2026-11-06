/**
 * GET/POST /api/mrv/sites/{siteId}/tanks — **수조 조회·등록.**
 * 원본: 없다. 원본 엔드포인트 41개에 `mrv_tanks` 쓰기 창구가 없다.
 *
 * ── 왜 이 창구가 필요한가 ──────────────────────────────────────────────────
 * 수조의 `target_do_min` / `target_do_max` 가 **OEI(산소효율지수)의 유일한 입력 조건**이다.
 * 둘이 없으면 OEI 는 그 기간의 데이터와 무관하게 애초에 산출 대상이 아니고
 * (`lib/mrv/kpi-service.ts` 의 band 선택), 「산출 불가 사유」가 이렇게 적혔다:
 *
 *     "이 플랫폼에는 아직 그 설정 화면이 없으므로, 관리자에게 수조(mrv_tanks)의
 *      target_do_min · target_do_max 등록을 요청하십시오."
 *
 * 생산량 창구(`../harvests/route.ts`)가 EI 의 분모에 대해 메운 것과 **같은 구멍**이다.
 * 증빙 플랫폼의 지표가 제품 안에서 닫히지 않고 사람의 DB 직접 조작을 전제하고 있었다.
 *
 * ── 대역을 바꾸면 지표가 움직인다 ───────────────────────────────────────────
 * 대역을 넓히면 유지율이 올라가 OEI 가 좋아진다. 그래서 이 창구는 설정 변경이지
 * 기록 입력이 아니며, AGENTS.md 절대규칙 9 에 따라 **before/after diff 를 감사 로그에
 * 남긴다.** 값 검사는 `lib/mrv/do-band.ts` 한 곳에 있다.
 *
 * ── 잠긴 기준선은 건드리지 않는다 ───────────────────────────────────────────
 * 잠긴 기준선은 그때의 KPI 를 **스냅샷으로 얼려서** 들고 있으므로(`mrv_kpi_snapshots`),
 * 지금 대역을 바꿔도 기준선 숫자는 변하지 않는다. 다만 기준선 당시 OEI 가 null 이었다면
 * 이후 전·후 비교에 OEI 의 원점이 없다 — 그 사실은 화면이 적는다(설정 화면의 안내문).
 * 여기서 잠금을 이유로 막지는 않는다. 대역을 처음 등록하는 시점이 잠금 뒤일 수 있고,
 * 그때 막으면 OEI 를 영영 못 쓰게 된다.
 *
 * 수조 **삭제**는 두지 않는다. 계측기·배치·측정값이 전부 수조를 참조하고
 * (`on delete cascade`), 지우면 과거 KPI 의 근거가 통째로 사라진다. 계측기 창구가
 * 수정·삭제를 두지 않은 것과 같은 판단이다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { parseDoBand } from "@/lib/mrv/do-band"

const TANK_COLUMNS = "id, site_id, org_id, name, volume_m3, target_do_min, target_do_max"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = await authorizeMrv(req)
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    // id 오름차순 — `kpi-service` 가 OEI 기준 수조를 고르는 순서와 같다. 화면이 "맨 위
    // 대역이 OEI 에 쓰인다" 고 적을 수 있으려면 같은 순서로 보여야 한다.
    const rows = await fetchAll((f, t) =>
      auth.db
        .from(T.tanks)
        .select(TANK_COLUMNS)
        .eq("site_id", siteId)
        .order("id", { ascending: true })
        .range(f, t),
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
    const auth = requireWriter(await authorizeMrv(req))
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      name?: string
      volume_m3?: number | string | null
      target_do_min?: number | string | null
      target_do_max?: number | string | null
    }

    const name = (body.name ?? "").trim()
    if (name === "") throw new HttpError(422, "수조 이름을 적어야 합니다.")

    let volume: number | null = null
    if (body.volume_m3 !== undefined && body.volume_m3 !== null && body.volume_m3 !== "") {
      volume = Number(body.volume_m3)
      if (!Number.isFinite(volume) || volume <= 0) {
        throw new HttpError(422, "수조 용량(m³)은 0보다 큰 숫자여야 합니다.")
      }
    }

    const band = parseDoBand(body)
    if (!band.ok) throw new HttpError(422, band.detail)

    const row = {
      id: newId("tank"),
      site_id: siteId,
      org_id: auth.orgId,
      name,
      volume_m3: volume,
      target_do_min: band.band?.target_do_min ?? null,
      target_do_max: band.band?.target_do_max ?? null,
    }
    const { error } = await auth.db.from(T.tanks).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "tanks",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          name: row.name,
          volume_m3: row.volume_m3,
          target_do_min: row.target_do_min,
          target_do_max: row.target_do_max,
        },
      },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
