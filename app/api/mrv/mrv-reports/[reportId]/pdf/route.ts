/**
 * GET /api/mrv/mrv-reports/{reportId}/pdf — 리포트 인쇄용 문서.
 * 원본: apps/api/app/routers/mrv_reports.py::get_mrv_report_pdf
 *
 * 원본은 서버가 미리 구워 둔 PDF 파일을 스트리밍했다. 이식본은 요청 시 인쇄용 HTML 을
 * 그려 준다 — 이유는 lib/mrv/report-html.ts 상단에 적었다(영속 디스크 없음 + 한글 폰트
 * 임베드가 배포 환경마다 갈림). 브라우저 인쇄 → "PDF 로 저장" 으로 파일이 만들어진다.
 *
 * 문서 내용은 저장된 리포트 행에서만 만들어진다. 어떤 값도 여기서 다시 계산하지 않으므로
 * 몇 번을 열어도 같은 문서가 나온다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv } from "@/lib/mrv/auth"
import { handleRoute } from "@/lib/mrv/http"
import { loadReportForOrg } from "@/lib/mrv/mrv-report-loader"
import { renderMrvReportHtml } from "@/lib/mrv/report-html"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  return handleRoute(async () => {
    const { reportId } = await params
    const auth = await authorizeMrv(req)
    const { report, emissionFactor } = await loadReportForOrg(
      auth.db,
      reportId,
      auth.orgId,
    )
    return new NextResponse(renderMrvReportHtml(report, emissionFactor), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // 리포트는 조직 내부 증빙이다. 중간 캐시에 남지 않게 한다.
        "Cache-Control": "private, no-store",
      },
    })
  })
}
