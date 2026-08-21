"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, BrainCircuit, Loader2, Send } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getAlerts, getAllTanks, getFarms } from "@/lib/db"
import { isTestAccount, MOCK_ALERTS, MOCK_FARMS, MOCK_TANKS } from "@/lib/mock-data"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { Locale } from "@/lib/i18n"
import type { Alert, Farm, Tank } from "@/types"

/* ── 대화 메시지 ──────────────────────────────────────────── */

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  /** 응답 실패로 만들어진 에러 말풍선 여부 */
  error?: boolean
}

/** t.aiAdvisor 에 에러 키가 없어 이 문구만 예외적으로 로컬 상수로 둔다. */
const ERROR_MSG: Record<Locale, string> = {
  ko: "응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  en: "Failed to generate a response. Please try again in a moment.",
  vi: "Không thể tạo phản hồi. Vui lòng thử lại sau.",
  id: "Gagal menghasilkan jawaban. Silakan coba lagi nanti.",
}

/* ── 소형 마크다운 렌더러 (의존성 없음) ──────────────────────
 * 지원: **굵게**, #~### 제목, -/1. 목록, 빈 줄 단락, | 표 | 블록.
 * 그 외는 whitespace-pre-wrap 텍스트로 그대로 보여준다. */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][]; hasHeader: boolean }
  | { kind: "para"; text: string }

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const BULLET_RE = /^[-*]\s+/
const ORDERED_RE = /^\d+\.\s+/
const TABLE_SEP_CELL_RE = /^:?-{2,}:?$/

function renderInline(text: string): React.ReactNode {
  if (!text.includes("**")) return text
  const nodes: React.ReactNode[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    nodes.push(
      <strong key={key++} className="font-semibold">
        {match[1]}
      </strong>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function parseBlocks(src: string): Block[] {
  const lines = src.split("\n")
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i++
      continue
    }

    const heading = HEADING_RE.exec(trimmed)
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] })
      i++
      continue
    }

    if (trimmed.startsWith("|")) {
      const rows: string[][] = []
      let hasHeader = false
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map(c => c.trim())
        const isSeparator = cells.length > 0 && cells.every(c => TABLE_SEP_CELL_RE.test(c))
        if (isSeparator) {
          if (rows.length === 1) hasHeader = true
        } else {
          rows.push(cells)
        }
        i++
      }
      if (rows.length > 0) blocks.push({ kind: "table", rows, hasHeader })
      continue
    }

    if (BULLET_RE.test(trimmed) || ORDERED_RE.test(trimmed)) {
      const ordered = ORDERED_RE.test(trimmed)
      const re = ordered ? ORDERED_RE : BULLET_RE
      const items: string[] = []
      while (i < lines.length && re.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(re, ""))
        i++
      }
      blocks.push({ kind: "list", ordered, items })
      continue
    }

    // 단락 — 빈 줄이나 다른 블록 시작 전까지 모은다.
    const para: string[] = [lines[i]]
    i++
    while (i < lines.length) {
      const next = lines[i].trim()
      if (!next || HEADING_RE.test(next) || next.startsWith("|") || BULLET_RE.test(next) || ORDERED_RE.test(next)) break
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: "para", text: para.join("\n") })
  }
  return blocks
}

function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            // 페이지 h1 아래 계층을 지키도록 # → h3, ## → h4, ### → h5 로 내린다.
            const Tag = (["h3", "h4", "h5"] as const)[block.level - 1]
            return (
              <Tag
                key={i}
                className={cn(
                  "font-bold text-foreground",
                  block.level === 1 ? "text-base" : block.level === 2 ? "text-[15px]" : "text-sm"
                )}
              >
                {renderInline(block.text)}
              </Tag>
            )
          }
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul"
            return (
              <ListTag
                key={i}
                className={cn("pl-5 space-y-1 leading-relaxed", block.ordered ? "list-decimal" : "list-disc")}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ListTag>
            )
          }
          case "table": {
            const head = block.hasHeader ? block.rows[0] : null
            const body = block.hasHeader ? block.rows.slice(1) : block.rows
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full text-xs border-collapse tabular-nums">
                  {head && (
                    <thead>
                      <tr>
                        {head.map((cell, j) => (
                          <th
                            key={j}
                            className="border border-border bg-muted px-2.5 py-1.5 text-left font-semibold whitespace-nowrap"
                          >
                            {renderInline(cell)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {body.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k} className="border border-border px-2.5 py-1.5 align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          case "para":
            return (
              <p key={i} className="whitespace-pre-wrap leading-relaxed">
                {renderInline(block.text)}
              </p>
            )
        }
      })}
    </div>
  )
}

/* ── 말풍선 셸 ───────────────────────────────────────────── */

function AssistantShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#1E40AF]/10 border border-[#1E40AF]/25 flex items-center justify-center shrink-0 mt-0.5">
        <BrainCircuit className="w-4 h-4 text-[#1E40AF]" aria-hidden="true" />
      </div>
      <div className="max-w-[85%] sm:max-w-[75%] min-w-0 bg-card border border-border rounded-2xl rounded-tl-md px-4 py-2.5 text-sm text-foreground break-words">
        {children}
      </div>
    </div>
  )
}

/* ── 화면 본체 ───────────────────────────────────────────── */

export function AIAdvisorView() {
  const { user } = useAuth()
  const { t, locale } = useT()
  const mock = isTestAccount(user?.email)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [includeContext, setIncludeContext] = useState(true)

  const sendingRef = useRef(false) // 상태 반영 전 더블클릭 방지
  const logRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const idRef = useRef(0)

  // 새 메시지·스트리밍 조각이 올 때마다 맨 아래로.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // textarea 1~4행 자동 확장.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  /** 서버 폴백 파서가 정규식으로 읽는 고정 한국어 형식 — 문구·순서를 바꾸면 안 된다. */
  async function buildContext(): Promise<string | undefined> {
    try {
      let farms: Farm[]
      let tanks: Tank[]
      let alerts: Alert[]
      if (mock) {
        farms = MOCK_FARMS
        tanks = MOCK_TANKS
        alerts = MOCK_ALERTS.filter(a => !a.resolved)
      } else {
        ;[farms, tanks, alerts] = await Promise.all([getFarms(), getAllTanks(), getAlerts(true)])
      }
      const danger = tanks.filter(tk => tk.status === "danger").length
      const warning = tanks.filter(tk => tk.status === "warning").length
      const lines = [
        `운영 양식장: ${farms.length}개`,
        `운영 수조: ${tanks.length}개 (위험 ${danger}개, 주의 ${warning}개)`,
        `활성 알림 ${alerts.length}건:`,
        ...alerts.slice(0, 3).map(a => `- ${a.message}`),
      ]
      return lines.join("\n")
    } catch {
      return undefined // 현황 조회 실패는 조용히 무시하고 컨텍스트 없이 전송
    }
  }

  async function send(raw: string) {
    const question = raw.trim()
    if (!question || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setInput("")

    const assistantId = `msg-${++idRef.current}`
    setMessages(prev => [
      ...prev,
      { id: `msg-${++idRef.current}`, role: "user", content: question },
      { id: assistantId, role: "assistant", content: "" },
    ])

    const fail = (message: string) => {
      setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content: message, error: true } : m)))
    }

    try {
      const context = includeContext ? await buildContext() : undefined
      const res = await fetch("/api/ai-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, ...(context ? { context } : {}), stream: true }),
      })

      if (!res.ok) {
        let serverError = ""
        try {
          const data: unknown = await res.json()
          if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
            serverError = (data as { error: string }).error
          }
        } catch {
          /* 본문이 JSON 이 아니면 아래 기본 문구 사용 */
        }
        fail(res.status === 429 ? t.aiAdvisor.limitReached : serverError || ERROR_MSG[locale])
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        fail(ERROR_MSG[locale])
        return
      }
      const decoder = new TextDecoder()
      let acc = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        const text = acc
        setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content: text } : m)))
      }
      acc += decoder.decode()
      if (!acc.trim()) {
        fail(ERROR_MSG[locale])
      } else {
        const text = acc
        setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content: text } : m)))
      }
    } catch {
      fail(ERROR_MSG[locale])
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const suggestions = [t.aiAdvisor.suggestQ1, t.aiAdvisor.suggestQ2, t.aiAdvisor.suggestQ3, t.aiAdvisor.suggestQ4]

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto animate-fade-in">
      {/* 헤더 */}
      <header className="flex items-center justify-between gap-3 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-[#1E40AF] rounded-xl flex items-center justify-center shrink-0">
            <BrainCircuit className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground leading-tight truncate">{t.aiAdvisor.title}</h1>
            <p className="text-xs text-muted-foreground truncate">{t.aiAdvisor.subtitle}</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          {t.aiAdvisor.online}
        </span>
      </header>

      {/* 메시지 로그 */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t.aiAdvisor.title}
        className="flex-1 min-h-0 overflow-y-auto py-4 space-y-4"
      >
        {/* 환영 말풍선 */}
        <AssistantShell>
          <p className="font-semibold mb-1">{t.aiAdvisor.welcomeTitle}</p>
          <p className="leading-relaxed">{t.aiAdvisor.welcomeMsg}</p>
        </AssistantShell>

        {/* 추천 질문 — 대화 시작 전에만 */}
        {messages.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2 pl-9 sm:pl-10">
            {suggestions.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q)}
                disabled={sending}
                className="text-left text-sm text-foreground bg-card border border-border rounded-xl px-3.5 py-2.5 min-h-[44px] hover:bg-accent hover:border-ocean-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map(m =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] sm:max-w-[75%] bg-ocean-800 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantShell key={m.id}>
              {m.error ? (
                <span className="flex items-start gap-1.5 text-destructive">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="leading-relaxed">{m.content}</span>
                </span>
              ) : m.content ? (
                <Markdown text={m.content} />
              ) : (
                <span className="flex items-center gap-1 py-1" aria-hidden="true">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </AssistantShell>
          )
        )}
      </div>

      {/* 입력 영역 */}
      <div className="shrink-0 pt-3 border-t border-border">
        <div className="flex items-center gap-2 mb-2" title={t.aiAdvisor.contextTitle}>
          <Switch
            id="ai-advisor-context"
            checked={includeContext}
            onCheckedChange={setIncludeContext}
            disabled={sending}
          />
          <label htmlFor="ai-advisor-context" className="text-xs text-muted-foreground cursor-pointer select-none">
            {t.aiAdvisor.contextToggle}
          </label>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={e => {
            e.preventDefault()
            void send(input)
          }}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(input)
              }
            }}
            rows={1}
            disabled={sending}
            placeholder={t.aiAdvisor.inputPlaceholder}
            aria-label={t.aiAdvisor.inputPlaceholder}
            className="flex-1 min-h-[44px] max-h-[120px] rounded-xl text-base sm:text-sm py-2.5 leading-relaxed"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label={sending ? t.aiAdvisor.sending : t.aiAdvisor.send}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] sm:px-4 rounded-xl bg-ocean-500 hover:bg-ocean-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ocean-500"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span className="hidden sm:inline">{t.aiAdvisor.sending}</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t.aiAdvisor.send}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
