"use client"

// 베드 카드(농업 화면) — 수아 시안 mode-split-ui.md 5-8 "베드 카드".
//
// 요소 순서: 이름+상태 배지 → 재배일수 칩(정식일 있을 때만) → 타일 2~4칸(유형·용량은 항상,
// 정식일·수확 예정은 값 있을 때만) → 레시피 요약 줄 → 등록일 + 수정/삭제 → 기기 섹션.
// 새우 전용 컬럼(stocking_density·shrimp_count·cycle_day)은 그리지 않는다.
import { Calendar, Droplets, FlaskConical, Layers, Sprout, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { BedStatusBadge } from "@/components/agri/bed-status-badge"
import { AGRI_STATUS_STYLES, type AgriStatusLevel } from "@/lib/agri-standards"
import { useAgriT } from "@/lib/i18n-context"
import { cn, computeCycleDay, formatDate } from "@/lib/utils"
import type { Tank } from "@/types"
import type { IconComponent } from "@/types"
import { BedDeviceList } from "./bed-device-list"
import { DeleteBedDialog, EditBedDialog, bedTypeLabel } from "./bed-dialogs"
import { fill } from "./form-styles"

/** tank.status(DB) → 화면 상태 5단계. inactive 는 "미측정"으로 읽는다(수아 시안 3-1). */
export function bedStatusLevel(status: Tank["status"]): AgriStatusLevel {
  switch (status) {
    case "warning": return "주의"
    case "danger":  return "위험"
    case "inactive": return "미측정"
    default:        return "정상"
  }
}

/** 카드 테두리 — 상태색은 AGRI_STATUS_STYLES 와 같은 톤(emerald/amber/red 500/20). */
const CARD_BORDER: Record<AgriStatusLevel, string> = {
  정상: "border-emerald-500/20",
  주의: "border-amber-500/20",
  위험: "border-red-500/20",
  미측정: "border-border",
  기준없음: "border-border",
}

/** 수확 예정일이 지났는가. 컴포넌트 밖이라 Date.now 가 허용된다. */
function isPast(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now()
}

/** EC·pH 레시피 요약 "EC 1.80 ±0.10 · pH 6.0 ±0.5". 둘 다 없으면 null. */
export function recipeSummary(tank: Tank): string | null {
  const parts = [
    tank.target_ec != null
      ? `EC ${(tank.target_ec / 1000).toFixed(2)} ±${((tank.ec_tolerance ?? 100) / 1000).toFixed(2)}`
      : null,
    tank.target_ph != null
      ? `pH ${tank.target_ph.toFixed(1)} ±${(tank.ph_tolerance ?? 0.5).toFixed(1)}`
      : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

function Tile({ icon: Icon, label, value, valueClass }: {
  icon: IconComponent
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="bg-muted rounded-lg p-2.5 min-w-0">
      <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1 truncate">
        <Icon className="w-3 h-3 shrink-0" aria-hidden="true" /> {label}
      </p>
      <p className={cn("text-foreground font-bold text-sm tabular-nums truncate", valueClass)}>{value}</p>
    </div>
  )
}

export function BedCard({ tank, latestVersion, onChanged }: {
  tank: Tank
  latestVersion: string | null
  onChanged: (message: string) => void
}) {
  const { farms: d } = useAgriT()
  const level = bedStatusLevel(tank.status)
  const style = AGRI_STATUS_STYLES[level]
  const recipe = recipeSummary(tank)
  const harvestPast = !!tank.harvest_date && isPast(tank.harvest_date)

  return (
    <Card className={cn("bg-card border transition-colors duration-200 motion-reduce:transition-none", CARD_BORDER[level])}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-foreground font-semibold text-base leading-tight truncate min-w-0 flex-1">{tank.name}</h3>
          <BedStatusBadge status={level} size="md" className="shrink-0" />
        </div>

        {tank.stocking_date && (
          <div className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border tabular-nums", style.bg, style.text)}>
            <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
            {fill(d.cropDayN, { n: computeCycleDay(tank.stocking_date) })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Tile icon={Layers} label={d.bedType} value={bedTypeLabel(d, tank.tank_type)} />
          <Tile
            icon={Droplets}
            label={d.volume}
            value={tank.volume > 0 ? `${tank.volume.toLocaleString()} ${d.volumeUnit}` : "—"}
          />
          {tank.stocking_date && (
            <Tile icon={Sprout} label={d.plantingDate} value={formatDate(tank.stocking_date)} />
          )}
          {tank.harvest_date && (
            <Tile
              icon={Calendar}
              label={d.harvestPlanDate}
              value={formatDate(tank.harvest_date)}
              valueClass={harvestPast ? "text-red-600 dark:text-red-400" : undefined}
            />
          )}
        </div>

        <p className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-brand-fg shrink-0" aria-hidden="true" />
          {recipe ?? d.recipeNotSet}
        </p>

        <div className="flex items-center justify-between pt-1 border-t border-border">
          <p className="text-muted-foreground text-xs">{d.registered} {formatDate(tank.created_at)}</p>
          <div className="flex items-center gap-0.5">
            <EditBedDialog tank={tank} onSuccess={() => onChanged(d.bedUpdated)} />
            <DeleteBedDialog tank={tank} onSuccess={() => onChanged(d.bedDeleted)} />
          </div>
        </div>

        <BedDeviceList tank={tank} latestVersion={latestVersion} />
      </CardContent>
    </Card>
  )
}
