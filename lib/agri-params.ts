// 농업(스마트팜) 측정 항목 6개의 메타 한 벌 — 설계서 mode-split.md 5-1.
//
// 농업 뷰(components/agri/**)가 탭 순서·단위·소수 자리·차트 색을 여기서 읽는다.
// 항목 이름(라벨)은 사전(`useAgriT().common.param[dictKey]`)에 있고 여기엔 없다 —
// 이 파일은 "use client" 가 아니라 서버·테스트에서도 그대로 쓸 수 있다.
//
// 값의 단위 규약:
//   conductivity 는 DB(µS/cm) 저장값을 받아 화면에서 mS/cm 로 보인다(÷1000).
//   그 밖은 저장값 그대로다.
// 0 의 뜻(미측정인가 실측인가)은 `agriIsMissing` 한 곳에 맡긴다 — 유량 0 은 펌프 정지.
import { Zap, Droplets, ThermometerSun, Wind, Waves, Gauge } from "lucide-react"
import type { IconComponent } from "@/types"
import type { AgriDict } from "@/lib/i18n/agri"
import { agriIsMissing } from "@/lib/agri-standards"

/** water_quality_readings 의 컬럼 키. */
export type AgriParamKey =
  | "conductivity"
  | "ph"
  | "temperature"
  | "do_level"
  | "flow_rate"
  | "diff_pressure"

/** `AgriCommonDict.param` / `AgriCommonDict.unit` 의 키. */
export type AgriParamDictKey = "ec" | "ph" | "temperature" | "do" | "flowRate" | "diffPressure"

export interface AgriParam {
  key: AgriParamKey
  dictKey: AgriParamDictKey
  /** 화면 단위 기호. */
  unit: string
  /** 소수 자리. */
  digits: number
  /** 저장값 × scale = 화면값. EC 만 1/1000(µS/cm → mS/cm). */
  scale: number
  /** 차트·타일 강조색(hex). 상태색(emerald/amber/red)과 겹치지 않게 골랐다. */
  color: string
  /** 타일·탭·입력 폼이 공유하는 아이콘(수아 시안 3-4) — 세 화면이 각자 들고 다니지 않게. */
  icon: IconComponent
}

/** 양액 관리 탭 순서이기도 하다 — EC(기본) → pH → 양액 온도 → DO → 유량 → 차압. */
export const AGRI_PARAMS: readonly AgriParam[] = [
  { key: "conductivity",  dictKey: "ec",           unit: "mS/cm", digits: 2, scale: 1 / 1000, color: "#0ea5e9", icon: Zap },
  { key: "ph",            dictKey: "ph",           unit: "",      digits: 2, scale: 1,        color: "#8b5cf6", icon: Droplets },
  { key: "temperature",   dictKey: "temperature",  unit: "°C",    digits: 1, scale: 1,        color: "#f59e0b", icon: ThermometerSun },
  { key: "do_level",      dictKey: "do",           unit: "ppm",   digits: 1, scale: 1,        color: "#14b8a6", icon: Wind },
  { key: "flow_rate",     dictKey: "flowRate",     unit: "L/min", digits: 1, scale: 1,        color: "#6366f1", icon: Waves },
  { key: "diff_pressure", dictKey: "diffPressure", unit: "kPa",   digits: 1, scale: 1,        color: "#f43f5e", icon: Gauge },
] as const

const BY_KEY: Record<AgriParamKey, AgriParam> = Object.fromEntries(
  AGRI_PARAMS.map(p => [p.key, p]),
) as Record<AgriParamKey, AgriParam>

/** 키로 메타 하나를 꺼낸다. */
export const agriParam = (key: AgriParamKey): AgriParam => BY_KEY[key]

/** 저장값 → 화면 숫자(스케일만 적용, 반올림 없음). 미측정이면 null. */
export function agriDisplayValue(key: AgriParamKey, value: number | null | undefined): number | null {
  if (agriIsMissing(key, value)) return null
  return (value as number) * BY_KEY[key].scale
}

/** 저장값 → 화면 문자열. 미측정이면 `"—"`, 아니면 항목 소수 자리로 고정한 숫자.
 *  단위는 붙이지 않는다 — 타일·표가 단위 위치를 각자 정한다(`agriParam(key).unit`). */
export function agriFormat(key: AgriParamKey, value: number | null | undefined): string {
  const v = agriDisplayValue(key, value)
  return v == null ? "—" : v.toFixed(BY_KEY[key].digits)
}

/** 차트 y 값용 별칭 — `agriDisplayValue` 와 같다(시안 3-4 의 이름). */
export const agriScaled = agriDisplayValue

/** 항목 이름. 사전은 화면 쪽(useAgriT) 에서 받아 넘긴다. */
export function agriParamLabel(d: AgriDict, key: AgriParamKey): string {
  return d.common.param[BY_KEY[key].dictKey]
}
