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
const RETRY_AFTER_MS = 10 * 60_000

/** 열이 없다고 판정한 시각(프로세스 기억). null 이면 "열이 있다고 본다". */
let missingSince: number | null = null

/**
 * 모르는 열을 알리는 오류 코드.
 *   · `42703` — Postgres `undefined_column`. select 에 없는 열을 적었을 때.
 *   · `PGRST204` — PostgREST 가 스키마 캐시에 없는 열을 **본문**에서 발견했을 때.
 */
const UNKNOWN_COLUMN_CODES = new Set(["42703", "PGRST204"])

/** 이 마이그레이션이 더하는 열 이름들. 오류 본문에 이 중 하나가 적혀 있어야 판정한다. */
const COLUMNS = ["production_basis", "production_basis_note", "survival_adjusted"] as const

/** 이번 요청에 산정 근거 칸들을 포함해도 되는가. */
export function shouldSendProductionBasisColumns(): boolean {
  if (missingSince === null) return true
  if (Date.now() - missingSince >= RETRY_AFTER_MS) {
    // 창이 지났다. 다시 넣어 본다 — 사람이 그 사이 SQL 을 돌렸으면 이대로 정상 복귀다.
    missingSince = null
    return true
  }
  return false
}

/**
 * 이 오류가 **산정 근거 열이 없기 때문**인가.
 *
 * 코드만으로 판정하지 않고 **열 이름이 오류 본문에 적혀 있는지까지** 본다. 다른 열 때문에
 * 42703 이 난 요청을 이 열 탓으로 돌리면, 그 칸만 빼고 재시도해 똑같이 실패하거나 —
 * 더 나쁘게 — 증빙 열이 빠진 요청이 성공해 버린다.
 */
export function isMissingProductionBasisColumnError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
  if (typeof e.code !== "string" || !UNKNOWN_COLUMN_CODES.has(e.code)) return false
  const text = [e.message, e.details, e.hint]
    .filter((x): x is string => typeof x === "string")
    .join(" ")
  return COLUMNS.some((c) => text.includes(c))
}

/**
 * 열이 없다는 사실을 기억하고 **로그에 남긴다.**
 *
 * 기억이 없던 상태에서만 찍는다 — 요청마다 찍으면 묻혀서 정작 읽히지 않는다. 기억은
 * 10분 뒤 저절로 풀리므로 열이 없는 동안에는 **10분마다 다시 찍힌다**(한 번만 찍고
 * 조용해지면, 마이그레이션을 잊은 채 며칠이 지나도 로그에 흔적이 없다).
 */
export function noteMissingProductionBasisColumn(where: string): void {
  const firstTime = missingSince === null
  missingSince = Date.now()
  if (!firstTime) return
  console.error(
    "[mrv] mrv_harvest_logs 의 산정 근거 열(production_basis / production_basis_note / " +
      `survival_adjusted)이 없습니다 — ${where} 에서 그 칸들을 빼고 진행합니다. 생체량은 ` +
      "조회되지만 생산량 산정 근거는 전부 '미기재' 로 남고, MRV 리포트는 분모로 쓰인 " +
      "생체량이 실측 출하·계측량인지 알 수 없다고 인쇄합니다. " +
      "supabase/migrations/mrv_harvest_logs_production_basis.sql 을 실행하십시오 " +
      "(실행하면 추가 조치 없이 정상 경로로 돌아옵니다). 생산량 입력 창구는 이 폴백을 " +
      "쓰지 않고 거절합니다 — 사람이 적어 넣은 근거가 조용히 사라지는 쪽이 더 나쁩니다. " +
      "이 메시지는 열이 없는 동안 10분마다 다시 남습니다.",
  )
}

/** 시험용 — 프로세스 기억을 지운다(검증 스크립트가 왕복을 되돌려 확인할 때 쓴다). */
export function resetProductionBasisColumnMemory(): void {
  missingSince = null
}
