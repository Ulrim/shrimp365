"use client"

// 전역 UI 모드(새우/농업) 컨텍스트.
//
// 파생 규칙(설계서 3장): 로그인 사용자의 farm 목록에서
//   - 모든 farm 이 agriculture → 농업 UI 모드
//   - 하나라도 shrimp(혼합 포함) → 기존 새우 UI 모드
//   - farm 없음(온보딩 전) → 새우 모드 기본
//
// auth-context 는 건드리지 않는다(profiles 전용 현 구조 유지). farm 목록은
// 여기서 따로 읽으며, 실패하면 조용히 새우 모드로 남는다 — 기본값은 언제나
// 새우 양식이다(절대 원칙).

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react"
import { useAuth } from "@/lib/auth-context"
import { getFarms } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { AgriDictOverride } from "@/lib/i18n-context"
import type { Farm } from "@/types"

interface FarmModeContextType {
  /** 전역 UI 모드가 농업(수경재배)인지. 로딩 중·오류 시 false. */
  isAgriMode: boolean
  /** farm 유형을 바꾼 화면(/farms 등)이 호출해 모드를 다시 계산한다. */
  refreshFarmMode: () => Promise<void>
}

// 프로바이더 밖(예: 온보딩)에서 훅을 써도 깨지지 않게 새우 기본값을 둔다.
const FarmModeContext = createContext<FarmModeContextType>({
  isAgriMode: false,
  refreshFarmMode: async () => {},
})

function deriveMode(farms: Farm[]): boolean {
  if (farms.length === 0) return false
  return farms.every(f => (f.farm_type ?? "shrimp") === "agriculture")
}

export function FarmModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [isAgriMode, setIsAgriMode] = useState(false)

  const refreshFarmMode = useCallback(async () => {
    // 데모 계정 목데이터는 전부 새우 양식장이다.
    if (!user || isTestAccount(user.email)) {
      setIsAgriMode(false)
      return
    }
    try {
      setIsAgriMode(deriveMode(await getFarms()))
    } catch {
      // 못 읽으면 새우 모드 유지 — 화면이 막히는 것보다 낫다.
      setIsAgriMode(false)
    }
  }, [user])

  useEffect(() => {
    // 마이크로태스크로 미뤄 렌더 직후의 동기 setState 를 피한다(lint 규칙 준수).
    let cancelled = false
    Promise.resolve().then(() => { if (!cancelled) refreshFarmMode() })
    return () => { cancelled = true }
  }, [refreshFarmMode])

  return (
    <FarmModeContext.Provider value={{ isAgriMode, refreshFarmMode }}>
      <AgriDictOverride enabled={isAgriMode}>{children}</AgriDictOverride>
    </FarmModeContext.Provider>
  )
}

export function useFarmMode() {
  return useContext(FarmModeContext)
}
