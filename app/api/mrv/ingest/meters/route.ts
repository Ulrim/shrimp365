/**
 * GET /api/mrv/ingest/meters — 현장 장비가 자기 사이트의 전력 계측기를 조회한다.
 *
 * **왜 읽기 창구를 여는가.** 계측값을 보내려면 `meter_id` 를 알아야 한다. 그 목록을 장비
 * 설정 파일에 손으로 적어 두면, 운영자가 설정 화면에서 계측기를 하나 더 등록한 날 장비는
 * 그것을 모르고, 반대로 지워진 계측기 id 로 계속 보내면 그 건들이 조용히 거부된다.
 * **보낼 수 없는 값을 알려 주지 않으면 장비는 실패를 성공으로 읽는다.**
 *
 * **왜 이것만 여는가.** 장비 키로 열리는 읽기는 이 한 창구뿐이고, 돌려주는 것은
 * **그 사이트의 전력 계측기 식별·표시 정보**다. EI·Scope2·기준선 같은 **탄소 산출값은
 * 한 줄도 돌려주지 않는다.** 장비 키는 기계실 터치스크린에 들어 있어 사람 세션보다
 * 노출 위험이 크다 — 그 키가 새면 "계측기 목록을 알게 되는 것" 까지가 피해 범위여야 한다.
 *
 * 전력 타입만 준다. 장비는 전력 수기 입력 단말이고, DO·수온 계측기를 보여 주면 작업자가
 * 거기에 kWh 를 적을 수 있다 — 그 값은 EI 에 들어가지 않고 수질 시계열을 망친다.
 */

import { NextRequest, NextResponse } from "next/server"
import { handleRoute } from "@/lib/mrv/http"
import { authorizeDevice } from "@/lib/mrv/device-auth"
import { T, fetchAll } from "@/lib/mrv/db"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const device = await authorizeDevice(req)

    // 테넌시의 진실은 키의 (org_id, site_id) 다. 쿼리로 사이트를 바꿀 수 없다.
    const rows = await fetchAll<{
      id: string
      label: string | null
      unit: string
      is_aeration: boolean
    }>((f, t) =>
      device.db
        .from(T.meters)
        .select("id, label, unit, is_aeration")
        .eq("org_id", device.orgId)
        .eq("site_id", device.siteId)
        .eq("type", "power")
        .order("id", { ascending: true })
        .range(f, t),
    )

    return NextResponse.json({
      site_id: device.siteId,
      items: rows.map((m) => ({
        id: m.id,
        label: m.label,
        unit: m.unit,
        // 폭기 여부를 함께 준다. 폭기 EI 가 이 플래그로 갈리므로, 장비 화면에서
        // 어느 계측기가 폭기인지 보이지 않으면 총전력계에 폭기 전력을 적어도
        // 아무도 알아채지 못한다.
        is_aeration: m.is_aeration,
      })),
    })
  })
}
