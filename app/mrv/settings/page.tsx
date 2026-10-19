"use client"

/**
 * 설정 — MASTER 4장 화면 #15 「기준선 확정/잠금, KPI 산식 파라미터, 배출계수 관리,
 * 센서/계측기 등록」.
 *
 * 기준선 잠금은 이미 독립 화면(`/mrv/baseline`)이라 여기서는 링크만 걸고, 창구는 있는데
 * 화면이 없던 나머지 셋을 담는다.
 *
 * **이 화면을 관통하는 규칙: 고치지 않고 덧붙인다.**
 *   - 배출계수는 append-only 다. 기존 행을 수정하면 그 값을 참조한 과거 MRV 리포트의
 *     근거가 사후에 바뀐다 — 증빙 시스템에서 해서는 안 되는 일이다. 그래서 '수정' 버튼이
 *     아니라 '새 version 추가' 만 둔다.
 *   - 계측기도 수정·삭제 창구가 없다(서버에도 없다). 계측기를 바꾸면 과거 KPI 의 근거가
 *     흔들리므로 교체는 새 계측기 등록으로 다룬다.
 *   - KPI 산식 설정은 **읽기 전용**이다. 이유는 `app/api/mrv/kpi-config/route.ts` 에 적었다 —
 *     파라미터를 바꾸면 지나간 기간의 신호등 판정까지 소급해 달라지므로, 과제 책임자의
 *     승인 절차 없이 화면에서 바꿀 수 있게 두지 않는다.
 *
 * 권한: 계측기 등록은 owner/operator, 배출계수 등록은 owner 전용(서버와 같은 기준).
 * 권한이 없으면 폼을 감추지 않고 비활성으로 보여 주며 이유를 적는다 — 메뉴가 사라지면
 * 사용자는 기능이 없는 줄 안다.
 */

import Link from "next/link"
import { useId, useMemo, useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { READING_TYPE_META, READING_TYPE_ORDER } from "@/lib/mrv/ui/reading-meta"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { collectQualityFlagRisks, qualityFlagRiskText } from "@/lib/mrv/quality-flags"
import {
  Card,
  INPUT_CLASS,
  LoadError,
  PRIMARY_BUTTON,
  PageHeader,
  formatNumber,
} from "@/components/mrv/ui"
import { ConfirmDialog } from "@/components/mrv/confirm-dialog"
import type {
  EmissionFactorListResponse,
  KpiConfigListResponse,
  MeterListResponse,
  MrvApiKey,
  MrvApiKeyListResponse,
  ReadingMeterType,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

function PermissionNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-muted">
      {children}
    </p>
  )
}

/** 섹션 공통 머리 — 제목 + 왜 이렇게 동작하는지 한 줄. */
function SectionHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold text-mrv-fg">{title}</h2>
      <p className="text-xs text-mrv-muted">{note}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 계측기 등록
// ---------------------------------------------------------------------------

function MeterSection({ siteId, canWrite }: { siteId: string | null; canWrite: boolean }) {
  const typeId = useId()
  const unitId = useId()
  const labelId = useId()
  const tankId = useId()

  const [type, setType] = useState<ReadingMeterType>("power")
  const [unit, setUnit] = useState(READING_TYPE_META.power.unit)
  const [label, setLabel] = useState("")
  const [tank, setTank] = useState("")
  const [isAeration, setIsAeration] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const list = useApiQuery<MeterListResponse>(
    (signal) =>
      apiFetch<MeterListResponse>(
        `/sites/${encodeURIComponent(siteId as string)}/meters`,
        { signal },
      ),
    [siteId],
    { enabled: Boolean(siteId) },
  )

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(`/sites/${encodeURIComponent(siteId as string)}/meters`, {
      method: "POST",
      json: body,
    }),
  )
  const disabled = !canWrite || !siteId || mutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return
    if (!unit.trim()) return setFieldError("단위를 입력하세요.")
    setFieldError(null)

    try {
      await mutation.mutate({
        type,
        unit: unit.trim(),
        is_aeration: isAeration,
        tank_id: tank.trim() || null,
        label: label.trim() || null,
      })
      setLabel("")
      setTank("")
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
      list.refetch()
    } catch {
      /* 오류는 mutation.error 로 아래에 표시된다. */
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <SectionHeader
        title="계측기 등록"
        note="등록한 계측기부터 시계열과 KPI 에 들어갑니다. 수정·삭제 창구는 두지 않습니다 — 계측기를 바꾸면 과거 KPI 의 근거가 흔들리므로 교체는 새 등록으로 다룹니다."
      />

      {list.isLoading && (
        <div
          role="status"
          className="h-20 animate-pulse rounded-md border border-mrv-border"
          aria-label="계측기 목록 불러오는 중"
        />
      )}

      {list.isError && !list.isLoading && (
        <LoadError
          message="계측기 목록을 불러오지 못했습니다."
          isUnauthorized={list.error instanceof ApiError && list.error.isUnauthorized}
          onRetry={list.refetch}
        />
      )}

      {list.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">등록된 계측기 목록</caption>
            <thead>
              <tr className="border-b border-mrv-border text-xs text-mrv-muted">
                <th scope="col" className="py-2 pr-3 font-medium">종류</th>
                <th scope="col" className="py-2 pr-3 font-medium">이름</th>
                <th scope="col" className="py-2 pr-3 font-medium">단위</th>
                <th scope="col" className="py-2 pr-3 font-medium">수조</th>
                <th scope="col" className="py-2 font-medium">폭기</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-mrv-muted">
                    등록된 계측기가 없습니다.
                  </td>
                </tr>
              )}
              {list.data.items.map((m) => (
                <tr key={m.id} className="border-b border-mrv-border last:border-0">
                  <td className="py-2 pr-3 text-mrv-fg">
                    {READING_TYPE_META[m.type]?.label ?? m.type}
                  </td>
                  <td className="py-2 pr-3 text-mrv-fg">{m.label ?? m.id}</td>
                  <td className="py-2 pr-3 tabular-nums text-mrv-muted">{m.unit}</td>
                  <td className="py-2 pr-3 text-mrv-muted">{m.tank_id ?? "사이트 전체"}</td>
                  <td className="py-2 text-mrv-muted">{m.is_aeration ? "폭기" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleSubmit} aria-label="계측기 등록 폼" className="flex flex-col gap-3 border-t border-mrv-border pt-4">
        {!canWrite && (
          <PermissionNote>
            읽기 전용 권한(viewer)입니다. 계측기 등록은 owner/operator 만 가능합니다.
          </PermissionNote>
        )}
        {/* 쓰기 권한은 있는데 사이트가 없으면 폼이 회색으로 죽는다. 이유를 적지 않으면
            운영자는 고장으로 읽는다(이 화면의 규칙: 감추지 말고 이유를 적는다). */}
        {canWrite && !siteId && (
          <PermissionNote>
            등록된 사이트가 없어 계측기를 넣을 수 없습니다. 사이트가 먼저 있어야 합니다 —
            관리자에게 사이트 등록을 요청해 주세요.
          </PermissionNote>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={typeId} className="text-sm font-medium text-mrv-fg">
              종류 <span className="text-mrv-red">*</span>
            </label>
            <select
              id={typeId}
              value={type}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value as ReadingMeterType
                setType(next)
                setUnit(READING_TYPE_META[next].unit)
              }}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            >
              {READING_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {READING_TYPE_META[t].label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={unitId} className="text-sm font-medium text-mrv-fg">
              단위 <span className="text-mrv-red">*</span>
            </label>
            <input
              id={unitId}
              value={unit}
              disabled={disabled}
              onChange={(e) => setUnit(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
            {/*
              이 값은 **표시용 메타데이터일 뿐 어디서도 변환되지 않는다.** 집계는 타입별
              표준 단위를 쓰고(`readings-service.ts` 의 DISPLAY_UNIT), 적재 쪽에는 unit 이
              등장조차 하지 않는다. 그래서 전력 계측기를 Wh 로 등록해도 값이 그대로 합산돼
              kWh 로 표시되고 Scope2 배출량까지 간다 — 1000배 오차가 조용히 섞인다.
              계측기는 수정 경로가 없으므로 잘못 적은 단위는 되돌릴 수 없다.
            */}
            {unit.trim() !== READING_TYPE_META[type].unit && (
              <p role="alert" className="text-xs text-mrv-red">
                표준 단위({READING_TYPE_META[type].unit})와 다릅니다. 이 값은 표시용 메모일
                뿐 <strong>단위 변환을 하지 않습니다</strong> — 계측기는 반드시{" "}
                {READING_TYPE_META[type].unit} 로 값을 올려야 합니다. 다른 단위로 올리면
                틀린 값이 그대로 KPI·배출량에 들어가고, 계측기는 나중에 고칠 수 없습니다.
              </p>
            )}
            {unit.trim() === READING_TYPE_META[type].unit && (
              <p className="text-xs text-mrv-muted">
                표시용 메모입니다. 단위 변환은 하지 않으므로 계측기가 올리는 값이 이 단위여야
                합니다.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={labelId} className="text-sm font-medium text-mrv-fg">
              이름
            </label>
            <input
              id={labelId}
              value={label}
              disabled={disabled}
              placeholder="예: 1번 수조 폭기 전력"
              onChange={(e) => setLabel(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={tankId} className="text-sm font-medium text-mrv-fg">
              수조 ID
            </label>
            <input
              id={tankId}
              value={tank}
              disabled={disabled}
              placeholder="비우면 사이트 전체"
              onChange={(e) => setTank(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-mrv-fg">
          <input
            type="checkbox"
            checked={isAeration}
            disabled={disabled}
            onChange={(e) => setIsAeration(e.target.checked)}
            className="h-4 w-4 rounded border-mrv-border disabled:opacity-50"
          />
          폭기 계측기 (폭기 EI 산정에 들어갑니다)
        </label>

        {fieldError && (
          <p role="alert" className="text-sm text-mrv-red">
            {fieldError}
          </p>
        )}
        {mutation.error !== undefined && (
          <p role="alert" className="text-sm text-mrv-red">
            {errorMessage(mutation.error, "계측기 등록에 실패했습니다.")}
          </p>
        )}
        {savedAt && !mutation.isPending && mutation.error === undefined && (
          <p role="status" className="text-sm text-mrv-green">
            {savedAt} 등록했습니다.
          </p>
        )}

        <button type="submit" disabled={disabled} className={`${PRIMARY_BUTTON} self-start`}>
          {mutation.isPending ? "등록 중…" : "계측기 등록"}
        </button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 배출계수 관리
// ---------------------------------------------------------------------------

function EmissionFactorSection({ isOwner }: { isOwner: boolean }) {
  const factorId = useId()
  const sourceId = useId()
  const yearId = useId()
  const versionId = useId()
  const effectiveId = useId()
  const gasScopeId = useId()
  const basisFromId = useId()
  const basisToId = useId()
  const documentNameId = useId()
  const issuingBodyId = useId()
  const publishedOnId = useId()
  const sourceUrlId = useId()

  const [factor, setFactor] = useState("")
  const [source, setSource] = useState("")
  const [year, setYear] = useState(String(new Date().getUTCFullYear()))
  const [version, setVersion] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  // 출처 칸. 전부 선택이다 — 추측으로 채우는 것보다 비는 쪽이 낫다(틀린 문서명은
  // 산정 전체의 신뢰를 깬다). 대신 비어 있으면 아래에 무엇이 비었는지 알려 준다.
  const [gasScope, setGasScope] = useState<"CO2e" | "CO2">("CO2e")
  const [basisFrom, setBasisFrom] = useState("")
  const [basisTo, setBasisTo] = useState("")
  const [documentName, setDocumentName] = useState("")
  const [issuingBody, setIssuingBody] = useState("")
  const [publishedOn, setPublishedOn] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const list = useApiQuery<EmissionFactorListResponse>(
    (signal) => apiFetch<EmissionFactorListResponse>("/emission-factors", { signal }),
    [],
  )

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch("/emission-factors", { method: "POST", json: body }),
  )
  const disabled = !isOwner || mutation.isPending

  // 활성 계수 = **사용 중단되지 않은** 행 중 effective_from 이 가장 늦은 것.
  // 서버가 effective_from 내림차순으로 주므로 그 조건을 만족하는 첫 행이다.
  // `items[0]` 을 그대로 쓰면 사용 중단된 행을 "적용 중" 으로 표시하게 된다 —
  // 서버의 자동 선택(`mrv-report-service.loadEmissionFactor`)과 기준이 갈라지면
  // 화면이 리포트와 다른 계수를 가리킨다.
  const activeId = list.data?.items.find((ef) => !ef.deprecated_at)?.id ?? null

  /**
   * 적용 시작일이 오늘(UTC)보다 뒤인가 — 즉시 적용이라는 경고를 띄울 조건.
   *
   * 오늘 날짜는 **마운트 때 한 번** 잡는다. 렌더 중에 `Date.now()` 를 부르면 같은 입력이
   * 렌더마다 다른 결과를 낼 수 있어 순수성 규칙에 걸린다(React Compiler lint 가 잡는다).
   * `YYYY-MM-DD` 문자열끼리의 비교는 사전순이 곧 날짜순이라 그대로 쓸 수 있다.
   */
  const [todayUtc] = useState(() => new Date().toISOString().slice(0, 10))
  const isFutureDate = effectiveFrom !== "" && effectiveFrom > todayUtc

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return

    const value = Number(factor)
    if (!Number.isFinite(value) || value <= 0) {
      return setFieldError("배출계수는 0보다 큰 값이어야 합니다.")
    }
    if (!source.trim()) return setFieldError("출처를 입력하세요(공표 기관·문서명).")
    const yearNum = Number(year)
    if (!Number.isInteger(yearNum)) return setFieldError("연도는 정수여야 합니다.")
    if (!version.trim()) return setFieldError("version 을 입력하세요.")
    if (!effectiveFrom) return setFieldError("적용 시작일을 입력하세요.")
    const effective = new Date(`${effectiveFrom}T00:00:00Z`)
    if (Number.isNaN(effective.getTime())) {
      return setFieldError("적용 시작일이 올바르지 않습니다.")
    }
    setFieldError(null)

    try {
      await mutation.mutate({
        factor_tco2e_per_mwh: value,
        source: source.trim(),
        year: yearNum,
        version: version.trim(),
        effective_from: effective.toISOString(),
        gas_scope: gasScope,
        // 빈 칸은 보내지 않는다(null). 빈 문자열을 보내면 서버가 "적었지만 비었다" 와
        // "적지 않았다" 를 구분할 수 없다.
        basis_from_year: basisFrom.trim() === "" ? null : Number(basisFrom),
        basis_to_year: basisTo.trim() === "" ? null : Number(basisTo),
        document_name: documentName.trim() || null,
        issuing_body: issuingBody.trim() || null,
        published_on: publishedOn.trim() || null,
        source_url: sourceUrl.trim() || null,
      })
      setFactor("")
      setVersion("")
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
      list.refetch()
    } catch {
      /* 오류는 아래에 표시된다. */
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <SectionHeader
        title="전력 배출계수"
        note="Scope2 감축량이 이 값에 곱해집니다. 기존 행은 고치지 않습니다 — 값이 갱신되면 새 version 을 추가하고, 과거 리포트는 그때 쓴 version 을 계속 참조합니다."
      />

      {list.isLoading && (
        <div
          role="status"
          className="h-20 animate-pulse rounded-md border border-mrv-border"
          aria-label="배출계수 목록 불러오는 중"
        />
      )}

      {list.isError && !list.isLoading && (
        <LoadError
          message="배출계수 목록을 불러오지 못했습니다."
          isUnauthorized={list.error instanceof ApiError && list.error.isUnauthorized}
          onRetry={list.refetch}
        />
      )}

      {list.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">등록된 전력 배출계수 목록</caption>
            <thead>
              <tr className="border-b border-mrv-border text-xs text-mrv-muted">
                <th scope="col" className="py-2 pr-3 font-medium">version</th>
                <th scope="col" className="py-2 pr-3 font-medium">tCO2e/MWh</th>
                <th scope="col" className="py-2 pr-3 font-medium">연도</th>
                <th scope="col" className="py-2 pr-3 font-medium">적용 시작</th>
                <th scope="col" className="py-2 font-medium">출처</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-mrv-muted">
                    등록된 배출계수가 없습니다. 이 상태에서는 MRV 리포트를 만들 수 없습니다.
                  </td>
                </tr>
              )}
              {list.data.items.map((ef) => {
                const isActive = ef.id === activeId
                const isDeprecated = Boolean(ef.deprecated_at)
                return (
                  <tr key={ef.id} className="border-b border-mrv-border last:border-0">
                    <td className="py-2 pr-3 text-mrv-fg">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {ef.version}
                        {/* 활성·중단 여부는 색이 아니라 글자로 적는다. */}
                        {isActive && (
                          <span className="rounded-full bg-mrv-green-bg px-2 py-0.5 text-[11px] font-medium text-mrv-green">
                            적용 중
                          </span>
                        )}
                        {/* 중단된 행도 숨기지 않는다. 과거 리포트가 이 계수를 근거로
                            삼았으므로, 목록에서 사라지면 그 리포트를 되짚을 수 없다. */}
                        {isDeprecated && (
                          <span className="rounded-full bg-mrv-na-bg px-2 py-0.5 text-[11px] font-medium text-mrv-na">
                            사용 중단
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-mrv-fg">
                      {formatNumber(ef.factor_tco2e_per_mwh, 4)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-mrv-muted">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {ef.year}
                        {/* 가스 범위는 숫자만큼 중요하다 — 같은 승인분이 CO2e 판과
                            CO2 판으로 둘 다 공표되므로, 표에서 바로 보여야 한다. */}
                        <span className="rounded bg-mrv-bg px-1.5 py-0.5 text-[11px] font-medium text-mrv-fg">
                          {ef.gas_scope ?? "범위 미기재"}
                        </span>
                      </span>
                      {ef.basis_from_year !== null && ef.basis_to_year !== null && (
                        <span className="block text-[11px] text-mrv-muted">
                          {ef.basis_from_year === ef.basis_to_year
                            ? `${ef.basis_from_year}년 단년도`
                            : `${ef.basis_from_year}~${ef.basis_to_year}년 평균`}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-mrv-muted">
                      {formatIsoLocal(ef.effective_from)}
                    </td>
                    <td className="py-2 text-mrv-muted">
                      {ef.source}
                      {/* 구조화된 출처가 있으면 함께 보인다. 없으면 **무엇이 비었는지**
                          적는다 — 빈 칸을 조용히 두면 검증 직전에야 발견한다. */}
                      {(ef.issuing_body || ef.document_name || ef.published_on) && (
                        <span className="mt-0.5 block text-[11px] text-mrv-fg">
                          {[
                            ef.issuing_body,
                            ef.document_name,
                            ef.published_on ? `${ef.published_on} 공표` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      {ef.source_url && (
                        <span className="mt-0.5 block break-all text-[11px] text-mrv-muted">
                          {ef.source_url}
                        </span>
                      )}
                      {!ef.deprecated_at && !(ef.document_name && ef.source_url) && (
                        <span className="mt-0.5 block text-[11px] text-mrv-amber">
                          검증 대응 미비 — 공표 문서명·출처 주소가 비어 있습니다
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        aria-label="배출계수 추가 폼"
        className="flex flex-col gap-3 border-t border-mrv-border pt-4"
      >
        {!isOwner && (
          <PermissionNote>
            배출계수 등록은 owner 만 가능합니다. 조직 전역 설정이라 operator 까지 열지 않습니다.
          </PermissionNote>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={factorId} className="text-sm font-medium text-mrv-fg">
              배출계수 (tCO2e/MWh) <span className="text-mrv-red">*</span>
            </label>
            <input
              id={factorId}
              type="number"
              step="0.0001"
              min="0"
              value={factor}
              disabled={disabled}
              onChange={(e) => setFactor(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={versionId} className="text-sm font-medium text-mrv-fg">
              version <span className="text-mrv-red">*</span>
            </label>
            <input
              id={versionId}
              value={version}
              disabled={disabled}
              placeholder="예: KR-GRID-2025.1"
              onChange={(e) => setVersion(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={yearId} className="text-sm font-medium text-mrv-fg">
              연도 <span className="text-mrv-red">*</span>
            </label>
            <input
              id={yearId}
              type="number"
              step="1"
              value={year}
              disabled={disabled}
              onChange={(e) => setYear(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={effectiveId} className="text-sm font-medium text-mrv-fg">
              적용 시작일 (UTC) <span className="text-mrv-red">*</span>
            </label>
            <input
              id={effectiveId}
              type="date"
              value={effectiveFrom}
              disabled={disabled}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
            {/*
              이름이 예약 등록처럼 읽히지만 아니다. 활성 계수 판정은
              `effective_from desc limit 1` 이고 **`<= now()` 필터가 없다**
              (`lib/mrv/mrv-report-service.ts`). 미래 날짜로 넣으면 오늘자 Scope2 가
              곧바로 그 계수로 바뀐다. 배출계수는 append-only 라 되돌릴 수도 없다.
            */}
            {isFutureDate ? (
              <p role="alert" className="text-xs text-mrv-red">
                미래 날짜입니다. 예약 등록이 아니라 <strong>지금 즉시 적용</strong>됩니다 —
                가장 늦은 적용 시작일을 가진 행이 활성 계수이기 때문입니다. 되돌릴 수 없으니
                오늘 이전 날짜를 쓰거나, 정말 이 계수를 지금부터 쓰려는지 확인하세요.
              </p>
            ) : (
              <p className="text-xs text-mrv-muted">
                가장 늦은 적용 시작일을 가진 행이 활성 계수가 됩니다(미래 날짜도 즉시 적용).
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={sourceId} className="text-sm font-medium text-mrv-fg">
            출처 <span className="text-mrv-red">*</span>
          </label>
          <input
            id={sourceId}
            value={source}
            disabled={disabled}
            placeholder="예: 환경부 온실가스종합정보센터(GIR) 국가 전력 배출계수 2025"
            onChange={(e) => setSource(e.target.value)}
            className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
          />
          <p className="text-xs text-mrv-muted">
            제3자가 값을 되짚을 수 있도록 공표 기관과 문서를 적습니다. 리포트에 이 문구가
            그대로 실립니다.
          </p>
        </div>

        {/* ── 출처(검증 대응) ───────────────────────────────────────────────
            칸을 나눈 이유: 자유 문장 하나로는 **무엇을 제시해야 하는지** 운영자가
            알 수 없다. 나눠 두면 비어 있는 칸이 곧 "아직 못 댄 근거" 가 된다.
            전부 선택이다 — 추측으로 채우는 것보다 비는 쪽이 낫다. */}
        <fieldset className="flex flex-col gap-3 rounded-md border border-mrv-border p-3">
          <legend className="px-1 text-xs font-medium text-mrv-fg">
            출처 상세 (검증 대응 · 선택)
          </legend>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={gasScopeId} className="text-sm font-medium text-mrv-fg">
                온실가스 범위
              </label>
              <select
                id={gasScopeId}
                value={gasScope}
                disabled={disabled}
                onChange={(e) => setGasScope(e.target.value as "CO2e" | "CO2")}
                className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
              >
                <option value="CO2e">CO2e — CH4·N2O 포함</option>
                <option value="CO2">CO2 — 이산화탄소만</option>
              </select>
              <p className="text-xs text-mrv-muted">
                같은 승인분이 <strong>두 판으로 공표됩니다</strong>(2023년도: CO2e 0.4173 /
                CO2 만 0.4149). 검증기관이 가장 먼저 묻는 칸입니다.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={publishedOnId} className="text-sm font-medium text-mrv-fg">
                공표일
              </label>
              <input
                id={publishedOnId}
                type="date"
                value={publishedOn}
                disabled={disabled}
                onChange={(e) => setPublishedOn(e.target.value)}
                className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
              />
              <p className="text-xs text-mrv-muted">
                계수가 공표된 날입니다. 적용 시작일(위)과 다를 수 있습니다.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={basisFromId} className="text-sm font-medium text-mrv-fg">
                기준 기간 시작 연도
              </label>
              <input
                id={basisFromId}
                type="number"
                step="1"
                value={basisFrom}
                disabled={disabled}
                placeholder="예: 2023"
                onChange={(e) => setBasisFrom(e.target.value)}
                className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={basisToId} className="text-sm font-medium text-mrv-fg">
                기준 기간 끝 연도
              </label>
              <input
                id={basisToId}
                type="number"
                step="1"
                value={basisTo}
                disabled={disabled}
                placeholder="단년도면 시작 연도와 같게"
                onChange={(e) => setBasisTo(e.target.value)}
                className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
              />
              <p className="text-xs text-mrv-muted">
                <strong>단년도</strong> 계수는 두 칸을 같게, <strong>다년 평균</strong>은
                범위로 적습니다(2024년 승인분 = 2020~2022 평균). 둘 다 적거나 둘 다 비웁니다.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={issuingBodyId} className="text-sm font-medium text-mrv-fg">
              발행기관
            </label>
            <input
              id={issuingBodyId}
              value={issuingBody}
              disabled={disabled}
              placeholder="예: 기후에너지환경부 국가 온실가스 통계 관리위원회"
              onChange={(e) => setIssuingBody(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={documentNameId} className="text-sm font-medium text-mrv-fg">
              공표 문서명
            </label>
            <input
              id={documentNameId}
              value={documentName}
              disabled={disabled}
              placeholder="예: 2025년 승인 국가 온실가스 배출·흡수계수"
              onChange={(e) => setDocumentName(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
            <p className="text-xs text-mrv-muted">
              검증기관에 제시하는 것이 이 문서입니다. 추측으로 적지 말고, 원문을 확인한
              뒤 그 제목을 그대로 적으세요.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={sourceUrlId} className="text-sm font-medium text-mrv-fg">
              출처 주소
            </label>
            <input
              id={sourceUrlId}
              type="url"
              value={sourceUrl}
              disabled={disabled}
              placeholder="https://..."
              onChange={(e) => setSourceUrl(e.target.value)}
              className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
            />
            <p className="text-xs text-mrv-muted">
              리포트에 글자로 인쇄됩니다(인쇄물에서는 누를 수 없으므로). http:// 또는
              https:// 로 시작해야 합니다.
            </p>
          </div>
        </fieldset>

        {fieldError && (
          <p role="alert" className="text-sm text-mrv-red">
            {fieldError}
          </p>
        )}
        {mutation.error !== undefined && (
          <p role="alert" className="text-sm text-mrv-red">
            {errorMessage(mutation.error, "배출계수 등록에 실패했습니다.")}
          </p>
        )}
        {savedAt && !mutation.isPending && mutation.error === undefined && (
          <p role="status" className="text-sm text-mrv-green">
            {savedAt} 새 version 을 추가했습니다.
          </p>
        )}

        <button type="submit" disabled={disabled} className={`${PRIMARY_BUTTON} self-start`}>
          {mutation.isPending ? "추가 중…" : "새 version 추가"}
        </button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// KPI 산식 설정 (읽기 전용)
// ---------------------------------------------------------------------------

function KpiConfigSection() {
  const list = useApiQuery<KpiConfigListResponse>(
    (signal) => apiFetch<KpiConfigListResponse>("/kpi-config", { signal }),
    [],
  )

  const active = useMemo(
    () => list.data?.items.find((c) => c.version === list.data?.active_version) ?? null,
    [list.data],
  )

  /**
   * 활성 설정이 오염된 계측값을 KPI 에 산입하고 있는가.
   *
   * 이 경고가 필요한 이유: `included_quality_flags` 를 넓히면 적산 원값이 EI 분자에
   * 들어가지만, **화면의 어떤 숫자도 그 사실을 알려 주지 않는다** — EI 가 커졌다는 것만
   * 보인다. JSON 전문은 아래에 그대로 찍히지만, 60줄짜리 블록에서 `"suspect"` 한 단어를
   * 찾아내기를 기대할 수는 없다. 그래서 꺼내 놓고 글자로 적는다(색만으로 알리지 않는다).
   */
  const risks = useMemo(
    () => (active === null ? [] : collectQualityFlagRisks(active.params_json)),
    [active],
  )

  return (
    <Card className="flex flex-col gap-4">
      <SectionHeader
        title="KPI 산식 설정"
        note="지금 신호등 판정에 쓰이는 파라미터입니다. 이 화면에서는 바꿀 수 없습니다 — 파라미터를 바꾸면 이미 지나간 기간의 판정까지 소급해서 달라지므로, 변경은 과제 책임자 승인 절차를 거쳐 새 version 으로 반영합니다."
      />

      {risks.length > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-mrv-red bg-mrv-red-bg p-3 text-sm"
        >
          <p className="font-semibold text-mrv-fg">
            경고 — 오염된 계측값이 KPI 에 산입되고 있습니다
          </p>
          <ul className="flex flex-col gap-2 text-xs leading-relaxed text-mrv-fg">
            {risks.map((risk) => (
              <li key={risk.path}>
                <code className="font-mono">params_json.{risk.path}</code> 에{" "}
                <strong>{risk.flags.join(", ")}</strong> 가 들어 있습니다.
                <ul className="mt-1 flex flex-col gap-1 pl-4">
                  {risk.flags.map((flag) => (
                    <li key={flag} className="list-disc">
                      {qualityFlagRiskText(flag)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="text-xs text-mrv-muted">
            기본 설정은 <code className="font-mono">[&quot;ok&quot;]</code> 입니다. 이 상태로
            만든 MRV 리포트에는 「포함 품질 플래그」 줄에 기본값이 아니라는 표시가 함께
            인쇄됩니다.
          </p>
        </div>
      )}

      {list.isLoading && (
        <div
          role="status"
          className="h-20 animate-pulse rounded-md border border-mrv-border"
          aria-label="KPI 설정 불러오는 중"
        />
      )}

      {list.isError && !list.isLoading && (
        <LoadError
          message="KPI 설정을 불러오지 못했습니다."
          isUnauthorized={list.error instanceof ApiError && list.error.isUnauthorized}
          onRetry={list.refetch}
        />
      )}

      {list.data && list.data.items.length === 0 && (
        <p className="text-sm text-mrv-muted">
          등록된 KPI 설정이 없습니다. 엔진 기본값으로 판정합니다.
        </p>
      )}

      {active && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-mrv-fg">
            적용 중 version{" "}
            <span className="font-semibold">{active.version}</span>
            <span className="text-mrv-muted">
              {" "}· 적용 시작 {formatIsoLocal(active.effective_from)}
            </span>
          </p>
          <pre className="max-h-80 overflow-auto rounded-md border border-mrv-border bg-mrv-bg p-3 text-xs leading-relaxed text-mrv-fg">
            {JSON.stringify(active.params_json, null, 2)}
          </pre>
        </div>
      )}

      {list.data && list.data.items.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-mrv-muted hover:text-mrv-fg">
            이전 version {list.data.items.length - 1}건
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-mrv-muted">
            {list.data.items
              .filter((c) => c.version !== list.data!.active_version)
              .map((c) => (
                <li key={c.id}>
                  {c.version} · 적용 시작 {formatIsoLocal(c.effective_from)}
                </li>
              ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

/**
 * 현장 장비 연결 — 장비 화면의 6자리 코드를 받아 수집 키를 발급한다.
 *
 * 이 카드가 **MRV 수집 API 키의 유일한 발급 경로다.** 지금까지 그 행은 SQL 로만 넣을 수
 * 있어서, 전력계나 입력 단말을 붙이려면 매번 DB 를 직접 만져야 했다.
 *
 * 원문 키는 **이 화면에 나타나지 않는다.** 장비가 자기만 아는 값으로 따로 가져간다 —
 * 승인한 사람의 브라우저나 화면 캡처에 장비 자격이 남을 이유가 없다.
 */
function DevicePairingSection({
  siteId,
  siteName,
  canWrite,
  onLinked,
}: {
  siteId: string | null
  siteName: string | null
  canWrite: boolean
  /** 연결이 끝났음을 알린다. 아래 키 목록이 방금 발급된 키를 바로 보여 주게 하려는 것. */
  onLinked: () => void
}) {
  const codeId = useId()
  const labelId = useId()
  const [code, setCode] = useState("")
  const [label, setLabel] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [linked, setLinked] = useState<{ at: string; site: string } | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch<{ status: string; site_name: string }>("/pair/claim", {
      method: "POST",
      json: body,
    }),
  )
  const disabled = !canWrite || !siteId || mutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return
    const digits = code.trim()
    if (!/^[0-9]{6}$/.test(digits)) {
      return setFieldError("장비 화면에 뜬 6자리 숫자를 그대로 적어 주세요.")
    }
    setFieldError(null)
    try {
      const res = await mutation.mutate({
        code: digits,
        site_id: siteId,
        label: label.trim() || null,
      })
      setCode("")
      setLabel("")
      setLinked({ at: new Date().toLocaleTimeString("ko-KR"), site: res.site_name })
      onLinked()
    } catch {
      /* 오류는 아래에 표시된다. */
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <SectionHeader
        title="현장 장비 연결"
        note="기계실 터치스크린에서 전력 계량기 지침을 바로 넣을 수 있게 장비를 붙입니다. 장비 화면에 뜬 6자리 코드를 아래에 적으세요. 코드는 15분 뒤 만료됩니다."
      />

      <div className="rounded-md bg-mrv-bg px-3 py-2 text-xs text-mrv-muted">
        연결될 사이트: <strong className="text-mrv-fg">{siteName ?? "사이트 미선택"}</strong>
        {" — "}
        장비가 넣는 전력은 <strong className="text-mrv-fg">이 사이트</strong>의 EI·Scope2·
        기준선 근거가 됩니다. 사이트를 바꾸려면 위쪽 사이트 선택기에서 먼저 고르세요.
      </div>

      <form onSubmit={handleSubmit} aria-label="현장 장비 연결 폼" className="flex flex-col gap-3">
        {!canWrite && (
          <PermissionNote>
            읽기 전용 권한(viewer)입니다. 장비 연결은 owner/operator 만 가능합니다.
          </PermissionNote>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={codeId} className="text-sm font-medium text-mrv-fg">
            장비 화면의 6자리 코드 <span className="text-mrv-red">*</span>
          </label>
          <input
            id={codeId}
            value={code}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="예: 043712"
            // 숫자만 남긴다 — 작업자가 하이픈이나 공백을 섞어 적는 일이 흔하다.
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${INPUT_CLASS} py-2 font-mono tracking-[0.3em] disabled:opacity-60`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={labelId} className="text-sm font-medium text-mrv-fg">
            장비 이름 (선택)
          </label>
          <input
            id={labelId}
            value={label}
            disabled={disabled}
            placeholder="예: 기계실 입력 단말"
            onChange={(e) => setLabel(e.target.value)}
            className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
          />
          <p className="text-xs text-mrv-muted">
            나중에 어느 장비인지 알아보려고 적습니다. 비우면 장비 일련번호로 채워집니다.
          </p>
        </div>

        {fieldError && (
          <p role="alert" className="text-sm text-mrv-red">
            {fieldError}
          </p>
        )}
        {mutation.error !== undefined && (
          <p role="alert" className="text-sm text-mrv-red">
            {errorMessage(mutation.error, "장비 연결에 실패했습니다.")}
          </p>
        )}
        {linked && !mutation.isPending && mutation.error === undefined && (
          <div role="status" className="flex flex-col gap-1 rounded-md border border-mrv-green bg-mrv-green-bg p-3 text-sm">
            <p className="font-medium text-mrv-fg">
              {linked.at} {linked.site} 에 장비를 연결했습니다.
            </p>
            <p className="text-xs text-mrv-muted">
              장비 화면이 몇 초 안에 &ldquo;연결됨&rdquo; 으로 바뀝니다. 바뀌지 않으면 장비에서
              코드를 새로 받아 다시 시도하세요 — 수집 키는 장비가 직접 가져가므로 이 화면에는
              나타나지 않습니다.
            </p>
          </div>
        )}

        <button type="submit" disabled={disabled} className={`${PRIMARY_BUTTON} self-start`}>
          {mutation.isPending ? "연결 중…" : "장비 연결"}
        </button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 연결된 장비 · 연결 해제
// ---------------------------------------------------------------------------

/**
 * 발급된 장비 수집 키 목록과 [연결 해제].
 *
 * 왜 필요한가: 키를 **발급**하는 길(위 카드)은 있었는데 **끊는** 길이 화면에도 API 에도
 * 없었다. 기계실 터치스크린을 분실·교체·반납해도 끊는 방법이 DB 직접 수정뿐이었다.
 * 그 키 하나로 이 사이트의 전력 계측값을 넣을 수 있고 그 전력이 EI·Scope2·기준선의
 * 근거가 되므로, 상용화 전에 반드시 있어야 하는 창구다.
 *
 * 표시 규칙:
 *   - 원문 키는 어디에도 나타나지 않는다(서버가 내보내지 않는다).
 *   - 끊은 키도 목록에서 지우지 않는다. 그 장비가 넣은 계측값이 기준선의 근거로 남아
 *     있으므로, 사라지면 그 데이터의 출처를 되짚을 수 없다.
 *   - 상태는 **글자로** 구분한다(색만으로 구분하지 않는다) — 위 배출계수 표의
 *     `적용 중`/`사용 중단` 배지와 같은 방식이다.
 */
function DeviceKeySection({
  siteId,
  siteName,
  canWrite,
  refreshToken,
}: {
  siteId: string | null
  siteName: string | null
  canWrite: boolean
  /** 위 카드에서 장비를 연결하면 값이 바뀌어 목록을 다시 읽게 한다. */
  refreshToken: number
}) {
  const list = useApiQuery<MrvApiKeyListResponse>(
    (signal) =>
      apiFetch<MrvApiKeyListResponse>("/api-keys", {
        signal,
        query: { site_id: siteId! },
      }),
    [siteId, refreshToken],
    { enabled: siteId !== null },
  )

  /** 확인 대화상자에 올려 둔 대상. null 이면 닫혀 있다. */
  const [target, setTarget] = useState<MrvApiKey | null>(null)
  const [revokedAt, setRevokedAt] = useState<string | null>(null)

  const mutation = useApiMutation(async (apiKeyId: string) =>
    apiFetch<MrvApiKey>(`/api-keys/${encodeURIComponent(apiKeyId)}/revoke`, {
      method: "POST",
      json: {},
    }),
  )

  async function handleConfirm() {
    if (target === null) return
    try {
      await mutation.mutate(target.id)
      setRevokedAt(new Date().toLocaleTimeString("ko-KR"))
      setTarget(null)
      list.refetch()
    } catch {
      /* 오류는 아래에 표시된다. 대화상자는 닫지 않는다 — 무엇이 실패했는지 보여야 한다. */
    }
  }

  const activeCount = list.data?.items.filter((k) => !k.revoked).length ?? 0

  return (
    <Card className="flex flex-col gap-4">
      <SectionHeader
        title="연결된 장비"
        note="이 사이트에 붙어 있는 전력 입력 장비입니다. 단말을 분실·교체·반납했으면 여기서 연결을 해제하세요. 수집 키는 이 화면에 나타나지 않습니다 — 장비만 들고 있습니다."
      />

      {siteId === null && (
        <p className="text-sm text-mrv-muted">
          사이트를 먼저 고르면 그 사이트에 연결된 장비를 보여 줍니다.
        </p>
      )}

      {list.isLoading && (
        <div
          role="status"
          className="h-20 animate-pulse rounded-md border border-mrv-border"
          aria-label="연결된 장비 불러오는 중"
        />
      )}

      {list.isError && !list.isLoading && (
        <LoadError
          message="연결된 장비를 불러오지 못했습니다."
          isUnauthorized={list.error instanceof ApiError && list.error.isUnauthorized}
          onRetry={list.refetch}
        />
      )}

      {!canWrite && siteId !== null && (
        <PermissionNote>
          읽기 전용 권한(viewer)입니다. 연결 해제는 owner/operator 만 가능합니다.
        </PermissionNote>
      )}

      {mutation.error !== undefined && (
        <p role="alert" className="text-sm text-mrv-red">
          {errorMessage(mutation.error, "연결 해제에 실패했습니다.")}
        </p>
      )}
      {revokedAt && !mutation.isPending && mutation.error === undefined && (
        <p role="status" className="text-sm text-mrv-green">
          {revokedAt} 연결을 해제했습니다. 이 장비는 더 이상 계측값을 올릴 수 없습니다.
        </p>
      )}

      {list.data && !list.isLoading && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {siteName ?? "이 사이트"}에 연결된 장비 목록
            </caption>
            <thead>
              <tr className="border-b border-mrv-border text-xs text-mrv-muted">
                <th scope="col" className="py-2 pr-3 font-medium">장비</th>
                <th scope="col" className="py-2 pr-3 font-medium">연결일</th>
                <th scope="col" className="py-2 pr-3 font-medium">마지막 사용</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">연결 해제</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-mrv-muted">
                    연결된 장비가 없습니다. 위 「현장 장비 연결」에서 붙일 수 있습니다.
                  </td>
                </tr>
              )}
              {list.data.items.map((key) => (
                <tr key={key.id} className="border-b border-mrv-border last:border-0">
                  <td className="py-2 pr-3 text-mrv-fg">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {key.label ?? "이름 없는 장비"}
                      {/* 상태는 색이 아니라 글자로 적는다. */}
                      {key.revoked ? (
                        <span className="rounded-full bg-mrv-na-bg px-2 py-0.5 text-[11px] font-medium text-mrv-na">
                          연결 해제됨
                        </span>
                      ) : (
                        <span className="rounded-full bg-mrv-green-bg px-2 py-0.5 text-[11px] font-medium text-mrv-green">
                          사용 중
                        </span>
                      )}
                    </span>
                    {key.revoked && (
                      <span className="block text-[11px] text-mrv-muted">
                        {key.revoked_at
                          ? `${formatIsoLocal(key.revoked_at)} 해제`
                          : "해제 시각 미기록 (이 기능이 생기기 전에 DB 에서 직접 끊긴 키)"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-mrv-muted">
                    {formatIsoLocal(key.created_at)}
                  </td>
                  <td className="py-2 pr-3 text-mrv-muted">
                    {key.last_used_at ? formatIsoLocal(key.last_used_at) : "사용 기록 없음"}
                  </td>
                  <td className="py-2">
                    {!key.revoked && (
                      <button
                        type="button"
                        disabled={!canWrite || mutation.isPending}
                        onClick={() => {
                          setRevokedAt(null)
                          setTarget(key)
                        }}
                        className="rounded-md border border-mrv-red px-3 py-1 text-xs font-medium text-mrv-red hover:bg-mrv-red-bg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        연결 해제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.data && activeCount > 0 && (
        <p className="text-xs text-mrv-muted">
          「마지막 사용」은 몇 분에 한 번만 갱신됩니다(계측값이 올라올 때마다 기록하면
          수집 쓰기가 헛돕니다). 방금 올라온 장비가 조금 전 시각으로 보일 수 있습니다.
        </p>
      )}

      <ConfirmDialog
        open={target !== null}
        title="이 장비의 연결을 해제하시겠습니까?"
        tone="danger"
        confirmLabel="연결 해제"
        pendingLabel="해제 중…"
        pending={mutation.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setTarget(null)}
        description={
          <>
            해제하면 이 장비는 <strong className="text-mrv-red">더 이상 전력 입력을 올릴
            수 없습니다.</strong> 장비가 아직 올리지 못해 <strong>보관하고 있는 입력이
            있으면 그것도 올라오지 못하고 장비에 남습니다</strong> — 기계실 단말은 통신이
            끊긴 동안의 입력을 들고 있다가 나중에 올립니다. 끊기 전에 그 장비가 보관분을
            올렸는지 확인하세요.
            <br />
            <br />
            되돌릴 수 없습니다. 같은 장비를 다시 쓰려면 장비에서 코드를 새로 받아 위
            「현장 장비 연결」로 다시 붙여야 합니다.
          </>
        }
        detail={
          target && (
            <>
              <p>장비: {target.label ?? "이름 없는 장비"}</p>
              <p className="mt-1">사이트: {siteName ?? target.site_id}</p>
              <p className="mt-1">
                마지막 사용:{" "}
                {target.last_used_at
                  ? formatIsoLocal(target.last_used_at)
                  : "사용 기록 없음 (한 번도 계측값을 올리지 않은 장비)"}
              </p>
            </>
          )
        }
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)
  const isOwner = role === "owner"
  /** 장비를 새로 연결하면 아래 키 목록이 다시 읽도록 올리는 값. */
  const [keyListNonce, setKeyListNonce] = useState(0)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="설정"
        description={`${selectedSite?.name ?? "사이트"} · 계측기 · 배출계수 · KPI 산식 설정`}
      />

      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-mrv-fg">기준선 확정 · 잠금</h2>
          <p className="text-xs text-mrv-muted">
            기준선은 잠그면 바뀌지 않습니다(DB 가 강제). 전용 화면에서 다룹니다.
          </p>
        </div>
        <Link
          href="/mrv/baseline"
          className="rounded-md border border-mrv-border bg-mrv-surface px-3 py-1.5 text-sm font-medium text-mrv-fg hover:bg-mrv-bg"
        >
          기준선 화면으로
        </Link>
      </Card>

      <MeterSection siteId={selectedSiteId} canWrite={canWrite} />
      <DevicePairingSection
        siteId={selectedSiteId}
        siteName={selectedSite?.name ?? null}
        canWrite={canWrite}
        onLinked={() => setKeyListNonce((n) => n + 1)}
      />
      <DeviceKeySection
        siteId={selectedSiteId}
        siteName={selectedSite?.name ?? null}
        canWrite={canWrite}
        refreshToken={keyListNonce}
      />
      <EmissionFactorSection isOwner={isOwner} />
      <KpiConfigSection />
    </div>
  )
}
