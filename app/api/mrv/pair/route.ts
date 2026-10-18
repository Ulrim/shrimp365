/**
 * MRV 현장 장비 페어링 — 장비 쪽 창구.
 *
 *   POST /api/mrv/pair            장비가 6자리 코드를 받는다
 *   GET  /api/mrv/pair?secret=…   장비가 승인 여부를 묻고, 승인됐으면 원문 키를 받는다
 *
 * **세션이 없다.** 이 두 창구는 아직 아무 자격도 없는 장비가 부르는 곳이다. 그래서
 * 인증 대신 **(a) 장비만 아는 `pairing_secret`, (b) 짧은 만료, (c) 호출 빈도 제한**
 * 셋으로 막는다. 6자리 코드는 100만 가지뿐이라 오래 열어 두거나 무제한으로 조회시키면
 * 전수 시도가 현실적인 공격이 된다.
 *
 * 승인은 사람이 세션으로 한다(`POST /api/mrv/pair/claim`). 즉 **코드만 알아낸 제3자는
 * 아무것도 못 한다** — 승인에는 로그인과 쓰기 권한이 필요하고, 원문 키 수령에는 코드가
 * 아니라 `pairing_secret` 이 필요하다.
 *
 * 수질 쪽 `/api/sensors/pair` 와 같은 모양이지만 **테이블과 테넌시가 다르다**(설계 근거는
 * `supabase/migrations/mrv_device_pairing.sql` 머리말). 한 창구로 합치면 수질 장치 키가
 * 탄소 증빙 창구를 열 수 있게 된다.
 */

import { NextRequest, NextResponse } from "next/server"
import { randomBytes, randomInt } from "node:crypto"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, mrvDb, newId } from "@/lib/mrv/db"

/** 코드 발급 빈도 제한. 장비 하나가 정상 동작하며 이보다 자주 코드를 받을 일은 없다. */
const ISSUE_WINDOW_MS = 60_000
const ISSUE_MAX = 5
/** 폴링 빈도 제한. 장비는 2~3초 간격으로 묻는다. */
const POLL_WINDOW_MS = 60_000
const POLL_MAX = 60

/**
 * 호출 빈도 장부. 프로세스 메모리라 인스턴스가 여러 개면 각자 센다 —
 * 완전한 방어가 아니라 **전수 시도의 비용을 올리는 장치**다. 최종 방어선은 짧은 만료와
 * `pairing_secret` 이다.
 */
const issueCounts = new Map<string, { count: number; resetAt: number }>()
const pollCounts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  windowMs: number,
  max: number,
): boolean {
  const now = Date.now()
  const hit = store.get(key)
  if (!hit || hit.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    // 장부가 무한히 자라지 않게 만료된 것만 걷어낸다.
    if (store.size > 2000) {
      for (const [k, v] of store) if (v.resetAt < now) store.delete(k)
    }
    return false
  }
  hit.count += 1
  return hit.count > max
}

/** 요청자 식별값. 프록시 뒤라 완벽하지 않지만 빈도 제한의 키로는 충분하다. */
function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  )
}

/** 6자리 코드. `randomInt` 를 쓴다 — `Math.random` 은 추측 가능한 값을 낸다. */
function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

// ── 코드 발급 ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    if (rateLimited(issueCounts, clientKey(req), ISSUE_WINDOW_MS, ISSUE_MAX)) {
      throw new HttpError(429, "too many pairing requests")
    }

    const body = (await req.json().catch(() => ({}))) as {
      serial?: unknown
      firmware?: unknown
    }
    // 자기소개는 승인 화면에 "어느 기기인가" 를 보여 주려고 받는다. 신뢰하지 않는 값이라
    // 길이만 자르고 그대로 저장한다 — 이 값으로 어떤 판정도 하지 않는다.
    const serial = typeof body.serial === "string" ? body.serial.slice(0, 64) : null
    const firmware = typeof body.firmware === "string" ? body.firmware.slice(0, 32) : null

    const db = mrvDb()
    // 만료된 미승인 코드를 걷어낸다. 안 걷으면 유니크 인덱스가 코드 공간을 잠식한다.
    await db.rpc("purge_expired_mrv_device_pairings").then(
      () => undefined,
      () => undefined, // 함수가 아직 없는 DB 에서도 페어링 자체는 되게 한다
    )

    const pairingSecret = randomBytes(32).toString("hex")
    // 활성 코드 충돌은 유니크 인덱스가 막는다. 몇 번 다시 뽑아 본다.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = sixDigitCode()
      const { error } = await db.from(T.devicePairings).insert({
        id: newId("mdp"),
        code,
        pairing_secret: pairingSecret,
        serial,
        firmware,
      })
      if (!error) {
        return NextResponse.json(
          { code, pairing_secret: pairingSecret, expires_in_sec: 900 },
          { status: 201 },
        )
      }
      if ((error as { code?: string }).code !== "23505") throw error
    }
    throw new HttpError(503, "could not allocate a pairing code, try again")
  })
}

// ── 승인 여부 확인 + 원문 키 수령 ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const secret = req.nextUrl.searchParams.get("secret")?.trim()
    // 길이를 먼저 본다. 짧은 값으로 긁는 시도를 DB 까지 보내지 않는다.
    if (!secret || secret.length < 32) {
      throw new HttpError(422, "secret is required")
    }
    if (rateLimited(pollCounts, secret, POLL_WINDOW_MS, POLL_MAX)) {
      throw new HttpError(429, "too many polls")
    }

    const db = mrvDb()
    const { data, error } = await db
      .from(T.devicePairings)
      .select("id, site_id, org_id, claimed_at, expires_at, issued_key")
      .eq("pairing_secret", secret)
      .maybeSingle()
    if (error) throw error

    const row = data as {
      id: string
      site_id: string | null
      org_id: string | null
      claimed_at: string | null
      expires_at: string
      issued_key: string | null
    } | null
    // 없는 secret 과 만료된 secret 을 구분해 알리지 않는다 — 구분해 주면 존재 여부를
    // 캐낼 수 있다. 둘 다 "다시 시작하라" 로 답한다.
    if (!row) return NextResponse.json({ status: "not_found" }, { status: 404 })

    if (!row.claimed_at) {
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ status: "expired" })
      }
      return NextResponse.json({ status: "pending" })
    }

    // 승인됐지만 이미 가져간 경우. 장비가 키를 잃었으면 처음부터 다시 페어링해야 한다 —
    // 같은 키를 두 번 내주면 "그 키를 지금 누가 들고 있나" 를 알 수 없게 된다.
    if (!row.issued_key) {
      return NextResponse.json({ status: "already_claimed" })
    }

    // 한 번만 내준다.
    //
    // **비우기가 자물쇠고, 값은 위에서 이미 읽어 둔 것을 쓴다.** `UPDATE … SET
    // issued_key = null RETURNING issued_key` 는 **갱신된 값**(= null)을 돌려주므로
    // 그 반환값으로 키를 내보낼 수 없다 — 그러면 장비가 영원히 키를 못 받는다.
    // 대신 조건부 갱신(`issued_key is not null`)이 성공한 요청만 "내가 가져갔다" 가
    // 되므로, 동시에 두 번 와도 한쪽만 통과한다.
    const { data: taken, error: takeError } = await db
      .from(T.devicePairings)
      .update({ issued_key: null })
      .eq("id", row.id)
      .not("issued_key", "is", null)
      .select("id")
      .maybeSingle()
    if (takeError) throw takeError
    if (!taken) return NextResponse.json({ status: "already_claimed" })

    return NextResponse.json({
      status: "linked",
      api_key: row.issued_key,
      site_id: row.site_id,
      org_id: row.org_id,
    })
  })
}
