/**
 * 비교실험(A/B) — 검사와 결과 조립. (PRO, 사양서 화면 9번 "비교실험(A/B) 구성·결과")
 *
 * ── 무엇이 없었나 ──────────────────────────────────────────────────────────
 * 비교 화면은 잠긴 기준선 ↔ 조회 기간만 견줬다. "무엇을 바꿔 보았는가" 를 적는 개체가
 * 없어서, 폭기기를 바꾼 뒤 EI 가 내려갔다는 사실이 **어디에도 기록으로 남지 않았다.**
 * 기간을 다시 조회하면 숫자는 나오지만 그것이 실험이었다는 사실은 사람 머릿속에만 있다.
 *
 * ── 대조군 기간을 실험이 직접 들고 있다 ────────────────────────────────────
 * 기준선을 대조군으로 쓰면 실험마다 기준선을 새로 잠가야 하는데 기준선은 사이트당 하나,
 * 불변이다. 실험은 그보다 가벼운 "이 기간 ↔ 저 기간" 비교이고 둘 다 기록이 있는 과거
 * 구간이다. **두 구간 모두 라이브로 다시 산출한다** — 기준선 비교와 달리 어느 쪽도
 * 얼린 값이 아니므로, 원천 기록이 보정되면 두 값이 함께 움직인다. 그것이 맞다: 실험
 * 결과는 발행물이 아니라 조회이고, 발행이 필요하면 MRV 리포트로 낸다.
 *
 * ── 산식은 다시 쓰지 않는다 ────────────────────────────────────────────────
 * 두 기간의 KPI 는 `computeSiteKpiResults`, 차이는 엔진의 `compareMetric` 이 낸다.
 * 이 모듈은 입력 검사와 응답 조립만 한다.
 */

export const EXPERIMENT_NAME_MAX = 100
export const EXPERIMENT_TEXT_MAX = 2000
export const EXPERIMENT_STATUSES = ["running", "concluded", "abandoned"] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

/** 한 구간의 최소 길이. 하루보다 짧은 구간은 KPI 가 몇 건의 측정값에 좌우된다. */
export const MIN_PERIOD_MS = 24 * 60 * 60_000

export type ExperimentInput = {
  name?: unknown
  hypothesis?: unknown
  control_from?: unknown
  control_to?: unknown
  treatment_from?: unknown
  treatment_to?: unknown
}

export type ExperimentCheck =
  | {
      ok: true
      value: {
        name: string
        hypothesis: string | null
        control_from: Date
        control_to: Date
        treatment_from: Date
        treatment_to: Date
      }
    }
  | { ok: false; detail: string }

function instant(raw: unknown, label: string): Date | { err: string } {
  if (typeof raw !== "string" || raw === "") return { err: `${label}을(를) 적어야 합니다.` }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return { err: `${label}이(가) 올바른 시각이 아닙니다: ${raw}` }
  return d
}

export function checkExperiment(input: ExperimentInput): ExperimentCheck {
  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (name === "") return { ok: false, detail: "실험 이름을 적어야 합니다." }
  if (name.length > EXPERIMENT_NAME_MAX) {
    return { ok: false, detail: `실험 이름은 ${EXPERIMENT_NAME_MAX}자까지 적을 수 있습니다.` }
  }

  let hypothesis: string | null = null
  if (input.hypothesis !== undefined && input.hypothesis !== null) {
    if (typeof input.hypothesis !== "string") return { ok: false, detail: "가설은 문자열이어야 합니다." }
    hypothesis = input.hypothesis.trim() || null
    if (hypothesis !== null && hypothesis.length > EXPERIMENT_TEXT_MAX) {
      return { ok: false, detail: `가설은 ${EXPERIMENT_TEXT_MAX}자까지 적을 수 있습니다.` }
    }
  }

  const cf = instant(input.control_from, "대조군 시작")
  if ("err" in cf) return { ok: false, detail: cf.err }
  const ct = instant(input.control_to, "대조군 끝")
  if ("err" in ct) return { ok: false, detail: ct.err }
  const tf = instant(input.treatment_from, "처리군 시작")
  if ("err" in tf) return { ok: false, detail: tf.err }
  const tt = instant(input.treatment_to, "처리군 끝")
  if ("err" in tt) return { ok: false, detail: tt.err }

  if (cf.getTime() >= ct.getTime()) return { ok: false, detail: "대조군 구간의 시작이 끝보다 앞서야 합니다." }
  if (tf.getTime() >= tt.getTime()) return { ok: false, detail: "처리군 구간의 시작이 끝보다 앞서야 합니다." }
  if (ct.getTime() - cf.getTime() < MIN_PERIOD_MS || tt.getTime() - tf.getTime() < MIN_PERIOD_MS) {
    return { ok: false, detail: "각 구간은 최소 하루 이상이어야 합니다 — 그보다 짧으면 KPI 가 몇 건의 측정값에 좌우됩니다." }
  }
  // 겹치는 두 구간은 같은 기록을 양쪽에 세는 것이라 비교가 아니다.
  if (cf.getTime() < tt.getTime() && tf.getTime() < ct.getTime()) {
    return { ok: false, detail: "대조군과 처리군 구간이 겹칩니다 — 같은 기록을 양쪽에 세면 비교가 되지 않습니다." }
  }

  return { ok: true, value: { name, hypothesis, control_from: cf, control_to: ct, treatment_from: tf, treatment_to: tt } }
}

export type ConclusionCheck = { ok: true; status: ExperimentStatus; conclusion: string | null } | { ok: false; detail: string }

/** 끝낼 때의 입력 검사. 결론은 `concluded` 에 필수 — 결론 없는 '결론' 은 기록이 아니다. */
export function checkConclusion(input: { status?: unknown; conclusion?: unknown }): ConclusionCheck {
  const status = input.status
  if (status !== "concluded" && status !== "abandoned") {
    return { ok: false, detail: "status 는 concluded 또는 abandoned 여야 합니다." }
  }
  let conclusion: string | null = null
  if (input.conclusion !== undefined && input.conclusion !== null) {
    if (typeof input.conclusion !== "string") return { ok: false, detail: "결론은 문자열이어야 합니다." }
    conclusion = input.conclusion.trim() || null
    if (conclusion !== null && conclusion.length > EXPERIMENT_TEXT_MAX) {
      return { ok: false, detail: `결론은 ${EXPERIMENT_TEXT_MAX}자까지 적을 수 있습니다.` }
    }
  }
  if (status === "concluded" && conclusion === null) {
    return { ok: false, detail: "결론을 적어야 합니다 — 무엇을 확인했는지 없는 '결론' 은 기록이 아닙니다. 결론 없이 접으려면 abandoned 로 두십시오." }
  }
  return { ok: true, status, conclusion }
}
