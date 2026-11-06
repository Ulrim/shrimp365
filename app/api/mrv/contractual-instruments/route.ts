/**
 * GET/POST /api/mrv/contractual-instruments — Scope 2 market-based 의 계약 전력 증서.
 * 원본: 없다.
 *
 * REC(재생에너지 공급인증서) · PPA(전력구매계약) · 녹색프리미엄을 등록한다. 등록된 증서는
 * MRV 리포트가 발행될 때 그 기간과 겹치는 만큼 적용되어 market-based 배출량을 만든다
 * (`lib/mrv/scope2-market.ts`). location-based 는 그대로 함께 보고된다.
 *
 * ── 조직 범위다 ────────────────────────────────────────────────────────────
 * 증서는 보통 법인이 산다. `site_id` 는 선택이고, 비우면 조직 전체 계약이다. 사이트별
 * 계약이면 적는다 — 적지 않은 증서가 어느 사이트 리포트에나 쓰이면 같은 증서가 여러
 * 사이트에서 중복 계상된다. **이 중복을 막는 책임은 사람에게 있다**(사이트별로 적거나,
 * 조직 전체 계약을 한 사이트에서만 쓰도록 운영하거나). 지금 스키마는 조직 전체 증서의
 * 사이트 간 배분을 받지 않고, 받지 않는 것을 추정으로 메우지 않는다 — 리포트가 "이 증서는
 * 조직 전체 계약" 이라고 적어 사람이 볼 수 있게 한다.
 *
 * ── 권한: owner 전용 ───────────────────────────────────────────────────────
 * 배출계수 등록과 같은 기준이다. 증서는 배출량을 직접 낮추는 값이고 계약 문서를 근거로
 * 하므로, 운영 작업이 아니다.
 *
 * ── 수정·삭제는 두지 않는다 ────────────────────────────────────────────────
 * 이미 발행된 리포트가 그 증서로 계산됐다. 잘못 넣었으면 기간이 지난 뒤 새로 넣는 것이
 * 아니라, 리포트를 다시 발행해야 한다(리포트도 append-only 다). 배출계수가 '새 version
 * 추가' 만 두는 것과 같은 태도다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"

const KINDS = ["rec", "ppa", "green_premium"] as const
const COLUMNS =
  "id, org_id, site_id, kind, mwh, factor_tco2e_per_mwh, period_start, period_end, " +
  "document_name, certificate_id, source_url, note, created_at"

/**
 * 계통 계수보다 높은 계약 계수는 받지 않는다.
 *
 * 계약 전력이 계통 평균보다 더럽다면 그 계약을 Scope 2 감축 근거로 쓸 수 없다 —
 * market-based 가 location-based 보다 나쁘게 나오고, 그것은 보통 입력 실수다.
 * (정말 그런 계약이라면 note 에 적고 사람이 판단할 일이지 자동 산입할 일이 아니다.)
 */
const MAX_PLAUSIBLE_FACTOR = 1.0

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    const url = new URL(req.url)
    const siteId = url.searchParams.get("site_id")

    const rows = await fetchAll((f, t) => {
      // 사이트를 지정하면 **그 사이트 증서 + 조직 전체 증서** 둘 다 준다 — 리포트가
      // 실제로 적용하는 집합과 같아야 화면이 거짓말을 하지 않는다.
      const q = auth.db.from(T.contractualInstruments).select(COLUMNS).eq("org_id", auth.orgId)
      return (siteId ? q.or(`site_id.eq.${siteId},site_id.is.null`) : q)
        .order("period_start", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
    })
    return NextResponse.json({ items: rows, total: rows.length })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(await authorizeMrv(req))

    const body = (await req.json()) as {
      site_id?: string | null
      kind?: string
      mwh?: number | string
      factor_tco2e_per_mwh?: number | string
      period_start?: string
      period_end?: string
      document_name?: string | null
      certificate_id?: string | null
      source_url?: string | null
      note?: string | null
    }

    if (!body.kind || !(KINDS as readonly string[]).includes(body.kind)) {
      throw new HttpError(422, `kind 는 ${KINDS.join(" / ")} 중 하나여야 합니다.`)
    }
    if (body.site_id) {
      await resolveSiteForOrg(auth.db, body.site_id, auth.orgId)
    }

    const mwh = Number(body.mwh)
    if (!Number.isFinite(mwh) || mwh <= 0) {
      throw new HttpError(422, "전력량(MWh)은 0보다 큰 숫자여야 합니다.")
    }
    const factor = Number(body.factor_tco2e_per_mwh)
    if (!Number.isFinite(factor) || factor < 0) {
      throw new HttpError(
        422,
        "배출계수(tCO2e/MWh)는 0 이상의 숫자여야 합니다. 재생에너지 증서는 보통 0 이지만 " +
          "계약마다 다르므로 기본값으로 넣지 않습니다 — 계약서의 값을 적으십시오.",
      )
    }
    if (factor > MAX_PLAUSIBLE_FACTOR) {
      throw new HttpError(
        422,
        `배출계수 ${factor} tCO2e/MWh 는 계통 평균보다 높습니다. 그런 계약은 Scope 2 감축 ` +
          "근거가 되지 않습니다 — 단위를 확인하십시오(kgCO2e/kWh 와 tCO2e/MWh 는 같은 " +
          "수이고, gCO2e/kWh 라면 1000 으로 나눠야 합니다).",
      )
    }

    if (!body.period_start || !body.period_end) {
      throw new HttpError(422, "증서 유효기간(period_start · period_end)을 적어야 합니다.")
    }
    const from = parseInstant(body.period_start, "period_start")
    const to = parseInstant(body.period_end, "period_end")
    if (from.getTime() >= to.getTime()) {
      throw new HttpError(422, "증서 유효기간의 시작이 끝보다 앞서야 합니다.")
    }

    const trimmed = (v: string | null | undefined) => {
      const s = (v ?? "").trim()
      return s === "" ? null : s
    }

    const row = {
      id: newId("ci"),
      org_id: auth.orgId,
      site_id: body.site_id ?? null,
      kind: body.kind,
      mwh,
      factor_tco2e_per_mwh: factor,
      period_start: from.toISOString(),
      period_end: to.toISOString(),
      document_name: trimmed(body.document_name),
      certificate_id: trimmed(body.certificate_id),
      source_url: trimmed(body.source_url),
      note: trimmed(body.note),
      created_by: auth.userId,
    }
    const { error } = await auth.db.from(T.contractualInstruments).insert(row)
    if (error) throw error

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "contractual_instruments",
      entityId: row.id,
      action: "create",
      diff: { before: null, after: { ...row, created_by: undefined } },
      note:
        "Scope 2 market-based 계약 전력 증서 등록 — 이 기간과 겹치는 리포트의 " +
        "market-based 배출량이 달라집니다.",
    })

    return NextResponse.json(row, { status: 201 })
  })
}
