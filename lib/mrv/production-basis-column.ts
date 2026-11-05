/**
 * `mrv_harvest_logs` 의 산정 근거 세 열이 **아직 없는 DB** 를 만났을 때의 처리.
 *
 * ── 왜 이 파일이 있는가 ─────────────────────────────────────────────────────
 * 그 열들은 마이그레이션(supabase/migrations/mrv_harvest_logs_production_basis.sql)이
 * 추가하고 **실행은 사람 몫**이다. 그래서 배포가 SQL 보다 먼저 올라가는 창이 반드시
 * 존재한다. 그 창에서 PostgREST 는 모르는 열이 섞인 요청을 거절하고(select 는 Postgres 의
 * `42703`, insert 는 `PGRST204`), 호출부의 `if (error) throw error` 가 그것을 500 으로
 * 바꾼다.
 *
 * 그 500 이 어디서 터지는지가 문제다. 수확·계측 기록 조회는 **KPI·리포트·알림·기준선
 * 판정 전부의 질의**이고(EI·폭기 EI·FCR·OEI 의 분모가 거기서 나온다), 열 셋이 없는
 * 동안 증빙 산출이 통째로 멈춘다. 같은 사고가 두 번 있었다 — `632b2a6`("인증 경로가
 * 마이그레이션 전에 죽지 않게 한다")와 `lib/mrv/measurement-basis-column.ts`. 거기 적힌
 * 기준이 여기서도 그대로다:
 *
 *   **생체량은 증빙이고 산정 근거는 그 증빙에 대한 메타데이터다. 메타데이터를 적을 칸이
 *   없는 것이 증빙을 받지 못할 이유가 되어서는 안 된다.**
 *
 * ── 그래서 어떻게 하는가 ────────────────────────────────────────────────────
 *   1) 평소에는 그 칸들을 **포함해** 요청한다(열이 있으면 이 파일은 아무 일도 하지 않는다).
 *   2) 거절이 **이 열들 때문임이 확인되면**(아래 판정) 칸을 뺀 요청으로 한 번 더 한다.
 *      생체량은 들어가고·읽히고, 산정 근거만 null(미기재)로 남는다.
 *   3) 그 사실을 **로그에 크게 남긴다.** 조용히 지나가면 반 년 뒤 "산정 근거가 왜 전부
 *      미기재인가" 를 아무도 설명할 수 없다.
 *   4) 같은 프로세스에서 잠시 **기억**해 헛된 왕복을 반복하지 않는다. 다만 영구 기억이
 *      아니라 `RETRY_AFTER_MS` 뒤에 저절로 잊는다 — 사람이 SQL 을 돌린 뒤 **아무 조치 없이
 *      정상 경로로 돌아와야** 하기 때문이다.
 *
 * ★ 이 기억은 **메타데이터 칸을 요청에 넣을지만** 정한다. 저장되는 biomass_kg·ts,
 *   분모 선택(pickBiomassBounds), KPI 산출값에는 닿지 않는다.
 *
 * ⚠ 이 폴백은 **마이그레이션을 돌리지 않아도 된다는 뜻이 아니다.** 이 상태로 쌓인 수확
 *   기록은 전부 미기재이고, 리포트는 "분모로 쓰인 생체량이 실측인지 알 수 없다" 를 그대로
 *   인쇄한다. 로그가 그 사실을 알리는 유일한 경로다.
 *
 * ── 쓰기 창구는 폴백하지 않는다 (판단) ─────────────────────────────────────
 * 이 모듈은 **읽기 경로에서만** 쓴다. 생산량 입력 라우트는 산정 근거를 요구하므로
 * (app/api/mrv/sites/[siteId]/harvests/route.ts), 그 칸을 저장할 수 없는 DB 에서 칸만 빼고
 * insert 하면 **사람이 "계산생체량" 이라고 적어 넣은 사실이 조용히 사라진 채** 저장된다.
 * 그쪽은 실패하는 쪽이 옳다 — 그래서 라우트는 이 오류를 그대로 올려보내고, 응답이
 * 마이그레이션을 가리킨다.
 */

/** 열이 없다고 판정한 뒤, 다시 그 칸을 넣어 보기까지 기다리는 시간(10분). */

import { createMissingColumnFallback } from "./missing-column-fallback"

/**
 * 뼈대는 `./missing-column-fallback.ts` 에 있다(같은 모양을 세 번 쓰게 되어 뽑았다).
 * 이 파일에 남는 것은 **이 열 묶음에만 해당하는 것** — 열 이름과 로그 문구다.
 */
const fallback = createMissingColumnFallback({
  columns: ["production_basis", "production_basis_note", "survival_adjusted"],
  message: (where) =>
    "[mrv] mrv_harvest_logs 의 산정 근거 열(production_basis / production_basis_note / " +
    `survival_adjusted)이 없습니다 — ${where} 에서 그 칸들을 빼고 진행합니다. 생체량은 ` +
    "조회되지만 생산량 산정 근거는 전부 '미기재' 로 남고, MRV 리포트는 분모로 쓰인 " +
    "생체량이 실측 출하·계측량인지 알 수 없다고 인쇄합니다. " +
    "supabase/migrations/mrv_harvest_logs_production_basis.sql 을 실행하십시오 " +
    "(실행하면 추가 조치 없이 정상 경로로 돌아옵니다). 생산량 입력 창구는 이 폴백을 " +
    "쓰지 않고 거절합니다 — 사람이 적어 넣은 근거가 조용히 사라지는 쪽이 더 나쁩니다. " +
    "이 메시지는 열이 없는 동안 10분마다 다시 남습니다.",
})

/** 이번 요청에 산정 근거 칸들을 포함해도 되는가. */
export function shouldSendProductionBasisColumns(): boolean {
  return fallback.shouldSend()
}

/** 이 오류가 **산정 근거 열이 없기 때문**인가. */
export function isMissingProductionBasisColumnError(error: unknown): boolean {
  return fallback.isMissingError(error)
}

/** 열이 없다는 사실을 기억하고 **로그에 남긴다.** */
export function noteMissingProductionBasisColumn(where: string): void {
  fallback.note(where)
}

/** 시험용 — 프로세스 기억을 지운다(검증 스크립트가 왕복을 되돌려 확인할 때 쓴다). */
export function resetProductionBasisColumnMemory(): void {
  fallback.reset()
}
