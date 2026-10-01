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
import {
  Card,
  INPUT_CLASS,
  LoadError,
  PRIMARY_BUTTON,
  PageHeader,
  formatNumber,
} from "@/components/mrv/ui"
import type {
  EmissionFactorListResponse,
  KpiConfigListResponse,
  MeterListResponse,
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

  const [factor, setFactor] = useState("")
  const [source, setSource] = useState("")
  const [year, setYear] = useState(String(new Date().getUTCFullYear()))
  const [version, setVersion] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
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

  // 활성 계수 = effective_from 이 가장 늦은 행. 서버가 그 순서로 주므로 첫 행이다.
  const activeId = list.data?.items[0]?.id ?? null

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
                return (
                  <tr key={ef.id} className="border-b border-mrv-border last:border-0">
                    <td className="py-2 pr-3 text-mrv-fg">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {ef.version}
                        {/* 활성 여부는 색이 아니라 글자로 적는다. */}
                        {isActive && (
                          <span className="rounded-full bg-mrv-green-bg px-2 py-0.5 text-[11px] font-medium text-mrv-green">
                            적용 중
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-mrv-fg">
                      {formatNumber(ef.factor_tco2e_per_mwh, 4)}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-mrv-muted">{ef.year}</td>
                    <td className="py-2 pr-3 text-mrv-muted">
                      {formatIsoLocal(ef.effective_from)}
                    </td>
                    <td className="py-2 text-mrv-muted">{ef.source}</td>
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

  return (
    <Card className="flex flex-col gap-4">
      <SectionHeader
        title="KPI 산식 설정"
        note="지금 신호등 판정에 쓰이는 파라미터입니다. 이 화면에서는 바꿀 수 없습니다 — 파라미터를 바꾸면 이미 지나간 기간의 판정까지 소급해서 달라지므로, 변경은 과제 책임자 승인 절차를 거쳐 새 version 으로 반영합니다."
      />

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

export default function SettingsPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)
  const isOwner = role === "owner"

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
      <EmissionFactorSection isOwner={isOwner} />
      <KpiConfigSection />
    </div>
  )
}
