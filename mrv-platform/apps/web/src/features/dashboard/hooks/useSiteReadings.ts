import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  ReadingGranularity,
  ReadingPoint,
  ReadingQualityFlag,
  ReadingsResponse,
} from "@/types/api";

/*
 * GET /sites/{siteId}/readings 소비 훅 (phase-2 4.1/4.3절, 슬라이스 I).
 * 절대 규칙: value는 백엔드 응답을 그대로 표시한다(집계/재계산 금지).
 *
 * 대시보드는 "단일 meterId" 또는 "여러 tankId(수조별 비교)"를 동시에 지원해야 하므로,
 * 조회 대상을 `targets` 배열로 받아 TanStack Query의 `useQueries`로 병렬 조회한다.
 * 백엔드는 tank_id+type 요청 시 여러 계측기(meter_id)가 하나의 응답에 섞여 올 수 있으므로
 * (4.1절 "복수 계측기 병합"), meter_id 단위로 series를 나누는 일은 차트 컴포넌트가 담당한다.
 */

/** 백엔드 원본(wire) 응답 형태 — snake_case. 이 파일 밖으로 노출하지 않는다. */
interface WireReadingPoint {
  ts: string;
  value: number;
  quality_flag: ReadingQualityFlag;
  meter_id?: string | null;
}
interface WireReadingsResponse {
  site_id: string;
  meter_id: string | null;
  type: string;
  granularity: string;
  unit: string;
  points: WireReadingPoint[];
}

function mapWireToReadingsResponse(wire: WireReadingsResponse): ReadingsResponse {
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
  };
}

/** 조회 대상 1건. meterId 단일 지정 또는 tankId+type 조합(백엔드 422 규칙과 동일). */
export interface UseSiteReadingsTarget {
  /** series 식별 키(UI 라벨/색상 매핑용). 보통 tankId 또는 meterId. */
  key: string;
  label?: string;
  meterId?: string;
  tankId?: string;
  type?: string;
}

export interface UseSiteReadingsParams {
  siteId: string;
  targets: UseSiteReadingsTarget[];
  /** ISO8601 UTC */
  from: string;
  /** ISO8601 UTC */
  to: string;
  /** 대시보드 UI는 raw 미노출(4.3절) */
  granularity: Extract<ReadingGranularity, "hourly" | "daily">;
}

export interface SiteReadingsSeriesResult {
  key: string;
  label?: string;
  target: UseSiteReadingsTarget;
  data: ReadingsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export interface UseSiteReadingsResult {
  series: SiteReadingsSeriesResult[];
  /** 하나라도 아직 로딩 중이고 표시할 데이터가 전혀 없을 때 true(점진적 렌더 위해 부분 데이터는 loading 아님) */
  isLoading: boolean;
  /** 모든 대상이 에러이고 표시할 데이터가 하나도 없을 때 true */
  isError: boolean;
  /** 로딩도 에러도 아니며 포인트가 하나도 없을 때 true(빈 상태) */
  isEmpty: boolean;
}

export function siteReadingsQueryKey(
  siteId: string,
  target: UseSiteReadingsTarget,
  from: string,
  to: string,
  granularity: string,
) {
  return [
    "site-readings",
    siteId,
    target.meterId ?? null,
    target.tankId ?? null,
    target.type ?? null,
    from,
    to,
    granularity,
  ] as const;
}

function isTargetQueryable(target: UseSiteReadingsTarget): boolean {
  return Boolean(target.meterId || (target.tankId && target.type));
}

/**
 * 여러 조회 대상(meterId 단일 또는 tankId+type 다건)을 병렬로 조회한다.
 * 산식/집계 로직 없음 — 응답을 camelCase로 옮겨 담기만 한다.
 */
export function useSiteReadings(params: UseSiteReadingsParams): UseSiteReadingsResult {
  const { siteId, targets, from, to, granularity } = params;

  const queryResults = useQueries({
    queries: targets.map((target) => ({
      queryKey: siteReadingsQueryKey(siteId, target, from, to, granularity),
      enabled: Boolean(siteId && from && to) && isTargetQueryable(target),
      queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<ReadingsResponse> => {
        const query: Record<string, string> = { from, to, granularity };
        if (target.meterId) query.meter_id = target.meterId;
        if (target.tankId) query.tank_id = target.tankId;
        if (target.type) query.type = target.type;
        const wire = await apiFetch<WireReadingsResponse>(
          `/sites/${encodeURIComponent(siteId)}/readings`,
          { query, signal },
        );
        return mapWireToReadingsResponse(wire);
      },
    })),
  }) as UseQueryResult<ReadingsResponse, unknown>[];

  const series: SiteReadingsSeriesResult[] = targets.map((target, index) => {
    const r = queryResults[index];
    return {
      key: target.key,
      label: target.label,
      target,
      data: r?.data,
      isLoading: r?.isLoading ?? false,
      isError: r?.isError ?? false,
      error: r?.error,
    };
  });

  const anyLoadingWithoutData = series.some((s) => s.isLoading && !s.data);
  const allErrored = series.length > 0 && series.every((s) => s.isError);
  const totalPoints = series.reduce((sum, s) => sum + (s.data?.points.length ?? 0), 0);

  return {
    series,
    isLoading: series.length > 0 && anyLoadingWithoutData,
    isError: allErrored,
    isEmpty: !anyLoadingWithoutData && !allErrored && totalPoints === 0,
  };
}
