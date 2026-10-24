/**
 * POST /api/mrv/sites/{siteId}/harvests — **생산량(생체량) 기록 수기 입력·기록지 업로드.**
 * 원본: 없다. 원본 엔드포인트 41개에 `mrv_harvest_logs` 쓰기 창구가 없다.
 *
 * ── 왜 이 창구가 필요한가 ──────────────────────────────────────────────────
 * `mrv_harvest_logs` 의 기간 양 끝 생체량 차이(Δbiomass)가 **EI · 폭기 EI · FCR · OEI 네
 * 지표 전부의 분모**다(lib/mrv/kpi-service.ts::pickBiomassBounds). 그런데 그 표에 쓰기
 * UI 도 API 도 없었다 — 기록지 CSV 는 급이·폐사·전력 3종뿐이었다. 즉 전력을 아무리 잘
 * 모아도 **분모가 비어 EI 가 영원히 null** 이었고, 「산출 불가 사유」 문장은 "이 플랫폼에는
 * 아직 생산량 입력 화면이 없으므로 관리자에게 요청하십시오" 라고 적을 수밖에 없었다
 * (lib/mrv/metric-unavailability.ts). 증빙 플랫폼의 핵심 지표가 제품 안에서 닫히지 않는
 * 상태였고, 이 창구가 그 구멍을 메운다.
 *
 * ── 규약은 급이·폐사 창구를 그대로 따른다 ──────────────────────────────────
 * `requireWriter`(viewer 403) → `resolveSiteForOrg` → `resolveBatchForSite` → insert →
 * `recordAudit`. 새 모양을 만들지 않는다. 가장 가까운 본보기는 전력 수기 입력
 * (`../readings/route.ts`)과 급이(`../feed-logs/route.ts`)다.
 *
 * ── 산정 근거를 **요구한다** ────────────────────────────────────────────────
 * `production_basis` 는 필수다. 받은 MRV 계산표의 생산량 3,500 kg 은 저울에 올린 출하량이
 * 아니라 **입식수 100,000미 × 최종평균 35g 으로 계산한 값**이고 생존율 보정도 하지
 * 않았다. 분모가 그런 값이면 EI 전체가 그 성질을 물려받는데, 그 구분을 적지 않아도
 * 저장되게 두면 사람이 넣는 생산량이 전부 '미기재' 로 쌓인다. 전력 수기 입력이
 * `measurement_basis` 를 필수로 둔 것과 **같은 판단**이다 — 값을 아는 사람이 화면 앞에
 * 있다.
 *
 * 그리고 `calculated` · `estimated` 에는 **근거 메모를 필수로** 요구한다. 근거 없는
 * '계산생체량' 딱지는 검산할 수 없는 주장이라 딱지가 없는 것보다 나쁘다(적어 두었으니
 * 확인됐다는 인상만 준다).
 *
 * ── 마이그레이션 전 폴백을 쓰지 않는다 (판단) ──────────────────────────────
 * 읽기 경로(KPI 조회)는 산정 근거 열이 없는 DB 에서 그 칸을 빼고 읽는다 — 메타데이터
 * 칸이 없는 것이 증빙 산출을 멈출 이유가 되어서는 안 되기 때문이다
 * (lib/mrv/production-basis-column.ts). **쓰기는 그 반대다.** 칸만 빼고 insert 하면 사람이
 * "계산생체량" 이라고 적어 넣은 사실이 조용히 사라진 채 저장되고, 되돌릴 방법이 없다.
 * 그래서 여기서는 실패하는 쪽이 옳고, 응답이 돌려야 할 SQL 을 가리킨다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { resolveBatchForSite, resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"
import { isMissingProductionBasisColumnError } from "@/lib/mrv/production-basis-column"
import {
  PRODUCTION_BASES,
  PRODUCTION_BASIS_NOTE_MAX,
  isProductionBasis,
  productionBasisNoteRequired,
} from "@/lib/mrv/production-basis"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))
    // 산출 비용을 쓰기 전에 소유권부터 본다(집 양식).
    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const body = (await req.json()) as {
      batch_id?: unknown
      ts?: unknown
      biomass_kg?: unknown
      production_basis?: unknown
      production_basis_note?: unknown
      survival_adjusted?: unknown
    }

    if (typeof body.batch_id !== "string" || !body.batch_id) {
      throw new HttpError(422, "batch_id is required")
    }
    if (typeof body.ts !== "string" || !body.ts) throw new HttpError(422, "ts is required")
    const ts = parseInstant(body.ts, "ts")

    /**
     * 생체량은 0 보다 커야 한다. 0 kg 을 허용하면 그 행이 분모의 한쪽 끝으로 뽑혀
     * Δbiomass 가 전체 현존량과 같아지고(= 기간에 없던 생산량이 산출된다), 음수는 생체량
     * 이라는 말 자체가 성립하지 않는다. 숫자 문자열("3500")도 받지 않는다 — 받아 주면
     * 빈 칸이 `Number("") = 0` 으로 둔갑한다(전력 창구와 같은 기준).
     */
    if (typeof body.biomass_kg !== "number" || !Number.isFinite(body.biomass_kg)) {
      throw new HttpError(422, "biomass_kg must be a finite number")
    }
    if (!(body.biomass_kg > 0)) {
      throw new HttpError(
        422,
        "biomass_kg must be greater than 0 — 0 kg 기록은 분모의 한쪽 끝으로 뽑혀 " +
          "기간에 없던 생산량을 만들어 냅니다.",
      )
    }

    if (!isProductionBasis(body.production_basis)) {
      throw new HttpError(
        422,
        `production_basis is required: one of ${PRODUCTION_BASES.join(", ")}. ` +
          "실측 출하·계측량과 입식수 × 평균체중으로 계산한 값은 같은 증빙이 아니고, " +
          "이 생체량이 EI·FCR 의 분모가 되므로 그 구분을 적어야 합니다.",
      )
    }
    const basis = body.production_basis

    if (
      body.production_basis_note !== undefined &&
      body.production_basis_note !== null &&
      typeof body.production_basis_note !== "string"
    ) {
      throw new HttpError(422, "production_basis_note must be a string")
    }
    const rawNote =
      typeof body.production_basis_note === "string" ? body.production_basis_note.trim() : ""
    if (rawNote.length > PRODUCTION_BASIS_NOTE_MAX) {
      throw new HttpError(
        422,
        `production_basis_note must be at most ${PRODUCTION_BASIS_NOTE_MAX} characters`,
      )
    }
    // 계산·어림이면 근거가 필수다. 자르지 않고 **거절한다** — 조용히 비워 저장하면
    // 검산할 수 없는 딱지만 남는다.
    if (productionBasisNoteRequired(basis) && rawNote === "") {
      throw new HttpError(
        422,
        "production_basis_note is required when production_basis is " +
          `'${basis}' — 무엇으로 계산했는지(예: 입식 100,000미 × 최종평균 35g, 생존율 ` +
          "보정 미적용) 적어야 합니다. 근거 없는 '계산생체량' 딱지는 검산할 수 없는 " +
          "주장이라 딱지가 없는 것보다 나쁩니다.",
      )
    }

    /**
     * 생존율 보정 적용 여부. **선택이지만 null 과 false 를 가른다** —
     * null 은 「미기재」이고 false 는 「보정하지 않았다」라는 참인 기록이다.
     * 계산·어림에서 이 칸이 비면 그 사실이 리포트에 미기재로 적힌다(막지는 않는다 —
     * 실측 출하량에는 이 칸이 뜻을 갖지 않으므로 필수로 둘 수 없다).
     */
    if (
      body.survival_adjusted !== undefined &&
      body.survival_adjusted !== null &&
      typeof body.survival_adjusted !== "boolean"
    ) {
      throw new HttpError(422, "survival_adjusted must be a boolean or null")
    }
    const survivalAdjusted =
      typeof body.survival_adjusted === "boolean" ? body.survival_adjusted : null

    const batch = await resolveBatchForSite(auth.db, body.batch_id, siteId, auth.orgId)

    const row = {
      id: newId("hrv"),
      batch_id: batch.id,
      site_id: siteId,
      org_id: auth.orgId,
      ts: ts.toISOString(),
      biomass_kg: body.biomass_kg,
      production_basis: basis,
      production_basis_note: rawNote === "" ? null : rawNote,
      survival_adjusted: survivalAdjusted,
    }
    const { error } = await auth.db.from(T.harvestLogs).insert(row)
    if (error) {
      // 산정 근거 열이 아직 없는 DB. 그 사실을 **숨기지 않고** 돌려야 할 SQL 을 가리킨다 —
      // "500 Internal Server Error" 로는 운영자가 무엇을 해야 하는지 알 수 없다.
      if (isMissingProductionBasisColumnError(error)) {
        throw new HttpError(
          503,
          "mrv_harvest_logs 에 산정 근거 열이 없어 저장하지 않았습니다. " +
            "supabase/migrations/mrv_harvest_logs_production_basis.sql 을 실행한 뒤 다시 " +
            "보내 주세요. 그 칸만 빼고 저장하지 않는 이유: 사람이 적어 넣은 산정 근거가 " +
            "조용히 사라진 채 생산량만 들어가면, 그 생체량이 실측인지 계산값인지 아는 " +
            "기록이 아무 데도 남지 않습니다.",
        )
      }
      throw error
    }

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "harvest_logs",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          batch_id: row.batch_id,
          site_id: row.site_id,
          ts: row.ts,
          biomass_kg: row.biomass_kg,
          // 산정 근거도 남긴다. 행에도 적히지만 **"누가 언제 그렇게 적어 넣었나"** 는 이
          // 로그에만 남고, 그것이 네 지표의 분모에 대한 가장 많이 되짚히는 사실이다.
          production_basis: row.production_basis,
          production_basis_note: row.production_basis_note,
          survival_adjusted: row.survival_adjusted,
        },
      },
    })

    return NextResponse.json(row, { status: 201 })
  })
}
