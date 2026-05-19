import { NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { GuideDocument } from "@/components/catalog/guide-document"

export async function GET() {
  try {
    const buffer = await renderToBuffer(GuideDocument())
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Shrimp365_사용설명서.pdf"',
      },
    })
  } catch (err) {
    console.error("[guide pdf]", err)
    return NextResponse.json({ error: "PDF 생성 실패" }, { status: 500 })
  }
}
