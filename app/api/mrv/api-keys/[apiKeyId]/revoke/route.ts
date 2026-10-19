/**
 * POST /api/mrv/api-keys/{id}/revoke — 장비 수집 키를 끊는다.
 *
 * 원본에는 이 창구가 없다. 발급(페어링 승인)과 인증(`revoked` 확인)은 있었지만
 * **끊는 경로가 없어서**, 기계실 터치스크린을 분실·교체·반납해도 DB 를 직접 만지는 것이
 * 유일한 방법이었다. 그 키 하나로 사이트의 전력 계측값을 넣을 수 있고 그 전력이 EI ·
 * Scope2 · 기준선의 근거가 되므로, 통제 밖에 남겨 둘 수 없는 구멍이다.
 *
 * 세 가지를 못박는다(페어링 승인 창구와 같은 규약).
 *   1) **쓰기 권한**(owner/operator)을 요구한다. 수집 경로를 끊는 일은 viewer 가 할 수
 *      있는 것이 아니다.
 *   2) **사이트 소유권**을 `resolveSiteForOrg` 로 확인한다. id 만 알면 남의 사이트 장비를
 *      끊을 수 있게 되면 안 된다 — org 확인과 site 확인을 모두 거친다.
 *   3) **감사 로그를 남긴다.** 누가·언제·어느 장비를 끊었는지. 그 장비가 넣은 전력이
 *      증빙의 근거이므로, 그 입력이 어디서 끊겼는지가 기록에 남아야 한다.
 *
 * ★ 되돌리는 창구는 두지 않는다. 끊은 키를 되살리는 것은 **분실한 단말을 다시 유효하게
 *   만드는 것**과 같고, 그 판단은 "새 장비를 페어링한다" 로 해야 한다 — 페어링은 장비가
 *   직접 코드를 띄우므로 그 단말이 실제로 손에 있다는 증거가 된다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { API_KEY_COLUMNS, type ApiKeyRow } from "@/lib/mrv/api-keys"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ apiKeyId: string }> },
) {
  return handleRoute(async () => {
    const { apiKeyId } = await params
    const auth = requireWriter(await authorizeMrv(req))

    const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
    // 사유는 선택이다. 요구하면 급한 상황(단말 분실)에서 아무 글자나 적게 되고, 그런
    // 기록은 없는 것보다 나쁘다. 적었으면 감사 로그의 note 로 그대로 남긴다.
    const reason =
      typeof body.reason === "string" && body.reason.trim() !== ""
        ? body.reason.trim().slice(0, 500)
        : null

    const { data, error } = await auth.db
      .from(T.apiKeys)
      .select(`${API_KEY_COLUMNS}, org_id`)
      .eq("id", apiKeyId)
      .maybeSingle()
    if (error) throw error
    const key = data as (ApiKeyRow & { org_id: string }) | null
    if (!key) throw new HttpError(404, `api key not found: ${apiKeyId}`)
    if (key.org_id !== auth.orgId) {
      throw new HttpError(403, "api key does not belong to your organization")
    }
    // org 가 맞아도 사이트 확인을 한 번 더 거친다 — 멀티사이트 조직에서 "내 org 의 키"
    // 라는 사실만으로는 끊는 사람이 그 사이트를 보고 있었는지 알 수 없다. 사이트가
    // 지워졌다면 여기서 404 가 나고, 그 경우 키 행도 cascade 로 이미 사라져 있다.
    const site = await resolveSiteForOrg(auth.db, key.site_id, auth.orgId)

    const revokedAt = new Date().toISOString()
    // 조건에 `revoked=false` 를 걸어, 두 사람이 동시에 끊어도 한쪽만 기록을 남긴다.
    // 이미 끊긴 키를 다시 끊으면 revoked_at/revoked_by 가 덮여 **처음 끊긴 시각이
    // 사라진다** — 그 시각이 "그 장비가 넣은 계측값이 어디까지인가" 의 기준이다.
    const { data: updated, error: updateError } = await auth.db
      .from(T.apiKeys)
      .update({ revoked: true, revoked_at: revokedAt, revoked_by: auth.userId })
      .eq("id", key.id)
      .eq("revoked", false)
      .select(API_KEY_COLUMNS)
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) {
      throw new HttpError(409, "this api key is already revoked")
    }

    /**
     * 장비가 아직 가져가지 않은 원문 키를 비운다.
     *
     * 페어링 행은 승인 시점에 만든 원문 키를 장비가 폴링해 가져갈 때까지 들고 있다
     * (`mrv_device_pairings.issued_key`). 그 사이에 운영자가 키를 끊었다면 그 원문은
     * 쓸모가 없는데도 표에 남는다. 폐기된 키라 인증은 통과하지 못하므로 위험하지는
     * 않지만, **쓸 수 없는 자격 문자열을 DB 에 남겨 둘 이유가 없다.**
     *
     * 실패해도 폐기를 되돌리지 않는다 — 끊는 것이 이 요청의 본질이고 이것은 정리다.
     */
    const { error: purgeError } = await auth.db
      .from(T.devicePairings)
      .update({ issued_key: null })
      .eq("api_key_id", key.id)
    if (purgeError) {
      console.error("[mrv] failed to purge issued_key after revoke", key.id, purgeError)
    }

    /**
     * 감사 로그.
     *
     * ── 기록 실패 시 무엇이 참인가 ──────────────────────────────────────────
     * **키는 이미 끊겼다.** 위 조건부 UPDATE 가 커밋됐고 인증 게이트는 그 열 하나를
     * 본다(lib/mrv/device-auth.ts). 그래서 감사 로그 실패를 그대로 던지면 응답은 500 이
     * 되고 화면은 "해제 실패" 를 띄우는데, 다시 누르면 이미 끊긴 키라 409 가 난다 —
     * 운영자는 분실한 단말이 아직 살아 있다고 믿게 된다. **그 거짓말이 이 기능을 만든
     * 이유를 지운다.**
     *
     * 그래서 성공은 성공으로 돌려주고, 기록이 빠졌다는 사실은 숨기지 않는다.
     *   (1) 서버 로그에 남긴다.
     *   (2) 응답에 `audit_recorded: false` 를 실어 화면이 "폐기는 됐고 기록은 남지
     *       않았다" 를 적을 수 있게 한다.
     * 키 행 자체가 `revoked_at`/`revoked_by` 를 들고 있으므로 "누가 언제 끊었는가" 는
     * 감사 로그 없이도 남는다 — 그 두 열을 행에 둔 이유가 여기서 값을 한다.
     */
    let auditRecorded = true
    try {
      await recordAudit(auth.db, {
        orgId: auth.orgId,
        actorId: auth.userId,
        entity: "api_keys",
        entityId: key.id,
        action: "revoke",
        diff: {
          before: { revoked: false, last_used_at: key.last_used_at },
          after: {
            revoked: true,
            revoked_at: revokedAt,
            revoked_by: auth.userId,
            site_id: site.id,
            label: key.label,
            // 원문 키도, 해시도 남기지 않는다(페어링 승인 로그와 같은 규약) — 감사 로그는
            // 열람 범위가 넓고, 키는 그 자체가 자격이다.
          },
        },
        note: reason,
      })
    } catch (err) {
      auditRecorded = false
      console.error("[mrv] api key revoked but audit log failed", key.id, err)
    }

    return NextResponse.json({
      ...(updated as ApiKeyRow),
      audit_recorded: auditRecorded,
    })
  })
}
