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

import { useId, useState } from "react"
import { apiFetch, errorMessage, useApiMutation } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal, localInputToIsoUtc, nowLocalInputValue } from "@/lib/mrv/ui/datetime"
import { BatchSelect } from "@/components/mrv/batch-select"
import { CsvUpload } from "@/components/mrv/csv-upload"
import { PowerMeterSelect } from "@/components/mrv/power-meter-select"
import { INPUT_CLASS, PRIMARY_BUTTON, PageHeader } from "@/components/mrv/ui"
import {
  CSV_BASIS_PRECEDENCE_NOTE,
  MEASUREMENT_BASES,
  MEASUREMENT_BASIS_HINTS,
  MEASUREMENT_BASIS_LABELS,
  type MeasurementBasis,
} from "@/lib/mrv/measurement-basis"
import {
  PRODUCTION_BASES,
  PRODUCTION_BASIS_HINTS,
  PRODUCTION_BASIS_LABELS,
  PRODUCTION_BASIS_NOTE_MAX,
  PRODUCTION_BASIS_NOTE_REQUIRED_NOTE,
  productionBasisNoteRequired,
  type ProductionBasis,
} from "@/lib/mrv/production-basis"
import {
  FEED_CSV_TEMPLATE,
  HARVEST_CSV_TEMPLATE,
  MORTALITY_CSV_TEMPLATE,
  POWER_CUMULATIVE_CSV_TEMPLATE,
  POWER_INTERVAL_CSV_TEMPLATE,
  parseFeedCsv,
  parseHarvestCsv,
  parseMortalityCsv,
  parsePowerCsv,
  type HarvestCsvRecord,
  type PowerCsvRecord,
} from "@/lib/mrv/csv-records"
import type { CsvParseResult } from "@/lib/mrv/csv-records"
import type { ReadingsIngestResult } from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

/** 아직 고르지 않은 상태. `MeasurementBasis` 에 'none' 같은 값을 더하지 않는다 —
 *  저장될 수 있는 값과 "고르지 않았다" 는 같은 타입에 섞이면 안 된다. */
type BasisChoice = MeasurementBasis | ""

/** 생산량 산정 근거도 같은 모양으로 둔다(저장 가능한 값과 "고르지 않았다" 를 섞지 않는다). */
type ProductionBasisChoice = ProductionBasis | ""

/** 생존율 보정 선택칸의 상태. `""` 는 **미기재**이고 `"false"`(미적용)와 다른 사실이다. */
type SurvivalChoice = "" | "true" | "false"

/**
 * 전력 자료유형 선택칸 — **이 kWh 를 계량기가 쟀는가, 산식이 냈는가.**
 *
 * ★ **기본값을 두지 않는다.** 처음 상태는 빈 값이고, 고르지 않으면 저장이 막힌다.
 *   'metered'(실측)를 기본값으로 두면 계산값을 올리는 사람이 아무 선택도 하지 않은 채
 *   **계량기 실측으로 저장**하게 되고, 그 kWh 가 EI·Scope 2 배출량의 분자가 된 뒤
 *   리포트가 그것을 실측으로 제시한다 — 이 열을 만든 이유가 정확히 그 사고를 막는 것이다.
 *   `mrv_readings.measurement_basis` 가 기존 행을 'metered' 로 메우지 않은 것과 같은 판단
 *   이다(없는 사실을 만들어 내지 않는다).
 *
 * 고른 값의 뜻을 선택칸 아래에 그대로 적는다. 선택지 이름만으로는 "계산값" 이 무엇을
 * 말하는지 사람마다 달리 읽는다.
 */
function MeasurementBasisSelect({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id: string
  value: BasisChoice
  onChange: (next: BasisChoice) => void
  disabled: boolean
  label: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-mrv-fg">
        {label} <span className="text-mrv-red">*</span>
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as BasisChoice)}
        className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
      >
        {/* 빈 선택지를 목록에 남겨 둔다 — 고르고 나서 "아직 안 골랐음" 으로 되돌릴 수
            있어야 하고, 되돌릴 수 없으면 사람은 아무거나 고른 채 넘어간다. */}
        <option value="">— 고르세요 —</option>
        {MEASUREMENT_BASES.map((basis) => (
          <option key={basis} value={basis}>
            {MEASUREMENT_BASIS_LABELS[basis]}
          </option>
        ))}
      </select>
      <p className="text-xs text-mrv-muted">
        {value === ""
          ? "계량기가 잰 값과 산식으로 계산한 값은 같은 증빙이 아니므로 구분해 저장합니다. 고르지 않으면 저장할 수 없습니다 — 기본값을 두면 계산값이 실측으로 기록됩니다."
          : MEASUREMENT_BASIS_HINTS[value]}
      </p>
    </div>
  )
}

/**
 * 생산량 산정 근거 선택칸 — **이 생체량을 저울이 쟀는가, 산식이 냈는가.**
 *
 * ★ **기본값을 두지 않는다.** 전력 자료유형과 같은 이유다(위 머리말) — 'measured' 를
 *   기본값으로 두면 입식수 × 평균체중으로 계산한 값을 올리는 사람이 아무 선택도 하지
 *   않은 채 **실측 출하량으로 저장**하게 되고, 그 kg 이 EI·FCR 의 **분모**가 된 뒤
 *   리포트가 그것을 실측으로 제시한다.
 */
function ProductionBasisSelect({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id: string
  value: ProductionBasisChoice
  onChange: (next: ProductionBasisChoice) => void
  disabled: boolean
  label: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-mrv-fg">
        {label} <span className="text-mrv-red">*</span>
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ProductionBasisChoice)}
        className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
      >
        <option value="">— 고르세요 —</option>
        {PRODUCTION_BASES.map((basis) => (
          <option key={basis} value={basis}>
            {PRODUCTION_BASIS_LABELS[basis]}
          </option>
        ))}
      </select>
      <p className="text-xs text-mrv-muted">
        {value === ""
          ? "저울에 올린 출하량과 입식수 × 평균체중으로 계산한 값은 같은 증빙이 아니므로 구분해 저장합니다. 이 생체량이 EI·FCR 의 분모가 되므로, 고르지 않으면 저장할 수 없습니다."
          : PRODUCTION_BASIS_HINTS[value]}
      </p>
    </div>
  )
}

/**
 * 생존율 보정 적용 여부.
 *
 * **세 상태다.** 미기재(빈 값) · 적용 · 미적용. 빈 값을 '미적용' 으로 뭉개지 않는 이유:
 * 받은 계산표가 적은 「미적용」은 **보정하지 않았다는 참인 기록**이고, 미기재는 그 기록이
 * 없다는 뜻이다. 둘을 같게 저장하면 적지 않은 사람이 "보정 안 했다" 고 선언한 셈이 된다.
 */
function SurvivalAdjustedSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: SurvivalChoice
  onChange: (next: SurvivalChoice) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-mrv-fg">
        생존율 보정 적용 여부
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SurvivalChoice)}
        className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
      >
        <option value="">— 미기재 —</option>
        <option value="true">적용</option>
        <option value="false">미적용</option>
      </select>
      <p className="text-xs text-mrv-muted">
        폐사를 반영하지 않은 계산생체량은 생산량이 과대해지고, 그만큼 EI 는 과소해집니다.
        <strong> 미기재는 「미적용」과 다른 사실</strong>로 저장됩니다 — 보정하지 않았다면
        그렇게 골라 주세요.
      </p>
    </div>
  )
}

function ViewerNote() {
  return (
    <p role="note" className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-na">
      읽기 전용 권한(viewer)입니다. 입력은 owner/operator 만 가능합니다.
    </p>
  )
}

/**
 * 생산량(생체량) 수기 입력 — **EI · 폭기 EI · FCR · OEI 네 지표의 분모.**
 *
 * **왜 이 폼이 새로 필요했는가.** `mrv_harvest_logs` 에는 쓰기 UI 도 API 도 없었다 —
 * 기록지 CSV 는 급이·폐사·전력 3종뿐이었다. 전력을 아무리 잘 모아도 분모가 비어 EI 가
 * 영원히 null 이었고, 개요 화면의 KPI 카드 넷이 전부 "생산량 기록이 한 건도 없습니다" 로
 * 산출 불가였다. 그 사유 문장은 "이 플랫폼에는 아직 생산량 입력 화면이 없으므로 관리자에게
 * 요청하십시오" 라고 적을 수밖에 없었다 — 이 폼이 그 문장을 거짓으로 만든다.
 *
 * **두 점이 필요하다는 사실을 폼이 말한다.** Δbiomass 는 기간 양 끝 두 기록의 차이이므로
 * 한 건만 넣으면 개시=마감이 되어 분모가 0 이다. 저장은 되고 EI 는 그대로인 — 성공처럼
 * 보이는 실패라서, 저장 뒤 문구가 그 사실을 적는다.
 */
function HarvestLogForm({ siteId, canWrite }: { siteId: string | null; canWrite: boolean }) {
  const tsId = useId()
  const biomassId = useId()
  const basisId = useId()
  const noteId = useId()
  const survivalId = useId()

  const [batchId, setBatchId] = useState("")
  const [ts, setTs] = useState(() => nowLocalInputValue())
  const [biomassKg, setBiomassKg] = useState("")
  const [basis, setBasis] = useState<ProductionBasisChoice>("")
  const [basisNote, setBasisNote] = useState("")
  const [survival, setSurvival] = useState<SurvivalChoice>("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(`/sites/${encodeURIComponent(siteId as string)}/harvests`, {
      method: "POST",
      json: body,
    }),
  )
  const disabled = !canWrite || !siteId || mutation.isPending
  const noteRequired = basis !== "" && productionBasisNoteRequired(basis)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return

    if (!batchId.trim()) return setFieldError("배치를 선택하세요.")
    const iso = localInputToIsoUtc(ts)
    if (!iso) return setFieldError("기록 시각이 올바르지 않습니다.")
    const kg = Number(biomassKg)
    // 0 을 받지 않는다 — 0 kg 기록이 분모의 한쪽 끝으로 뽑히면 기간에 없던 생산량이
    // 산출된다(라우트도 같은 기준으로 422 를 낸다).
    if (!Number.isFinite(kg) || kg <= 0 || biomassKg.trim() === "") {
      return setFieldError("생체량(kg)은 0보다 큰 값이어야 합니다.")
    }
    if (basis === "") {
      return setFieldError(
        "산정 근거를 고르세요 — 이 생체량이 실측 출하·계측량인지, 입식수 × 평균체중으로 계산한 값인지 적어야 합니다.",
      )
    }
    // 계산·어림이면 근거가 필수다. 화면이 빠른 피드백을 하고 최종 판정은 서버가 한다.
    if (productionBasisNoteRequired(basis) && basisNote.trim() === "") {
      return setFieldError(
        `산정 근거가 '${PRODUCTION_BASIS_LABELS[basis]}' 이면 무엇으로 계산했는지 적어야 합니다. ${PRODUCTION_BASIS_NOTE_REQUIRED_NOTE}`,
      )
    }
    if (basisNote.trim().length > PRODUCTION_BASIS_NOTE_MAX) {
      return setFieldError(`산정 근거는 ${PRODUCTION_BASIS_NOTE_MAX}자까지 적을 수 있습니다.`)
    }
    setFieldError(null)

    try {
      await mutation.mutate({
        batch_id: batchId.trim(),
        ts: iso,
        biomass_kg: kg,
        production_basis: basis,
        production_basis_note: basisNote.trim() || null,
        // 빈 값은 null(미기재)로 보낸다 — false(미적용)로 바꿔 보내지 않는다.
        survival_adjusted: survival === "" ? null : survival === "true",
      })
      // 연속 입력 편의: 배치·시각·산정 근거는 남기고 생체량만 비운다(기간 양 끝 두 점을
      // 연달아 넣는 것이 이 폼의 기본 사용법이다).
      setBiomassKg("")
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
    } catch {
      /* 오류는 mutation.error 로 아래에 표시된다. */
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="생산량 입력 폼"
      className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-mrv-fg">생산량 입력 (생체량)</h2>
      {!canWrite && <ViewerNote />}

      <BatchSelect
        siteId={siteId}
        value={batchId}
        onChange={setBatchId}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={tsId} className="text-sm font-medium text-mrv-fg">
          기록 시각 <span className="text-mrv-red">*</span>
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
          생산량은 기간 <strong>양 끝 두 기록의 생체량 차이</strong>로 산출됩니다. 한 건만
          넣으면 개시와 마감이 같은 기록이 되어 차이가 0 이고 EI·FCR 이 산출되지 않습니다 —
          기간 시작 시점과 마감 시점을 각각 넣어 주세요.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={biomassId} className="text-sm font-medium text-mrv-fg">
          생체량 (kg) <span className="text-mrv-red">*</span>
        </label>
        <input
          id={biomassId}
          type="number"
          step="0.01"
          min="0"
          value={biomassKg}
          disabled={disabled}
          onChange={(e) => setBiomassKg(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
      </div>

      <ProductionBasisSelect
        id={basisId}
        label="산정 근거 (이 생체량을 어떻게 얻었는가)"
        value={basis}
        onChange={setBasis}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-sm font-medium text-mrv-fg">
          산정 근거 상세 {noteRequired && <span className="text-mrv-red">*</span>}
        </label>
        <textarea
          id={noteId}
          rows={2}
          value={basisNote}
          disabled={disabled}
          placeholder="예: 입식 100,000미 × 최종평균 35g, 생존율 보정 미적용"
          onChange={(e) => setBasisNote(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        />
        <p className="text-xs text-mrv-muted">{PRODUCTION_BASIS_NOTE_REQUIRED_NOTE}</p>
      </div>

      <SurvivalAdjustedSelect
        id={survivalId}
        value={survival}
        onChange={setSurvival}
        disabled={disabled}
      />

      {fieldError && (
        <p role="alert" className="text-sm text-mrv-red">
          {fieldError}
        </p>
      )}
      {mutation.error !== undefined && (
        <p role="alert" className="text-sm text-mrv-red">
          {errorMessage(mutation.error, "생산량 기록 저장에 실패했습니다.")}
        </p>
      )}
      {savedAt && !mutation.isPending && mutation.error === undefined && (
        <p role="status" className="text-sm text-mrv-green">
          {savedAt} 저장했습니다. 기간 양 끝에 두 건이 있으면 EI·폭기 EI·FCR·OEI 가
          산출됩니다.
        </p>
      )}

      <button type="submit" disabled={disabled} className={PRIMARY_BUTTON}>
        {mutation.isPending ? "저장 중…" : "생산량 기록 저장"}
      </button>
    </form>
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
  const basisId = useId()

  const [meterId, setMeterId] = useState("")
  const [ts, setTs] = useState(() => nowLocalInputValue())
  const [kwh, setKwh] = useState("")
  /**
   * 자료유형. **기본값 없이 시작한다**(MeasurementBasisSelect 의 머리말 참고).
   * 저장 뒤에도 비우지 않는다 — 계측기·시각을 남겨 두는 것과 같은 이유로, 같은 종류의
   * 기록을 연달아 넣을 때 매번 다시 고르게 하면 아무거나 고르고 넘어간다. 처음 한 번은
   * 반드시 사람이 고른 값이고, 바꾸지 않은 채 다른 종류를 넣는 일은 **선택칸과 그 아래
   * 설명이 계속 보이므로** 눈에 띈다.
   */
  const [basis, setBasis] = useState<BasisChoice>("")
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
    // 고르지 않았으면 저장하지 않는다. 서버도 이 칸을 요구하므로(라우트의 422) 화면이
    // 빠른 피드백만 하고 최종 판정은 서버가 한다 — 이 폼의 다른 칸과 같은 구조다.
    if (basis === "") {
      return setFieldError(
        "자료유형을 고르세요 — 이 kWh 가 계량기 지침인지, 산식으로 계산한 값인지 적어야 합니다.",
      )
    }
    setFieldError(null)

    try {
      const result = await mutation.mutate({
        source: "manual",
        readings: [
          {
            meter_id: meterId.trim(),
            ts: iso,
            value,
            reading_kind: "interval_kwh",
            measurement_basis: basis,
          },
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

      <MeasurementBasisSelect
        id={basisId}
        label="자료유형 (이 값을 어떻게 얻었는가)"
        value={basis}
        onChange={setBasis}
        disabled={disabled}
      />

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

/**
 * 미리보기의 생존율 보정 칸. **미기재와 미적용을 구별해** 적는다 — 둘을 같게 보여 주면
 * 운영자는 빈 칸을 '미적용' 으로 올렸다고 믿는다.
 */
function survivalPreviewCell(record: HarvestCsvRecord): string {
  if (record.survival_adjusted === null) return "미기재"
  return record.survival_adjusted ? "적용" : "미적용"
}

/** 표현을 고정한 파서. 컴포넌트 밖에 둬서 렌더마다 새 함수가 되지 않게 한다. */
function parseIntervalPowerCsv(text: string) {
  return parsePowerCsv(text, "interval_kwh")
}
function parseCumulativePowerCsv(text: string) {
  return parsePowerCsv(text, "cumulative_kwh")
}

/**
 * 자료유형이 비어 있어 **저장을 막아야 하는가.** 막을 이유가 없으면 null.
 *
 * 막는 조건을 "고르지 않았다" 가 아니라 **"고른 값이 필요한 줄이 있는데 고르지 않았다"**
 * 로 둔다. 파일의 모든 줄이 자기 자료유형을 들고 있으면 여기서 고를 것이 없고, 그때도
 * 고르라고 막으면 사람은 아무거나 골라 넘긴다 — 그 선택은 어디에도 쓰이지 않으므로
 * 해롭지는 않지만, "아무거나 골라도 통과한다" 를 가르치는 것이 해롭다.
 */
function powerBasisBlockReason(
  parsed: CsvParseResult<PowerCsvRecord> | null,
  basis: BasisChoice,
): string | null {
  if (basis !== "" || parsed === null) return null
  const missing = parsed.records.filter((r) => r.measurement_basis === undefined).length
  if (missing === 0) return null
  return (
    `이 파일의 ${missing}건에 자료유형이 적혀 있지 않습니다. 위에서 「이 파일의 자료유형」을 ` +
    "고르거나 파일의 measurement_basis 열을 채워 주세요 — 고르지 않은 채 저장하면 그 전력이 " +
    "계량기 실측인지 계산값인지 아는 기록이 아무 데도 남지 않고, 리포트는 그 사실을 " +
    "'미기재' 로 적습니다."
  )
}

/** 미리보기의 자료유형 칸. 파일이 적은 값과 화면에서 고른 값을 **구별해** 보여 준다. */
function basisPreviewCell(record: PowerCsvRecord, basis: BasisChoice): string {
  if (record.measurement_basis !== undefined) {
    return `${MEASUREMENT_BASIS_LABELS[record.measurement_basis]} (파일)`
  }
  return basis === ""
    ? "— 고르지 않음 —"
    : `${MEASUREMENT_BASIS_LABELS[basis]} (위에서 고른 값)`
}

/**
 * 전력 기록지 업로드의 자료유형 칸 + 그 규칙.
 *
 * 선택은 **파일 단위 기본값**이다. 파일에 `measurement_basis` 열이 적힌 줄은 그 값이
 * 이기고(CSV_BASIS_PRECEDENCE_NOTE), 그 규칙을 화면에 그대로 적는다 — 적지 않으면
 * 운영자는 자기가 고른 값이 파일을 덮어쓴다고 믿는다.
 *
 * 해석 결과를 받아 **열이 없는 줄이 몇 건인지** 함께 알린다. 그 수가 "여기서 고른 값이
 * 실제로 적용되는 건수" 이고, 0 이면 고르지 않아도 저장할 수 있다.
 */
function PowerCsvBasisControls({
  parsed,
  value,
  onChange,
  canWrite,
}: {
  parsed: CsvParseResult<PowerCsvRecord> | null
  value: BasisChoice
  onChange: (next: BasisChoice) => void
  canWrite: boolean
}) {
  const id = useId()
  const rowsNeedingFallback =
    parsed?.records.filter((r) => r.measurement_basis === undefined).length ?? null
  const rowsWithOwnBasis =
    parsed === null ? null : parsed.records.length - (rowsNeedingFallback ?? 0)

  return (
    <div className="flex flex-col gap-2 rounded-md border border-mrv-border bg-mrv-bg p-3">
      <MeasurementBasisSelect
        id={id}
        label="이 파일의 자료유형"
        value={value}
        onChange={onChange}
        disabled={!canWrite}
      />
      <p className="text-xs text-mrv-muted">{CSV_BASIS_PRECEDENCE_NOTE}</p>
      {parsed !== null && (
        <p className="text-xs tabular-nums text-mrv-fg">
          읽은 {parsed.records.length}건 중 파일에 자료유형이 적힌 줄 {rowsWithOwnBasis}건 ·
          여기서 고른 값이 적용되는 줄 {rowsNeedingFallback}건.
        </p>
      )}
    </div>
  )
}

export default function InputPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  /**
   * 전력 기록지 두 칸의 **파일 단위 자료유형.** 칸마다 따로 들고 있다 — 한 상태를
   * 공유하면 구간 사용량 파일에 고른 값이 적산 지침 파일에도 묻어 들어간다.
   */
  const [intervalBasis, setIntervalBasis] = useState<BasisChoice>("")
  const [cumulativeBasis, setCumulativeBasis] = useState<BasisChoice>("")

  /**
   * 전력 기록지는 **파일 하나를 요청 하나로** 보낸다. 줄마다 보내면 적산 지침이 매번
   * 배치 경계가 되어 전부 산입에서 빠진다(ADR 0001) — 저장은 됐는데 EI 는 그대로인
   * 상태다. 급이·폐사는 줄이 서로 독립이라 줄 단위를 그대로 둔다.
   *
   * 결과 문구에 **산입 가능 건수를 그대로 적는다.** 'suspect'/'bad' 는 KPI 산입 목록에서
   * 빠지므로, "30건 저장" 만 보여 주면 운영자는 EI 가 왜 그대로인지 알 수 없다.
   */
  const makePowerSubmit = (basis: BasisChoice) => {
    if (!selectedSiteId) return null
    return async (records: PowerCsvRecord[]) => {
      const result = await apiFetch<ReadingsIngestResult>(
        `/sites/${encodeURIComponent(selectedSiteId)}/readings`,
        {
          method: "POST",
          json: {
            source: "csv",
            // 파일 단위 기본값. 줄마다 적힌 값은 서버가 그것을 먼저 쓴다
            // (lib/mrv/ingestion.ts 의 processBatch — 건별 > 배치 기본값).
            // 고르지 않았다면 보내지 않는다 — 그 경우 모든 줄이 자기 값을 들고 있고
            // (아니면 저장 자체가 막혀 있다), 빈 문자열을 보내면 서버가 422 로 거절한다.
            ...(basis === "" ? {} : { measurement_basis: basis }),
            readings: records,
          },
        },
      )
      const parts = [`KPI 산입 가능 ${result.quality.ok}건`]
      if (result.quality.suspect > 0) {
        parts.push(
          `산입 제외(품질 의심) ${result.quality.suspect}건 — 적산 지침의 첫 건은 기준점으로만 쓰여 제외됩니다`,
        )
      }
      if (result.quality.bad > 0) parts.push(`산입 제외(불량) ${result.quality.bad}건`)
      if (result.deduped > 0) parts.push(`이미 있어 흡수 ${result.deduped}건`)
      /**
       * **어떤 자료유형으로 보냈는지 그대로 적는다.** 저장이 끝난 뒤 그 사실이 남는
       * 자리는 화면의 이 문장과 감사 로그뿐이고, 여기에 적지 않으면 "실측으로 올린 줄
       * 알았다" 를 아무도 되짚을 수 없다. 서버가 돌려주는 요약에는 이 칸이 없으므로
       * (수락·중복·품질 분포만 돌려준다) 보낸 값을 그대로 센다.
       */
      const basisCounts = new Map<MeasurementBasis, number>()
      for (const r of records) {
        const effective = r.measurement_basis ?? basis
        if (effective === "") continue
        basisCounts.set(effective, (basisCounts.get(effective) ?? 0) + 1)
      }
      const basisNote = MEASUREMENT_BASES.filter((b) => basisCounts.has(b))
        .map((b) => `${MEASUREMENT_BASIS_LABELS[b]} ${basisCounts.get(b)}건`)
        .join(" · ")
      if (basisNote) parts.push(`자료유형 — ${basisNote}`)
      return { savedCount: result.accepted, note: parts.join(" · ") }
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="급이 · 폐사 · 전력 · 생산량 입력"
        description={`${selectedSite?.name ?? "사이트"} · 입력값은 검증 후 저장되며 KPI(EI·FCR·폐사율·Scope2)에 반영됩니다.`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FeedLogForm siteId={selectedSiteId} canWrite={canWrite} />
        <MortalityLogForm siteId={selectedSiteId} canWrite={canWrite} />
        <PowerLogForm siteId={selectedSiteId} canWrite={canWrite} />
        {/* 생산량은 EI·폭기 EI·FCR·OEI 네 지표의 **분모**다. 전력(분자) 바로 다음에
            둔다 — 전력만 넣고 "왜 EI 가 안 나오나" 가 되는 것이 이 화면에 생산량 창구가
            없던 동안 실제로 일어난 일이다. */}
        <HarvestLogForm siteId={selectedSiteId} canWrite={canWrite} />
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

        {/* 생산량 기록지. 급이·폐사와 같이 **줄마다** 보낸다 — 줄이 서로 독립이고
            (적산 지침처럼 직전 행과의 차이로 해석되는 값이 아니다) 줄 단위가 "어디까지
            들어갔나" 를 더 정확히 알려 준다. 산정 근거는 파일 단위 기본값을 두지 않고
            열을 필수로 받으므로 `controls` 도 `blockSendReason` 도 쓰지 않는다
            (이유는 lib/mrv/csv-records.ts 의 HarvestCsvRecord 주석). */}
        <CsvUpload
          title="생산량 기록지 업로드 (CSV)"
          parse={parseHarvestCsv}
          endpoint={
            selectedSiteId
              ? `/sites/${encodeURIComponent(selectedSiteId)}/harvests`
              : null
          }
          template={HARVEST_CSV_TEMPLATE}
          templateFilename="생산량기록지_견본.csv"
          successNote="기간 양 끝에 두 건이 있으면 EI·폭기 EI·FCR·OEI 가 산출됩니다."
          columnsHint="필요한 열: batch_id(배치) · ts(시각) · biomass_kg(생체량) · production_basis(산정 근거 — 실측/계산생체량/어림값). production_basis_note(산정 근거 상세)는 계산생체량·어림값에 필수, survival_adjusted(생존율 보정 적용 여부)는 선택입니다(빈 칸은 미기재로 저장되며 '미적용' 과 다른 사실입니다). 한국어 머리글도 받습니다."
          previewColumns={[
            { header: "배치", cell: (r) => r.batch_id },
            { header: "기록 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "생체량(kg)", cell: (r) => String(r.biomass_kg) },
            {
              header: "산정 근거",
              cell: (r) => PRODUCTION_BASIS_LABELS[r.production_basis],
            },
            { header: "산정 근거 상세", cell: (r) => r.production_basis_note ?? "—" },
            { header: "생존율 보정", cell: (r) => survivalPreviewCell(r) },
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
          batchSubmit={makePowerSubmit(intervalBasis)}
          template={POWER_INTERVAL_CSV_TEMPLATE}
          templateFilename="전력기록지_구간사용량_견본.csv"
          successNote="EI·Scope2 에 반영됩니다."
          columnsHint="필요한 열: meter_id(계측기) · ts(구간 끝 시각) · value(그 구간에 쓴 kWh). measurement_basis(자료유형)는 선택입니다. 한국어 머리글도 받습니다. 0 도 받습니다 — 돌리지 않은 날의 0 kWh 는 실제 계측이고, 줄을 비우면 계측이 끊긴 것과 구분되지 않습니다."
          previewColumns={[
            { header: "계측기", cell: (r) => r.meter_id },
            { header: "구간 끝 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "사용량(kWh)", cell: (r) => String(r.value) },
            { header: "자료유형", cell: (r) => basisPreviewCell(r, intervalBasis) },
          ]}
          controls={(parsed) => (
            <PowerCsvBasisControls
              parsed={parsed}
              value={intervalBasis}
              onChange={setIntervalBasis}
              canWrite={canWrite}
            />
          )}
          blockSendReason={(parsed) => powerBasisBlockReason(parsed, intervalBasis)}
          canWrite={canWrite}
        />

        <CsvUpload
          title="전력 기록지 업로드 — 적산 지침 (CSV)"
          parse={parseCumulativePowerCsv}
          endpoint={null}
          batchSubmit={makePowerSubmit(cumulativeBasis)}
          template={POWER_CUMULATIVE_CSV_TEMPLATE}
          templateFilename="전력기록지_적산지침_견본.csv"
          successNote="지침 두 건의 차이가 구간 사용량으로 저장되어 EI·Scope2 에 반영됩니다."
          columnsHint="필요한 열: meter_id(계측기) · ts(검침 시각) · value(계량기 표시값). measurement_basis(자료유형)는 선택입니다. 계측기당 2건 이상이어야 합니다 — 지침 두 건의 차이가 사용량이므로 1건만으로는 전력이 산출되지 않습니다. 이어서 올릴 때는 직전 지침을 같은 파일에 함께 넣으세요(중복은 흡수됩니다)."
          previewColumns={[
            { header: "계측기", cell: (r) => r.meter_id },
            { header: "검침 시각", cell: (r) => formatIsoLocal(r.ts) },
            { header: "계량기 표시값", cell: (r) => String(r.value) },
            { header: "자료유형", cell: (r) => basisPreviewCell(r, cumulativeBasis) },
          ]}
          controls={(parsed) => (
            <PowerCsvBasisControls
              parsed={parsed}
              value={cumulativeBasis}
              onChange={setCumulativeBasis}
              canWrite={canWrite}
            />
          )}
          blockSendReason={(parsed) => powerBasisBlockReason(parsed, cumulativeBasis)}
          canWrite={canWrite}
        />
      </div>
    </div>
  )
}
