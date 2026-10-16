import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import {
  kakaoAddressSearch, nominatimBacklog, nominatimSearch, providerFor,
  type GeoCandidate, type GeoProvider,
} from "@/lib/geocode"

// GET /api/geocode/search?q=<주소>&lang=<ko|en|vi|id>
// 농장 주소 입력칸(components/ui/address-search.tsx)의 "주소 검색(전 세계)" 탭이 부른다.
// 응답: { provider, results: [{ label, latitude, longitude, country_code, precision }] } (최대 5개)
//
// 브라우저가 Nominatim·카카오를 직접 부르지 않게 서버가 대신 묻는다 — 카카오 키 보호,
// CSP, 그리고 Nominatim 이용 정책(UA 명시·초당 1건·자동완성 금지)을 한 곳에서 지키려고.
// 화면은 사용자가 검색 버튼/Enter 를 눌렀을 때만 부른다(타이핑마다 부르지 않는다).
//
// 로그인 사용자만. 남용을 막으려고 사용자별 분당 상한과 Nominatim 대기열 상한을 둔다.
// 오류 응답은 짧은 코드만 준다 — 제공자 HTTP 상태나 내부 메시지는 내보내지 않는다.

const LANGS = new Set(["ko", "en", "vi", "id"])
const MAX_RESULTS = 5
const Q_MIN = 2
const Q_MAX = 200

// 같은 질의는 10분 동안 다시 묻지 않는다(최대 200개, 오래된 것부터 버린다).
const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 200
const cache = new Map<string, { at: number; provider: GeoProvider; results: GeoCandidate[] }>()

// 사용자별 분당 상한. 사람 손으로 누르는 검색이라 이 정도면 넉넉하다.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 12
const hits = new Map<string, number[]>()

// Nominatim 줄에 이만큼 넘게 서 있으면 기다리게 하지 않고 바로 "잠시 뒤" 로 답한다.
const MAX_BACKLOG = 4

function rateLimited(userId: string, now: number): boolean {
  const recent = (hits.get(userId) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    hits.set(userId, recent)
    return true
  }
  recent.push(now)
  hits.set(userId, recent)
  // 오래 안 쓴 사용자 기록이 쌓이지 않게 가끔 정리한다.
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k)
  }
  return false
}

function cacheGet(key: string, now: number) {
  const hit = cache.get(key)
  if (!hit) return null
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit
}

function cacheSet(key: string, value: { at: number; provider: GeoProvider; results: GeoCandidate[] }) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const noStore = { "Cache-Control": "private, no-store" }
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore })

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail("unauthorized", 401)

  const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim()
  if (q.length < Q_MIN || q.length > Q_MAX) return fail("invalid_query", 400)
  const langParam = req.nextUrl.searchParams.get("lang") ?? ""
  const lang = LANGS.has(langParam) ? langParam : "en"

  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim() || ""
  const provider = providerFor(q, kakaoKey)
  const key = `${provider}|${lang}|${q.toLowerCase()}`
  const now = Date.now()

  // 캐시에 있으면 상한에 세지 않는다 — 제공자에 부담을 주지 않으므로.
  const cached = cacheGet(key, now)
  if (cached) return NextResponse.json({ provider: cached.provider, results: cached.results }, { headers: noStore })

  if (rateLimited(user.id, now)) return fail("rate_limited", 429)
  if (provider === "nominatim" && nominatimBacklog() >= MAX_BACKLOG) return fail("busy", 503)

  const r = provider === "kakao"
    ? await kakaoAddressSearch(q, kakaoKey, MAX_RESULTS)
    : await nominatimSearch(q, { lang, limit: MAX_RESULTS })
  if (!r.ok) {
    console.warn(`[geocode/search] ${provider} 오류(${r.detail})`)
    return fail("provider_error", 502)
  }

  // 같은 이름이 여러 번 오는 일이 있다(같은 마을의 다른 OSM 개체). 라벨로 한 번만 보인다.
  const seen = new Set<string>()
  const results = r.items.filter(c => !seen.has(c.label) && seen.add(c.label)).slice(0, MAX_RESULTS)
  cacheSet(key, { at: now, provider, results })
  return NextResponse.json({ provider, results }, { headers: noStore })
}
