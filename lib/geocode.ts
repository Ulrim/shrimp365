// 농장 주소 → 좌표 (서버 전용) — docs/plans/control-map-farms.md 2-1·2-2.
//
// 관제센터 지도는 농장 위치를 세 단계로 채운다: 농가 입력 좌표 → 장비 좌표 평균 →
// 주소 지오코딩(캐시). 이 파일은 그 규칙(순수 함수)과 지오코딩 호출을 담는다.
//
// 브라우저에서 부르지 않는다 — 카카오 키가 노출되고 CSP 도 막는다. overview 라우트가
// 응답을 보낸 뒤 after() 안에서만 refreshFarmGeocodes() 를 부른다. 농가 화면의 주소
// 검색은 app/api/geocode/search 가 이 파일의 nominatimSearch()·kakaoAddressSearch() 를 쓴다.
//
// 전 세계 주소를 다룬다(베트남·인도네시아 농가). 한글 주소만 한국 규칙(행정구역 줄이기,
// 카카오)을 따르고, 그 외는 Nominatim 을 국가 제한 없이 부른다.
// 지오코딩 결과는 farms 에 쓰지 않는다. 별도 캐시 테이블(farm_geocodes)에만 둔다.
import type { createAdminClient } from "@/lib/supabase-server"

export type GeoPrecision = "address" | "region"
export type GeoProvider = "kakao" | "nominatim"
export type CoordSource = "farm" | "device" | "address"

/** 한 요청이 응답 뒤에 찾는 농장 수 상한. */
export const GEOCODE_MAX_PER_REQUEST = 10
/** 실패 캐시(latitude NULL)는 이만큼 지난 뒤에 다시 시도한다. */
export const GEOCODE_FAIL_RETRY_MS = 7 * 24 * 60 * 60_000

const FETCH_TIMEOUT_MS = 5_000
const MAX_QUERIES = 3              // 상세 주소 + 줄인 주소, 합쳐서 최대 3번 묻는다
const NOMINATIM_GAP_MS = 1_100     // Nominatim 이용 정책: 초당 1건 이하
// after() 는 플랫폼의 함수 실행 시간 상한 안에서만 돈다. 상한에 걸려 중간에 끊기기
// 전에 스스로 멈춘다 — 못 찾은 농장은 다음 새로고침이 이어서 찾는다.
const BATCH_BUDGET_MS = 25_000
const USER_AGENT = "Shrimp365/1.0 (+https://www.shrimp365.kr)"

// ── 순수 함수 ────────────────────────────────────────────────────────────────

/** 지도에 찍을 수 있는 좌표인가. (0,0) 은 입력 기본값일 뿐이라 버린다. */
export function isValidCoord(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0)
}

/** 지오코딩에 쓸 주소 문자열. 괄호 메모("(양식장 뒤편)")는 검색을 망치므로 뺀다.
 *  캐시의 query 와 비교하는 값이기도 하다 — 같은 규칙으로만 만든다. */
export function normalizeAddress(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

// 행정구역 토큰. 숫자로 시작하는 "101동"(아파트 동)은 행정동이 아니다.
const ADMIN_FINE = /^[가-힣][가-힣0-9]*(읍|면|동|리|가)$/   // 읍·면·동·리
const ADMIN_COARSE = /^[가-힣]+(시|군|구)$/                  // 시·군·구
const PROVINCE = /(도|특별시|광역시|특별자치시|특별자치도)$/  // 여기까지 줄이면 너무 넓다

/** 주소가 번지·도로명 없이 행정구역에서 끝나면 그 자체로 "대략 위치" 다. */
function endsAtRegion(tokens: string[]): boolean {
  const last = tokens[tokens.length - 1] ?? ""
  return ADMIN_FINE.test(last) || ADMIN_COARSE.test(last) || PROVINCE.test(last)
}

/** 한글이 들어간 주소인가. 한국 주소 규칙(행정구역 줄이기)과 카카오는 이때만 쓴다.
 *  카카오는 국내 주소만 찾으므로 베트남·인도네시아 주소에 물어봐야 헛수고다. */
export function hasHangul(s: string | null | undefined): boolean {
  return /[가-힣ㄱ-ㆎ]/.test(String(s ?? ""))
}

// 줄인 주소가 나라 이름만 남으면 지도에 찍을 의미가 없다(나라 한가운데에 핀이 꽂힌다).
const COUNTRY_ONLY = /^(viet ?nam|việt nam|indonesia|republic of indonesia|korea|south korea|republic of korea|thailand|philippines|malaysia|india|china|ecuador)$/i
const HAS_LETTER = /\p{L}/u

/** 물어볼 주소 목록(최대 3개). 첫 항목은 언제나 주소 전체다.
 *
 *  한글 주소 — 상세 주소로 못 찾으면 뒤에서부터 줄여 읍·면·동, 다음 시·군·구 수준으로
 *  다시 묻는다. 줄인 주소로 찾은 결과는 precision 'region'.
 *   "전라남도 무안군 해제면 ○○길 12-3"
 *     → "전라남도 무안군 해제면 ○○길 12-3"(address) → "… 해제면"(region) → "전라남도 무안군"(region)
 *  행정구역 토큰이 하나도 없으면 끝 토큰을 하나씩 떼어 낸다.
 *
 *  그 외(베트남·인도네시아·영문) — 이 주소들은 좁은 곳 → 넓은 곳 순서로 쓴다. 그래서
 *  앞에서부터 뗀다. 쉼표가 있으면 쉼표 구간 단위, 없으면 공백 토큰 단위(두 토큰 이상 남길 때까지).
 *   "Lot 5, Jalan X, Kec. Y, Kab. Z, Jawa Timur"
 *     → 전체(address) → "Jalan X, Kec. Y, …"(region) → "Kec. Y, Kab. Z, Jawa Timur"(region)
 *  글자가 없는 조각("12")이나 나라 이름만 남는 조각은 묻지 않는다. */
export function addressQueries(raw: string | null | undefined): { query: string; precision: GeoPrecision }[] {
  const full = normalizeAddress(raw)
  if (!full) return []
  return hasHangul(full) ? koreanQueries(full) : frontTrimQueries(full)
}

function frontTrimQueries(full: string): { query: string; precision: GeoPrecision }[] {
  const out: { query: string; precision: GeoPrecision }[] = [{ query: full, precision: "address" }]
  const byComma = full.includes(",")
  const parts = byComma ? full.split(",").map(s => s.trim()).filter(Boolean) : full.split(" ")
  // 쉼표 구간은 하나만 남아도 지명("Banyuwangi")이지만, 공백 토큰 하나("Lieu")는 지명 조각일 뿐이다.
  const minParts = byComma ? 1 : 2
  for (let i = 1; parts.length - i >= minParts && out.length < MAX_QUERIES; i++) {
    const query = parts.slice(i).join(byComma ? ", " : " ")
    if (!HAS_LETTER.test(query) || COUNTRY_ONLY.test(query)) continue
    if (out.some(o => o.query === query)) continue
    out.push({ query, precision: "region" })
  }
  return out
}

function koreanQueries(full: string): { query: string; precision: GeoPrecision }[] {
  const tokens = full.split(" ")
  const out: { query: string; precision: GeoPrecision }[] = [
    { query: full, precision: endsAtRegion(tokens) ? "region" : "address" },
  ]
  let len = tokens.length

  const cut = (n: number) => {
    if (out.length >= MAX_QUERIES || n < 1 || n >= len) return
    if (PROVINCE.test(tokens[n - 1])) return
    out.push({ query: tokens.slice(0, n).join(" "), precision: "region" })
    len = n
  }
  const lastMatch = (re: RegExp) => {
    for (let i = len - 2; i >= 0; i--) if (re.test(tokens[i])) return i
    return -1
  }

  const fine = lastMatch(ADMIN_FINE)
  if (fine >= 0) cut(fine + 1)
  const coarse = lastMatch(ADMIN_COARSE)
  if (coarse >= 0) cut(coarse + 1)
  if (fine < 0 && coarse < 0) {
    cut(len - 1)
    cut(len - 1)
  }
  return out
}

export type GeocodeCacheRow = {
  farm_id: string
  query: string
  latitude: number | null
  longitude: number | null
  precision: string | null
  geocoded_at: string
}

export type CoordPick = {
  latitude: number
  longitude: number
  source: CoordSource
  precision?: GeoPrecision
}

/** 농장 좌표 3단계(설계서 2-1). 앞 단계가 있으면 뒤는 보지 않는다.
 *  1 농가 입력 좌표 → 2 active 장비 좌표 평균 → 3 현재 주소와 같은 query 로 찾은 캐시.
 *  주소가 바뀐 뒤의 옛 캐시는 쓰지 않는다(다른 곳을 가리킬 수 있다). */
export function pickFarmCoord(
  farm: { latitude: number | null; longitude: number | null },
  devices: { latitude?: number | null; longitude?: number | null }[],
  cached: GeocodeCacheRow | null | undefined,
  currentQuery: string,
): CoordPick | null {
  if (isValidCoord(farm.latitude, farm.longitude)) {
    return { latitude: farm.latitude!, longitude: farm.longitude!, source: "farm" }
  }
  const pts = devices.filter(d => isValidCoord(d.latitude, d.longitude))
  if (pts.length) {
    return {
      latitude: pts.reduce((s, d) => s + d.latitude!, 0) / pts.length,
      longitude: pts.reduce((s, d) => s + d.longitude!, 0) / pts.length,
      source: "device",
    }
  }
  if (cached && currentQuery && cached.query === currentQuery && isValidCoord(cached.latitude, cached.longitude)) {
    return {
      latitude: cached.latitude!,
      longitude: cached.longitude!,
      source: "address",
      precision: cached.precision === "region" ? "region" : "address",
    }
  }
  return null
}

/** 이 농장을 (다시) 지오코딩해야 하나. 0·1·2 는 우선순위(작을수록 먼저), null 은 불필요.
 *  0 캐시 없음 · 1 주소가 바뀜 · 2 실패한 지 7일 지남. */
export function geocodePriority(
  cached: GeocodeCacheRow | null | undefined,
  currentQuery: string,
  now: number,
): 0 | 1 | 2 | null {
  if (!currentQuery) return null
  if (!cached) return 0
  if (cached.query !== currentQuery) return 1
  if (!isValidCoord(cached.latitude, cached.longitude)) {
    const at = new Date(cached.geocoded_at).getTime()
    if (!Number.isFinite(at) || now - at >= GEOCODE_FAIL_RETRY_MS) return 2
  }
  return null
}

/** 테이블이 아직 없을 때(마이그레이션 전) Postgres/PostgREST 가 주는 코드. */
export function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code === "42P01" || code === "PGRST205"
}

// ── 제공자 ───────────────────────────────────────────────────────────────────
//
// 아래 nominatimSearch()·kakaoAddressSearch() 는 관제센터 지도(refreshFarmGeocodes)와
// 농가용 주소 검색 API(app/api/geocode/search)가 함께 쓴다. Nominatim 호출 간격·UA·
// 시간 초과를 한 곳에서 지키기 위해서다 — 두 경로가 각자 부르면 초당 1건이 깨진다.

type Lookup =
  | { kind: "found"; latitude: number; longitude: number }
  | { kind: "not_found" }
  | { kind: "error"; detail: string }   // HTTP 오류·시간 초과·응답 형식 이상

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Nominatim 호출 간격은 프로세스 전체에서 지킨다 — 관리자 여럿이 동시에 열어
// after() 가 겹쳐 돌아도, 농가가 주소 검색을 함께 눌러도 초당 1건을 넘지 않게 한 줄로 세운다.
let nominatimQueue: Promise<void> = Promise.resolve()
let nominatimNextAt = 0
let nominatimWaiting = 0
function nominatimSlot(): Promise<void> {
  nominatimWaiting++
  const slot = nominatimQueue.then(async () => {
    const wait = nominatimNextAt - Date.now()
    if (wait > 0) await sleep(wait)
    nominatimNextAt = Date.now() + NOMINATIM_GAP_MS
  })
  nominatimQueue = slot.catch(() => {})
  return slot.finally(() => { nominatimWaiting-- })
}

/** 지금 Nominatim 차례를 기다리는 요청 수. 줄이 길면 검색 API 가 바로 "잠시 뒤" 로 답한다. */
export function nominatimBacklog(): number {
  return nominatimWaiting
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: true; body: unknown } | { ok: false; detail: string }> {
  try {
    const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    try {
      return { ok: true, body: await res.json() }
    } catch {
      return { ok: false, detail: "응답 파싱 실패" }
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.name : "fetch 실패" }
  }
}

/** 주소 후보 하나. 검색 API 응답 모양 그대로다. */
export type GeoCandidate = {
  label: string
  latitude: number
  longitude: number
  /** ISO 3166-1 alpha-2 소문자("vn"). 모르면 "". */
  country_code: string
  precision: GeoPrecision
}

export type SearchResult = { ok: true; items: GeoCandidate[] } | { ok: false; detail: string }

const LABEL_MAX = 300

/** Nominatim 검색 — 국가 제한 없음. 호출 간격은 nominatimSlot() 이 지킨다.
 *  자동완성(타이핑마다)으로 부르지 않는다: 이용 정책 위반이다. 사용자가 검색을 눌렀을 때만. */
export async function nominatimSearch(query: string, opts: { lang: string; limit: number }): Promise<SearchResult> {
  await nominatimSlot()
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: "jsonv2", addressdetails: "1", limit: String(opts.limit), q: query,
  })}`
  const r = await getJson(url, { "User-Agent": USER_AGENT, "Accept-Language": opts.lang })
  if (!r.ok) return r
  if (!Array.isArray(r.body)) return { ok: false, detail: "응답 형식 이상" }
  const items: GeoCandidate[] = []
  for (const raw of r.body) {
    const d = raw as { lat?: unknown; lon?: unknown; display_name?: unknown; place_rank?: unknown; address?: { country_code?: unknown } }
    const lat = Number(d.lat), lng = Number(d.lon)
    if (!isValidCoord(lat, lng)) continue
    const cc = typeof d.address?.country_code === "string" ? d.address.country_code.toLowerCase() : ""
    items.push({
      label: String(d.display_name ?? query).slice(0, LABEL_MAX),
      latitude: lat,
      longitude: lng,
      country_code: /^[a-z]{2}$/.test(cc) ? cc : "",
      // place_rank 26 이상이 도로·번지·건물. 그보다 낮으면 마을·군·도 수준이다.
      precision: Number(d.place_rank) >= 26 ? "address" : "region",
    })
  }
  if (r.body.length > 0 && items.length === 0) return { ok: false, detail: "좌표 형식 이상" }
  return { ok: true, items }
}

/** 카카오 주소 검색 — 국내 주소 전용. 한글 주소에만 부른다. */
export async function kakaoAddressSearch(query: string, key: string, size: number): Promise<SearchResult> {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query, size: String(size) })}`
  const r = await getJson(url, { Authorization: `KakaoAK ${key}` })
  if (!r.ok) return r
  const docs = (r.body as { documents?: unknown } | null)?.documents
  if (!Array.isArray(docs)) return { ok: false, detail: "응답 형식 이상" }
  const items: GeoCandidate[] = []
  for (const raw of docs) {
    const d = raw as { x?: unknown; y?: unknown; address_name?: unknown; address_type?: unknown; road_address?: { address_name?: unknown } | null }
    const lat = Number(d.y), lng = Number(d.x)   // 카카오는 x=경도, y=위도(문자열)
    if (!isValidCoord(lat, lng)) continue
    const road = typeof d.road_address?.address_name === "string" ? d.road_address.address_name : ""
    items.push({
      label: String(road || d.address_name || query).slice(0, LABEL_MAX),
      latitude: lat,
      longitude: lng,
      country_code: "kr",
      // REGION·ROAD 는 행정구역·도로명까지만 맞은 결과, *_ADDR 는 번지까지 맞은 결과.
      precision: d.address_type === "REGION_ADDR" || d.address_type === "ROAD_ADDR" ? "address" : "region",
    })
  }
  if (docs.length > 0 && items.length === 0) return { ok: false, detail: "좌표 형식 이상" }
  return { ok: true, items }
}

/** 이 주소를 물을 제공자. 한글 주소이고 카카오 키가 있을 때만 카카오. */
export function providerFor(query: string, kakaoKey: string): GeoProvider {
  return kakaoKey && hasHangul(query) ? "kakao" : "nominatim"
}

async function lookup(query: string, provider: GeoProvider, kakaoKey: string): Promise<Lookup> {
  const r = provider === "kakao"
    ? await kakaoAddressSearch(query, kakaoKey, 1)
    : await nominatimSearch(query, { lang: "ko", limit: 1 })
  if (!r.ok) return { kind: "error", detail: r.detail }
  const first = r.items[0]
  return first ? { kind: "found", latitude: first.latitude, longitude: first.longitude } : { kind: "not_found" }
}

type GeocodeOutcome = {
  latitude: number | null
  longitude: number | null
  precision: GeoPrecision | null
  /** 제공자 장애(HTTP 오류·시간 초과·형식 이상). 이번 배치에서 이 제공자는 더 묻지 않는다. */
  error: string | null
}

async function geocodeAddress(location: string, provider: GeoProvider, kakaoKey: string): Promise<GeocodeOutcome> {
  for (const c of addressQueries(location)) {
    const r = await lookup(c.query, provider, kakaoKey)
    if (r.kind === "found") return { latitude: r.latitude, longitude: r.longitude, precision: c.precision, error: null }
    if (r.kind === "error") return { latitude: null, longitude: null, precision: null, error: r.detail }
  }
  return { latitude: null, longitude: null, precision: null, error: null }
}

/** 좌표가 없는 농장들의 주소를 찾아 farm_geocodes 에 넣는다. overview 의 after() 전용.
 *
 *  - admin 은 service_role 클라이언트(createAdminClient) — 캐시 테이블은 정책이 없다.
 *  - 최대 10곳. 같은 주소의 농장은 한 번만 묻는다(같은 요청 안 중복 없음).
 *    다른 관리자의 요청과 겹쳐 같은 농장을 두 번 찾는 것은 upsert 라 무해하다.
 *  - 제공자는 주소마다 고른다: 한글 주소 + 카카오 키 → 카카오, 그 외 → Nominatim(국가 제한 없음).
 *  - 못 찾아도, 제공자가 오류를 내도 실패로 기록한다(latitude NULL) — 7일 뒤 재시도.
 *    오류가 나면 그 제공자가 지금 막힌 것이므로 그 제공자로 물을 남은 농장은 다음 요청에 맡긴다.
 *  - 농장마다 바로 기록한다. 실행 시간 상한에 걸려 끊겨도 찾은 만큼은 남는다. */
export async function refreshFarmGeocodes(
  admin: ReturnType<typeof createAdminClient>,
  farms: { farm_id: string; location: string }[],
): Promise<void> {
  const kakaoKey = process.env.KAKAO_REST_API_KEY?.trim() || ""

  // 주소별로 묶는다(농장 id 중복도 여기서 걸러진다).
  const byQuery = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const f of farms) {
    if (seen.size >= GEOCODE_MAX_PER_REQUEST) break
    if (seen.has(f.farm_id)) continue
    const q = normalizeAddress(f.location)
    if (!q) continue
    seen.add(f.farm_id)
    byQuery.set(q, [...(byQuery.get(q) ?? []), f.farm_id])
  }

  const started = Date.now()
  const blocked = new Set<GeoProvider>()
  for (const [query, farmIds] of byQuery) {
    if (Date.now() - started > BATCH_BUDGET_MS) break
    const provider = providerFor(query, kakaoKey)
    if (blocked.has(provider)) continue
    const r = await geocodeAddress(query, provider, kakaoKey)
    const geocoded_at = new Date().toISOString()
    const { error } = await admin.from("farm_geocodes").upsert(
      farmIds.map(farm_id => ({
        farm_id, query,
        latitude: r.latitude, longitude: r.longitude, precision: r.precision,
        provider, geocoded_at,
      })),
      { onConflict: "farm_id" },
    )
    if (error) {
      if (isMissingTable(error)) return
      // 그사이 농장이 지워졌으면(FK) 이 묶음만 버린다. 주소는 남기지 않는다.
      console.warn("[geocode] 캐시 기록 실패", (error as { code?: string }).code ?? "")
    }
    if (r.error) {
      console.warn(`[geocode] ${provider} 오류(${r.error}) — 이 제공자로 찾을 남은 농장은 다음 새로고침에`)
      blocked.add(provider)
    }
  }
}
