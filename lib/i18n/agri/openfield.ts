// 농업(스마트팜) 사전 — openfield 섹션(노지 재해위험 카드). 4개 언어를 한 파일에 둔다.
// 이 파일은 O2 담당이 채운다(docs/plans/openfield-merge.md 6장). index.ts 는 건드리지 않는다.
import type { Locale } from "@/lib/i18n"

export interface AgriOpenfieldDict {}

export const agriOpenfield: Record<Locale, AgriOpenfieldDict> = {
  ko: {},
  en: {},
  vi: {},
  id: {},
}
