/**
 * POST /api/mrv/pair/claim — 운영자가 현장 장비를 승인한다.
 *
 * 장비가 화면에 띄운 6자리 코드와 **붙일 사이트**를 받아, `mrv_api_keys` 행을 만들고
 * 원문 키를 페어링 행에 잠깐 올려 둔다(장비가 `pairing_secret` 으로 가져간다).
 *
 * **이 창구가 MRV 수집 API 키의 유일한 발급 경로다.** 지금까지 그 행은 SQL 로만 넣을 수
 * 있었다 — 발급 화면도 API 도 없어서, 전력계를 붙이려면 매번 DB 를 직접 만져야 했다.
 *
 * 세 가지를 못박는다.
 *   1) **쓰기 권한**(owner/operator)을 요구한다. 장비 키는 그 사이트에 계측값을 넣을 수
 *      있는 자격이고, 그건 viewer 가 만들 수 있는 것이 아니다.
 *   2) **사이트 소유권**을 `resolveSiteForOrg` 로 확인한다. 코드만 알면 남의 사이트에
 *      장비를 붙일 수 있게 되면 안 된다.
 *   3) **감사 로그를 남긴다.** 누가 언제 어느 장비를 어느 사이트에 붙였는지가 남아야
 *      한다 — 그 장비가 넣은 전력이 기준선의 근거가 되기 때문이다.
 */

import { NextRequest, NextResponse } from "next/server"
import { randomBytes, createHash } from "node:crypto"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { recordAudit } from "@/lib/mrv/audit"

/** 원문 키 → sha256 hex. 수집 창구(`/ingest/readings`)와 같은 규약이어야 한다. */
function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex")
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireWriter(await authorizeMrv(req))

    const body = (await req.json()) as {
      code?: unknown
      site_id?: unknown
      label?: unknown
    }
    if (typeof body.code !== "string" || !/^[0-9]{6}$/.test(body.code)) {
      throw new HttpError(422, "code must be 6 digits")
    }
    if (typeof body.site_id !== "string" || !body.site_id) {
      throw new HttpError(422, "site_id is required")
    }
    const label =
      typeof body.label === "string" && body.label.trim() !== ""
        ? body.label.trim().slice(0, 120)
        : null

    // 소유권부터. 이 확인 없이는 코드 하나로 남의 사이트에 장비를 붙일 수 있다.
    const site = await resolveSiteForOrg(auth.db, body.site_id, auth.orgId)

    // 아직 승인되지 않은, 만료되지 않은 코드만 받는다.
    const { data, error } = await auth.db
      .from(T.devicePairings)
      .select("id, serial, firmware, expires_at, claimed_at")
      .eq("code", body.code)
      .is("claimed_at", null)
      .maybeSingle()
    if (error) throw error
    const pairing = data as {
      id: string
      serial: string | null
      firmware: string | null
      expires_at: string
      claimed_at: string | null
    } | null
    // 없는 코드와 만료된 코드를 구분해 알리지 않는다.
    if (!pairing || new Date(pairing.expires_at).getTime() < Date.now()) {
      throw new HttpError(404, "no pending pairing for this code (it may have expired)")
    }

    // 원문 키는 여기서만 만들어지고, 해시만 영속한다.
    const rawKey = randomBytes(32).toString("hex")
    const apiKeyId = newId("mak")
    const { error: keyError } = await auth.db.from(T.apiKeys).insert({
      id: apiKeyId,
      org_id: auth.orgId,
      site_id: site.id,
      key_hash: hashApiKey(rawKey),
      label: label ?? `현장 장비${pairing.serial ? ` ${pairing.serial}` : ""}`,
    })
    if (keyError) throw keyError

    // 승인 표시 + 장비가 가져갈 원문 키를 올려 둔다. 조건에 claimed_at is null 을 다시
    // 걸어, 두 사람이 같은 코드를 동시에 승인해도 한쪽만 성공하게 한다.
    const { data: claimed, error: claimError } = await auth.db
      .from(T.devicePairings)
      .update({
        org_id: auth.orgId,
        site_id: site.id,
        api_key_id: apiKeyId,
        claimed_by: auth.userId,
        claimed_at: new Date().toISOString(),
        issued_key: rawKey,
      })
      .eq("id", pairing.id)
      .is("claimed_at", null)
      .select("id")
      .maybeSingle()
    if (claimError) throw claimError
    if (!claimed) {
      // 다른 쪽이 먼저 승인했다. 방금 만든 키는 쓰이지 않으므로 거둬들인다 —
      // 두지 않으면 어떤 장비도 들고 있지 않은 유효한 키가 남는다.
      await auth.db.from(T.apiKeys).delete().eq("id", apiKeyId)
      throw new HttpError(409, "this pairing was already claimed")
    }

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "api_keys",
      entityId: apiKeyId,
      action: "create",
      diff: {
        before: null,
        after: {
          site_id: site.id,
          label,
          // 원문 키도, 해시도 남기지 않는다. 감사 로그는 열람 범위가 넓고, 키는
          // 그 자체가 자격이다 — 남기면 로그를 읽을 수 있는 사람이 장비가 된다.
          via: "device_pairing",
          device_serial: pairing.serial,
          device_firmware: pairing.firmware,
        },
      },
    })

    // 원문 키는 **응답에 담지 않는다.** 장비가 pairing_secret 으로 가져간다 —
    // 승인한 사람의 브라우저에 장비 자격이 남을 이유가 없다.
    return NextResponse.json(
      { status: "linked", site_id: site.id, site_name: site.name, api_key_id: apiKeyId },
      { status: 201 },
    )
  })
}
