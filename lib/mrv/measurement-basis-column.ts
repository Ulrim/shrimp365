/**
 * `mrv_readings.measurement_basis` 열이 **아직 없는 DB** 를 만났을 때의 처리.
 *
 * ── 왜 이 파일이 있는가 ─────────────────────────────────────────────────────
 * 그 열은 마이그레이션(supabase/migrations/mrv_readings_measurement_basis.sql)이 추가하고,
 * **실행은 사람 몫**이다. 그래서 배포가 SQL 보다 먼저 올라가는 창이 반드시 존재한다.
 * 그 창에서 PostgREST 는 모르는 열이 섞인 요청을 거절하고(insert 는 `PGRST204`, select 는
 * Postgres 의 `42703`), 호출부의 `if (error) throw error` 가 그것을 500 으로 바꾼다.
 *
 * 그 500 이 어디서 터지는지가 문제다. `processBatch` 는 **모든 계측값 쓰기의 공통 경로**이고
 * (장비 키·세션 수기 입력·기록지 CSV 세 창구가 전부 지난다) 전력만이 아니라 **DO·수질
 * 계측값도** 그 길로 들어온다. `computeSiteKpiResults` 의 계측값 조회는 KPI·리포트·알림·
 * 기준선 판정 전부의 첫 질의다. 즉 열 하나가 없는 동안 **증빙 입력과 증빙 산출이 통째로
 * 멈춘다.**
 *
 * 같은 사고가 바로 앞에 있었다 — `632b2a6`("인증 경로가 마이그레이션 전에 죽지 않게
 * 한다"). 그때는 인증 질의가 아직 없는 `last_used_at` 을 **select** 해서 전 장비의 수집이
 * 막힐 뻔한 것이었고, 거기 적힌 기준이 여기서도 그대로다:
 *
 *   **계측값은 증빙이고 자료유형은 그 증빙에 대한 메타데이터다. 메타데이터를 적을 칸이
 *   없는 것이 증빙을 받지 못할 이유가 되어서는 안 된다.**
 *
 * ── 그래서 어떻게 하는가 ────────────────────────────────────────────────────
 *   1) 평소에는 그 칸을 **포함해** 요청한다(열이 있으면 이 파일은 아무 일도 하지 않는다).
 *   2) 거절이 **이 열 때문임이 확인되면**(아래 판정) 그 칸을 뺀 요청으로 한 번 더 한다.
 *      계측값은 들어가고, 자료유형만 null(미기재)로 남는다.
 *   3) 그 사실을 **로그에 크게 남긴다.** 조용히 지나가면 반 년 뒤 "자료유형이 왜 전부
 *      미기재인가" 를 아무도 설명할 수 없다.
 *   4) 같은 프로세스에서 잠시 **기억**해 헛된 왕복을 반복하지 않는다. 다만 영구 기억이
 *      아니라 `RETRY_AFTER_MS` 뒤에 저절로 잊는다 — 사람이 SQL 을 돌린 뒤 **아무 조치 없이
 *      정상 경로로 돌아와야** 하기 때문이다(프로세스 재시작을 조건으로 두면 장시간 떠 있는
 *      인스턴스가 영원히 미기재로 저장한다).
 *
 * ★ 이 기억은 **메타데이터 칸을 요청에 넣을지만** 정한다. 저장되는 value·quality_flag,
 *   멱등 판정(meter_id, ts), KPI 산출값에는 닿지 않는다 — 시각에 따라 달라지는 것이
 *   계측값 자체가 되면 안 된다(ingestion.ts 머리말의 결정론 규약).
 *
 * ⚠ 이 폴백은 **마이그레이션을 돌리지 않아도 된다는 뜻이 아니다.** 이 상태로 쌓인 전력은
 *   전부 미기재이고, 리포트는 "산입된 전력이 실측인지 알 수 없다" 를 그대로 인쇄한다.
 *   로그가 그 사실을 알리는 유일한 경로다.
 */

import { createMissingColumnFallback } from "./missing-column-fallback"

/**
 * 뼈대는 `./missing-column-fallback.ts` 에 있다(같은 모양을 세 번 쓰게 되어 뽑았다).
 * 이 파일에 남는 것은 **이 열 묶음에만 해당하는 것** — 열 이름과 로그 문구다.
 */
const fallback = createMissingColumnFallback({
  columns: ["measurement_basis"],
  message: (where) =>
    "[mrv] mrv_readings.measurement_basis 열이 없습니다 — " +
    `${where} 에서 그 칸을 빼고 진행합니다. 계측값은 저장·조회되지만 전력 자료유형은 ` +
    "전부 '미기재' 로 남고, MRV 리포트는 산입된 전력이 계량기 실측인지 알 수 없다고 " +
    "인쇄합니다. supabase/migrations/mrv_readings_measurement_basis.sql 을 실행하십시오 " +
    "(실행하면 추가 조치 없이 정상 경로로 돌아옵니다). 이 메시지는 열이 없는 동안 " +
    "10분마다 다시 남습니다.",
})

/** 이번 요청에 `measurement_basis` 를 포함해도 되는가. */
export function shouldSendMeasurementBasisColumn(): boolean {
  return fallback.shouldSend()
}

/** 이 오류가 **`measurement_basis` 열이 없기 때문**인가. */
export function isMissingMeasurementBasisColumnError(error: unknown): boolean {
  return fallback.isMissingError(error)
}

/** 열이 없다는 사실을 기억하고 **로그에 남긴다.** */
export function noteMissingMeasurementBasisColumn(where: string): void {
  fallback.note(where)
}

/** 시험용 — 프로세스 기억을 지운다(검증 스크립트가 왕복을 되돌려 확인할 때 쓴다). */
export function resetMeasurementBasisColumnMemory(): void {
  fallback.reset()
}
