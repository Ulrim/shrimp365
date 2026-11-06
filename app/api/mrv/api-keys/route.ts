/**
 * GET /api/mrv/api-keys — 발급된 장비 수집 키 목록.
 *
 * 원본에는 이 창구가 없다. 키를 발급하는 경로는 있었고(페어링 승인,
 * POST /api/mrv/pair/claim) 인증 경로도 `revoked` 를 보지만, **발급된 키를 보거나
 * 끊는 경로가 없었다.** 기계실 터치스크린을 분실·교체·반납해도 끊을 방법이 DB 직접
 * 수정뿐이었다는 뜻이다.
 *
 * ★ 원문 키도 해시도 응답에 담지 않는다. 이 목록은 "어떤 장비가 이 사이트에 붙어
 *   있는가" 를 보는 창구이고, 키 자체는 그 장비만 들고 있어야 한다 — 목록을 열 수 있는
 *   사람이 장비가 될 수 있게 되면 폐기 기능을 만든 이유가 사라진다.
 *   (`mrv_api_keys` 에는 애초에 해시만 저장된다. 그 해시도 내보내지 않는다 —
 *   사전 공격의 재료이고, 화면이 쓸 일이 없다.)
 *
 * 역할 제한을 두지 않는다. 읽기이고, viewer 가 "이 사이트에 어떤 장비가 붙어 있나" 를
 * 보는 것은 막을 이유가 없다 — 감사 로그 조회와 같은 판단이다. 끊는 쪽(POST .../revoke)
 * 이 requireWriter 다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute, requiredParam } from "@/lib/mrv/http"
import { T, fetchAll } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { API_KEY_COLUMNS, type ApiKeyRow } from "@/lib/mrv/api-keys"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    const url = new URL(req.url)

    // 사이트를 반드시 받는다. org 전체를 한 번에 내주면 설정 화면이 "지금 고른 사이트"
    // 와 다른 장비까지 보여 주게 되고, 끊을 대상을 잘못 고르기 쉽다.
    const siteId = requiredParam(url, "site_id")
    const site = await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    // 폐기된 키도 뺀 채 보여 주지 않는다 — 그 장비가 넣은 계측값이 기준선의 근거로
    // 남아 있으므로, 목록에서 사라지면 그 데이터의 출처를 되짚을 수 없다.
    const rows = await fetchAll<ApiKeyRow>((f, t) =>
      auth.db
        .from(T.apiKeys)
        .select(API_KEY_COLUMNS)
        .eq("org_id", auth.orgId)
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .range(f, t),
    )

    return NextResponse.json({ items: rows, total: rows.length })
  })
}
