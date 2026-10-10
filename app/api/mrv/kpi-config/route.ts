/**
 * KPI 산식 설정 조회 — 읽기 전용.
 *
 * 원본에는 이 창구가 없다(원본 엔드포인트 41개에 kpi_config 조회/수정이 없었다).
 * 설정 화면(MASTER 4장 화면 #15)이 「KPI 산식 파라미터」를 보여 주려면 지금 어떤 값이
 * 판정에 쓰이는지 읽을 길이 필요해서 더했다.
 *
 * **쓰기 창구를 함께 두지 않은 것은 누락이 아니라 결정이다.** KPI 는 요청 시점의 활성
 * 설정(= `effective_from` 이 가장 늦은 행)으로 계산되므로, 파라미터를 바꾸면 **이미 지나간
 * 기간의 신호등 판정까지 소급해서 달라진다.** 임계값을 올려 어제의 '경고'를 오늘 '정상'으로
 * 만들 수 있다는 뜻이고, 그 결정은 과제 책임자의 승인 절차에 속한다. 추가한다면
 * 배출계수와 같은 append-only + 새 version + 감사 로그 형태여야 하며, 별건으로 다룬다.
 *
 * 이 테이블은 조직 전역 설정이다(`mrv_kpi_config` 에 org_id 가 없다). 그래서 응답을
 * org 로 좁히지 않는다 — `/emission-factors` 와 같은 자리다. 다만 로그인은 요구한다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { T, fetchAll } from "@/lib/mrv/db"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)

    // 활성 설정 판정 규칙을 kpi-service 와 똑같이 둔다 — effective_from 내림차순 첫 행.
    // 여기서 다르게 정렬하면 화면이 "판정에 쓰이는 값" 이라고 거짓말을 한다.
    const rows = await fetchAll<{
      id: string
      version: string
      params_json: Record<string, unknown>
      effective_from: string
    }>((f, t) =>
      auth.db
        .from(T.kpiConfig)
        .select("id, version, params_json, effective_from")
        .order("effective_from", { ascending: false })
        .range(f, t),
    )

    return NextResponse.json({
      items: rows,
      /** 지금 KPI 판정에 쓰이는 버전. 목록 첫 행과 같되, 화면이 다시 고르지 않게 못 박는다. */
      active_version: rows[0]?.version ?? null,
    })
  })
}
