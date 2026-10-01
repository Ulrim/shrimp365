"use client"

/**
 * 급이 · 폐사 입력 — 수기 폼 + 표준 기록지(CSV) 업로드.
 * 원본: mrv-platform/apps/web/src/features/input/{InputPage,FeedLogForm,MortalityLogForm}.tsx
 *
 * 이 두 값이 각각 FCR 과 폐사율의 분자다. 그래서 입력 검증이 화면에도, 서버에도 있다 —
 * 화면 검증은 빠른 피드백일 뿐이고 최종 판정은 서버가 한다.
 *
 * MASTER 4장 화면 #4 는 "수동 입력 폼 + 표준 기록지(CSV 업로드) + 입력 검증" 을 요구한다.
 * 원본에는 업로드가 없어(엔드포인트 41개에 기록지 창구가 없다) 이식 범위 밖이었고,
 * 여기서 더했다. 업로드도 같은 서버 창구를 줄마다 호출하므로 검증 기준이 갈라지지 않는다 —
 * 해석 규칙은 `lib/mrv/csv-records.ts`, 그 검증은 `npm run mrv:verify-csv`.
 *
 * viewer 는 쓰기 권한이 없다. 폼을 감추지 않고 비활성 상태로 보여 주며 이유를 적는다 —
 * 메뉴가 사라지면 사용자는 기능이 없는 줄 안다.
 */

import { useId, useState } from "react"
import { apiFetch, errorMessage, useApiMutation } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal, localInputToIsoUtc, nowLocalInputValue } from "@/lib/mrv/ui/datetime"
import { BatchSelect } from "@/components/mrv/batch-select"
import { CsvUpload } from "@/components/mrv/csv-upload"
import { INPUT_CLASS, PRIMARY_BUTTON, PageHeader } from "@/components/mrv/ui"
import {
  FEED_CSV_TEMPLATE,
  MORTALITY_CSV_TEMPLATE,
  parseFeedCsv,
  parseMortalityCsv,
} from "@/lib/mrv/csv-records"

const WRITER_ROLES = new Set(["owner", "operator"])

function ViewerNote() {
  return (
    <p role="note" className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-muted">
      읽기 전용 권한(viewer)입니다. 입력은 owner/operator 만 가능합니다.
    </p>
  )
}

function FeedLogForm({ siteId, canWrite }: { siteId: string | null; canWrite: boolean }) {
  const tsId = useId()
  const feedKgId = useId()

  const [batchId, setBatchId] = useState("")
  const [ts, setTs] = useState(() => nowLocalInputValue())
  const [feedKg, setFeedKg] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(`/sites/${encodeURIComponent(siteId as string)}/feed-logs`, {
      method: "POST",
      json: body,
    }),
  )
  const disabled = !canWrite || !siteId || mutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return

    if (!batchId.trim()) return setFieldError("배치를 선택하세요.")
    const iso = localInputToIsoUtc(ts)
    if (!iso) return setFieldError("급이 시각이 올바르지 않습니다.")
    const kg = Number(feedKg)
    if (!Number.isFinite(kg) || kg <= 0) {
      return setFieldError("급이량(kg)은 0보다 큰 값이어야 합니다.")
    }
    setFieldError(null)

    try {
      await mutation.mutate({ batch_id: batchId.trim(), ts: iso, feed_kg: kg })
      // 연속 입력 편의를 위해 배치와 시각은 남기고 수량만 비운다.
      setFeedKg("")
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
    } catch {
      /* 오류는 mutation.error 로 아래에 표시된다. */
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="급이 입력 폼"
      className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-mrv-fg">급이 입력</h2>
      {!canWrite && <ViewerNote />}

      <BatchSelect
        siteId={siteId}
        value={batchId}
        onChange={setBatchId}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={tsId} className="text-sm font-medium text-mrv-fg">
          급이 시각 <span className="text-mrv-red">*</span>
        </label>
        <input
          id={tsId}
          type="datetime-local"
          value={ts}
          disabled={disabled}
          onChange={(e) => setTs(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={feedKgId} className="text-sm font-medium text-mrv-fg">
          급이량 (kg) <span className="text-mrv-red">*</span>
        </label>
        <input
          id={feedKgId}
          type="number"
          step="0.01"
          min="0"
          value={feedKg}
          disabled={disabled}
          onChange={(e) => setFeedKg(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
      </div>

      {fieldError && (
        <p role="alert" className="text-sm text-mrv-red">
          {fieldError}
        </p>
      )}
      {mutation.error !== undefined && (
        <p role="alert" className="text-sm text-mrv-red">
          {errorMessage(mutation.error, "급이 기록 저장에 실패했습니다.")}
        </p>
      )}
      {savedAt && !mutation.isPending && mutation.error === undefined && (
        <p role="status" className="text-sm text-mrv-green">
          {savedAt} 저장했습니다.
        </p>
      )}

      <button type="submit" disabled={disabled} className={PRIMARY_BUTTON}>
        {mutation.isPending ? "저장 중…" : "급이 기록 저장"}
      </button>
    </form>
  )
}

function MortalityLogForm({
  siteId,
  canWrite,
}: {
  siteId: string | null
  canWrite: boolean
}) {
  const tsId = useId()
  const deadCountId = useId()
  const noteId = useId()

  const [batchId, setBatchId] = useState("")
  const [ts, setTs] = useState(() => nowLocalInputValue())
  const [deadCount, setDeadCount] = useState("")
  const [causeNote, setCauseNote] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(`/sites/${encodeURIComponent(siteId as string)}/mortality-logs`, {
      method: "POST",
      json: body,
    }),
  )
  const disabled = !canWrite || !siteId || mutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return

    if (!batchId.trim()) return setFieldError("배치를 선택하세요.")
    const iso = localInputToIsoUtc(ts)
    if (!iso) return setFieldError("폐사 기록 시각이 올바르지 않습니다.")
    const count = Number(deadCount)
    // 급이량과 달리 0 을 허용한다 — 그날 폐사가 없었다는 기록도 증빙이다.
    if (!Number.isInteger(count) || count < 0) {
      return setFieldError("폐사 개체수는 0 이상의 정수여야 합니다.")
    }
    setFieldError(null)

    try {
      await mutation.mutate({
        batch_id: batchId.trim(),
        ts: iso,
        dead_count: count,
        cause_note: causeNote.trim() || null,
      })
      setDeadCount("")
      setCauseNote("")
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
    } catch {
      /* 오류는 아래에 표시된다. */
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="폐사 입력 폼"
      className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-mrv-fg">폐사 입력</h2>
      {!canWrite && <ViewerNote />}

      <BatchSelect
        siteId={siteId}
        value={batchId}
        onChange={setBatchId}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={tsId} className="text-sm font-medium text-mrv-fg">
          폐사 기록 시각 <span className="text-mrv-red">*</span>
        </label>
        <input
          id={tsId}
          type="datetime-local"
          value={ts}
          disabled={disabled}
          onChange={(e) => setTs(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={deadCountId} className="text-sm font-medium text-mrv-fg">
          폐사 개체수 <span className="text-mrv-red">*</span>
        </label>
        <input
          id={deadCountId}
          type="number"
          step="1"
          min="0"
          value={deadCount}
          disabled={disabled}
          onChange={(e) => setDeadCount(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-sm font-medium text-mrv-fg">
          원인 메모
        </label>
        <textarea
          id={noteId}
          rows={2}
          value={causeNote}
          disabled={disabled}
          onChange={(e) => setCauseNote(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
      </div>

      {fieldError && (
        <p role="alert" className="text-sm text-mrv-red">
          {fieldError}
        </p>
      )}
      {mutation.error !== undefined && (
        <p role="alert" className="text-sm text-mrv-red">
          {errorMessage(mutation.error, "폐사 기록 저장에 실패했습니다.")}
        </p>
      )}
      {savedAt && !mutation.isPending && mutation.error === undefined && (
        <p role="status" className="text-sm text-mrv-green">
          {savedAt} 저장했습니다.
        </p>
      )}

      <button type="submit" disabled={disabled} className={PRIMARY_BUTTON}>
        {mutation.isPending ? "저장 중…" : "폐사 기록 저장"}
      </button>
    </form>
  )
}

export default function InputPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="급이 · 폐사 입력"
        description={`${selectedSite?.name ?? "사이트"} · 입력값은 검증 후 저장되며 KPI(FCR·폐사율)에 반영됩니다.`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FeedLogForm siteId={selectedSiteId} canWrite={canWrite} />
        <MortalityLogForm siteId={selectedSiteId} canWrite={canWrite} />
      </div>

      <div className="flex flex-col gap-6">
        <CsvUpload
          title="급이 기록지 업로드 (CSV)"
          parse={parseFeedCsv}
          endpoint={
            selectedSiteId
              ? `/sites/${encodeURIComponent(selectedSiteId)}/feed-logs`
              : null
          }
          template={FEED_CSV_TEMPLATE}
          templateFilename="급이기록지_견본.csv"
          columnsHint="필요한 열: batch_id(배치) · ts(시각) · feed_kg(급이량). 한국어 머리글도 받습니다."
          previewColumns={[
            { header: "배치", cell: (r) => r.batch_id },
            { header: "급이 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "급이량(kg)", cell: (r) => String(r.feed_kg) },
          ]}
          canWrite={canWrite}
        />

        <CsvUpload
          title="폐사 기록지 업로드 (CSV)"
          parse={parseMortalityCsv}
          endpoint={
            selectedSiteId
              ? `/sites/${encodeURIComponent(selectedSiteId)}/mortality-logs`
              : null
          }
          template={MORTALITY_CSV_TEMPLATE}
          templateFilename="폐사기록지_견본.csv"
          columnsHint="필요한 열: batch_id(배치) · ts(시각) · dead_count(폐사 개체수). cause_note(원인 메모)는 선택입니다."
          previewColumns={[
            { header: "배치", cell: (r) => r.batch_id },
            { header: "기록 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "폐사 개체수", cell: (r) => String(r.dead_count) },
            { header: "원인 메모", cell: (r) => r.cause_note ?? "—" },
          ]}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}
