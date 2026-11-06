/**
 * GET/POST /api/mrv/sites — org 소속 사이트 목록 · 사이트 등록.
 * 원본: apps/api/app/routers/sites.py::list_sites (GET 만 있다. POST 는 원본에 없다.)
 *
 * 조회에 플랜 게이팅은 없다 — 단일 사이트 조직도 자기 사이트 목록은 볼 권리가 있고,
 * 온보딩 화면도 이 목록이 있어야 시작된다.
 *
 * ── POST 를 더하는 이유 ─────────────────────────────────────────────────────
 * 사이트를 만드는 길이 어디에도 없었다. `mrv_sites` 에 쓰는 코드가 이 저장소 전체에
 * 한 줄도 없어서, **새 고객을 받으려면 사람이 SQL 을 직접 쳐야 했다.** 설정 화면도
 * 그 사실을 그대로 적고 있었다 — "등록된 사이트가 없어 계측기를 넣을 수 없습니다.
 * 관리자에게 사이트 등록을 요청해 주세요."
 *
 * 생산량·입식·DO 목표대역 창구와 같은 종류의 구멍이다. 제품이 자기 데이터를 스스로
 * 만들지 못하고 DB 조작을 전제하는 자리.
 *
 * ── 누가 만들 수 있나: owner 단독 ──────────────────────────────────────────
 * `requireWriter`(owner/operator)가 아니라 `requireOwner` 다. 사이트는 요금이 매겨지는
 * 단위이고, 늘리는 것은 운영 작업이 아니라 계약에 관한 결정이다. 조직 구성원 초대를
 * owner 한정으로 둔 것과 같은 기준이다.
 *
 * ── 두 번째 사이트부터 ENTERPRISE ───────────────────────────────────────────
 * 멀티사이트는 ENTERPRISE 기능이다(MASTER 2장: "ENTERPRISE … 멀티사이트로 확장",
 * 화면 12번 멀티사이트 관리 · `/sites/kpi-benchmark` 도 ENTERPRISE 게이트). 그래서
 * **첫 사이트는 플랜과 무관하게** 만들 수 있고(START 고객도 자기 양식장 하나는 등록해야
 * 제품을 쓸 수 있다), 두 번째부터 ENTERPRISE 를 요구한다. 이 선을 긋지 않으면 START
 * 요금으로 사이트를 여러 개 두게 되어 플랜 경계가 무의미해진다.
 *
 * ── 삭제·수정은 두지 않는다 ────────────────────────────────────────────────
 * 사이트를 지우면 `on delete cascade` 로 수조·계측기·측정값·배치·리포트가 **전부** 함께
 * 사라진다. 이미 발행한 MRV 리포트의 근거가 통째로 없어지는 일이라 화면에 둘 수 없다.
 * 이름을 고치는 길도 지금은 두지 않는다 — 리포트가 발행 시점의 사이트 이름을 인쇄하므로
 * 개명은 과거 발행물과의 대조를 어긋나게 만든다. 필요해지면 그때 별도로 다룬다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    const rows = await fetchAll<{
      id: string
      name: string
      region: string | null
      ras_type: string | null
    }>((f, t) =>
      auth.db
        .from(T.sites)
        .select("id, name, region, ras_type")
        .eq("org_id", auth.orgId)
        .order("id", { ascending: true })
        .range(f, t),
    )
    return NextResponse.json({ items: rows, total: rows.length })
  })
}

/** 이름 길이 상한. 리포트 표지와 사이트 선택 드롭다운에 그대로 들어간다. */
const SITE_NAME_MAX = 100
const SITE_FIELD_MAX = 60

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(await authorizeMrv(req))

    const body = (await req.json()) as {
      name?: string
      region?: string | null
      ras_type?: string | null
    }

    const name = (body.name ?? "").trim()
    if (name === "") throw new HttpError(422, "사이트 이름을 적어야 합니다.")
    if (name.length > SITE_NAME_MAX) {
      throw new HttpError(422, `사이트 이름은 ${SITE_NAME_MAX}자까지 적을 수 있습니다.`)
    }

    const optional = (raw: string | null | undefined, label: string): string | null => {
      const v = (raw ?? "").trim()
      if (v === "") return null
      if (v.length > SITE_FIELD_MAX) {
        throw new HttpError(422, `${label}은(는) ${SITE_FIELD_MAX}자까지 적을 수 있습니다.`)
      }
      return v
    }

    // 플랜 경계는 **지금 몇 개 있는지**로 판정한다. 플랜을 내렸다고 이미 있는 사이트를
    // 뺏지는 않으므로(그러면 과거 리포트의 근거가 사라진다), ENTERPRISE 가 아닌 조직이
    // 사이트를 이미 여럿 들고 있을 수 있다. 그때도 **더 늘리는 것만** 막는다.
    const existing = await fetchAll<{ id: string }>((f, t) =>
      auth.db.from(T.sites).select("id").eq("org_id", auth.orgId).range(f, t),
    )
    if (existing.length >= 1 && auth.plan !== "ENTERPRISE") {
      throw new HttpError(
        403,
        `사이트를 둘 이상 두려면 ENTERPRISE 플랜이 필요합니다(현재 ${auth.plan} · ` +
          `등록된 사이트 ${existing.length}개). 멀티사이트 관리·사이트 횡단 벤치마크가 ` +
          "ENTERPRISE 기능입니다.",
      )
    }

    const row = {
      id: newId("site"),
      org_id: auth.orgId,
      name,
      region: optional(body.region, "지역"),
      ras_type: optional(body.ras_type, "RAS 방식"),
      // `alert_enabled_types` 는 보내지 않는다 — DB 기본값(세 종류 전부 켬)이 들어간다.
      // 여기서 같은 값을 다시 적으면 기본값이 두 곳에 생겨 한쪽만 바뀌는 날이 온다.
    }
    const { error } = await auth.db.from(T.sites).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "sites",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: { name: row.name, region: row.region, ras_type: row.ras_type },
      },
      note: `등록 시점 플랜 ${auth.plan} · 이 조직의 ${existing.length + 1}번째 사이트`,
    })

    return NextResponse.json(row, { status: 201 })
  })
}
