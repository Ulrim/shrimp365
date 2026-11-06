"use client"

// 수질 기록(/admin/readings) — 회원들의 수질 기록을 출처(수기·센서)별로 본다(읽기 전용).
//
// 데이터는 /api/admin/readings 가 admin·총관리자 확인 뒤 준다. 테스트·모니터 계정은
// API 를 부르지 않고 목데이터(readings/mock.ts)로 같은 화면을 그린다.
// 필터는 주소가 원본이다(새로고침·공유·사용자 상세의 링크로 들어와도 유지).
// 출처 판정 규칙은 lib/wq-source.ts, 쿼리·CSV 규칙은 lib/admin-readings.ts.
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  AlertCircle, ChevronLeft, ChevronRight, Download, Droplets, RefreshCw, Search, X,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { isMonitorAccount, isTestAccount } from "@/lib/mock-data"
import type { WqSourceFilter } from "@/lib/wq-source"
import {
  DEFAULT_READINGS_FILTER, READINGS_CSV_MAX, READINGS_PERIODS, WQ_VALUE_META,
  filterFromSearch, filterToApiSearch, filterToSearch, formatKst, kstDateString, readingsCsv, readingsCsvFilename,
  type AdminReadingRow, type AdminReadingsResponse, type ReadingsFilter, type WqValueKey,
} from "@/lib/admin-readings"
import { useAdminStats } from "@/components/admin/admin-stats"
import { LoadProblemView, problemOf, type LoadProblem } from "@/components/admin/stats-status"
import { mockReadingsResponse } from "@/components/admin/readings/mock"
import { GUESS_TITLE, LateEntryMark, RecordedAt, SourceBadge, WqValue, unitOf } from "@/components/admin/readings/parts"

const DAY_MS = 86_400_000

type Problem = { kind: LoadProblem } | { kind: "bad_request"; message: string }

const SOURCE_OPTIONS: { value: WqSourceFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "manual", label: "수기" },
  { value: "sensor", label: "센서" },
]

/** 기본으로 보이는 값 열. 전도도·유량·차압은 그 쪽에 값이 있을 때만, 나머지는 "항목 더보기"에서. */
const CORE_KEYS: WqValueKey[] = ["temperature", "ph", "do_level", "salinity"]
const OPTIONAL_KEYS: WqValueKey[] = ["conductivity", "flow_rate", "diff_pressure"]
const EXTRA_KEYS: WqValueKey[] = ["ammonia", "nitrite", "nitrate", "alkalinity", "turbidity"]

function sameFilter(a: ReadingsFilter, b: ReadingsFilter) {
  return filterToSearch(a).toString() === filterToSearch(b).toString()
}

/** 파일 내려받기 — 브라우저에서 만든 글(Blob)을 a[download] 로 저장시킨다. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── 바깥 ────────────────────────────────────────────────────────────────────

/** `useSearchParams` 는 Suspense 경계가 필요하다(없으면 프로덕션 빌드가 실패한다 — 관제센터와 같다). */
export function AdminReadingsView() {
  return (
    <Suspense fallback={<ReadingsSkeleton />}>
      <ReadingsInner />
    </Suspense>
  )
}

function ReadingsInner() {
  const { user } = useAuth()
  const isMock = isMonitorAccount(user?.email) || isTestAccount(user?.email)

  // 필터 — 주소가 원본. router.replace 가 반영되기 전 잠깐은 누른 값(pending)을 먼저 보인다.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlFilter = useMemo(() => filterFromSearch(searchParams), [searchParams])
  const [pending, setPending] = useState<ReadingsFilter | null>(null)
  if (pending && sameFilter(pending, urlFilter)) setPending(null)   // 주소가 따라잡음
  const filter = pending ?? urlFilter
  const urlKey = filterToSearch(urlFilter).toString()

  const setFilter = (patch: Partial<ReadingsFilter>) => {
    // 쪽 이동이 아니면 첫 쪽으로 돌아간다.
    const next = { ...filter, page: 1, ...patch }
    setPending(next)
    const q = filterToSearch(next).toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }

  // 데이터
  const [data, setData] = useState<AdminReadingsResponse | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async (f: ReadingsFilter) => {
    const id = ++reqId.current
    setFetching(true)
    try {
      let body: AdminReadingsResponse
      if (isMock) {
        body = mockReadingsResponse(f, Date.now()).response
      } else {
        const res = await fetch(`/api/admin/readings?${filterToApiSearch(f, Date.now())}`, { cache: "no-store" })
        if (!res.ok) {
          const j = res.status === 400 ? await res.json().catch(() => null) as { message?: unknown } | null : null
          if (id !== reqId.current) return
          setProblem(res.status === 400
            ? { kind: "bad_request", message: typeof j?.message === "string" ? j.message : "요청이 올바르지 않습니다" }
            : { kind: problemOf(res.status) })
          setData(null)
          return
        }
        body = await res.json() as AdminReadingsResponse
      }
      if (id !== reqId.current) return
      setData(body)
      setProblem(null)
    } catch {
      if (id === reqId.current) { setProblem({ kind: "failed" }); setData(null) }
    } finally {
      if (id === reqId.current) { setLoading(false); setFetching(false) }
    }
  }, [isMock])

  useEffect(() => {
    if (!user) return
    // setState 가 effect 본문에서 동기로 불리지 않도록 한 틱 미룬다(콘솔 다른 화면과 같다).
    const t = setTimeout(() => { load(filterFromSearch(new URLSearchParams(urlKey))) }, 0)
    return () => clearTimeout(t)
  }, [user, urlKey, load])

  const refresh = () => { load(urlFilter) }

  // 사용자 선택지 — 시스템 모니터링 통계의 사용자 목록을 그대로 쓴다(목데이터 계정은 목 목록).
  const { stats, error: usersError } = useAdminStats()
  const users = useMemo(
    () => (stats?.users ?? []).map(u => ({ id: u.id, name: u.name || "이름 없음", email: u.email ?? "" })),
    [stats],
  )

  if (loading) return <ReadingsSkeleton />
  if (problem && (problem.kind === "forbidden" || problem.kind === "service_key")) {
    return <LoadProblemView problem={problem.kind} onRetry={refresh} retrying={fetching} />
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* 머리 — 셸 머리(h1 "수질 기록")와 같은 이름이라 데스크톱에서는 제목을 숨긴다. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground lg:sr-only">수질 기록</h2>
          <p className="text-sm text-muted-foreground mt-0.5 lg:mt-0 tabular-nums" aria-live="polite">
            {data ? `총 ${data.total.toLocaleString("ko-KR")}건` : " "}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CsvButton filter={filter} isMock={isMock} disabled={!data || data.total === 0} />
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            aria-label="수질 기록 새로고침"
            className="border-border text-muted-foreground hover:text-foreground gap-2 min-h-[44px]"
          >
            <RefreshCw className={cn("w-4 h-4", fetching && "animate-spin")} aria-hidden="true" />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
        </div>
      </div>

      <FilterBar
        filter={filter}
        setFilter={setFilter}
        users={users}
        usersFailed={!!usersError}
        scope={data?.scope}
      />

      {problem ? (
        problem.kind === "bad_request" ? (
          <div className="flex flex-col items-center text-center gap-3 py-12 px-4 rounded-xl border border-border bg-card" role="alert">
            <AlertCircle className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-foreground max-w-sm">{problem.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter({ ...DEFAULT_READINGS_FILTER })}
              className="border-border min-h-[44px]"
            >
              필터 초기화
            </Button>
          </div>
        ) : (
          <LoadProblemView problem={problem.kind} onRetry={refresh} retrying={fetching} />
        )
      ) : data && (
        <div className={cn("space-y-3 transition-opacity", fetching && "opacity-60")} aria-busy={fetching}>
          <ReadingsList data={data} filter={filter} onPage={page => setFilter({ page })} />
          <Legend hasSourceColumn={data.has_source_column} />
        </div>
      )}
    </div>
  )
}

// ─── 필터 바 ─────────────────────────────────────────────────────────────────

type UserOption = { id: string; name: string; email: string }

function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5 bg-card">
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "px-3 min-h-[44px] sm:min-h-[40px] rounded-md text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const SELECT_CLS =
  "h-11 sm:h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"

function FilterBar({ filter, setFilter, users, usersFailed, scope }: {
  filter: ReadingsFilter
  setFilter: (patch: Partial<ReadingsFilter>) => void
  users: UserOption[]
  usersFailed: boolean
  scope: AdminReadingsResponse["scope"]
}) {
  const farms = scope?.farms ?? []
  const farm = farms.find(f => f.id === filter.farm)
  const tankOptions = (farm ? [farm] : farms).flatMap(f =>
    f.tanks.map(t => ({ id: t.id, label: farm ? t.name : `${f.name} · ${t.name}`, unit: unitOf(f.farm_type) })),
  )
  const hasAgri = farms.some(f => f.farm_type === "agriculture")
  const tankWord = hasAgri ? (farms.every(f => f.farm_type === "agriculture") ? "베드" : "수조·베드") : "수조"

  function choosePeriod(p: ReadingsFilter["period"]) {
    if (p !== "custom") { setFilter({ period: p, from: "", to: "" }); return }
    // 직접 — 지금 보던 30일을 기본값으로 채워 둔다.
    const now = Date.now()
    setFilter({ period: "custom", from: filter.from || kstDateString(now - 30 * DAY_MS), to: filter.to || kstDateString(now) })
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <UserPicker
            users={users}
            failed={usersFailed}
            value={filter.user}
            onChange={id => setFilter({ user: id, farm: "", tank: "" })}
          />
          <select
            value={filter.farm}
            onChange={e => setFilter({ farm: e.target.value, tank: "" })}
            disabled={!filter.user || farms.length === 0}
            aria-label="농장"
            className={SELECT_CLS}
          >
            <option value="">{!filter.user ? "농장 — 사용자를 먼저 고르세요" : farms.length === 0 ? "농장 없음" : "모든 농장"}</option>
            {farms.map(f => (
              <option key={f.id} value={f.id}>{f.name}{f.farm_type === "agriculture" ? " (스마트팜)" : ""}</option>
            ))}
          </select>
          <select
            value={filter.tank}
            onChange={e => setFilter({ tank: e.target.value })}
            disabled={!filter.user || tankOptions.length === 0}
            aria-label={tankWord}
            className={SELECT_CLS}
          >
            <option value="">{!filter.user ? `${tankWord} — 사용자를 먼저 고르세요` : tankOptions.length === 0 ? `${tankWord} 없음` : `모든 ${tankWord}`}</option>
            {tankOptions.map(t => (
              <option key={t.id} value={t.id}>{hasAgri ? `${t.unit} ` : ""}{t.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="출처" options={SOURCE_OPTIONS} value={filter.source} onChange={v => setFilter({ source: v })} />
          <Segmented label="기간" options={READINGS_PERIODS} value={filter.period} onChange={choosePeriod} />
          {filter.period === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={filter.from}
                max={filter.to || undefined}
                onChange={e => setFilter({ from: e.target.value })}
                aria-label="시작일"
                className="h-11 sm:h-10 w-[9.5rem] tabular-nums"
              />
              <span className="text-muted-foreground text-sm" aria-hidden="true">~</span>
              <Input
                type="date"
                value={filter.to}
                min={filter.from || undefined}
                onChange={e => setFilter({ to: e.target.value })}
                aria-label="종료일"
                className="h-11 sm:h-10 w-[9.5rem] tabular-nums"
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** 사용자 고르기 — 이름·이메일로 좁혀 고른다(간단한 콤보박스). */
function UserPicker({ users, failed, value, onChange }: {
  users: UserOption[]
  failed: boolean
  value: string
  onChange: (id: string) => void
}) {
  const listId = useId()
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = users.find(u => u.id === value)

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    return users
      .filter(u => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 50)
  }, [users, text])

  function pick(u: UserOption) {
    onChange(u.id)
    setText("")
    setOpen(false)
  }

  if (value) {
    return (
      <div className="flex items-center gap-1 h-11 sm:h-10 rounded-lg border border-input bg-background pl-3 pr-1 min-w-0">
        <span className="text-sm text-foreground truncate flex-1 min-w-0" title={selected?.email}>
          {selected ? <>{selected.name} <span className="text-muted-foreground">· {selected.email}</span></> : <span className="font-mono text-xs">{value}</span>}
        </span>
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="사용자 선택 해제"
          className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const shown = open && matches.length > 0
  return (
    <div className="relative min-w-0">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
      <Input
        type="search"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown ? `${listId}-${active}` : undefined}
        aria-label="사용자 검색(이름·이메일)"
        placeholder={failed ? "사용자 목록을 불러오지 못했습니다" : "사용자 — 이름·이메일 검색"}
        disabled={failed}
        value={text}
        onChange={e => { setText(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, matches.length - 1)) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === "Enter" && shown) { e.preventDefault(); pick(matches[Math.min(active, matches.length - 1)]) }
          else if (e.key === "Escape") setOpen(false)
        }}
        className="pl-9 h-11 sm:h-10"
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          aria-label="사용자"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-md py-1"
        >
          {matches.map((u, i) => (
            <li
              key={u.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // blur 보다 먼저 고르게 mousedown 에서 처리한다.
              onMouseDown={e => { e.preventDefault(); pick(u) }}
              onMouseEnter={() => setActive(i)}
              className={cn("px-3 min-h-[44px] flex flex-col justify-center cursor-pointer", i === active && "bg-accent")}
            >
              <span className="text-sm text-foreground truncate">{u.name}</span>
              <span className="text-xs text-muted-foreground truncate">{u.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

function CsvButton({ filter, isMock, disabled }: { filter: ReadingsFilter; isMock: boolean; disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setNote(null)
    const now = Date.now()
    try {
      if (isMock) {
        const { all } = mockReadingsResponse({ ...filter, page: 1 }, now)
        saveBlob(new Blob([readingsCsv(all.slice(0, READINGS_CSV_MAX))], { type: "text/csv;charset=utf-8" }), readingsCsvFilename(now))
        return
      }
      const res = await fetch(`/api/admin/readings?${filterToApiSearch(filter, now, "csv")}`, { cache: "no-store" })
      if (!res.ok) {
        const j = res.status === 400 ? await res.json().catch(() => null) as { message?: unknown } | null : null
        const p = problemOf(res.status)
        setNote(typeof j?.message === "string" ? j.message
          : p === "forbidden" ? "내려받을 권한이 없습니다"
          : p === "service_key" ? "서비스 롤 키가 설정되지 않았습니다"
          : "내려받지 못했습니다. 잠시 뒤 다시 시도해 주세요")
        return
      }
      saveBlob(await res.blob(), readingsCsvFilename(now))
      if (res.headers.get("X-Truncated") === "1") {
        setNote(`최대 ${READINGS_CSV_MAX.toLocaleString("ko-KR")}건까지만 담았습니다 — 기간을 좁혀 나눠 받으세요`)
      }
    } catch {
      setNote("내려받지 못했습니다. 잠시 뒤 다시 시도해 주세요")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={download}
        disabled={disabled || busy}
        className="border-border text-muted-foreground hover:text-foreground gap-2 min-h-[44px]"
      >
        <Download className={cn("w-4 h-4", busy && "animate-pulse")} aria-hidden="true" />
        {busy ? "내려받는 중" : <>CSV<span className="hidden sm:inline"> 내려받기</span></>}
      </Button>
      {note && (
        <p role="status" className="absolute right-0 top-full mt-1 z-10 w-64 text-xs text-foreground bg-popover border border-border rounded-md px-2 py-1.5 shadow-sm">
          {note}
        </p>
      )}
    </div>
  )
}

// ─── 목록 ────────────────────────────────────────────────────────────────────

function UnitHeader({ k }: { k: WqValueKey }) {
  const m = WQ_VALUE_META[k]
  return (
    <th className="text-right pb-2 pr-3 font-medium whitespace-nowrap">
      {m.short}
      {m.unit && <span className="block text-[10px] font-normal text-muted-foreground/80">{m.unit}</span>}
    </th>
  )
}

function OwnerLink({ row }: { row: AdminReadingRow }) {
  if (!row.owner_id) return <span className="text-muted-foreground">{row.owner_name}</span>
  return (
    <Link
      href={`/admin/users/${encodeURIComponent(row.owner_id)}`}
      className="text-foreground hover:underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {row.owner_name}
    </Link>
  )
}

function ReadingsList({ data, filter, onPage }: { data: AdminReadingsResponse; filter: ReadingsFilter; onPage: (p: number) => void }) {
  const [showAll, setShowAll] = useState(false)
  const rows = data.rows
  const optional = OPTIONAL_KEYS.filter(k => rows.some(r => r.values[k] !== null))
  const keys = [...CORE_KEYS, ...optional, ...(showAll ? EXTRA_KEYS : [])]

  if (data.total === 0 || rows.length === 0) {
    const beyond = data.total > 0
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-12 flex flex-col items-center text-center gap-2">
          <Droplets className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-foreground">
            {beyond ? "이 쪽에는 기록이 없습니다"
              : filter.source === "manual" ? "조건에 맞는 수기 기록이 없습니다"
              : filter.source === "sensor" ? "조건에 맞는 센서 기록이 없습니다"
              : "조건에 맞는 수질 기록이 없습니다"}
          </p>
          {beyond ? (
            <Button variant="outline" size="sm" onClick={() => onPage(1)} className="border-border min-h-[44px]">첫 쪽으로</Button>
          ) : (
            <p className="text-xs text-muted-foreground">기간을 넓히거나 다른 사용자·출처를 골라 보세요.</p>
          )}
        </CardContent>
      </Card>
    )
  }

  const first = (data.page - 1) * data.page_size + 1
  const last = first + rows.length - 1

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 sm:p-4 space-y-3">
        {/* 모바일 — 카드 목록 */}
        <ul className="sm:hidden divide-y divide-border">
          {rows.map(r => {
            const agri = r.farm_type === "agriculture"
            const keyVals: WqValueKey[] = ["temperature", "ph", "do_level", agri ? "conductivity" : "salinity"]
            return (
              <li key={r.id} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground"><RecordedAt row={r} /></p>
                    <p className="text-xs text-muted-foreground break-words">
                      {r.farm_name} · {unitOf(r.farm_type)} {r.tank_name}
                    </p>
                    <p className="text-xs"><OwnerLink row={r} /></p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 max-w-[50%]">
                    <SourceBadge kind={r.source_kind} deviceName={r.device_name} compact />
                    <LateEntryMark row={r} />
                  </div>
                </div>
                <dl className="grid grid-cols-4 gap-1.5">
                  {keyVals.map(k => (
                    <div key={k} className="rounded-md bg-muted/60 px-2 py-1.5 min-w-0">
                      <dt className="text-[10px] text-muted-foreground truncate">{WQ_VALUE_META[k].short}</dt>
                      <dd className="text-sm font-medium tabular-nums"><WqValue v={r.values[k]} /></dd>
                    </div>
                  ))}
                </dl>
              </li>
            )
          })}
        </ul>

        {/* sm 이상 — 표 */}
        <div className="hidden sm:block">
          <div className="flex justify-end mb-2">
            <button
              type="button"
              aria-pressed={showAll}
              onClick={() => setShowAll(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 min-h-[44px] px-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAll ? "항목 접기" : "항목 더보기(암모니아·아질산·질산·알칼리도·탁도)"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs border-b border-border align-bottom">
                  <th className="text-left pb-2 pr-3 font-medium whitespace-nowrap">측정 시각</th>
                  <th className="text-left pb-2 pr-3 font-medium whitespace-nowrap">출처</th>
                  <th className="text-left pb-2 pr-3 font-medium whitespace-nowrap">사용자</th>
                  <th className="text-left pb-2 pr-3 font-medium whitespace-nowrap">농장 / 수조</th>
                  {keys.map(k => <UnitHeader key={k} k={k} />)}
                  <th className="text-right pb-2 font-medium whitespace-nowrap">입력 시각</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-accent/50 transition-colors">
                    <td className="py-2.5 pr-3 text-foreground"><RecordedAt row={r} /></td>
                    <td className="py-2.5 pr-3 max-w-[14rem]">
                      <SourceBadge kind={r.source_kind} deviceName={r.device_name} />
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap"><OwnerLink row={r} /></td>
                    <td className="py-2.5 pr-3 min-w-[9rem]">
                      <span className="block text-foreground">{r.farm_name}</span>
                      <span className="block text-xs text-muted-foreground">{unitOf(r.farm_type)} {r.tank_name}</span>
                    </td>
                    {keys.map(k => (
                      <td key={k} className="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">
                        <WqValue v={r.values[k]} digits={k === "conductivity" ? 0 : 2} />
                      </td>
                    ))}
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <span className="block text-xs text-muted-foreground tabular-nums">{formatKst(r.created_at)}</span>
                      <LateEntryMark row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 쪽 이동 */}
        <nav aria-label="쪽 이동" className="flex items-center justify-between gap-2 pt-1 border-t border-border">
          <p className="text-xs text-muted-foreground tabular-nums pt-2">
            {first.toLocaleString("ko-KR")}–{last.toLocaleString("ko-KR")} / 총 {data.total.toLocaleString("ko-KR")}건
          </p>
          <div className="flex items-center gap-1 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPage(data.page - 1)}
              disabled={data.page <= 1}
              aria-label="이전 쪽"
              className="border-border min-h-[44px] min-w-[44px] gap-1"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">이전</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPage(data.page + 1)}
              disabled={last >= data.total}
              aria-label="다음 쪽"
              className="border-border min-h-[44px] min-w-[44px] gap-1"
            >
              <span className="hidden sm:inline">다음</span><ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      </CardContent>
    </Card>
  )
}

function Legend({ hasSourceColumn }: { hasSourceColumn: boolean }) {
  return (
    <ul className="text-xs text-muted-foreground space-y-1 px-1">
      <li>
        <span className="font-medium text-foreground">수기(추정)</span> — {GUESS_TITLE}. 출처가 저장되기 전 기록이라
        수기인지 옛 센서 기록인지 구분할 수 없습니다. [수기] 필터에 함께 들어갑니다.
      </li>
      <li>흐린 <span className="tabular-nums">0</span> — 예전 수기 입력 폼은 빈 칸을 0 으로 저장해, 실제로 잰 0 과 구분할 수 없습니다.</li>
      <li>수기 기록의 측정 시각은 날짜만 보입니다(입력 폼이 날짜만 받습니다). &ldquo;나중 입력&rdquo;은 측정한 날보다 뒤에 적은 기록입니다.</li>
      {!hasSourceColumn && (
        <li className="text-amber-600 dark:text-amber-400">
          출처 저장 SQL(wq_source.sql)이 아직 실행되지 않았습니다 — 장비 기록이 아닌 것은 모두 수기(추정)으로 보입니다.
        </li>
      )}
    </ul>
  )
}

// ─── 로딩 ────────────────────────────────────────────────────────────────────

function ReadingsSkeleton() {
  const bar = "bg-muted rounded animate-pulse"
  return (
    <div className="space-y-4" role="status" aria-label="수질 기록 불러오는 중">
      <div className="flex items-center justify-between">
        <div className={cn(bar, "h-5 w-28")} />
        <div className={cn(bar, "h-10 w-40")} />
      </div>
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[0, 1, 2].map(i => <div key={i} className={cn(bar, "h-10")} />)}
        </div>
        <div className={cn(bar, "h-10 w-72 max-w-full")} />
      </div>
      <div className="rounded-xl border border-border p-4 space-y-3">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className={cn(bar, "h-6 w-full")} />)}
      </div>
    </div>
  )
}
