"use client"

/**
 * 급이 · 폐사 · 전력 입력 — 수기 폼 + 표준 기록지(CSV) 업로드.
 * 원본: mrv-platform/apps/web/src/features/input/{InputPage,FeedLogForm,MortalityLogForm}.tsx
 *
 * 급이·폐사는 각각 FCR 과 폐사율의 분자고, 전력은 EI·폭기 EI·Scope2·기준선·전후 비교의
 * 근거다. 그래서 입력 검증이 화면에도, 서버에도 있다 — 화면 검증은 빠른 피드백일 뿐이고
 * 최종 판정은 서버가 한다.
 *
 * **전력을 여기에 둔 이유.** 전력 계측값이 들어올 창구는 게이트웨이 수집(`X-API-Key`)
 * 하나뿐이었고, 그 키를 발급하는 화면조차 없다(SQL 로 해시를 넣어야 한다). 즉 전력계가
 * 붙기 전까지 **전력 지표 전부가 구조적으로 빈칸**이었고 기준선도 잠글 수 없었다. 이
 * 운영에서 전력은 사람이 수기로 넣기로 했으므로, 급이·폐사와 같은 자리에 같은 모양으로
 * 둔다.
 *
 * MASTER 4장 화면 #4 는 "수동 입력 폼 + 표준 기록지(CSV 업로드) + 입력 검증" 을 요구한다.
 * 원본에는 업로드가 없어(엔드포인트 41개에 기록지 창구가 없다) 이식 범위 밖이었고,
 * 여기서 더했다. 업로드도 같은 서버 창구를 줄마다 호출하므로 검증 기준이 갈라지지 않는다 —
 * 해석 규칙은 `lib/mrv/csv-records.ts`, 그 검증은 `npm run mrv:verify-csv`.
 *
 * viewer 는 쓰기 권한이 없다. 폼을 감추지 않고 비활성 상태로 보여 주며 이유를 적는다 —
 * 메뉴가 사라지면 사용자는 기능이 없는 줄 안다.
 */

import { useId, useMemo, useState } from "react"
import { apiFetch, errorMessage, useApiMutation } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal, localInputToIsoUtc, nowLocalInputValue } from "@/lib/mrv/ui/datetime"
import { BatchSelect } from "@/components/mrv/batch-select"
import { CsvUpload } from "@/components/mrv/csv-upload"
import { PowerMeterSelect } from "@/components/mrv/power-meter-select"
import { INPUT_CLASS, PRIMARY_BUTTON, PageHeader } from "@/components/mrv/ui"
import {
  FEED_CSV_TEMPLATE,
  MORTALITY_CSV_TEMPLATE,
  POWER_CUMULATIVE_CSV_TEMPLATE,
  POWER_INTERVAL_CSV_TEMPLATE,
  parseFeedCsv,
  parseMortalityCsv,
  parsePowerCsv,
  type PowerCsvRecord,
} from "@/lib/mrv/csv-records"
import type { ReadingsIngestResult } from "@/lib/mrv/api-types"

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

/**
 * 전력 수기 입력.
 *
 * **구간 사용량만 받는다.** 적산 지침(계량기 표시값)은 두 건의 차이가 구간 사용량이므로
 * 한 건씩 보내면 모든 건이 '직전값 없음' 이 되어 KPI 산입에서 빠진다(ADR 0001 — 저장되는
 * 값은 구간 kWh 뿐이고 원 카운터는 되살릴 수 없다). 그 함정을 폼에 두지 않고, 지침으로
 * 기록하고 싶은 운영자는 아래 기록지 업로드로 보내게 한다(한 파일이 한 배치가 된다).
 *
 * 시각은 **구간의 끝**이다. ADR 0001 이 Δ를 뒤 시각에 붙이기로 정했으므로 같은 규약을
 * 따른다 — 시작 시각을 적으면 모든 전력이 한 칸씩 앞으로 밀려 기간 경계에서 어긋난다.
 */
function PowerLogForm({ siteId, canWrite }: { siteId: string | null; canWrite: boolean }) {
  const tsId = useId()
  const kwhId = useId()

  const [meterId, setMeterId] = useState("")
  const [ts, setTs] = useState(() => nowLocalInputValue())
  const [kwh, setKwh] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  /**
   * 서버가 돌려준 마지막 결과. `useApiMutation` 은 진행 상태와 오류만 들고 있으므로
   * (캐시 무효화 규칙을 숨기지 않으려는 설계) 결과는 호출부가 받아 둔다.
   *
   * 이게 필요한 이유: 같은 (계측기, 시각) 을 두 번 보내면 서버가 중복으로 흡수해
   * `accepted: 0` 을 돌려준다. 그때 "저장했습니다" 라고 쓰면 거짓말이다 — 운영자는
   * 값이 바뀌었다고 믿고 넘어간다.
   */
  const [lastResult, setLastResult] = useState<ReadingsIngestResult | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch<ReadingsIngestResult>(`/sites/${encodeURIComponent(siteId as string)}/readings`, {
      method: "POST",
      json: body,
    }),
  )
  const disabled = !canWrite || !siteId || mutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return

    if (!meterId.trim()) return setFieldError("전력 계측기를 선택하세요.")
    const iso = localInputToIsoUtc(ts)
    if (!iso) return setFieldError("구간 끝 시각이 올바르지 않습니다.")
    const value = Number(kwh)
    // 0 은 받는다 — "이 구간에 0 kWh 를 썼다"는 실제 계측이다(블로어를 돌리지 않은 날).
    // 0 을 거부하면 운영자가 그 줄을 비우게 되고, 그러면 계측이 끊긴 것과 구분되지 않는다.
    if (!Number.isFinite(value) || value < 0 || kwh.trim() === "") {
      return setFieldError("구간 사용량(kWh)은 0 이상의 값이어야 합니다.")
    }
    setFieldError(null)

    try {
      const result = await mutation.mutate({
        source: "manual",
        readings: [
          { meter_id: meterId.trim(), ts: iso, value, reading_kind: "interval_kwh" },
        ],
      })
      setLastResult(result)
      // 연속 입력 편의: 계측기와 시각은 남기고 사용량만 비운다.
      setKwh("")
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
    } catch {
      setLastResult(null)
      /* 오류는 mutation.error 로 아래에 표시된다. */
    }
  }

  const dedupedOnly =
    lastResult !== null && lastResult.accepted === 0 && lastResult.deduped > 0

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="전력 입력 폼"
      className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-mrv-fg">전력 입력 (구간 사용량)</h2>
      {!canWrite && <ViewerNote />}

      <PowerMeterSelect
        siteId={siteId}
        value={meterId}
        onChange={setMeterId}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={tsId} className="text-sm font-medium text-mrv-fg">
          구간 끝 시각 <span className="text-mrv-red">*</span>
        </label>
        <input
          id={tsId}
          type="datetime-local"
          value={ts}
          disabled={disabled}
          onChange={(e) => setTs(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
        <p className="text-xs text-mrv-muted">
          이 사용량이 <strong>끝나는</strong> 시각입니다. 어제 0시부터 오늘 0시까지 쓴
          전력이면 <strong>오늘 0시</strong>를 적습니다 — 시작 시각을 적으면 전력이 한 칸씩
          앞으로 밀려 기간 경계에서 어긋납니다.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={kwhId} className="text-sm font-medium text-mrv-fg">
          구간 사용량 (kWh) <span className="text-mrv-red">*</span>
        </label>
        <input
          id={kwhId}
          type="number"
          step="0.01"
          min="0"
          value={kwh}
          disabled={disabled}
          onChange={(e) => setKwh(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
        <p className="text-xs text-mrv-muted">
          계량기 표시값(적산 지침)이 아니라 <strong>이 구간에 쓴 양</strong>입니다. 지침으로
          기록하시려면 아래 <strong>적산 지침 기록지 업로드</strong>를 쓰세요 — 지침은 두 건의
          차이로만 사용량이 되므로 한 건씩 넣으면 KPI 에 들어가지 않습니다.
        </p>
      </div>

      {fieldError && (
        <p role="alert" className="text-sm text-mrv-red">
          {fieldError}
        </p>
      )}
      {mutation.error !== undefined && (
        <p role="alert" className="text-sm text-mrv-red">
          {errorMessage(mutation.error, "전력 계측값 저장에 실패했습니다.")}
        </p>
      )}
      {savedAt && !mutation.isPending && mutation.error === undefined && (
        <p role="status" className="text-sm text-mrv-green">
          {dedupedOnly
            ? `${savedAt} 같은 계측기·시각의 값이 이미 있어 새로 저장하지 않았습니다(중복 흡수).`
            : `${savedAt} 저장했습니다. EI·Scope2 에 반영됩니다.`}
        </p>
      )}

      <button type="submit" disabled={disabled} className={PRIMARY_BUTTON}>
        {mutation.isPending ? "저장 중…" : "전력 계측값 저장"}
      </button>
    </form>
  )
}

/** 표현을 고정한 파서. 컴포넌트 밖에 둬서 렌더마다 새 함수가 되지 않게 한다. */
function parseIntervalPowerCsv(text: string) {
  return parsePowerCsv(text, "interval_kwh")
}
function parseCumulativePowerCsv(text: string) {
  return parsePowerCsv(text, "cumulative_kwh")
}

export default function InputPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  /**
   * 전력 기록지는 **파일 하나를 요청 하나로** 보낸다. 줄마다 보내면 적산 지침이 매번
   * 배치 경계가 되어 전부 산입에서 빠진다(ADR 0001) — 저장은 됐는데 EI 는 그대로인
   * 상태다. 급이·폐사는 줄이 서로 독립이라 줄 단위를 그대로 둔다.
   *
   * 결과 문구에 **산입 가능 건수를 그대로 적는다.** 'suspect'/'bad' 는 KPI 산입 목록에서
   * 빠지므로, "30건 저장" 만 보여 주면 운영자는 EI 가 왜 그대로인지 알 수 없다.
   */
  const powerSubmit = useMemo(() => {
    if (!selectedSiteId) return null
    return async (records: PowerCsvRecord[]) => {
      const result = await apiFetch<ReadingsIngestResult>(
        `/sites/${encodeURIComponent(selectedSiteId)}/readings`,
        { method: "POST", json: { source: "csv", readings: records } },
      )
      const parts = [`KPI 산입 가능 ${result.quality.ok}건`]
      if (result.quality.suspect > 0) {
        parts.push(
          `산입 제외(품질 의심) ${result.quality.suspect}건 — 적산 지침의 첫 건은 기준점으로만 쓰여 제외됩니다`,
        )
      }
      if (result.quality.bad > 0) parts.push(`산입 제외(불량) ${result.quality.bad}건`)
      if (result.deduped > 0) parts.push(`이미 있어 흡수 ${result.deduped}건`)
      return { savedCount: result.accepted, note: parts.join(" · ") }
    }
  }, [selectedSiteId])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="급이 · 폐사 · 전력 입력"
        description={`${selectedSite?.name ?? "사이트"} · 입력값은 검증 후 저장되며 KPI(EI·FCR·폐사율·Scope2)에 반영됩니다.`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FeedLogForm siteId={selectedSiteId} canWrite={canWrite} />
        <MortalityLogForm siteId={selectedSiteId} canWrite={canWrite} />
        <PowerLogForm siteId={selectedSiteId} canWrite={canWrite} />
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
          successNote="KPI(FCR)에 반영됩니다."
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
          successNote="KPI(폐사율)에 반영됩니다."
          columnsHint="필요한 열: batch_id(배치) · ts(시각) · dead_count(폐사 개체수). cause_note(원인 메모)는 선택입니다."
          previewColumns={[
            { header: "배치", cell: (r) => r.batch_id },
            { header: "기록 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "폐사 개체수", cell: (r) => String(r.dead_count) },
            { header: "원인 메모", cell: (r) => r.cause_note ?? "—" },
          ]}
          canWrite={canWrite}
        />

        {/* 전력은 기록지 두 종류를 받는다. 같은 `value` 열에 적을 숫자의 뜻이 다르므로
            (사용량 ↔ 계량기 표시값) 한 화면에서 고르게 하지 않고 창구를 나눈다 — 섞이면
            적산 지침이 그 자체로 사용량으로 저장되어 EI 가 수천 배가 된다. */}
        <CsvUpload
          title="전력 기록지 업로드 — 구간 사용량 (CSV)"
          parse={parseIntervalPowerCsv}
          endpoint={null}
          batchSubmit={powerSubmit}
          template={POWER_INTERVAL_CSV_TEMPLATE}
          templateFilename="전력기록지_구간사용량_견본.csv"
          successNote="EI·Scope2 에 반영됩니다."
          columnsHint="필요한 열: meter_id(계측기) · ts(구간 끝 시각) · value(그 구간에 쓴 kWh). 한국어 머리글도 받습니다. 0 도 받습니다 — 돌리지 않은 날의 0 kWh 는 실제 계측이고, 줄을 비우면 계측이 끊긴 것과 구분되지 않습니다."
          previewColumns={[
            { header: "계측기", cell: (r) => r.meter_id },
            { header: "구간 끝 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "사용량(kWh)", cell: (r) => String(r.value) },
          ]}
          canWrite={canWrite}
        />

        <CsvUpload
          title="전력 기록지 업로드 — 적산 지침 (CSV)"
          parse={parseCumulativePowerCsv}
          endpoint={null}
          batchSubmit={powerSubmit}
          template={POWER_CUMULATIVE_CSV_TEMPLATE}
          templateFilename="전력기록지_적산지침_견본.csv"
          successNote="지침 두 건의 차이가 구간 사용량으로 저장되어 EI·Scope2 에 반영됩니다."
          columnsHint="필요한 열: meter_id(계측기) · ts(검침 시각) · value(계량기 표시값). 계측기당 2건 이상이어야 합니다 — 지침 두 건의 차이가 사용량이므로 1건만으로는 전력이 산출되지 않습니다. 이어서 올릴 때는 직전 지침을 같은 파일에 함께 넣으세요(중복은 흡수됩니다)."
          previewColumns={[
            { header: "계측기", cell: (r) => r.meter_id },
            { header: "검침 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "계량기 표시값", cell: (r) => String(r.value) },
          ]}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}
