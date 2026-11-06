/**
 * "마이그레이션이 아직 안 돌아간 DB" 를 만났을 때의 공통 뼈대.
 *
 * ── 왜 뽑아 두는가 ──────────────────────────────────────────────────────────
 * 이 저장소의 마이그레이션은 **실행이 사람 몫**이다. 그래서 배포가 SQL 보다 먼저 올라가는
 * 창이 반드시 생기고, 그 창에서 PostgREST 는 모르는 열이 섞인 요청을 거절한다
 * (select 는 Postgres 의 `42703`, insert 는 `PGRST204`). 호출부의 `if (error) throw error`
 * 가 그것을 500 으로 바꾸는데, 그 500 이 **증빙 산출 전체의 길목**에서 터진다.
 *
 * 같은 사고를 세 번 겪었고(커밋 632b2a6 · measurement-basis · production-basis) 매번 같은
 * 모양의 모듈을 하나씩 더 썼다. 네 번째를 베끼는 대신 뼈대를 여기 두고, 각 열 묶음은
 * **설정만** 적는다. 기억 창·판정 규칙·로그 주기가 모듈마다 조금씩 달라지는 것을 막는 것이
 * 이 파일의 목적이다.
 *
 * ── 규칙 (세 모듈이 공유한다) ───────────────────────────────────────────────
 *   1) 평소에는 그 칸들을 **포함해** 요청한다(열이 있으면 이 파일은 아무 일도 하지 않는다).
 *   2) 거절이 **이 열들 때문임이 확인되면** 칸을 뺀 요청으로 한 번 더 한다.
 *   3) 그 사실을 **로그에 크게 남긴다.** 조용히 지나가면 반 년 뒤 "왜 전부 미기재인가" 를
 *      아무도 설명할 수 없다.
 *   4) 같은 프로세스에서 잠시 **기억**해 헛된 왕복을 반복하지 않되, `retryAfterMs` 뒤에
 *      저절로 잊는다 — 사람이 SQL 을 돌린 뒤 **아무 조치 없이** 정상 경로로 돌아와야 한다.
 *
 * ★ 이 기억은 **칸을 요청에 넣을지만** 정한다. 저장되는 값이나 산출 결과에 닿지 않는다.
 *
 * ⚠ 폴백이 있다는 것은 마이그레이션을 돌리지 않아도 된다는 뜻이 **아니다.** 그 상태로
 *   쌓인 기록은 메타데이터가 빈 채로 남는다. 로그가 그 사실을 알리는 유일한 경로다.
 */

/** 모르는 열. select 는 Postgres 의 42703, insert 는 PostgREST 의 PGRST204 로 온다. */
const UNKNOWN_COLUMN_CODES = new Set(["42703", "PGRST204"])

/** 기본 기억 창. 사람이 SQL 을 돌리고 나면 늦어도 이만큼 뒤에 정상 경로로 돌아온다. */
export const DEFAULT_RETRY_AFTER_MS = 10 * 60_000

export type MissingColumnFallback = {
  /** 이번 요청에 그 칸들을 포함해도 되는가. */
  shouldSend: () => boolean
  /** 이 오류가 **그 열이 없기 때문**인가. */
  isMissingError: (error: unknown) => boolean
  /** 열이 없다는 사실을 기억하고 로그에 남긴다. `where` 는 어느 질의였는지. */
  note: (where: string) => void
  /** 시험용 — 프로세스 기억을 지운다(검증 스크립트가 왕복을 되돌려 확인할 때 쓴다). */
  reset: () => void
}

export function createMissingColumnFallback(params: {
  /** 이 마이그레이션이 더하는 열 이름들. 오류 본문에 이 중 하나가 적혀 있어야 판정한다. */
  columns: readonly string[]
  /** 로그 한 줄을 만든다. `where` 는 호출부가 준 질의 이름. */
  message: (where: string) => string
  retryAfterMs?: number
}): MissingColumnFallback {
  const { columns, message } = params
  const retryAfterMs = params.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS
  let missingSince: number | null = null

  return {
    shouldSend() {
      if (missingSince === null) return true
      if (Date.now() - missingSince >= retryAfterMs) {
        // 창이 지났다. 다시 넣어 본다 — 사람이 그 사이 SQL 을 돌렸으면 이대로 정상 복귀다.
        missingSince = null
        return true
      }
      return false
    },

    /**
     * 코드만으로 판정하지 않고 **열 이름이 오류 본문에 적혀 있는지까지** 본다. 다른 열
     * 때문에 42703 이 난 요청을 이 열 탓으로 돌리면, 그 칸만 빼고 재시도해 똑같이
     * 실패하거나 — 더 나쁘게 — 증빙 열이 빠진 요청이 성공해 버린다.
     */
    isMissingError(error: unknown) {
      if (error === null || typeof error !== "object") return false
      const e = error as {
        code?: unknown
        message?: unknown
        details?: unknown
        hint?: unknown
      }
      if (typeof e.code !== "string" || !UNKNOWN_COLUMN_CODES.has(e.code)) return false
      const text = [e.message, e.details, e.hint]
        .filter((x): x is string => typeof x === "string")
        .join(" ")
      return columns.some((c) => text.includes(c))
    },

    /**
     * 기억이 없던 상태에서만 찍는다 — 요청마다 찍으면 묻혀서 정작 읽히지 않는다. 기억은
     * `retryAfterMs` 뒤에 저절로 풀리므로 열이 없는 동안에는 **그 주기로 다시 찍힌다**
     * (한 번만 찍고 조용해지면, 마이그레이션을 잊은 채 며칠이 지나도 로그에 흔적이 없다).
     */
    note(where: string) {
      const firstTime = missingSince === null
      missingSince = Date.now()
      if (!firstTime) return
      console.error(message(where))
    },

    reset() {
      missingSince = null
    },
  }
}
