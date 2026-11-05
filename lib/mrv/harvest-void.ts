/**
 * 생산량 기록 **정정** — 지우지 않고 무효로 표시한다.
 *
 * ── 왜 삭제가 아닌가 ────────────────────────────────────────────────────────
 * 잘못 넣은 생산량을 되돌릴 길이 없어 DB 를 직접 고쳐야 했다. 그래서 창구가 필요한데,
 * **DELETE 는 답이 아니다.** 생산량은 EI · 폭기 EI · FCR · OEI 의 분모이고, 행이 사라지면
 * 이미 발행된 리포트가 참조한 근거가 흔적 없이 없어진다. 그 뒤에 같은 기간을 다시 조회하면
 * 전에 인쇄된 숫자가 재현되지 않는데, 왜 달라졌는지 설명할 자리가 없다.
 *
 * 그래서 무효화(void)다. 행은 남고 KPI 산입에서만 빠지며, **누가 언제 왜** 뺐는지가 함께
 * 남는다. 감사 로그와 합쳐 보면 "그때는 이 값이 있었고 이런 이유로 뺐다" 가 재구성된다.
 * 되돌리기(unvoid)도 같은 창구다 — 잘못 무효화한 것 역시 되돌릴 수 있어야 한다.
 *
 * `app/api/mrv` 전체에 DELETE 라우트가 하나도 없는 것은 이 저장소의 일관된 태도이고,
 * 이 창구도 그것을 깨지 않는다.
 *
 * ── 사유를 요구한다 ────────────────────────────────────────────────────────
 * 사유 없는 무효화는 검산할 수 없다. "왜 이 기간 생산량이 빠졌는가" 에 답하지 못하면
 * 분모를 임의로 줄여 EI 를 좋게 만든 것과 구분되지 않는다. 그래서 필수다.
 */

import { createMissingColumnFallback } from "./missing-column-fallback"

/** 사유 길이 상한. 리포트와 감사 로그에 그대로 들어간다. */
export const VOID_REASON_MAX = 500

/**
 * `mrv_harvest_logs` 의 무효화 열이 아직 없는 DB 를 만났을 때.
 *
 * 읽기 경로(KPI 조회)는 이 칸 없이도 산출을 계속해야 한다 — 열 셋이 없다고 증빙 산출이
 * 통째로 멈추면 안 된다. 그 창에서는 **모든 행을 살아 있는 것으로 본다**(무효화된 행이
 * 아직 있을 수 없으므로 결과가 같다).
 *
 * 쓰기(무효화 창구)는 반대다. 칸이 없으면 **거절한다** — 칸만 빼고 update 하면 사람이
 * 무효로 만들었다고 믿는 행이 그대로 산입된 채 남는다. 산정 근거 쓰기와 같은 판단이다.
 */
export const harvestVoidColumns = createMissingColumnFallback({
  columns: ["voided_at", "voided_by", "void_reason"],
  message: (where) =>
    "[mrv] mrv_harvest_logs 의 정정 열(voided_at / voided_by / void_reason)이 없습니다 — " +
    `${where} 에서 그 칸을 빼고 진행합니다. 생산량은 그대로 조회되지만 무효 처리된 기록을 ` +
    "가려낼 수 없습니다(열이 없는 동안에는 무효 처리 자체가 불가능하므로 산출 결과는 " +
    "같습니다). supabase/migrations/mrv_remaining_scope.sql 을 실행하십시오 " +
    "(실행하면 추가 조치 없이 정상 경로로 돌아옵니다). 정정 창구는 이 폴백을 쓰지 않고 " +
    "거절합니다 — 무효로 만들었다고 믿는 기록이 그대로 산입되는 쪽이 더 나쁩니다. " +
    "이 메시지는 열이 없는 동안 10분마다 다시 남습니다.",
})

export type VoidCheck = { ok: true; reason: string } | { ok: false; detail: string }

/** 무효화 요청의 사유를 검사한다. */
export function checkVoidReason(raw: unknown): VoidCheck {
  const reason = typeof raw === "string" ? raw.trim() : ""
  if (reason === "") {
    return {
      ok: false,
      detail:
        "무효 처리 사유를 적어야 합니다 — 사유 없이 빠진 생산량은 분모를 임의로 줄여 EI 를 " +
        "좋게 만든 것과 구분되지 않습니다. 무엇이 잘못 입력됐는지 적으십시오.",
    }
  }
  if (reason.length > VOID_REASON_MAX) {
    return { ok: false, detail: `무효 처리 사유는 ${VOID_REASON_MAX}자까지 적을 수 있습니다.` }
  }
  return { ok: true, reason }
}
