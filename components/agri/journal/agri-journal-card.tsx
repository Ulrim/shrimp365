"use client"

// 영농 일지 카드 — 목록 한 건(시안 mode-split-ui.md 5-7).
//
// 4타일(양액 보충 / 보충 횟수 / 양액 교환 / 자재 투입) + 양액 종류 줄 + 방제·점검 요약
// 한 줄(한 것만, 없으면 줄 생략) + 메모. 타일 색 리듬은 brand → amber → teal → violet.
// 네 번째 색은 새 색이 아니라 차트 pH 선과 같은 violet-500(AGRI_PARAMS.ph.color)이다.
// 새우 전용 타일은 없다 — `mortality_count` 는 읽지 않는다.
import type { ReactNode } from "react"
import { User, Pencil, Trash2, FlaskConical, Repeat, RefreshCw, Beaker, ShieldCheck, Check, StickyNote } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAgriT, useT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import type { JournalEntry } from "@/types"

export function journalDateLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" })
}

interface AgriJournalCardProps {
  entry: JournalEntry
  currentUserId?: string
  currentUserName?: string
  onEdit: (e: JournalEntry) => void
  onDelete: (e: JournalEntry) => void
}

export function AgriJournalCard({ entry, currentUserId, currentUserName, onEdit, onDelete }: AgriJournalCardProps) {
  const { journal: j } = useAgriT()
  const { t, locale } = useT()
  const dateLabel = journalDateLabel(entry.date, locale)
  const createdLabel = new Date(entry.created_at).toLocaleString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
  const author = entry.created_by === currentUserId
    ? (currentUserName || j.me)
    : (entry.created_by ? `${entry.created_by.slice(0, 8)}…` : "")

  const checks = [
    entry.check_circulation && j.checkPump,
    entry.check_filtration && j.checkFilterUv,
    entry.check_aeration && j.checkChiller,
    entry.check_feeding_check && j.checkGrowth,
  ].filter((s): s is string => typeof s === "string")
  const hasWorkLine = entry.disinfection || checks.length > 0

  const iconBtn = "p-2 min-h-[44px] min-w-[44px] rounded-lg text-muted-foreground hover:bg-accent transition-colors duration-200 flex items-center justify-center"

  return (
    <Card className="bg-card border-border transition-colors">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-foreground font-semibold truncate">{entry.tank_name}</span>
              <span className="inline-flex items-center rounded-full bg-brand-a10 text-brand-fg px-2.5 py-0.5 text-xs font-semibold tabular-nums">{dateLabel}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              <User className="w-3 h-3" aria-hidden="true" />
              <span>{author}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{createdLabel}</span>
            </div>
          </div>
          <div className="flex items-center shrink-0">
            <button type="button" onClick={() => onEdit(entry)} className={cn(iconBtn, "hover:text-brand-fg")}
              aria-label={j.editAria.replace("{{date}}", dateLabel)} title={j.edit}>
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onDelete(entry)} className={cn(iconBtn, "hover:text-red-600 dark:hover:text-red-400")}
              aria-label={j.deleteAria.replace("{{date}}", dateLabel)} title={j.delete}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <Tile icon={<FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />} iconClass="text-brand-fg" label={j.tileRefill}>
            {entry.feeding_amount}<Unit>L</Unit>
          </Tile>
          <Tile icon={<Repeat className="w-3.5 h-3.5" aria-hidden="true" />} iconClass="text-amber-500" label={j.tileRefillTimes}>
            {entry.feeding_times}<Unit>{t.common.unit.timesPerDay}</Unit>
          </Tile>
          <Tile icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />} iconClass="text-teal-500" label={j.tileExchange}>
            {entry.water_exchange_rate}<Unit>%</Unit>
          </Tile>
          <Tile icon={<Beaker className="w-3.5 h-3.5" aria-hidden="true" />} iconClass="text-violet-500" label={j.tileInput} small>
            {entry.microbial_input ? (entry.microbial_type || j.inputApplied) : j.inputNone}
            {entry.microbial_input && entry.microbial_amount != null && entry.microbial_amount > 0 && (
              <Unit>{` ${entry.microbial_amount} kg`}</Unit>
            )}
          </Tile>
        </div>

        <div className="text-xs text-foreground/80 bg-muted rounded-lg px-3 py-2 flex items-start gap-2">
          <span className="text-muted-foreground font-medium shrink-0">{j.nutrientLabel}:</span>
          <span>{entry.feed_type}</span>
        </div>

        {hasWorkLine && (
          <div className="mt-2 text-xs text-foreground/80 bg-muted rounded-lg px-3 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap">
            {entry.disinfection && (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                <span className="text-muted-foreground font-medium">{j.pestLabel}:</span>
                <span>{entry.disinfection_type || "—"}</span>
              </span>
            )}
            {checks.map(c => (
              <span key={c} className="inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />{c}
              </span>
            ))}
          </div>
        )}

        {entry.notes && (
          <div className="mt-2 text-xs text-foreground/80 bg-muted rounded-lg px-3 py-2 flex items-start gap-2">
            <StickyNote className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" aria-hidden="true" />
            <p className="whitespace-pre-wrap break-words">{entry.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Tile({ icon, iconClass, label, small = false, children }: {
  icon: ReactNode; iconClass: string; label: string; small?: boolean; children: ReactNode
}) {
  return (
    <div className="bg-muted rounded-lg p-3 text-center min-w-0">
      <div className={cn("flex items-center justify-center mb-1", iconClass)}>{icon}</div>
      <p className={cn("font-bold text-foreground tabular-nums break-words", small ? "text-sm" : "text-lg")}>{children}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function Unit({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground font-medium ml-0.5">{children}</span>
}
