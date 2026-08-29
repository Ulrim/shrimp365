"use client"

/**
 * GET /sites/{siteId}/readings 소비 훅.
 * 원본: mrv-platform/apps/web/src/features/dashboard/hooks/useSiteReadings.ts
 *
 * 절대 규칙: value 는 서버 응답을 그대로 표시한다(집계/재계산 금지).
 *
 * 대시보드는 "단일 계측기" 또는 "여러 수조(수조별 비교)"를 동시에 지원해야 하므로 조회
 * 대상을 배열로 받아 병렬로 조회한다. 서버는 tank_id+type 요청에 여러 계측기 값을 한
 * 응답에 섞어 줄 수 있으므로, 계측기 단위로 series 를 나누는 일은 차트가 담당한다.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { apiFetch } from "@/lib/mrv/client"
import type {
  ReadingGranularity,
  ReadingPoint,
  ReadingQualityFlag,
  ReadingsResponse,
} from "@/lib/mrv/api-types"

/** 서버 원본(wire) 응답 형태 — snake_case. 이 파일 밖으로 내보내지 않는다. */
type WireReadingPoint = {
  ts: string
  value: number
  quality_flag: ReadingQualityFlag
  meter_id?: string | null
}
type WireReadingsResponse = {
  site_id: string
  meter_id: string | null
  type: string
  granularity: string
  unit: string
  points: WireReadingPoint[]
}

function mapWire(wire: WireReadingsResponse): ReadingsResponse {
  return {
    siteId: wire.site_id,
    meterId: wire.meter_id,
    type: wire.type,
    granularity: wire.granularity as ReadingGranularity,
    unit: wire.unit,
    points: wire.points.map(
      (p): ReadingPoint => ({
        ts: p.ts,
        value: p.value,
        qualityFlag: p.quality_flag,
        meterId: p.meter_id ?? null,
      }),
    ),
  }
}

/** 조회 대상 1건. meterId 단일 지정이거나 tankId+type 조합이어야 한다(서버 규칙과 같다). */
export type UseSiteReadingsTarget = {
  /** series 식별 키(라벨·색 매핑용). 보통 tankId 또는 meterId. */
  key: string
  label?: string
  meterId?: string
  tankId?: string
  type?: string
}

export type SiteReadingsSeriesResult = {
  key: string
  label?: string
  target: UseSiteReadingsTarget
  data: ReadingsResponse | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
}

export type UseSiteReadingsResult = {
  series: SiteReadingsSeriesResult[]
  /** 아직 표시할 데이터가 하나도 없이 로딩 중일 때만 true(부분 데이터는 로딩으로 치지 않는다). */
  isLoading: boolean
  /** 모든 대상이 실패하고 표시할 데이터가 하나도 없을 때 true. */
  isError: boolean
  /** 로딩도 에러도 아닌데 포인트가 하나도 없을 때 true. */
  isEmpty: boolean
}

function isTargetQueryable(target: UseSiteReadingsTarget): boolean {
  return Boolean(target.meterId || (target.tankId && target.type))
}

export function useSiteReadings(params: {
  siteId: string | null
  targets: UseSiteReadingsTarget[]
  from: string
  to: string
  granularity: Extract<ReadingGranularity, "hourly" | "daily">
}): UseSiteReadingsResult {
  const { siteId, targets, from, to, granularity } = params

  // 이번 조회가 무엇인지 한 문자열로 굳힌다. 대상 배열은 매 렌더 새로 만들어지므로
  // 그대로 의존성에 넣으면 무한 재조회에 빠진다. 결과도 이 키와 함께 저장해, 응답이
  // 도착했는지를 "저장된 키가 지금 키와 같은가"로 판단한다(로딩 플래그를 따로 켜지 않는다).
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        siteId,
        from,
        to,
        granularity,
        targets: targets.map((t) => [
          t.key,
          t.meterId ?? null,
          t.tankId ?? null,
          t.type ?? null,
        ]),
      }),
    [siteId, from, to, granularity, targets],
  )

  const [results, setResults] = useState<
    Record<string, { key: string; data?: ReadingsResponse; error?: unknown }>
  >({})

  // 렌더 중에는 ref 를 건드리지 않는다. 아래 조회 effect 보다 먼저 선언돼 있어 마운트
  // 시에도 이 effect 가 먼저 돈다.
  const targetsRef = useRef(targets)
  useEffect(() => {
    targetsRef.current = targets
  })

  useEffect(() => {
    if (!siteId || !from || !to) return
    const current = targetsRef.current.filter(isTargetQueryable)
    if (current.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    for (const target of current) {
      const query: Record<string, string> = { from, to, granularity }
      if (target.meterId) query.meter_id = target.meterId
      if (target.tankId) query.tank_id = target.tankId
      if (target.type) query.type = target.type

      apiFetch<WireReadingsResponse>(
        `/sites/${encodeURIComponent(siteId)}/readings`,
        { query, signal: controller.signal },
      )
        .then((wire) => {
          if (cancelled) return
          setResults((prev) => ({
            ...prev,
            [target.key]: { key: requestKey, data: mapWire(wire) },
          }))
        })
        .catch((error) => {
          if (cancelled || controller.signal.aborted) return
          setResults((prev) => ({ ...prev, [target.key]: { key: requestKey, error } }))
        })
    }

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [siteId, from, to, granularity, requestKey])

  const series: SiteReadingsSeriesResult[] = targets.map((target) => {
    const r = results[target.key]
    const isSettled = r?.key === requestKey
    return {
      key: target.key,
      label: target.label,
      target,
      // 새 조회가 도는 동안에도 직전 데이터를 그대로 보여 준다(차트가 비었다 다시 차지 않는다).
      data: r?.data,
      isLoading: isTargetQueryable(target) && !isSettled,
      isError: isSettled && r?.error !== undefined,
      error: isSettled ? r?.error : undefined,
    }
  })

  const anyLoadingWithoutData = series.some((s) => s.isLoading && !s.data)
  const allErrored = series.length > 0 && series.every((s) => s.isError)
  const totalPoints = series.reduce((sum, s) => sum + (s.data?.points.length ?? 0), 0)

  return {
    series,
    isLoading: series.length > 0 && anyLoadingWithoutData,
    isError: allErrored,
    isEmpty: !anyLoadingWithoutData && !allErrored && totalPoints === 0,
  }
}
