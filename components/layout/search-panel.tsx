"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, X, Building2, Droplets, BookOpen, FlaskConical, BarChart3, BrainCircuit, LayoutDashboard, ArrowRight, HelpCircle, ClipboardList } from "lucide-react"
import { getFarms, getAllTanks } from "@/lib/db"
import { MOCK_FARMS, MOCK_TANKS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import type { Farm, Tank, IconComponent } from "@/types"

interface SearchPanelProps {
  open: boolean
  onClose: () => void
}

export function SearchPanel({ open, onClose }: SearchPanelProps) {
  const { user } = useAuth()
  const { t } = useT()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [farms, setFarms] = useState<Farm[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)

  const navPages: { href: string; label: string; desc: string; icon: IconComponent }[] = [
    { href: "/dashboard",            label: t.nav.dashboard,            icon: LayoutDashboard, desc: t.search.descDashboard },
    { href: "/water-quality",        label: t.nav.waterQuality,         icon: Droplets,        desc: t.search.descWaterQuality },
    { href: "/record/water-quality", label: t.record.waterQuality,      icon: Droplets,        desc: t.search.descRecordWater },
    { href: "/record/journal",       label: t.search.pageRecordJournal, icon: ClipboardList,   desc: t.search.descRecordJournal },
    { href: "/journal",              label: t.nav.journal,              icon: BookOpen,        desc: t.search.descJournal },
    { href: "/farms",                label: t.farms.title,              icon: Building2,       desc: t.search.descFarms },
    { href: "/diagnosis",            label: t.nav.diagnosis,            icon: FlaskConical,    desc: t.search.descDiagnosis },
    { href: "/ai-advisor",           label: t.nav.aiAdvisor,            icon: BrainCircuit,    desc: t.search.descAiAdvisor },
    { href: "/reports",              label: t.nav.reports,              icon: BarChart3,       desc: t.search.descReports },
    { href: "/help",                 label: t.search.pageHelp,          icon: HelpCircle,      desc: t.search.descHelp },
  ]

  useEffect(() => {
    if (!open) return
    const mock = isTestAccount(user?.email)
    getFarms().then(f => setFarms(f.length ? f : (mock ? MOCK_FARMS : [])))
    getAllTanks().then(t => setTanks(t.length ? t : (mock ? MOCK_TANKS : [])))
  }, [open, user?.email])

  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const q = query.trim().toLowerCase()

  const matchedPages = navPages.filter(p =>
    !q || p.label.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)
  )
  const matchedFarms = farms.filter(f =>
    q && (f.name.toLowerCase().includes(q) || f.location.toLowerCase().includes(q))
  )
  const matchedTanks = tanks.filter(t =>
    q && t.name.toLowerCase().includes(q)
  )

  type ResultItem =
    | { kind: "page";  href: string; label: string; desc: string; icon: IconComponent }
    | { kind: "farm";  id: string;   name: string; location: string }
    | { kind: "tank";  id: string;   name: string; status: Tank["status"] }

  const results: ResultItem[] = [
    ...matchedPages.map(p => ({ kind: "page" as const, ...p })),
    ...matchedFarms.map(f => ({ kind: "farm" as const, id: f.id, name: f.name, location: f.location })),
    ...matchedTanks.map(t => ({ kind: "tank" as const, id: t.id, name: t.name, status: t.status })),
  ]

  const navigate = useCallback((item: ResultItem) => {
    onClose()
    if (item.kind === "page") router.push(item.href)
    else if (item.kind === "farm") router.push("/farms")
    else router.push(`/water-quality`)
  }, [router, onClose])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)) }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
      if (e.key === "Enter" && results[selectedIdx]) { navigate(results[selectedIdx]) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, results, selectedIdx, navigate, onClose])

  if (!open) return null

  const STATUS_LABEL: Record<Tank["status"], string> = {
    active: t.dashboard.normal, warning: t.dashboard.warning, danger: t.dashboard.danger, inactive: t.farms.tankStatusInactive
  }
  const STATUS_COLOR: Record<Tank["status"], string> = {
    active: "text-emerald-400", warning: "text-amber-400", danger: "text-red-400", inactive: "text-slate-400"
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-xl mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.search.placeholder}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:block text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto py-2">
          {results.length === 0 && q && (
            <p className="text-muted-foreground text-sm text-center py-8">{t.search.noResults.replace("{{query}}", query)}</p>
          )}

          {/* Pages */}
          {matchedPages.length > 0 && (
            <div>
              {q && <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider px-4 py-1.5">{t.search.sectionPages}</p>}
              {matchedPages.map((item, i) => {
                const absIdx = i
                const Icon = item.icon
                return (
                  <button
                    key={item.href}
                    onClick={() => navigate({ kind: "page", ...item })}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIdx === absIdx ? "bg-ocean-50" : "hover:bg-accent"}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-ocean-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}

          {/* Farms */}
          {matchedFarms.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider px-4 py-1.5 mt-1">{t.search.sectionFarms}</p>
              {matchedFarms.map((farm, i) => {
                const absIdx = matchedPages.length + i
                return (
                  <button
                    key={farm.id}
                    onClick={() => navigate({ kind: "farm", id: farm.id, name: farm.name, location: farm.location })}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIdx === absIdx ? "bg-ocean-50" : "hover:bg-accent"}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-teal-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium">{farm.name}</p>
                      <p className="text-xs text-muted-foreground">{farm.location}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}

          {/* Tanks */}
          {matchedTanks.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider px-4 py-1.5 mt-1">{t.search.sectionTanks}</p>
              {matchedTanks.map((tank, i) => {
                const absIdx = matchedPages.length + matchedFarms.length + i
                return (
                  <button
                    key={tank.id}
                    onClick={() => navigate({ kind: "tank", id: tank.id, name: tank.name, status: tank.status })}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${selectedIdx === absIdx ? "bg-ocean-50" : "hover:bg-accent"}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Droplets className="w-4 h-4 text-ocean-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium">{tank.name}</p>
                      <p className={`text-xs font-medium ${STATUS_COLOR[tank.status]}`}>{STATUS_LABEL[tank.status]}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span><kbd className="bg-muted border border-border rounded px-1">↑↓</kbd> {t.search.hintNavigate}</span>
          <span><kbd className="bg-muted border border-border rounded px-1">Enter</kbd> {t.search.hintSelect}</span>
          <span><kbd className="bg-muted border border-border rounded px-1">ESC</kbd> {t.common.close}</span>
        </div>
      </div>
    </div>
  )
}
