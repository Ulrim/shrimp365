"use client"

// 영농 일지 목록 — `/daumlabs/journal` 전용 뷰(설계서 mode-split.md 5장, 시안 5-7).
//
// 헤더 → 필터 줄(베드·기간·메모 검색) → 카드 목록(최신순 20건 + 더 보기) → 수정·삭제
// 다이얼로그. 데이터는 lib/db.ts 함수만 쓰고, 뷰 안에서 `farm_type === "agriculture"`
// 한 줄로 거른다. 진단 탭·측정값 동시 입력·"고위험" 위젯은 이 화면에 없다.
//
// 베드·기간은 getJournalEntries 가 서버에서 거르고(페이지가 20건이라 클라이언트 필터로는
// 결과가 빈 페이지가 되기 쉽다), 메모 검색만 받아 온 목록에서 거른다.
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BookOpen, Download, Plus, Search, Building2, Sprout, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AgriPageHeader } from "@/components/agri/agri-page-header"
import { AgriEmptyState } from "@/components/agri/agri-empty-state"
import { AgriJournalCard, journalDateLabel } from "@/components/agri/journal/agri-journal-card"
import { AgriJournalEditDialog, AgriJournalDeleteDialog } from "@/components/agri/journal/agri-journal-dialogs"
import { getFarms, getAllTanks, getJournalEntries } from "@/lib/db"
import { exportToCsv } from "@/lib/export"
import { useAuth } from "@/lib/auth-context"
import { useAgriT, useT } from "@/lib/i18n-context"
import type { AgriDict } from "@/lib/i18n/agri"
import type { Farm, JournalEntry, Tank } from "@/types"

const PAGE = 20
const ALL = "__all__"

const isAgri = (x: { farm_type?: "shrimp" | "agriculture" }) => x.farm_type === "agriculture"

// `?? []` 를 렌더마다 새로 만들면 useMemo 의존성이 매번 바뀐다 — 빈 배열은 모듈 상수로.
const NO_ENTRIES: JournalEntry[] = []

interface ListState {
  key: string
  items: JournalEntry[]
  /** 서버가 돌려준 원시 행 수(농업 필터 전) — 다음 페이지 offset. */
  rawCount: number
  hasMore: boolean
  error: boolean
}

export function AgriJournalView() {
  const d = useAgriT()
  const j = d.journal
  const { t, locale } = useT()
  const { user } = useAuth()

  // 농장·베드 — 농업 것만.
  const [base, setBase] = useState<{ farms: Farm[]; tanks: Tank[] } | null>(null)
  const [baseError, setBaseError] = useState(false)
  const [baseRetry, setBaseRetry] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([getFarms(), getAllTanks()])
      .then(([farms, tanks]) => {
        if (!alive) return
        setBase({ farms: farms.filter(isAgri), tanks: tanks.filter(isAgri) })
      })
      .catch(() => { if (alive) setBaseError(true) })
    return () => { alive = false }
  }, [baseRetry])

  const tanks = base?.tanks ?? []

  // 필터
  const [bedId, setBedId] = useState(ALL)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [search, setSearch] = useState("")
  const filtersActive = bedId !== ALL || !!from || !!to || !!search

  // 목록 — 필터 키가 바뀌면 첫 페이지부터 다시 받는다. 키가 다르면 "로딩 중".
  const [listRetry, setListRetry] = useState(0)
  const listKey = `${bedId}|${from}|${to}|${listRetry}`
  const [list, setList] = useState<ListState | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (!base || base.tanks.length === 0) return
    let alive = true
    const key = listKey
    getJournalEntries(bedId === ALL ? undefined : bedId, PAGE, from || undefined, to || undefined, 0)
      .then(rows => {
        if (!alive) return
        setList({ key, items: rows.filter(isAgri), rawCount: rows.length, hasMore: rows.length === PAGE, error: false })
      })
      .catch(() => { if (alive) setList({ key, items: [], rawCount: 0, hasMore: false, error: true }) })
    return () => { alive = false }
  }, [base, bedId, from, to, listKey])

  async function loadMore() {
    if (!list || loadingMore) return
    setLoadingMore(true)
    try {
      const rows = await getJournalEntries(bedId === ALL ? undefined : bedId, PAGE, from || undefined, to || undefined, list.rawCount)
      setList(prev => prev && prev.key === list.key
        ? { ...prev, items: [...prev.items, ...rows.filter(isAgri)], rawCount: prev.rawCount + rows.length, hasMore: rows.length === PAGE }
        : prev)
    } catch { /* 버튼이 그대로 남아 다시 누를 수 있다 */ } finally {
      setLoadingMore(false)
    }
  }

  const listLoading = !!base && base.tanks.length > 0 && list?.key !== listKey
  const items = list?.items ?? NO_ENTRIES
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(e => (e.notes ?? "").toLowerCase().includes(q) || e.tank_name.toLowerCase().includes(q))
  }, [items, search])

  // 수정·삭제·알림 문구
  const [editTarget, setEditTarget] = useState<JournalEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(cur => (cur === msg ? null : cur)), 2500)
  }

  function resetFilters() {
    setBedId(ALL); setFrom(""); setTo(""); setSearch("")
  }

  function handleExportCsv() {
    if (!visible.length) return
    const yn = (b: boolean) => (b ? j.csvYes : j.csvNo)
    const rows = visible.map(e => ({
      [j.csvDate]: e.date,
      [j.csvBed]: e.tank_name,
      [j.nutrientType]: e.feed_type,
      [`${j.refillAmount} (L)`]: e.feeding_amount,
      [j.refillTimes]: e.feeding_times,
      [`${j.exchangeRate} (%)`]: e.water_exchange_rate,
      [j.pestLabel]: yn(e.disinfection),
      [j.pestAgent]: e.disinfection ? (e.disinfection_type ?? "") : "",
      [j.inputType]: e.microbial_input ? (e.microbial_type ?? "") : "",
      [`${j.inputAmount} (kg)`]: e.microbial_input && e.microbial_amount != null ? e.microbial_amount : "",
      [j.checkPump]: yn(e.check_circulation),
      [j.checkFilterUv]: yn(e.check_filtration),
      [j.checkChiller]: yn(e.check_aeration),
      [j.checkGrowth]: yn(e.check_feeding_check),
      [j.notes]: e.notes ?? "",
    }))
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    exportToCsv(rows, `${j.csvPrefix}_${stamp}`)
  }

  const header = (
    <AgriPageHeader
      icon={BookOpen}
      title={j.title}
      subtitle={j.subtitle}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!visible.length}
            className="min-h-[44px] gap-2 border-border text-muted-foreground hover:bg-accent flex-1 sm:flex-none" aria-label={j.csv} title={j.csv}>
            <Download className="w-4 h-4" aria-hidden="true" />{j.csv}
          </Button>
          <Button asChild size="sm" className="min-h-[44px] gap-2 bg-brand hover:bg-brand-hover text-white flex-1 sm:flex-none">
            <Link href="/daumlabs/record/journal"><Plus className="w-4 h-4" aria-hidden="true" />{j.newEntry}</Link>
          </Button>
        </>
      }
    />
  )

  // ── 페이지 수준 상태 ──
  if (baseError) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <LoadError d={d} onRetry={() => { setBaseError(false); setBaseRetry(x => x + 1) }} />
      </div>
    )
  }
  if (!base) {
    return (
      <div className="space-y-6 animate-fade-in" role="status" aria-busy="true">
        {header}
        <div className="h-14 rounded-xl bg-muted animate-pulse" />
        {[0, 1, 2].map(i => <div key={i} className="h-56 rounded-xl bg-muted animate-pulse" />)}
      </div>
    )
  }
  if (base.farms.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriEmptyState icon={Building2} title={d.common.noFarmsTitle} description={d.common.noFarmsMsg}
          ctaLabel={d.common.registerFarm} ctaHref="/daumlabs/farms" />
      </div>
    )
  }
  if (tanks.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {header}
        <AgriEmptyState icon={Sprout} title={j.noBedsTitle} description={j.noBedsMsg} ctaLabel={j.addBedCta} ctaHref="/daumlabs/farms" />
      </div>
    )
  }

  const inputCls = "min-h-[44px] bg-muted border-border focus-visible:ring-brand-a50"

  return (
    <div className="space-y-6 animate-fade-in">
      {header}

      {notice && (
        <p role="status" className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{notice}</p>
      )}

      {/* ── 필터 줄 ── */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <Select value={bedId} onValueChange={setBedId}>
          <SelectTrigger aria-label={j.bedFilterAria} className={`${inputCls} w-full sm:w-48`}>
            <SelectValue placeholder={j.allBeds} />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value={ALL}>{j.allBeds}</SelectItem>
            {tanks.map(tk => <SelectItem key={tk.id} value={tk.id}>{tk.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" aria-label={j.dateFrom} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={`${inputCls} w-full sm:w-40`} />
          <span className="text-muted-foreground text-sm" aria-hidden="true">~</span>
          <Input type="date" aria-label={j.dateTo} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={`${inputCls} w-full sm:w-40`} />
        </div>
        <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <Input type="search" aria-label={j.searchAria} placeholder={j.searchPlaceholder} value={search}
            onChange={e => setSearch(e.target.value)} className={`${inputCls} pl-9`} />
        </div>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="min-h-[44px] text-muted-foreground">{j.resetFilters}</Button>
        )}
      </div>

      {/* ── 목록 ── */}
      {listLoading ? (
        <div className="space-y-4" role="status" aria-busy="true">
          {[0, 1, 2].map(i => <div key={i} className="h-56 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : list?.error ? (
        <LoadError d={d} onRetry={() => setListRetry(x => x + 1)} />
      ) : visible.length === 0 ? (
        filtersActive ? (
          <AgriEmptyState icon={BookOpen} title={j.noMatch} ctaLabel={j.resetFilters} onCta={resetFilters} className="py-8" />
        ) : (
          <AgriEmptyState icon={BookOpen} title={j.noEntries} description={j.noEntriesMsg} ctaLabel={j.newEntry} ctaHref="/daumlabs/record/journal" />
        )
      ) : (
        <>
          <ul className="space-y-4" aria-label={j.title}>
            {visible.map(e => (
              <li key={e.id}>
                <AgriJournalCard entry={e} currentUserId={user?.id} currentUserName={user?.name}
                  onEdit={setEditTarget} onDelete={setDeleteTarget} />
              </li>
            ))}
          </ul>
          {list?.hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="min-h-[44px] px-6 border-border">
                {loadingMore ? t.common.loading : j.loadMore}
              </Button>
            </div>
          )}
        </>
      )}

      <AgriJournalEditDialog
        entry={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={updated => {
          setList(prev => (prev ? { ...prev, items: prev.items.map(e => (e.id === updated.id ? updated : e)) } : prev))
          setEditTarget(null)
          flash(j.updated)
        }}
      />
      <AgriJournalDeleteDialog
        entry={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={id => {
          setList(prev => (prev ? { ...prev, items: prev.items.filter(e => e.id !== id) } : prev))
          setDeleteTarget(null)
          flash(j.deleted)
        }}
      />
      {/* 스크린리더용 — 마지막으로 다룬 일지 날짜를 알려 준다. */}
      <span className="sr-only" aria-live="polite">
        {editTarget ? `${j.edit}: ${journalDateLabel(editTarget.date, locale)}` : deleteTarget ? `${j.delete}: ${journalDateLabel(deleteTarget.date, locale)}` : ""}
      </span>
    </div>
  )
}

function LoadError({ d, onRetry }: { d: AgriDict; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-border bg-card px-6 py-12">
      <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
      <p className="text-lg font-semibold text-foreground">{d.common.loadErrorTitle}</p>
      <p className="text-sm text-muted-foreground">{d.common.loadErrorMsg}</p>
      <Button onClick={onRetry} className="bg-brand hover:bg-brand-hover text-white min-h-[44px] px-6 rounded-xl">{d.common.retry}</Button>
    </div>
  )
}
