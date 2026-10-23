"use client"

// 노지 재해위험 카드 — docs/plans/openfield-merge.md 6장. OFDF 패널(kiosk.html)의 농가 화면을
// React 로 옮긴 것: 알람 띠 → 위험 5종 × 1·3시간 격자 → 할 일(2건) → 날씨 타일 4칸 →
// 접기(신뢰도·모델·판단 시각). 운영자 수치는 접기 안에만 둔다.
//
// 장착 조건은 부모(agri-dashboard-view)가 본다: 선택 베드가 노지(tank_type === "노지")이고
// 판단이 1건 이상. 여기서는 받은 판단을 그리기만 한다. 색은 등급(0 emerald / 1 amber /
// 2 orange / 3 red)마다 등급 말을 **함께** 적는다 — 색만으로 가르지 않는다.
import { CloudSun, ChevronDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT, useAgriT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import { FIELD_RISK_TYPES, FIELD_ENV_UNITS, type FieldEnvKey } from "@/lib/i18n/agri/openfield"
import { agoLabel } from "@/components/agri/dashboard/time-ago"
import {
  FIELD_LEVEL_STYLES, fmtEnv, gridOf, latestEnvironment, todoOf, topJudgement, type TodoItem,
} from "./field-risk-model"
import type { FieldRiskJudgement } from "@/types"

/** 날씨 타일 4칸 — 서리·관수에 바로 닿는 넷(kiosk PAGES[0]). 흙 수분은 실측이 없으면 추정(soil_index). */
const ENV_TILES: ReadonlyArray<readonly FieldEnvKey[]> = [["t_air"], ["canopy_temp"], ["soil_moisture", "soil_index"], ["wind_speed"]]

interface FieldRiskCardProps {
  judgements: FieldRiskJudgement[]
  tankName: string
}

export function FieldRiskCard({ judgements, tankName }: FieldRiskCardProps) {
  const { t, locale } = useT()
  const { openfield: of } = useAgriT()

  const top = topJudgement(judgements)
  const grid = gridOf(judgements)
  const env = latestEnvironment(judgements)
  const todo = todoOf(judgements)
  const level = top?.level ?? 0
  const style = FIELD_LEVEL_STYLES[level]

  // "언제" — 예상 발생 시각이 있으면 그 시각, 없으면 전망 구간.
  let when = of.allClearWhen
  if (top && level > 0) {
    when = top.expected_onset
      ? of.whenAt.replace("{{time}}", new Date(top.expected_onset).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))
      : of.whenWithin.replace("{{h}}", String(top.horizon_h))
  }

  // 근거 한 줄 — evidence[0]. 엣지가 붙인 농가 말 label 이 있으면 그것, 없으면 env 사전.
  let evidenceLine: string | null = null
  const ev = top?.evidence?.[0]
  if (top && level > 0 && ev) {
    const name = ev.label ?? of.env[ev.feature as FieldEnvKey] ?? ev.feature
    const unit = FIELD_ENV_UNITS[ev.feature as FieldEnvKey] ?? ""
    evidenceLine = ev.value === null ? name : `${name} ${fmtEnv(ev.value)}${unit}`
  }

  const judgedAt = top ? new Date(top.ts) : null

  return (
    <Card className="bg-card border-border" aria-label={of.title}>
      <CardHeader className="pb-2 p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-foreground text-sm flex items-center gap-1.5">
            <CloudSun className="w-4 h-4 text-brand-fg" aria-hidden="true" />
            {of.title}
          </CardTitle>
          <p className="text-xs text-muted-foreground truncate">{of.subtitle.replace("{{name}}", tankName)}</p>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-4">
        {/* 1. 알람 띠 */}
        <div className={cn("rounded-xl border p-4 space-y-1", style.band)} role="status" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <p className="text-lg sm:text-xl font-bold leading-snug text-foreground break-keep">
              {top && level > 0 ? of.headline[top.risk][level] : of.allClear}
            </p>
            <span className={cn("shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold", style.chip)}>
              <span className={cn("w-2 h-2 rounded-full", style.dot, level >= 2 && "animate-pulse motion-reduce:animate-none")} aria-hidden="true" />
              {of.level[level]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {when}{top && level > 0 && <> · {of.risk[top.risk]}</>}
          </p>
          {evidenceLine && (
            <p className="text-sm text-muted-foreground truncate">
              <span className="font-medium text-foreground">{of.evidence}</span> · {evidenceLine}
            </p>
          )}
        </div>

        {/* 2. 위험 5종 × 1·3시간 격자 */}
        <section aria-label={of.gridHeading}>
          <table className="w-full text-xs">
            <caption className="sr-only">{of.gridHeading}</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="text-left font-medium pb-1.5">{of.gridHeading}</th>
                <th scope="col" className="text-center font-medium pb-1.5 w-24">{of.horizon1}</th>
                <th scope="col" className="text-center font-medium pb-1.5 w-24">{of.horizon3}</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_RISK_TYPES.map((risk) => (
                <tr key={risk} className="border-t border-border">
                  <th scope="row" className="text-left font-medium text-foreground py-1.5 pr-2 truncate">{of.risk[risk]}</th>
                  <td className="py-1.5 text-center"><LevelChip j={grid[risk][1]} labels={of.level} empty={of.noJudgement} /></td>
                  <td className="py-1.5 text-center"><LevelChip j={grid[risk][3]} labels={of.level} empty={of.noJudgement} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 3. 할 일 */}
        {(todo.length > 0 || level > 0) && (
          <section aria-label={of.todoHeading} className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">{of.todoHeading}</h3>
            {todo.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-xl border border-border bg-muted/40 px-3 py-2">{of.autoHandled}</p>
            ) : (
              <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {todo.map((item, i) => <TodoRow key={i} n={i + 1} item={item} />)}
              </ol>
            )}
          </section>
        )}

        {/* 4. 날씨 타일 4칸 */}
        <section aria-label={of.envHeading} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ENV_TILES.map((keys) => {
            const used = keys.find((k) => env[k] !== undefined) ?? keys[0]
            const v = env[used]
            const unit = FIELD_ENV_UNITS[used]
            return (
              <div key={keys[0]} className="rounded-xl border border-border bg-muted/40 px-3 py-2 min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">{of.env[used]}</p>
                <p className="text-xl font-bold tabular-nums text-foreground leading-tight">
                  {fmtEnv(v)}
                  {v !== undefined && unit && <span className="text-xs font-medium text-muted-foreground ml-0.5">{unit}</span>}
                </p>
                <p className="text-[10px] text-muted-foreground h-3.5">{used === "soil_index" && v !== undefined ? of.estimated : ""}</p>
              </div>
            )
          })}
        </section>

        {/* 5. 접기 — 운영자 수치 */}
        {top && (
          <details className="group text-xs text-muted-foreground">
            <summary className="cursor-pointer list-none inline-flex items-center gap-1 min-h-[44px] font-medium hover:text-foreground">
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              {of.details}
            </summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-1 pl-5 tabular-nums">
              <dt>{of.confidence}</dt>
              <dd className="text-foreground">{top.confidence === null ? "—" : `${Math.round(top.confidence * 100)}%`}</dd>
              <dt>{of.modelVersion}</dt>
              <dd className="text-foreground break-all">{top.model_version ?? "—"}</dd>
              <dt>{of.judgedAt}</dt>
              <dd className="text-foreground">
                {judgedAt && (
                  <>
                    <time dateTime={top.ts}>{judgedAt.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                    {" · "}{agoLabel(t.time, top.ts)}
                  </>
                )}
              </dd>
            </dl>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function LevelChip({ j, labels, empty }: { j: FieldRiskJudgement | undefined; labels: readonly string[]; empty: string }) {
  if (!j) return <span className="text-muted-foreground" aria-label={empty}>{empty}</span>
  const style = FIELD_LEVEL_STYLES[j.level]
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", style.chip)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {labels[j.level]}
    </span>
  )
}

function TodoRow({ n, item }: { n: number; item: TodoItem }) {
  const { openfield: of } = useAgriT()
  const text = item.plain.kind === "key" ? of.action[item.plain.key] : { what: item.plain.what, why: item.plain.why }
  const held = !!item.rejectedBy
  return (
    <li className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 min-w-0", held ? "border-border bg-muted/40 text-muted-foreground" : "border-border bg-card")}>
      <span
        className={cn("w-6 h-6 rounded-full shrink-0 text-xs font-bold flex items-center justify-center", held ? "bg-muted text-muted-foreground" : "bg-foreground text-background")}
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold truncate", held ? "text-muted-foreground" : "text-foreground")}>
          {text.what}
          {item.byHand && !held && (
            <span className="ml-1.5 align-middle text-[10px] font-bold rounded border border-amber-500/50 text-amber-600 dark:text-amber-400 px-1 py-px">{of.byHand}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {held ? of.rejectedBy.replace("{{by}}", item.rejectedBy ?? "") : text.why}
        </p>
      </div>
    </li>
  )
}
