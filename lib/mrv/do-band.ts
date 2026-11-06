/**
 * 수조의 DO 목표대역(target_do_min / target_do_max) 검증 — **한 곳에만 둔다.**
 *
 * ── 이 값이 무엇을 결정하는가 ───────────────────────────────────────────────
 * OEI(산소효율지수)의 분자는 「DO 가 목표대역 안에 있던 비율」이다. 그래서 이 두 수가
 * 없으면 OEI 는 **애초에 산출 대상이 아니다**(`lib/mrv/kpi-service.ts` 의 band 선택).
 * 반대로 대역을 넓게 잡으면 유지율이 올라가 OEI 가 좋아 보인다 — 즉 이 값은 지표를
 * 직접 움직이는 설정이고, 그래서 쓰기 경로가 값을 검사하고 감사 로그를 남긴다.
 *
 * ── 왜 산식 모듈(lib/mrv/kpi)에 두지 않는가 ────────────────────────────────
 * 이것은 산식이 아니라 **입력을 받아들이는 기준**이다. `lib/mrv/kpi` 는 원본 Python 과
 * 차분 검증으로 묶여 있어 원본에 없는 것을 넣지 않는다(AGENTS.md 절대규칙 1). 받는
 * 쪽의 가드는 경계 바깥에 두는 것이 이 저장소의 방식이다.
 *
 * ── 상한을 20 mg/L 로 두는 근거 ─────────────────────────────────────────────
 * 수집 경로가 이미 `do_mg_l` 0~20 바깥을 `suspect` 로 표시한다
 * (`lib/mrv/ingestion.ts`). 목표대역을 그 바깥에 두면 **정상 측정값이 영원히 대역 밖**이
 * 되어 OEI 가 0 에 붙는다. 두 경계를 같은 범위로 맞춘다.
 */

/** 수집 경로의 `do_mg_l` 타당 범위와 같다. */
export const DO_BAND_MIN_MG_L = 0
export const DO_BAND_MAX_MG_L = 20

/**
 * 하한과 상한 사이에 최소한 이만큼은 벌어져 있어야 한다.
 *
 * 0.1 mg/L 미만의 대역은 센서 분해능 아래라 '유지율' 이 사실상 0 이 된다 — 설정이
 * 아니라 입력 실수일 가능성이 훨씬 높다.
 */
export const DO_BAND_MIN_WIDTH_MG_L = 0.1

export type DoBandInput = {
  target_do_min?: number | string | null
  target_do_max?: number | string | null
}

export type DoBandParseResult =
  | { ok: true; band: { target_do_min: number; target_do_max: number } | null }
  | { ok: false; detail: string }

/**
 * 받은 두 값을 대역으로 해석한다.
 *
 * 세 가지 결과만 있다:
 *   · 둘 다 비었다 → `band: null` (대역 해제 = OEI 산출 대상에서 빠진다)
 *   · 둘 다 유효하다 → `band: {...}`
 *   · 그 밖 → 거부
 *
 * **한쪽만 받는 일은 없다.** 하한만 저장되면 `kpi-service` 의 band 선택이 그 수조를
 * 건너뛰므로(둘 다 non-null 이어야 한다) 저장은 됐는데 OEI 는 여전히 산출 불가인,
 * 화면에서 설명되지 않는 상태가 된다.
 */
export function parseDoBand(input: DoBandInput): DoBandParseResult {
  const rawMin = input.target_do_min
  const rawMax = input.target_do_max
  const minEmpty = rawMin === undefined || rawMin === null || rawMin === ""
  const maxEmpty = rawMax === undefined || rawMax === null || rawMax === ""

  if (minEmpty && maxEmpty) return { ok: true, band: null }
  if (minEmpty || maxEmpty) {
    return {
      ok: false,
      detail:
        "DO 목표대역은 하한과 상한을 함께 적어야 합니다 — 한쪽만 저장되면 OEI 는 여전히 " +
        "산출되지 않습니다. 대역을 없애려면 두 칸을 모두 비우십시오.",
    }
  }

  const min = Number(rawMin)
  const max = Number(rawMax)
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { ok: false, detail: "DO 목표대역은 숫자여야 합니다." }
  }
  for (const [label, v] of [
    ["하한", min],
    ["상한", max],
  ] as const) {
    if (v < DO_BAND_MIN_MG_L || v > DO_BAND_MAX_MG_L) {
      return {
        ok: false,
        detail:
          `DO 목표대역 ${label}(${v} mg/L)이 범위를 벗어납니다 — ` +
          `${DO_BAND_MIN_MG_L}~${DO_BAND_MAX_MG_L} mg/L 안이어야 합니다. ` +
          "수집 경로가 그 바깥 측정값을 suspect 로 표시하므로, 대역을 그 밖에 두면 " +
          "정상 측정값이 영원히 대역 밖이 되어 OEI 가 0 에 붙습니다.",
      }
    }
  }
  if (max - min < DO_BAND_MIN_WIDTH_MG_L) {
    return {
      ok: false,
      detail:
        `DO 목표대역 상한(${max})이 하한(${min})보다 최소 ` +
        `${DO_BAND_MIN_WIDTH_MG_L} mg/L 높아야 합니다.`,
    }
  }
  return { ok: true, band: { target_do_min: min, target_do_max: max } }
}
