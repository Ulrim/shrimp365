// 농업(스마트팜) 사전 — home 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
// 이 파일은 담당 에이전트가 채운다. 다른 섹션 파일·index.ts 는 건드리지 않는다.
import type { Locale } from "@/lib/i18n"

export interface AgriHomeDict {}

export const agriHome: Record<Locale, AgriHomeDict> = {
  ko: {},
  en: {},
  vi: {},
  id: {},
}
