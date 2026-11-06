/**
 * GET /api/mrv/auth/me — 현재 인증 컨텍스트 + 구독 플랜.
 * 원본: apps/api/app/routers/auth.py
 *
 * 화면이 로그인 직후 PRO/ENTERPRISE 메뉴를 미리 감추려면 plan 을 알아야 한다. 그 값을
 * 토큰에 굽지 않고 매 요청 조회하는 이유는, 플랜이 바뀌었을 때(예: 다운그레이드) 재로그인
 * 없이 즉시 반영되기 때문이다 — 토큰에 구우면 만료 전까지 낡은 플랜이 노출된다.
 *
 * 이 응답의 403/409 는 화면이 "이용 신청이 필요합니다" 안내로 바꿔 다는 신호이기도 하다
 * (인증은 됐으나 초대가 없는 계정 / 여러 조직에 초대돼 자동 연결이 중단된 계정).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    return NextResponse.json({
      org_id: auth.orgId,
      role: auth.role,
      user_id: auth.userId,
      plan: auth.plan,
    })
  })
}
