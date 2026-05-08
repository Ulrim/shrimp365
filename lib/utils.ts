import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

export function formatDateTime(date: string | Date) {
  return new Date(date).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function getStatusColor(value: number, normal: [number, number], warning: [number, number]): "normal" | "warning" | "danger" {
  if (value >= normal[0] && value <= normal[1]) return "normal"
  if (value >= warning[0] && value <= warning[1]) return "warning"
  return "danger"
}

// 수질 파라미터 물리적 유효 범위
export const WQ_BOUNDS = {
  temperature:    { min: 0,   max: 45,   label: "수온",      unit: "°C" },
  ph:             { min: 0,   max: 14,   label: "pH",        unit: "" },
  do_level:       { min: 0,   max: 25,   label: "DO",        unit: "mg/L" },
  salinity:       { min: 0,   max: 45,   label: "염도",      unit: "ppt" },
  ammonia:        { min: 0,   max: 50,   label: "암모니아",  unit: "mg/L" },
  nitrite:        { min: 0,   max: 50,   label: "아질산염",  unit: "mg/L" },
  nitrate:        { min: 0,   max: 200,  label: "질산염",    unit: "mg/L" },
  alkalinity:     { min: 0,   max: 500,  label: "알칼리도",  unit: "mg/L" },
  turbidity:      { min: 0,   max: 500,  label: "탁도",      unit: "NTU" },
} as const

export type WqField = keyof typeof WQ_BOUNDS

export function validateWqField(field: WqField, value: number): string | null {
  const b = WQ_BOUNDS[field]
  if (!Number.isFinite(value)) return `${b.label}: 유효한 숫자를 입력해주세요.`
  if (value < b.min || value > b.max) return `${b.label}: ${b.min}~${b.max}${b.unit} 범위를 벗어났습니다.`
  return null
}

export function clampWqField(field: WqField, value: number): number {
  const b = WQ_BOUNDS[field]
  return Math.min(Math.max(value, b.min), b.max)
}
