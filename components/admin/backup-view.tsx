"use client"

// 전체 백업(/admin/backup) — 플랫폼에 쌓인 데이터를 표마다 CSV 로 받아 ZIP 하나로 내려받는다.
//
// 총관리자 전용(lib/admin-access.ts 의 `backup`). 데이터는 /api/admin/backup 이 총관리자
// 확인 뒤 표 하나씩, 묶음 단위로 준다. 이 화면이 끝까지 이어 받아 CSV 로 바꾸고
// 브라우저에서 ZIP 으로 묶는다(lib/zip.ts) — 서버 응답 크기·시간 제한에 걸리지 않는다.
// 무엇을 담고 무엇을 빼는지는 lib/admin-backup.ts 가 정한다.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle, Check, CircleDashed, DatabaseBackup, Download, Loader2, Minus, ShieldAlert, X,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import {
  BACKUP_EXCLUDED_TABLES, BACKUP_GROUPS, BACKUP_TABLES,
  backupColumns, backupCsvLine, backupCsvRows, backupFilename,
  type BackupChunk, type BackupGroupKey, type BackupTable,
} from "@/lib/admin-backup"
import { buildZip, zipEntry, type ZipEntry } from "@/lib/zip"
import { LoadProblemView, problemOf, type LoadProblem } from "@/components/admin/stats-status"

type TableStatus = "pending" | "running" | "done" | "empty" | "missing" | "failed"
type TableState = { status: TableStatus; rows: number }
type Phase = "idle" | "running" | "done" | "stopped"

type Result = {
  blob: Blob
  filename: string
  rows: number
  files: number
  failed: string[]
}

/** 다시 시도해도 소용없는 응답(권한 없음·서비스 롤 키 없음) — 백업 전체를 멈춘다. */
class Fatal extends Error {
  constructor(readonly problem: LoadProblem) { super(problem) }
}

const ALL_GROUPS = BACKUP_GROUPS.map(g => g.key)
const RETRIES = 2

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

/** 묶음 하나. 일시적인 실패(네트워크·5xx)는 잠깐 쉬고 다시 묻는다. */
async function fetchChunk(table: string, cursor: string | null, signal: AbortSignal): Promise<BackupChunk> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const qs = new URLSearchParams({ table })
      if (cursor) qs.set("cursor", cursor)
      const res = await fetch(`/api/admin/backup?${qs}`, { cache: "no-store", signal })
      if (res.status === 401 || res.status === 403 || res.status === 503) throw new Fatal(problemOf(res.status))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const chunk = await res.json() as BackupChunk
      if (!Array.isArray(chunk?.rows)) throw new Error("응답 형식이 다릅니다")
      return chunk
    } catch (err) {
      if (err instanceof Fatal || signal.aborted || attempt >= RETRIES) throw err
      await sleep(800 * (attempt + 1), signal)
    }
  }
}

/** 표 하나를 끝까지 받아 CSV 바이트 조각으로 만든다. */
async function exportTable(
  table: BackupTable,
  signal: AbortSignal,
  onRows: (rows: number) => void,
): Promise<{ status: "done" | "empty" | "missing"; rows: number; chunks: Uint8Array[] }> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let columns: string[] | null = null
  let rows = 0
  let cursor: string | null = null
  do {
    const chunk = await fetchChunk(table.name, cursor, signal)
    if (chunk.missing) return { status: "missing", rows: 0, chunks: [] }
    if (chunk.rows.length > 0) {
      if (!columns) {
        columns = backupColumns(chunk.rows)
        // UTF-8 BOM — 엑셀이 한글을 깨뜨리지 않게.
        chunks.push(encoder.encode(`﻿${backupCsvLine(columns)}`))
      }
      chunks.push(encoder.encode(backupCsvRows(columns, chunk.rows)))
      rows += chunk.rows.length
      onRows(rows)
    }
    cursor = chunk.next
  } while (cursor)
  return { status: rows > 0 ? "done" : "empty", rows, chunks }
}

function formatKst(now: number) {
  return new Date(now).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
}

const STATUS_NOTE: Record<TableStatus, string> = {
  pending: "대기",
  running: "받는 중",
  done: "완료",
  empty: "기록 없음",
  missing: "이 DB 에 표 없음",
  failed: "실패 — 담지 못함",
}

/** ZIP 안에 함께 넣는 설명 파일. 무엇이 담겼고 무엇이 빠졌는지 파일만 보고도 알 수 있게. */
function readmeText(now: number, email: string, tables: BackupTable[], states: Record<string, TableState>) {
  const lines = [
    "Shrimp365 전체 백업",
    "",
    `내보낸 시각: ${formatKst(now)} (한국 시각)`,
    `내보낸 계정: ${email}`,
    "",
    "이 파일에는 회원 이메일 등 개인정보가 들어 있습니다. 안전한 곳에 보관하고,",
    "필요 없어지면 지우십시오. 외부로 보낼 때는 필요한 파일만 골라 보내십시오.",
    "",
    "형식: 표마다 CSV 파일 하나(UTF-8, 첫 줄이 칸 이름). 시각은 DB 에 저장된 그대로(UTC)입니다.",
    "      =, +, -, @ 로 시작하는 글자 앞에는 ' 가 붙어 있습니다(스프레드시트 수식 실행 방지).",
    "      내보내는 동안 새로 들어온 기록은 일부만 담겼을 수 있습니다.",
    "      여러 칸이 키인 표(count_records, mrv_readings, 좋아요·열람 권한)는 내보내는 도중",
    "      기록이 추가·삭제되면 몇 줄이 빠지거나 겹칠 수 있습니다 — 기록이 뜸한 시간에 받으십시오.",
    "",
    "── 담긴 내용 ──",
  ]
  for (const g of BACKUP_GROUPS) {
    const inGroup = tables.filter(t => t.group === g.key)
    if (inGroup.length === 0) continue
    lines.push("", `[${g.label}]`)
    for (const t of inGroup) {
      const s = states[t.name] ?? { status: "pending" as const, rows: 0 }
      // 파일이 실제로 들어 있는 표만 ".csv" 로 적는다.
      if (s.status === "done") {
        lines.push(`  ${t.name}.csv — ${t.label}: ${s.rows.toLocaleString("ko-KR")}건`)
        if (t.exclude?.length) lines.push(`      (뺀 칸: ${t.exclude.join(", ")})`)
      } else {
        lines.push(`  (파일 없음) ${t.name} — ${t.label}: ${STATUS_NOTE[s.status]}`)
      }
    }
  }
  const skipped = BACKUP_GROUPS.filter(g => !tables.some(t => t.group === g.key))
  if (skipped.length > 0) lines.push("", `선택하지 않아 담지 않은 묶음: ${skipped.map(g => g.label).join(", ")}`)
  lines.push(
    "",
    "── 일부러 뺀 것(비밀 값) ──",
    ...BACKUP_EXCLUDED_TABLES.map(t => `  ${t.name} — ${t.reason}`),
    "  그 밖에 장비 키·접속 주소 등 비밀 값 칸, 사진 원본, 로그인 암호는 담지 않습니다.",
    "",
  )
  return lines.join("\r\n")
}

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

function formatBytes(n: number) {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function AdminBackupView() {
  const { user } = useAuth()
  const [groups, setGroups] = useState<Set<BackupGroupKey>>(() => new Set(ALL_GROUPS))
  const [phase, setPhase] = useState<Phase>("idle")
  const [states, setStates] = useState<Record<string, TableState>>({})
  const [problem, setProblem] = useState<LoadProblem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const tables = useMemo(() => BACKUP_TABLES.filter(t => groups.has(t.group)), [groups])
  const running = phase === "running"

  // 화면을 떠나면 받던 것을 멈춘다.
  useEffect(() => () => abortRef.current?.abort(), [])

  // 받는 도중 탭을 닫거나 새로고침하면 처음부터 다시 받아야 한다 — 한 번 물어본다.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [running])

  async function start() {
    const selected = BACKUP_TABLES.filter(t => groups.has(t.group))
    if (selected.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    const now = Date.now()
    const local: Record<string, TableState> = Object.fromEntries(
      selected.map(t => [t.name, { status: "pending", rows: 0 } satisfies TableState]),
    )
    const put = (name: string, s: TableState) => {
      local[name] = s
      setStates(prev => ({ ...prev, [name]: s }))
    }
    setStates({ ...local })
    setResult(null)
    setProblem(null)
    setError(null)
    setPhase("running")

    try {
      const entries: ZipEntry[] = []
      for (const table of selected) {
        put(table.name, { status: "running", rows: 0 })
        try {
          const out = await exportTable(table, controller.signal, rows => put(table.name, { status: "running", rows }))
          if (out.status === "done") entries.push(await zipEntry(`${table.name}.csv`, out.chunks))
          put(table.name, { status: out.status, rows: out.rows })
        } catch (err) {
          if (err instanceof Fatal || controller.signal.aborted) throw err
          // 이 표만 건너뛴다 — 받다 만 조각은 담지 않는다(절반짜리 파일이 온전해 보이면 안 된다).
          put(table.name, { status: "failed", rows: 0 })
        }
      }
      const readme = new TextEncoder().encode(`﻿${readmeText(now, user?.email ?? "", selected, local)}`)
      entries.unshift(await zipEntry("README.txt", [readme]))
      const blob = buildZip(entries, new Date(now))
      const done: Result = {
        blob,
        filename: backupFilename(now),
        rows: selected.reduce((n, t) => n + (local[t.name].status === "done" ? local[t.name].rows : 0), 0),
        files: entries.length - 1,
        failed: selected.filter(t => local[t.name].status === "failed").map(t => t.label),
      }
      setResult(done)
      setPhase("done")
      saveBlob(blob, done.filename)
    } catch (err) {
      if (controller.signal.aborted) {
        // 받다 만 표는 "받는 중"으로 남기지 않는다.
        setStates(prev => Object.fromEntries(Object.entries(prev).map(
          ([k, s]) => [k, s.status === "running" ? { status: "pending", rows: 0 } satisfies TableState : s],
        )))
        setPhase("stopped")
        return
      }
      if (err instanceof Fatal) setProblem(err.problem)
      else setError(err instanceof Error && err.message ? err.message : "백업 파일을 만들지 못했습니다")
      setPhase("stopped")
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const cancel = () => abortRef.current?.abort()

  const toggle = (key: BackupGroupKey) => setGroups(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  if (problem) {
    return (
      <LoadProblemView
        problem={problem}
        onRetry={() => { setProblem(null); setPhase("idle") }}
        body={problem === "forbidden" ? "전체 백업은 총관리자 계정만 받을 수 있습니다." : undefined}
      />
    )
  }

  const shown = phase === "idle" ? [] : BACKUP_TABLES.filter(t => states[t.name])
  const finished = shown.filter(t => !["pending", "running"].includes(states[t.name].status)).length
  const totalRows = shown.reduce((n, t) => n + states[t.name].rows, 0)
  const current = shown.find(t => states[t.name].status === "running")
  const percent = shown.length ? Math.round((finished / shown.length) * 100) : 0

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-foreground lg:sr-only">전체 백업</h2>
        <p className="text-sm text-muted-foreground mt-0.5 lg:mt-0">
          플랫폼에 쌓인 데이터를 전 기간 그대로, 표마다 CSV 파일로 묶어(ZIP) 내려받습니다.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-border bg-card px-4 py-3" role="note">
        <ShieldAlert className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-sm text-muted-foreground space-y-1">
          <p className="text-foreground font-medium">회원 이메일 등 개인정보가 들어 있는 파일입니다</p>
          <p>안전한 곳에 보관하고, 필요 없어지면 지워 주세요. 누가 언제 받았는지는 서버 기록에 남습니다.</p>
          <p>장비 키·페어링 코드·푸시 구독·API 키·로그인 암호·사진 원본은 담지 않습니다.</p>
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <fieldset disabled={running} className="space-y-2">
            <legend className="text-sm font-semibold text-foreground mb-2">담을 내용</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {BACKUP_GROUPS.map(g => {
                const count = BACKUP_TABLES.filter(t => t.group === g.key).length
                const checked = groups.has(g.key)
                return (
                  <label
                    key={g.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3 py-2.5 min-h-[44px] cursor-pointer transition-colors",
                      checked ? "border-foreground/40 bg-accent/40" : "border-border hover:bg-accent/40",
                      running && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(g.key)}
                      className="mt-1 w-4 h-4 accent-foreground shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {g.label} <span className="text-muted-foreground font-normal tabular-nums">· 표 {count}개</span>
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{g.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="outline" onClick={cancel} className="border-border gap-2 min-h-[44px]">
                <X className="w-4 h-4" aria-hidden="true" />
                취소
              </Button>
            ) : (
              <Button onClick={start} disabled={tables.length === 0} className="gap-2 min-h-[44px]">
                <DatabaseBackup className="w-4 h-4" aria-hidden="true" />
                {phase === "idle" ? "백업 시작" : "다시 백업"}
              </Button>
            )}
            {result && !running && (
              <Button
                variant="outline"
                onClick={() => saveBlob(result.blob, result.filename)}
                className="border-border gap-2 min-h-[44px]"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                다시 내려받기
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {tables.length === 0
                ? "담을 내용을 하나 이상 골라 주세요"
                : running
                  ? "받는 동안 이 화면을 닫지 마세요"
                  : `표 ${tables.length}개 · 기록이 많으면 몇 분 걸릴 수 있습니다`}
            </p>
          </div>

          {phase !== "idle" && (
            <div className="space-y-2" aria-live="polite">
              <div
                className="h-2 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-label="백업 진행"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="h-full bg-foreground transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-sm text-foreground tabular-nums">
                {running && <>표 {finished}/{shown.length} · {totalRows.toLocaleString("ko-KR")}건{current ? ` · ${current.label} 받는 중` : " · 파일 묶는 중"}</>}
                {phase === "done" && result && (
                  <>
                    완료 — {result.rows.toLocaleString("ko-KR")}건, 파일 {result.files}개, {formatBytes(result.blob.size)}
                    <span className="text-muted-foreground"> · {result.filename}</span>
                  </>
                )}
                {phase === "stopped" && !error && "취소했습니다 — 파일을 만들지 않았습니다"}
              </p>
              {phase === "done" && result && result.failed.length > 0 && (
                <p className="flex items-start gap-2 text-sm text-foreground" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>받지 못한 표가 있습니다: {result.failed.join(", ")}. 이 표들은 파일에 없습니다 — 다시 백업해 주세요.</span>
                </p>
              )}
              {error && (
                <p className="flex items-start gap-2 text-sm text-foreground" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{error}</span>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {shown.length > 0 && (
        <Card className="border-border">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {shown.map(t => <TableRow key={t.name} table={t} state={states[t.name]} />)}
            </ul>
          </CardContent>
        </Card>
      )}

      <details className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <summary className="cursor-pointer text-foreground font-medium min-h-[28px]">담지 않는 것</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {BACKUP_EXCLUDED_TABLES.map(t => (
            <li key={t.name}><span className="font-mono text-xs text-foreground">{t.name}</span> — {t.reason}</li>
          ))}
          {BACKUP_TABLES.filter(t => t.exclude?.length).map(t => (
            <li key={t.name}>
              <span className="font-mono text-xs text-foreground">{t.name}</span> 의 {t.exclude!.join(", ")} 칸
            </li>
          ))}
          <li>로그인 암호(서버에도 원문이 없습니다), 저장소의 사진·PDF 파일</li>
        </ul>
      </details>
    </div>
  )
}

const STATUS_ICON: Record<TableStatus, { icon: typeof Check; className: string }> = {
  pending: { icon: CircleDashed, className: "text-muted-foreground/60" },
  running: { icon: Loader2, className: "text-foreground animate-spin" },
  done: { icon: Check, className: "text-foreground" },
  empty: { icon: Minus, className: "text-muted-foreground" },
  missing: { icon: Minus, className: "text-muted-foreground" },
  failed: { icon: AlertCircle, className: "text-destructive" },
}

function TableRow({ table, state }: { table: BackupTable; state: TableState }) {
  const { icon: Icon, className } = STATUS_ICON[state.status]
  const showRows = state.status === "done" || (state.status === "running" && state.rows > 0)
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <Icon className={cn("w-4 h-4 shrink-0", className)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="text-foreground">{table.label}</span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">{table.name}</span>
      </span>
      <span className={cn("shrink-0 tabular-nums", state.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
        {showRows ? `${state.rows.toLocaleString("ko-KR")}건` : STATUS_NOTE[state.status]}
      </span>
    </li>
  )
}
