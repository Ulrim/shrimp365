"use client"

// 농장 주소 입력칸 — 새우 농장 추가·수정, 스마트팜 농장 추가·수정, 온보딩이 함께 쓴다.
//
// 입력칸은 언제나 직접 타이핑할 수 있다. 검색은 거드는 도구일 뿐이다 — 베트남·인도네시아
// 양식장은 번지 없는 주소가 많아 검색으로 안 잡히는 일이 흔하다.
//
// "주소 검색" 대화상자에는 탭이 둘이다.
//  - 국내 주소(우편번호): 다음(카카오) 우편번호 위젯. 이 탭을 열 때만 스크립트를 받는다.
//  - 주소 검색(전 세계): /api/geocode/search (서버가 Nominatim·카카오를 대신 부른다).
//    검색 버튼/Enter 를 눌렀을 때만 부른다 — Nominatim 이용 정책상 자동완성 금지.
//    결과를 고르면 주소와 함께 좌표도 onPickCoords 로 넘긴다.
// 기본 탭은 한국어 사용자면 국내, 그 외 언어면 전 세계.
//
// 대화상자는 새우·스마트팜 농장 다이얼로그(Radix Dialog) 안에 그려진다. Radix 가 document
// 캡처 단계에서 Esc 를 받아 바깥 다이얼로그까지 닫아 버리므로, 열려 있는 동안 window 캡처
// 단계에서 Esc 를 먼저 받아 이 대화상자만 닫는다.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, MapPin, Search, X } from "lucide-react"
import { useT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: DaumPostcodeResult) => void
        onclose?: () => void
        width?: string | number
        height?: string | number
      }) => { embed: (el: HTMLElement) => void; open: () => void }
    }
  }
}

interface DaumPostcodeResult {
  address: string        // 기본 주소
  jibunAddress: string   // 지번 주소
  roadAddress: string    // 도로명 주소
  zonecode: string       // 우편번호
  sido: string
  sigungu: string
  bname: string
}

interface AddressSearchProps {
  value: string
  onChange: (address: string) => void
  /** 넘기면 사전 문구 대신 이것을 쓴다. */
  placeholder?: string
  id?: string
  className?: string
  required?: boolean
  inputClassName?: string
  /** 전 세계 검색 결과를 고르면 그 좌표를 넘긴다. 이미 들어 있는 좌표를 덮을지는 호출부가 정한다. */
  onPickCoords?: (lat: number, lng: number) => void
}

type Tab = "kr" | "world"

type Candidate = {
  label: string
  latitude: number
  longitude: number
  country_code: string
  precision: "address" | "region"
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; results: Candidate[]; provider: "kakao" | "nominatim" }
  | { kind: "error"; busy: boolean }

const SCRIPT_ID = "daum-postcode-script"
const SCRIPT_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
const Q_MIN = 2
const Q_MAX = 200
const ADDRESS_MAX = 300   // 검색 결과 라벨 상한(lib/geocode.ts LABEL_MAX)과 같다
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])'

// 우편번호 스크립트는 페이지 전체에서 한 번만 받는다. 실패하면 다음에 다시 시도할 수 있게 비운다.
let daumLoading: Promise<void> | null = null
function loadDaumPostcode(): Promise<void> {
  if (window.daum?.Postcode) return Promise.resolve()
  if (daumLoading) return daumLoading
  daumLoading = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement("script")
    script.addEventListener("load", () => resolve())
    script.addEventListener("error", () => {
      daumLoading = null
      script.remove()
      reject(new Error("postcode script"))
    })
    if (!existing) {
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })
  return daumLoading
}

function isCandidate(v: unknown): v is Candidate {
  const c = v as Candidate | null
  return !!c && typeof c.label === "string" && c.label.length > 0
    && typeof c.latitude === "number" && Number.isFinite(c.latitude)
    && typeof c.longitude === "number" && Number.isFinite(c.longitude)
}

// 나라 코드 → 화면 언어의 나라 이름("vn" → "베트남"). Intl.DisplayNames 가 없는 브라우저는 코드 그대로.
const displayNames = new Map<string, Intl.DisplayNames | null>()
function regionName(locale: string, cc: string): string {
  if (!/^[a-z]{2}$/i.test(cc)) return ""
  if (!displayNames.has(locale)) {
    try { displayNames.set(locale, new Intl.DisplayNames([locale], { type: "region" })) } catch { displayNames.set(locale, null) }
  }
  try { return displayNames.get(locale)?.of(cc.toUpperCase()) ?? cc.toUpperCase() } catch { return cc.toUpperCase() }
}

export function AddressSearch({
  value,
  onChange,
  placeholder,
  id,
  className,
  required,
  inputClassName,
  onPickCoords,
}: AddressSearchProps) {
  const { t, locale } = useT()
  const s = t.addressSearch
  const defaultTab: Tab = locale === "ko" ? "kr" : "world"

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(defaultTab)
  const [daum, setDaum] = useState<"idle" | "ready" | "failed">("idle")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<SearchState>({ kind: "idle" })

  const baseId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ kr: null, world: null })
  const embedRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 호출부가 onChange 를 매 렌더 새로 만들어 넘겨도 위젯을 다시 심지 않게 ref 로 든다.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  const close = useCallback((focusInput = false) => {
    abortRef.current?.abort()
    setOpen(false)
    requestAnimationFrame(() => (focusInput ? inputRef.current : triggerRef.current)?.focus())
  }, [])

  const openDialog = () => {
    setTab(defaultTab)
    setQuery(value.trim().slice(0, Q_MAX))
    setSearch({ kind: "idle" })
    setOpen(true)
  }

  // 언마운트 때 진행 중인 검색을 끊는다.
  useEffect(() => () => abortRef.current?.abort(), [])

  // 국내 탭을 열 때만 우편번호 스크립트를 받는다(해외 사용자에게는 받지 않는다).
  useEffect(() => {
    if (!open || tab !== "kr") return
    let alive = true
    loadDaumPostcode().then(
      () => { if (alive) setDaum("ready") },
      () => { if (alive) setDaum("failed") },
    )
    return () => { alive = false }
  }, [open, tab])

  // 국내 탭이 보이고 스크립트가 준비되면 우편번호 위젯을 iframe 으로 심는다.
  useEffect(() => {
    if (!open || tab !== "kr" || daum !== "ready" || !embedRef.current || !window.daum?.Postcode) return
    embedRef.current.innerHTML = ""
    new window.daum.Postcode({
      oncomplete(data: DaumPostcodeResult) {
        onChangeRef.current(data.roadAddress || data.jibunAddress || data.address)
        close(true)
      },
      onclose() {
        close()
      },
      width: "100%",
      height: "100%",
    }).embed(embedRef.current)
  }, [open, tab, daum, close])

  // 열릴 때 포커스를 대화상자 안으로 옮긴다. 전 세계 탭이면 검색어 칸, 국내 탭이면 탭 버튼.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      const target = tab === "world" ? queryRef.current : tabRefs.current[tab]
      target?.focus()
    })
    return () => cancelAnimationFrame(id)
    // 탭을 바꿀 때마다 포커스를 옮기지는 않는다 — 열릴 때 한 번만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Esc 로 닫기 + Tab 이 대화상자 밖으로 새지 않게. window 캡처 단계라 바깥 Radix 다이얼로그보다 먼저 받는다.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== "Tab" || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el.tagName === "IFRAME")
      if (items.length === 0) return
      const first = items[0], last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && dialogRef.current.contains(active)
      if (!inside || (e.shiftKey && active === first) || (!e.shiftKey && active === last)) {
        e.preventDefault()
        e.stopPropagation()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, close])

  const trimmedQuery = query.replace(/\s+/g, " ").trim()
  const canSearch = trimmedQuery.length >= Q_MIN && search.kind !== "loading"

  async function runSearch() {
    if (!canSearch) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setSearch({ kind: "loading" })
    try {
      const res = await fetch(
        `/api/geocode/search?${new URLSearchParams({ q: trimmedQuery, lang: locale })}`,
        { signal: ac.signal, cache: "no-store" },
      )
      const body = (await res.json().catch(() => null)) as { results?: unknown; provider?: unknown } | null
      if (ac.signal.aborted) return
      if (!res.ok) {
        setSearch({ kind: "error", busy: res.status === 429 || res.status === 503 })
        return
      }
      const results = Array.isArray(body?.results) ? body.results.filter(isCandidate) : []
      setSearch({ kind: "done", results, provider: body?.provider === "kakao" ? "kakao" : "nominatim" })
    } catch {
      if (!ac.signal.aborted) setSearch({ kind: "error", busy: false })
    }
  }

  function pick(c: Candidate) {
    onChange(c.label)
    onPickCoords?.(c.latitude, c.longitude)
    close(true)
  }

  function onTabKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return
    e.preventDefault()
    const next: Tab = e.key === "Home" ? "kr" : e.key === "End" ? "world" : tab === "kr" ? "world" : "kr"
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const titleId = `${baseId}-title`
  const tabs: { key: Tab; label: string }[] = [
    { key: "kr", label: s.tabDomestic },
    { key: "world", label: s.tabWorld },
  ]

  return (
    <>
      <div className={cn("flex gap-2", className)}>
        <Input
          ref={inputRef}
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? s.placeholder}
          required={required}
          autoComplete="street-address"
          maxLength={ADDRESS_MAX}
          className={inputClassName}
        />
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onClick={openDialog}
          aria-haspopup="dialog"
          aria-label={s.button}
          className="shrink-0 gap-1.5 px-3"
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">{s.button}</span>
        </Button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => close()}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-card rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
            style={{ height: "70vh", maxHeight: 560 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span id={titleId} className="text-sm font-semibold text-foreground">{s.title}</span>
              <button
                type="button"
                onClick={() => close()}
                aria-label={s.close}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div role="tablist" aria-label={s.title} className="flex shrink-0 border-b border-border" onKeyDown={onTabKeyDown}>
              {tabs.map(({ key, label }) => {
                const active = tab === key
                return (
                  <button
                    key={key}
                    ref={el => { tabRefs.current[key] = el }}
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${key}`}
                    aria-selected={active}
                    aria-controls={`${baseId}-panel-${key}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setTab(key)}
                    className={cn(
                      "flex-1 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                      active
                        ? "border-ocean-500 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {tab === "kr" ? (
              <div
                role="tabpanel"
                id={`${baseId}-panel-kr`}
                aria-labelledby={`${baseId}-tab-kr`}
                className="flex-1 relative"
              >
                {daum !== "ready" && (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                    {daum === "failed" ? (
                      <p className="text-sm text-muted-foreground" role="alert">{s.error}</p>
                    ) : (
                      <div
                        className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin"
                        role="status"
                        aria-label={s.loadingWidget}
                      />
                    )}
                  </div>
                )}
                <div ref={embedRef} className="w-full h-full" />
              </div>
            ) : (
              <div
                role="tabpanel"
                id={`${baseId}-panel-world`}
                aria-labelledby={`${baseId}-tab-world`}
                className="flex-1 min-h-0 flex flex-col"
              >
                <div className="p-4 space-y-2 shrink-0">
                  <label htmlFor={`${baseId}-q`} className="sr-only">{s.queryLabel}</label>
                  <div className="flex gap-2">
                    <Input
                      ref={queryRef}
                      id={`${baseId}-q`}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key !== "Enter") return
                        // 바깥 농장 폼이 제출되지 않게 막는다. IME 조합 중 Enter 는 글자 확정일 뿐이다.
                        e.preventDefault()
                        if (!e.nativeEvent.isComposing) void runSearch()
                      }}
                      placeholder={s.queryPlaceholder}
                      maxLength={Q_MAX}
                      enterKeyHint="search"
                      autoComplete="off"
                      className="min-h-[44px]"
                    />
                    <Button
                      type="button"
                      onClick={() => void runSearch()}
                      disabled={!canSearch}
                      className="shrink-0 min-h-[44px] bg-ocean-500 hover:bg-ocean-600 text-white"
                    >
                      {search.kind === "loading"
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        : <Search className="w-4 h-4" aria-hidden="true" />}
                      <span>{s.search}</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto border-t border-border">
                  <p role="status" aria-live="polite" className={cn("px-4 text-sm text-muted-foreground", search.kind === "done" && search.results.length > 0 ? "sr-only" : "py-4")}>
                    {search.kind === "loading" && s.searching}
                    {search.kind === "error" && (search.busy ? s.busy : s.error)}
                    {search.kind === "done" && search.results.length === 0 && s.noResults}
                    {search.kind === "done" && search.results.length > 0 && `${s.results}: ${search.results.length}`}
                  </p>
                  {search.kind === "done" && search.results.length > 0 && (
                    <ul aria-label={s.results} className="divide-y divide-border">
                      {search.results.map((c, i) => {
                        const country = regionName(locale, c.country_code)
                        return (
                          <li key={`${c.label}-${i}`}>
                            <button
                              type="button"
                              onClick={() => pick(c)}
                              className="w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            >
                              <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-ocean-500" aria-hidden="true" />
                              <span className="min-w-0">
                                <span className="block text-sm text-foreground break-words">{c.label}</span>
                                <span className="block text-xs text-muted-foreground mt-0.5">
                                  {[country, c.precision === "region" ? s.approx : ""].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {search.kind === "done" && search.provider === "nominatim" && search.results.length > 0 && (
                    <p className="px-4 py-2 text-[11px] text-muted-foreground">
                      ©{" "}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        OpenStreetMap
                      </a>{" "}
                      contributors
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
