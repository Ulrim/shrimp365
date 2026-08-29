"use client"

/**
 * 사이트 선택 컨텍스트.
 *
 * 원본(mrv-platform/apps/web)은 화면마다 `VITE_DEMO_SITE_ID` 환경변수 하나를 상수로 박아
 * 썼다("멀티사이트 선택 UI는 후속"이라는 주석과 함께). 이식본에는 데모 사이트가 없고
 * `GET /sites` 가 이미 조직의 사이트 목록을 주므로, 그 자리를 실제 선택으로 채운다.
 * 사이트가 하나뿐인 조직에서는 자동으로 그 하나가 골라져 원본과 똑같이 동작한다.
 *
 * 고른 사이트는 브라우저에만 남긴다(localStorage). 화면을 옮기거나 새로고침해도 유지되지만
 * 서버로는 가지 않는다 — 접근 권한은 언제나 서버가 org 로 판정하며, 이 값은 편의일 뿐이다.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { apiFetch, useApiQuery } from "@/lib/mrv/client"
import type { SitesListResponse, SiteSummary } from "@/lib/mrv/api-types"

const STORAGE_KEY = "mrv.selectedSiteId"

/*
 * 선택값을 localStorage 에 두고 useSyncExternalStore 로 읽는다.
 *
 * effect 안에서 상태를 세팅해 읽어 오는 방식이 더 흔하지만, 그러면 첫 렌더 뒤 상태가
 * 한 번 더 바뀌어 화면이 깜빡이고 React Compiler 규칙에도 걸린다. 외부 저장소로 다루면
 * 서버 렌더에서는 null(getServerSnapshot), 브라우저에서는 실제 값이 곧바로 읽힌다.
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getStoredSnapshot(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // 시크릿 창이나 저장소 차단 환경에서는 그냥 기억하지 않는다.
    return null
  }
}

/** 서버 렌더에는 브라우저 저장소가 없다. 선택 없음으로 시작해 목록의 첫 사이트를 쓴다. */
function getServerSnapshot(): string | null {
  return null
}

function writeStored(siteId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, siteId)
  } catch {
    /* 저장 실패는 무시한다 — 이번 화면에서는 선택이 그대로 반영된다. */
  }
  for (const listener of listeners) listener()
}

export type MrvSiteContext = {
  sites: SiteSummary[]
  selectedSiteId: string | null
  selectedSite: SiteSummary | null
  setSelectedSiteId: (siteId: string) => void
  isLoading: boolean
  isError: boolean
  error: unknown
}

const SiteContext = createContext<MrvSiteContext | null>(null)

export function MrvSiteProvider({ children }: { children: ReactNode }) {
  const query = useApiQuery<SitesListResponse>(
    (signal) => apiFetch<SitesListResponse>("/sites", { signal }),
    [],
  )
  const sites = useMemo(() => query.data?.items ?? [], [query.data])

  const stored = useSyncExternalStore(subscribe, getStoredSnapshot, getServerSnapshot)

  // 저장해 둔 선택이 아직 유효하면 그것을, 아니면 첫 사이트를 쓴다.
  // (조직이 바뀌거나 사이트가 삭제되면 저장값이 목록에 없을 수 있다.)
  const selectedSiteId = useMemo(() => {
    if (stored && sites.some((s) => s.id === stored)) return stored
    return sites[0]?.id ?? null
  }, [stored, sites])

  const setSelectedSiteId = useCallback((siteId: string) => {
    writeStored(siteId)
  }, [])

  const value: MrvSiteContext = {
    sites,
    selectedSiteId,
    selectedSite: sites.find((s) => s.id === selectedSiteId) ?? null,
    setSelectedSiteId,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useMrvSite(): MrvSiteContext {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error("useMrvSite must be used inside <MrvSiteProvider>")
  return ctx
}
