import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let cached: string | null = null

async function readBuildId(): Promise<string> {
  if (cached) return cached
  try {
    const id = (await fs.readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim()
    cached = id
    return id
  } catch {
    cached = "dev"
    return cached
  }
}

export async function GET() {
  const buildId = await readBuildId()
  return NextResponse.json(
    { buildId },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  )
}
