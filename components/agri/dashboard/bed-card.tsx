"use client"

// 베드 카드 — 수아 시안 mode-split-ui.md 5-5 "베드 현황".
//
// 두 역할을 분리한다: **카드 본체는 button**(누르면 선택 베드가 바뀌고 아래 양액 상태·
// 차압·센서 구역이 그 베드로 갱신), **우하단 작은 링크 "상세"**(양액 관리 딥링크).
// 카드 전체를 Link 로 만들면 선택을 표현할 길이 없다.
//
// 타일 3개(EC·pH·온도)는 AGRI_PARAMS 메타 + agriFormat + getAgriStatus 로 그린다 —
// 소수 자리·단위·판정 숫자를 여기서 손으로 적지 않는다. 상태는 색+텍스트 병기.
import Link from "next/link"
import { ArrowRight, FlaskConical, Sprout } from "lucide-react"
import { cn, computeCycleDay } from "@/lib/utils"
import { useT, useAgriT } from "@/lib/i18n-context"
import { AGRI_PARAMS, agriFormat, agriParamLabel, type AgriParamKey } from "@/lib/agri-params"
import { AGRI_STATUS_STYLES, getAgriStatus, type AgriStatusLevel } from "@/lib/agri-standards"
import { BedStatusBadge, useAgriStatusLabel } from "@/components/agri/bed-status-badge"
import { agoLabel } from "./time-ago"
import type { Tank, WaterQualityReading } from "@/types"

/** tank.status(DB) → 표시 레벨. 시안 3-1 변환표. */
export const TANK_STATUS_LEVEL: Record<Tank["status"], AgriStatusLevel> = {
  active: "정상",
  warning: "주의",
  danger: "위험",
  inactive: "미측정",
}

const TILE_KEYS: AgriParamKey[] = ["conductivity", "ph", "temperature"]

interface BedCardProps {
  tank: Tank
  /** 최신 측정. `undefined` = 조회 안 함(베드 12개 초과), `null` = 조회했지만 기록 없음. */
  latest: WaterQualityReading | null | undefined
  selected: boolean
  onSelect: () => void
}

export function BedCard({ tank, latest, selected, onSelect }: BedCardProps) {
  const { t } = useT()
  const d = useAgriT()
  const { dashboard: dd } = d
  const statusLabel = useAgriStatusLabel()

  const recipeParts: string[] = []
  if (tank.target_ec != null) {
    recipeParts.push(dd.recipeEc
      .replace("{{ec}}", (tank.target_ec / 1000).toFixed(2))
      .replace("{{ecTol}}", ((tank.ec_tolerance ?? 100) / 1000).toFixed(2)))
  }
  if (tank.target_ph != null) {
    recipeParts.push(dd.recipePh
      .replace("{{ph}}", tank.target_ph.toFixed(1))
      .replace("{{phTol}}", String(tank.ph_tolerance ?? 0.5)))
  }

  const footer: string[] = []
  if (tank.stocking_date) footer.push(dd.cropDayN.replace("{{n}}", String(computeCycleDay(tank.stocking_date))))
  if (latest) footer.push(dd.lastMeasuredAgo.replace("{{ago}}", agoLabel(t.time, latest.recorded_at)))
  else if (latest === null) footer.push(dd.noReading)

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 flex flex-col gap-3 shadow-sm transition-colors duration-200",
        selected ? "border-brand/40 ring-1 ring-brand/40" : "border-border hover:border-brand/30",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={dd.bedSelectAria.replace("{{name}}", tank.name)}
        onClick={onSelect}
        className="w-full text-left flex flex-col gap-3 min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground truncate">{tank.name}</p>
          <BedStatusBadge status={TANK_STATUS_LEVEL[tank.status] ?? "미측정"} />
        </div>

        <p className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5 min-w-0">
          <FlaskConical className="w-3.5 h-3.5 text-brand-fg shrink-0" aria-hidden="true" />
          <span className="truncate">{recipeParts.length ? recipeParts.join(" · ") : dd.recipeNotSet}</span>
        </p>

        {latest !== undefined && (
          <div className="grid grid-cols-3 gap-2">
            {AGRI_PARAMS.filter(p => TILE_KEYS.includes(p.key)).map(p => {
              const raw = latest ? latest[p.key] : null
              const status = getAgriStatus(p.key, raw, tank)
              const st = AGRI_STATUS_STYLES[status]
              const Icon = p.icon
              return (
                <div key={p.key} className={cn("rounded-lg border p-2 min-w-0", st.bg)}>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                    <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {agriParamLabel(d, p.key)}
                  </p>
                  <p className={cn("text-sm font-bold tabular-nums mt-0.5", st.text)}>
                    {agriFormat(p.key, raw)}
                    {p.unit && <span className="text-[10px] font-medium text-muted-foreground ml-0.5">{p.unit}</span>}
                  </p>
                  {/* 3번째 줄 — 색만으로 뜻을 전하지 않는다 */}
                  <p className="text-[10px] text-muted-foreground">{statusLabel(status)}</p>
                </div>
              )
            })}
          </div>
        )}

        {latest?.flow_rate === 0 && (
          <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">{dd.flowStopped}</p>
        )}
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 min-w-0">
          <Sprout className="w-3 h-3 shrink-0 text-brand-fg" aria-hidden="true" />
          <span className="truncate">{footer.join(" · ")}</span>
        </p>
        <Link
          href={`/daumlabs/water-quality?tank=${encodeURIComponent(tank.id)}`}
          className="text-xs text-brand-fg font-medium min-h-[44px] inline-flex items-center gap-1 shrink-0 hover:underline"
        >
          {dd.bedDetail} <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
