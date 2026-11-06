/**
 * 전력 자료유형(measurement basis) — 그 kWh 를 **계량기가 쟀는가, 산식이 냈는가**.
 *
 * ── 왜 이 파일이 따로 있는가 ─────────────────────────────────────────────────
 * `lib/mrv/quality-flags.ts` 와 같은 자리다. 값을 **만드는 곳**은 입력 화면과 수집
 * 경로이고, 그것을 **읽어 밝히는 곳**은 인쇄 리포트·리포트 화면·기준선 잠금 판정이다.
 * 네 곳이 각자 문장을 지으면 화면으로 본 사람과 인쇄물로 본 사람이 **다른 사실**을
 * 알게 되므로, 값의 의미와 사람이 읽는 문구를 한곳에 둔다.
 *
 * ★ 이 모듈은 의존성이 없는 순수 모듈로 유지할 것. 입력 화면(`"use client"`)과 인쇄
 *   리포트 렌더러와 라우트와 CSV 파서가 같이 import 한다 — `next/server` 나 DB 를 끌고
 *   들어오면 클라이언트 번들이 깨진다.
 *
 * ── `source` 와 무엇이 다른가 ────────────────────────────────────────────────
 * `mrv_readings.source`(device/manual/csv)는 **누가 넣었는가**다. 이 열은 **어떻게
 * 얻었는가**다. 둘은 직교한다 — 계량기를 읽어 손으로 적은 값도 manual 이고, 명판 정격으로
 * 계산한 표를 올린 값도 csv 다. 창구가 같아도 증거의 종류가 다르다.
 *
 * ── null = 미기재 ───────────────────────────────────────────────────────────
 * 이 열이 생기기 전에 저장된 행은 전부 null 이고, 그 행들이 실측이었다는 기록은 어디에도
 * 없다(supabase/migrations/mrv_readings_measurement_basis.sql). 그래서 null 은
 * **「미기재」**이며, 화면·리포트가 그렇게 적는다 — 실측으로 세지 않고, 실측이 아니라고도
 * 단정하지 않는다.
 */

/** 저장 가능한 자료유형 전체. `mrv_readings.measurement_basis` 의 CHECK 와 같은 집합이다. */
export const MEASUREMENT_BASES = ["metered", "calculated", "estimated"] as const

export type MeasurementBasis = (typeof MEASUREMENT_BASES)[number]

/**
 * 실측이 아닌 자료유형. **미기재(null)는 여기 들어가지 않는다** — 모른다는 것과 실측이
 * 아니라는 것은 다른 사실이고, 뭉개면 옛 데이터 전부가 "계산값" 으로 경고된다.
 */
export const NON_METERED_BASES = ["calculated", "estimated"] as const

/** 화면·인쇄물이 함께 쓰는 짧은 이름. 괄호 안이 판단 근거다. */
export const MEASUREMENT_BASIS_LABELS: Record<MeasurementBasis, string> = {
  metered: "실측(계량기 지침)",
  calculated: "계산값(산식)",
  estimated: "어림값",
}

/** 미기재(null)의 이름. 라벨 표에 null 키를 둘 수 없어 따로 둔다. */
export const UNRECORDED_BASIS_LABEL = "미기재"

/**
 * 고를 때 읽는 한 줄. "무엇을 고르면 되는가" 가 아니라 **그 값이 뜻하는 사실**을 적는다 —
 * 고르는 사람이 자기 기록이 어느 쪽인지 판단할 수 있어야 한다.
 */
export const MEASUREMENT_BASIS_HINTS: Record<MeasurementBasis, string> = {
  metered:
    "계량기가 잰 값입니다 — 적산 지침의 차, 전력계·게이트웨이가 올린 구간 사용량.",
  calculated:
    "산식으로 계산한 값입니다 — 정격 출력 × 가정 부하율 ÷ 가정 효율 × 가동시간처럼 " +
    "명판값과 가정에서 낸 수. 계량기가 잰 값이 아닙니다.",
  estimated: "어림값입니다 — 기억·경험으로 적은 수, 다른 기간에서 미룬 수.",
}

/** 문자열이 저장 가능한 자료유형인가. */
export function isMeasurementBasis(value: unknown): value is MeasurementBasis {
  return typeof value === "string" && (MEASUREMENT_BASES as readonly string[]).includes(value)
}

/**
 * 사람이 적은 칸 한 개를 자료유형으로 읽는다(기록지 CSV 의 열). 모르는 값이면 null.
 *
 * **한국어 표기도 받는다.** 운영자가 받는 기록지는 한국어이고, 받은 계산표는 그 칸에
 * "가정 기반 계산 샘플(실측 아님)" 처럼 적어 두었다. 다만 **뜻이 하나로 모이는 표기만**
 * 받는다 — 헤더 별칭과 같은 기준이다(lib/mrv/csv-records.ts). 못 읽은 값을 그럴듯한
 * 쪽으로 넘겨짚지 않고 null 을 돌려주고, 호출부가 그 줄을 오류로 세운다. 자료유형을
 * 넘겨짚는 것은 "실측 아님" 을 실측으로 저장하는 길이다.
 */
export function parseMeasurementBasis(raw: string): MeasurementBasis | null {
  const value = raw.trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (!value) return null
  switch (value) {
    case "metered":
    case "meter":
    case "measured":
    case "실측":
    case "계량기":
    case "계량기실측":
    case "계량기지침":
    case "실측값":
      return "metered"
    case "calculated":
    case "calc":
    case "computed":
    case "계산":
    case "계산값":
    case "산식":
    case "산식계산":
    case "계산전력량":
    case "가정기반계산":
      return "calculated"
    case "estimated":
    case "estimate":
    case "est":
    case "어림":
    case "어림값":
    case "추정":
    case "추정값":
      return "estimated"
    default:
      return null
  }
}

/** 받아들이는 표기를 사람에게 알려 주는 한 줄(422 문구·화면 설명이 같이 쓴다). */
export const MEASUREMENT_BASIS_ACCEPTED_NOTE =
  `자료유형은 ${MEASUREMENT_BASES.join(", ")} 중 하나여야 합니다` +
  "(한국어로 실측 · 계산값 · 어림값 으로 적어도 됩니다)."

/**
 * 기간에 **산입된** 전력 계측값의 자료유형 분포.
 *
 * ★ 산입된 건만 센다. 기간 밖이거나 품질 플래그가 산입 목록에 없어 빠진 건은 EI 분자에
 *   들어가지 않으므로, 그것까지 세면 "이 배출량이 무엇으로 산출됐는가" 를 틀리게 적는다.
 */
export type MeasurementBasisTally = {
  metered: number
  calculated: number
  estimated: number
  /** 자료유형이 적히지 않은 건(null). **실측이 아니라 「모른다」다.** */
  unrecorded: number
}

export function emptyMeasurementBasisTally(): MeasurementBasisTally {
  return { metered: 0, calculated: 0, estimated: 0, unrecorded: 0 }
}

/** 실측이 아닌 것으로 **기록된** 건수(계산값 + 어림값). 미기재는 세지 않는다. */
export function nonMeteredCount(tally: MeasurementBasisTally): number {
  return tally.calculated + tally.estimated
}

/** 집계가 담은 전체 건수. */
export function totalBasisCount(tally: MeasurementBasisTally): number {
  return tally.metered + tally.calculated + tally.estimated + tally.unrecorded
}

/** "실측 12건 · 계산값 30건 · 어림값 0건 · 미기재 3건" — 0 인 칸도 적는다(아래 참고). */
export function formatMeasurementBasisTally(tally: MeasurementBasisTally): string {
  // 0 건인 칸을 빼지 않는다. "계산값" 이 줄에서 사라지면 그 기간에 계산값이 없었다는
  // 사실이 **적히지 않은 것**과 구분되지 않는다 — 증빙에서는 0 이 쓰여 있어야 한다.
  return (
    `실측 ${tally.metered}건 · 계산값 ${tally.calculated}건 · ` +
    `어림값 ${tally.estimated}건 · 미기재 ${tally.unrecorded}건`
  )
}

/**
 * 실측이 아닌 건이 EI 에 산입됐을 때 **무슨 일이 생기는지** 문장으로.
 *
 * "위험합니다" 로 끝내지 않는다. 어느 수치가 그 값을 분자로 산출됐는지까지 적는다 —
 * 심사위원이 그 문장만 읽고 이 리포트의 성격을 판단할 수 있어야 경고가 제 일을 한다.
 * 색이나 아이콘에 기대지 않는다(인쇄 리포트는 흑백 복사가 기본이다 — 글자가 전부다).
 */
export function nonMeteredPowerText(tally: MeasurementBasisTally): string {
  const parts: string[] = []
  if (tally.calculated > 0) {
    parts.push(
      `이 기간 전력의 ${tally.calculated}건이 계량기 실측이 아니라 계산값입니다` +
        "(정격 출력 × 가정 부하율 ÷ 가정 효율 × 가동시간 꼴의 산식으로 낸 값)",
    )
  }
  if (tally.estimated > 0) {
    parts.push(`${tally.estimated}건은 어림값입니다`)
  }
  return (
    `${parts.join("고, ")}. Scope 2 배출량과 EI 는 그 값을 분자로 산출된 것입니다 — ` +
    "계량기가 잰 전력으로 산출된 수치가 아닙니다."
  )
}

/** 미기재 건이 섞여 있을 때 덧붙이는 사실. 경고가 아니라 **모른다는 기록**이다. */
export function unrecordedBasisText(count: number): string {
  return (
    `전력 ${count}건은 자료유형이 기재되지 않았습니다(이 칸을 넣기 전에 저장된 계측값은 ` +
    "전부 여기 들어갑니다). 미기재는 실측을 뜻하지 않으며, 실측이 아니라는 뜻도 아닙니다 — " +
    "그 건이 어떻게 얻어진 값인지 아는 기록이 없다는 뜻입니다."
  )
}

/**
 * 리포트의 「전력 자료유형」 줄이 **아예 없는** 옛 리포트에 적는 문구.
 *
 * ★ 칸이 없는 것과 "미기재 N건" 은 다른 사실이다. 칸이 없는 리포트는 이 집계를 넣기 전에
 *   발행된 것이고, 그때 산입된 전력이 실측이었는지 **리포트 자신이 모른다.** 그것을 0 으로
 *   뭉개면 "전부 실측" 이라는 강한 거짓 주장을 옛 리포트에 인쇄하게 된다.
 *   (`REPORT_MISSING_FLAGS_NOTE` 와 같은 태도다 — lib/mrv/quality-flags.ts.)
 */
export const REPORT_MISSING_BASIS_NOTE =
  "이 리포트에는 전력 자료유형 집계가 기록되지 않았습니다(이 칸을 넣기 전에 발행된 " +
  "리포트입니다). 산입된 전력이 계량기 실측이었는지는 이 리포트로 알 수 없으며, " +
  "근거 스냅샷(After KPI 스냅샷)과 원천 계측값으로 되짚어야 합니다."

/**
 * 인쇄 리포트와 리포트 화면이 **같이 쓰는** 머리말. 두 곳이 각자 적으면 화면으로 본
 * 사람과 인쇄물로 본 사람이 다른 사실을 알게 된다(품질 플래그 경고와 같은 모양).
 */
export const REPORT_NON_METERED_HEADLINE =
  "★ 이 기간의 전력에는 계량기 실측이 아닌 계측값이 산입돼 있습니다 — 아래 건수와 함께 읽으십시오."

/**
 * 저장된 집계(jsonb 에서 꺼낸 unknown)를 읽는다. 읽을 수 없으면 null — **「칸이 없다」와
 * 「0 건이다」를 가르기 위해서다.**
 *
 * 인쇄 리포트와 리포트 화면이 같은 함수를 쓴다. 두 곳이 각자 읽으면 한쪽은 "-" 를,
 * 다른 쪽은 "실측 0건" 을 적는 날이 온다 — 그 둘은 다른 주장이다.
 *
 * 숫자가 아닌 칸은 **0 으로 메우지 않고 그 집계를 통째로 버린다**(null). 일부만 읽어
 * 적으면 합계가 산입 건수와 어긋난 집계를 증빙에 인쇄하게 된다.
 */
export function readMeasurementBasisTally(raw: unknown): MeasurementBasisTally | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const doc = raw as Record<string, unknown>
  const keys = ["metered", "calculated", "estimated", "unrecorded"] as const
  const out = emptyMeasurementBasisTally()
  for (const key of keys) {
    const value = doc[key]
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
    out[key] = value
  }
  return out
}

/**
 * 전력 기록지(CSV)의 자료유형 열과 화면 선택의 우선순위. 두 업로드 칸이 같은 문장을
 * 쓰고, 그 규칙이 파서의 동작과 한 글자도 어긋나지 않아야 한다
 * (lib/mrv/csv-records.ts::parsePowerCsv).
 */
export const CSV_BASIS_PRECEDENCE_NOTE =
  "파일에 measurement_basis(자료유형) 열이 있으면 **그 줄의 값이 이깁니다.** 그 열이 " +
  "없거나 칸이 빈 줄에는 여기서 고른 값이 적힙니다. 열에 모르는 값이 적혀 있으면 그 줄을 " +
  "오류로 보고 아무것도 저장하지 않습니다 — 넘겨짚으면 '실측 아님' 이 실측으로 저장됩니다."
