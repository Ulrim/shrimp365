import { NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { CatalogDocument } from "@/components/catalog/catalog-document"

export async function GET() {
  try {
    const buffer = await renderToBuffer(CatalogDocument())
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Shrimp365_catalog.pdf"',
      },
    })
  } catch (err) {
    console.error("[catalog pdf]", err)
    return NextResponse.json({ error: "PDF 생성 실패" }, { status: 500 })
  }
}
