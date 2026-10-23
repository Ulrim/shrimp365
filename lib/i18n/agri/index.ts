// 농업(스마트팜) 전용 사전 조립 — 설계서 docs/plans/mode-split.md 6장.
//
// 새우 사전(lib/i18n/{ko,en,vi,id}.ts)과 별개다. 농업 화면(components/agri/**)은
// useAgriT() 로 이 사전을 읽고, 저장·취소·시간 같은 공용 문구만 기존 t.common 을 쓴다.
// 섹션은 파일 하나씩이고 각 파일이 자기 타입과 4개 언어를 함께 갖는다 — 여러 사람이
// 동시에 다른 섹션을 채워도 이 파일과 서로의 파일을 건드릴 일이 없다.
import type { Locale } from "@/lib/i18n"
import { agriCommon, type AgriCommonDict } from "./common"
import { agriNav, type AgriNavDict } from "./nav"
import { agriHome, type AgriHomeDict } from "./home"
import { agriDashboard, type AgriDashboardDict } from "./dashboard"
import { agriRecord, type AgriRecordDict } from "./record"
import { agriNutrient, type AgriNutrientDict } from "./nutrient"
import { agriJournal, type AgriJournalDict } from "./journal"
import { agriFarms, type AgriFarmsDict } from "./farms"
import { agriOpenfield, type AgriOpenfieldDict } from "./openfield"
import { agriEnvironment, type AgriEnvironmentDict } from "./environment"

export interface AgriDict {
  common: AgriCommonDict
  nav: AgriNavDict
  home: AgriHomeDict
  dashboard: AgriDashboardDict
  record: AgriRecordDict
  nutrient: AgriNutrientDict
  journal: AgriJournalDict
  farms: AgriFarmsDict
  /** 노지 재해위험 카드(OFDF 병합) — docs/plans/openfield-merge.md */
  openfield: AgriOpenfieldDict
  /** 환경·기상 카드(지그비 온습도·토양, 기상센서) — lib/env-params.ts */
  environment: AgriEnvironmentDict
}

export function agriDict(locale: Locale): AgriDict {
  return {
    common: agriCommon[locale],
    nav: agriNav[locale],
    home: agriHome[locale],
    dashboard: agriDashboard[locale],
    record: agriRecord[locale],
    nutrient: agriNutrient[locale],
    journal: agriJournal[locale],
    farms: agriFarms[locale],
    openfield: agriOpenfield[locale],
    environment: agriEnvironment[locale],
  }
}
