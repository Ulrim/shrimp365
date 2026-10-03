"use client"

/**
 * 표준 기록지(CSV) 업로드 — MASTER 4장 화면 #4.
 *
 * 해석·검증 규칙은 `lib/mrv/csv-records.ts` 에 있다(순수 함수라 화면 밖에서 검증한다 —
 * `npm run mrv:verify-csv`). 이 파일은 **그 결과를 사람에게 보여 주고 보내는 일**만 한다.
 *
 * 서버에 새 창구를 더하지 않고 기존 `POST /feed-logs` · `POST /mortality-logs` 를 줄마다
 * 호출한다. 일괄 창구를 새로 만들면 검증 규칙이 두 곳으로 갈라지는데, 급이·폐사는 FCR 과
 * 폐사율의 분자라 판정 기준이 둘로 갈리는 것이 가장 위험하다. 기존 창구를 쓰면 **서버 검증을
 * 줄마다 그대로 통과**한다.
 *
 * 세 가지 결정을 명시한다.
 *
 * 1. **보내기 전에 전부 검사한다.** 한 줄이라도 형식이 틀리면 아무것도 보내지 않는다.
 *    80번째 줄 오타 때문에 79줄이 들어간 뒤 멈추면, 운영자는 어디까지 들어갔는지 모르는
 *    채 같은 파일을 다시 올려 중복을 만든다.
 * 2. **서버가 거절하면 그 줄에서 멈춘다.** 배치 ID 가 틀렸다면 뒤 줄도 대개 같이 틀리므로,
 *    계속 밀어 넣으면 치우기 어려운 절반 상태가 된다. 멈추면 "몇 줄까지 저장됐고 어디서부터
 *    다시 올리면 되는가" 가 분명해진다.
 * 3. **저장된 줄 수를 숨기지 않는다.** 실패해도 직전까지 저장된 건수와 멈춘 줄 번호를
 *    그대로 적는다 — 증빙 시스템에서 "얼마나 들어갔는지 모른다" 가 가장 나쁜 상태다.
 */

import { useId, useRef, useState } from "react"
import { apiFetch, errorMessage } from "@/lib/mrv/client"
import type { CsvParseResult, CsvRowError } from "@/lib/mrv/csv-records"
import { INPUT_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/mrv/ui"

/** 미리보기에 보여 주는 최대 줄 수. 나머지는 건수로만 알린다. */
const PREVIEW_LIMIT = 10

/**
 * 한 번에 올릴 수 있는 최대 줄 수.
 *
 * 줄마다 POST 한 번이므로 상한이 없으면 5만 줄 파일을 잘못 고른 운영자가 5만 번의 쓰기를
 * 시작시킨다. 지울 방법이 없는(DELETE 라우트 없음) 쓰기라 되돌릴 수도 없다. 기록지 한 장이
 * 이 수를 넘는 일은 없으므로, 넘으면 파일을 나눠 올리게 한다.
 */
const MAX_ROWS = 1000

type UploadOutcome = {
  savedCount: number
  /** 서버가 거절해 멈춘 지점. 없으면 전부 저장됐다. */
  stoppedAt: { line: number; message: string } | null
  /** 운영자가 중간에 멈췄다. */
  cancelled: boolean
}

export type CsvUploadProps<T> = {
  /** 제목(예: "급이 기록지 업로드"). */
  title: string
  /** 파일을 레코드로 바꾸는 순수 함수. */
  parse: (text: string) => CsvParseResult<T>
  /** 레코드 1건을 보낼 경로(사이트 포함 전체 경로). */
  endpoint: string | null
  /** 내려 줄 견본 서식 내용. */
  template: string
  /** 내려 줄 견본 파일 이름. */
  templateFilename: string
  /** 머리글 설명(사람이 읽는 한 줄). */
  columnsHint: string
  /** 미리보기 표의 열 정의. */
  previewColumns: { header: string; cell: (record: T) => string }[]
  canWrite: boolean
}

export function CsvUpload<T>({
  title,
  parse,
  endpoint,
  template,
  templateFilename,
  columnsHint,
  previewColumns,
  canWrite,
}: CsvUploadProps<T>) {
  const fileId = useId()

  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<CsvParseResult<T> | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null)
  /**
   * 중단 요청. 줄마다 보내는 루프가 **다음 줄로 넘어가기 전에** 본다. 이미 날아간 요청은
   * 되돌릴 수 없으므로 "지금까지 저장된 건수" 를 결과에 적는다.
   * state 가 아니라 ref 인 것은, 루프가 돌고 있는 동안의 state 변화를 그 클로저가 보지
   * 못하기 때문이다.
   */
  const cancelRef = useRef(false)

  const isUploading = progress !== null
  const hasBlockingErrors = (parsed?.errors.length ?? 0) > 0
  const tooManyRows = (parsed?.records.length ?? 0) > MAX_ROWS
  /**
   * `outcome !== null` 이면 보낼 수 없다 — **이 한 줄이 중복 저장을 막는다.**
   *
   * 이 창구에는 멱등성이 없다(라우트가 매 호출 새 id 를 만들고, `(batch_id, ts)` 유니크
   * 제약도 없다). 그리고 `app/api/mrv` 전체에 DELETE 라우트가 하나도 없어서 **한 번 들어간
   * 중복 급이 기록은 제품으로 지울 수 없다** — FCR 분자가 영구히 두 배가 된다.
   * 그래서 한 번 보낸 뒤에는 `지우기` → 파일 다시 선택을 반드시 거치게 한다.
   */
  const canSend =
    canWrite &&
    Boolean(endpoint) &&
    !isUploading &&
    outcome === null &&
    parsed !== null &&
    !hasBlockingErrors &&
    !tooManyRows &&
    parsed.records.length > 0

  function reset() {
    cancelRef.current = false
    setParsed(null)
    setFileName(null)
    setReadError(null)
    setProgress(null)
    setOutcome(null)
  }

  async function handleFile(file: File | undefined) {
    setParsed(null)
    setReadError(null)
    setOutcome(null)
    setProgress(null)
    if (!file) {
      setFileName(null)
      return
    }
    setFileName(file.name)
    try {
      const text = await file.text()
      setParsed(parse(text))
    } catch (err) {
      setReadError(errorMessage(err, "파일을 읽지 못했습니다."))
    }
  }

  function downloadTemplate() {
    // BOM 을 붙여 내려 준다 — 붙이지 않으면 Excel(한국어 Windows)이 UTF-8 로 읽지 않아
    // 머리글의 한글이 깨지고, 운영자가 그 파일을 고쳐 올리면 전부 오류가 된다.
    const blob = new Blob([`﻿${template}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = templateFilename
    a.click()
    // 동기적으로 revoke 하면 브라우저가 아직 읽기 전일 수 있어 빈 파일이 떨어진다.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function handleSend() {
    if (!canSend || !parsed || !endpoint) return
    const records = parsed.records
    setOutcome(null)
    cancelRef.current = false
    setProgress({ done: 0, total: records.length })

    let saved = 0
    for (let i = 0; i < records.length; i += 1) {
      if (cancelRef.current) {
        setProgress(null)
        setOutcome({ savedCount: saved, stoppedAt: null, cancelled: true })
        return
      }
      try {
        await apiFetch(endpoint, { method: "POST", json: records[i] })
        saved += 1
        setProgress({ done: saved, total: records.length })
      } catch (err) {
        setProgress(null)
        setOutcome({
          savedCount: saved,
          cancelled: false,
          stoppedAt: {
            // 파서가 레코드마다 들고 온 **실제 파일 줄 번호**를 쓴다. `i + 2` 로 추정하면
            // 따옴표 안 개행이나 중간 빈 줄이 있는 파일에서 엉뚱한 줄을 가리킨다.
            line: parsed.lines[i],
            message: errorMessage(err, "서버가 이 줄을 거절했습니다."),
          },
        })
        return
      }
    }
    setProgress(null)
    setOutcome({ savedCount: saved, stoppedAt: null, cancelled: false })
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
      aria-label={title}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-mrv-fg">{title}</h2>
        <p className="text-xs text-mrv-muted">{columnsHint}</p>
        <p className="text-xs text-mrv-muted">
          시간대를 적지 않은 시각은 이 기기의 시각으로 읽습니다(수기 입력과 같은 규약).
          한 줄이라도 형식이 틀리면 아무것도 저장하지 않습니다.
        </p>
      </div>

      {!canWrite && (
        <p role="note" className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-muted">
          읽기 전용 권한(viewer)입니다. 업로드는 owner/operator 만 가능합니다.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={fileId} className="text-sm font-medium text-mrv-fg">
            기록지 파일 (.csv)
          </label>
          <input
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            disabled={!canWrite || isUploading}
            onChange={(e) => handleFile(e.target.files?.[0])}
            className={`${INPUT_CLASS} py-1.5 disabled:opacity-60`}
          />
        </div>
        <button type="button" onClick={downloadTemplate} className={SECONDARY_BUTTON}>
          견본 서식 내려받기
        </button>
      </div>

      {readError && (
        <p role="alert" className="text-sm text-mrv-red">
          {readError}
        </p>
      )}

      {/* ── 형식 오류: 보내기 전에 전부 보여 준다 ──────────────────────────── */}
      {parsed && hasBlockingErrors && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-mrv-red bg-mrv-red-bg p-3"
        >
          <p className="text-sm font-medium text-mrv-red">
            {fileName} — 형식 오류 {parsed.errors.length}건. 저장하지 않았습니다.
          </p>
          <ul className="flex flex-col gap-1 text-xs text-mrv-fg">
            {parsed.errors.slice(0, 20).map((e: CsvRowError, i) => (
              <li key={`${e.line}-${i}`}>
                <span className="font-medium tabular-nums">{e.line}번째 줄</span> — {e.message}
              </li>
            ))}
          </ul>
          {parsed.errors.length > 20 && (
            <p className="text-xs text-mrv-muted">… 외 {parsed.errors.length - 20}건</p>
          )}
          <p className="text-xs text-mrv-muted">
            오류를 모두 고친 뒤 다시 올려 주세요. 데이터 줄 {parsed.dataLineCount}건 중
            위 {parsed.errors.length}건이 걸렸습니다.
          </p>
        </div>
      )}

      {/* ── 미리보기 ───────────────────────────────────────────────────────── */}
      {parsed && !hasBlockingErrors && parsed.records.length > 0 && !outcome && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-mrv-fg">
            {fileName} — {parsed.records.length}건을 읽었습니다. 저장할 내용을 확인하세요.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">업로드 미리보기</caption>
              <thead>
                <tr className="border-b border-mrv-border text-xs text-mrv-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">#</th>
                  {previewColumns.map((c) => (
                    <th key={c.header} scope="col" className="py-2 pr-3 font-medium">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.records.slice(0, PREVIEW_LIMIT).map((r, i) => (
                  <tr key={i} className="border-b border-mrv-border last:border-0">
                    <td className="py-2 pr-3 tabular-nums text-mrv-muted">{i + 1}</td>
                    {previewColumns.map((c) => (
                      <td key={c.header} className="py-2 pr-3 text-mrv-fg">
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.records.length > PREVIEW_LIMIT && (
            <p className="text-xs text-mrv-muted">
              … 외 {parsed.records.length - PREVIEW_LIMIT}건(저장은 전체 {parsed.records.length}건)
            </p>
          )}
        </div>
      )}

      {parsed && !hasBlockingErrors && parsed.records.length === 0 && (
        <p role="status" className="text-sm text-mrv-muted">
          {fileName} — 저장할 데이터 줄이 없습니다(머리글만 있는 파일).
        </p>
      )}

      {/* ── 줄 수 상한 ────────────────────────────────────────────────────── */}
      {parsed && tooManyRows && (
        <p role="alert" className="text-sm text-mrv-red">
          한 번에 올릴 수 있는 줄은 {MAX_ROWS}건까지입니다(이 파일은{" "}
          {parsed.records.length}건). 파일을 나눠 올려 주세요 — 줄마다 한 번씩 저장하므로
          너무 많으면 중간에 멈췄을 때 되돌리기 어렵습니다.
        </p>
      )}

      {/* ── 진행 상황 ──────────────────────────────────────────────────────── */}
      {progress && (
        <p role="status" className="text-sm text-mrv-fg">
          저장 중… <span className="tabular-nums">{progress.done}</span> /{" "}
          <span className="tabular-nums">{progress.total}</span>건
        </p>
      )}

      {/* ── 결과 ───────────────────────────────────────────────────────────── */}
      {outcome && outcome.stoppedAt === null && !outcome.cancelled && (
        <p role="status" className="text-sm text-mrv-green">
          {outcome.savedCount}건을 모두 저장했습니다. KPI(FCR·폐사율)에 반영됩니다.
          다시 올리려면 [지우기] 를 눌러 파일을 새로 고르세요(같은 파일을 한 번 더 보내면
          중복이 되고, 저장된 기록은 화면에서 지울 수 없습니다).
        </p>
      )}

      {outcome && outcome.cancelled && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-mrv-amber bg-mrv-amber-bg p-3 text-sm"
        >
          <p className="font-medium text-mrv-fg">
            중단했습니다 — {outcome.savedCount}건까지 저장됐습니다.
          </p>
          <p className="text-xs text-mrv-muted">
            저장된 {outcome.savedCount}건은 그대로 남아 있습니다. 이어서 올리려면 그만큼의
            데이터 줄을 지운 파일로 올려 주세요.
          </p>
        </div>
      )}

      {outcome && outcome.stoppedAt && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-mrv-amber bg-mrv-amber-bg p-3 text-sm"
        >
          <p className="font-medium text-mrv-fg">
            {outcome.savedCount}건을 저장한 뒤 멈췄습니다.
          </p>
          <p className="text-mrv-fg">
            거절된 줄: 파일 {outcome.stoppedAt.line}번째 줄 — {outcome.stoppedAt.message}
          </p>
          <p className="text-xs text-mrv-muted">
            이미 저장된 {outcome.savedCount}건은 그대로 남아 있습니다. 같은 파일을 그대로
            다시 올리면 중복이 되므로, {outcome.stoppedAt.line}번째 줄부터 남긴 파일로 올려
            주세요(그 앞의 데이터 줄은 이미 저장됐습니다).
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {/* 한 번 보낸 뒤에는 저장 버튼을 아예 치운다 — 비활성으로 남겨 두면
            "다시 눌러 볼까" 를 부른다. 재전송은 지우기 → 파일 재선택뿐이다. */}
        {outcome === null && (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={PRIMARY_BUTTON}
          >
            {isUploading
              ? "저장 중…"
              : parsed && !hasBlockingErrors && !tooManyRows && parsed.records.length > 0
                ? `${parsed.records.length}건 저장`
                : "저장"}
          </button>
        )}
        {isUploading && (
          <button
            type="button"
            onClick={() => {
              cancelRef.current = true
            }}
            className={SECONDARY_BUTTON}
          >
            중단
          </button>
        )}
        {(parsed || outcome || readError) && !isUploading && (
          <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
            지우기
          </button>
        )}
      </div>
    </section>
  )
}
