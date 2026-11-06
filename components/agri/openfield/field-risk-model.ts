// 노지 재해위험 카드의 **순수 계산** — 어느 판단이 맨 위에 서고, 격자는 어떻게 채우고,
// 할 일·환경값은 어디서 가져오나. 화면(field-risk-card.tsx)은 이 결과를 그리기만 한다.
//
// 입력은 getFieldRiskLatest 가 돌려주는 "risk × horizon 별 최신 1건"(최대 10건)이다.
import type { FieldEnvKey } from "@/lib/i18n/agri/openfield"
import type { FieldRiskAction, FieldRiskJudgement, FieldRiskType } from "@/types"
import { plainAction, isByHand, type PlainAction } from "./field-action-plain"

export type FieldLevel = FieldRiskJudgement["level"]

/** 등급 색 — 0 emerald / 1 amber / 2 orange / 3 red. 색만으로 가르지 않고 등급 말을 함께 적는다.
 *  상태색은 `-600 dark:-400` 쌍(AGRI_STATUS_STYLES 와 같은 결). */
export const FIELD_LEVEL_STYLES: Record<FieldLevel, { band: string; text: string; chip: string; dot: string }> = {
  0: {
    band: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  1: {
    band: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  2: {
    band: "bg-orange-500/10 border-orange-500/30",
    text: "text-orange-600 dark:text-orange-400",
    chip: "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  3: {
    band: "bg-red-500/10 border-red-500/30",
    text: "text-red-600 dark:text-red-400",
    chip: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
}

/** 알람 띠에 설 판단: level 최고 → 같으면 짧은 전망(1시간) → 같으면 최신 ts. */
export function topJudgement(js: FieldRiskJudgement[]): FieldRiskJudgement | null {
  let top: FieldRiskJudgement | null = null
  for (const j of js) {
    if (!top || j.level > top.level
      || (j.level === top.level && j.horizon_h < top.horizon_h)
      || (j.level === top.level && j.horizon_h === top.horizon_h && j.ts > top.ts)) top = j
  }
  return top
}

export type RiskGrid = Record<FieldRiskType, { 1?: FieldRiskJudgement; 3?: FieldRiskJudgement }>

/** 위험 5종 × 1·3시간 격자. 없는 칸은 undefined(화면이 "—"). */
export function gridOf(js: FieldRiskJudgement[]): RiskGrid {
  const grid: RiskGrid = { heat_dry: {}, rain_wet: {}, disease: {}, frost: {}, compound: {} }
  for (const j of js) {
    const cell = grid[j.risk]
    if (!cell) continue
    const cur = cell[j.horizon_h]
    if (!cur || j.ts > cur.ts) cell[j.horizon_h] = j
  }
  return grid
}

/** 환경값은 판단마다 실려 오는데 모두 같은 측정이다. 최신 판단부터 보며 키마다 처음 나온 값을 쓴다. */
export function latestEnvironment(js: FieldRiskJudgement[]): Partial<Record<FieldEnvKey, number>> {
  const out: Partial<Record<FieldEnvKey, number>> = {}
  const sorted = [...js].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  for (const j of sorted) {
    for (const [k, v] of Object.entries(j.environment ?? {})) {
      if (typeof v === "number" && Number.isFinite(v) && !(k in out)) (out as Record<string, number>)[k] = v
    }
  }
  return out
}

export interface TodoItem {
  plain: PlainAction
  action: FieldRiskAction
  byHand: boolean
  rejectedBy: string | null
}

/** 할 일 — 최신 시각의 판단들에 실린 actions 중 advisory·executed 를 2건까지. 막힌 조치
 *  (rejected_by)는 뒤로 보내되 숨기지 않는다(회색). 같은 할 일은 한 번만. */
export function todoOf(js: FieldRiskJudgement[], max = 2): TodoItem[] {
  if (js.length === 0) return []
  const latestTs = js.reduce((m, j) => (j.ts > m ? j.ts : m), js[0].ts)
  const actions = js.filter((j) => j.ts === latestTs).flatMap((j) => j.actions ?? [])
  const items: TodoItem[] = []
  const seen = new Set<string>()
  const ordered = [...actions.filter((a) => !a.rejected_by), ...actions.filter((a) => a.rejected_by)]
  for (const a of ordered) {
    if (!a.advisory && !a.executed && !a.rejected_by) continue
    const plain = plainAction(a)
    if (!plain) continue
    const dedupe = plain.kind === "key" ? plain.key : plain.what
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    items.push({ plain, action: a, byHand: isByHand(a), rejectedBy: a.rejected_by })
    if (items.length >= max) break
  }
  return items
}

/** 숫자 표기 — 정수는 그대로, 아니면 소수 1자리(kiosk 와 같은 규칙). */
export function fmtEnv(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—"
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
