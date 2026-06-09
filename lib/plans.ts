// All features are free & unlimited — monetization via advertising
const UNLIMITED = {
  farms: Infinity,
  tanksPerFarm: Infinity,
  aiPerHour: Infinity,
  sensors: Infinity,
  autoRefreshSec: 60 as number | null,
  csvExport: true,
  diagPerMonth: Infinity,
  reportPeriods: [7, 30, 90] as number[],
} as const

export const PLAN_LIMITS = {
  free: UNLIMITED,
  basic: UNLIMITED,
  pro: UNLIMITED,
  enterprise: UNLIMITED,
} as const

export type Plan = keyof typeof PLAN_LIMITS

export function canCreateFarm(_plan: Plan, _currentCount: number): boolean { return true }
export function canAddTank(_plan: Plan, _currentCount: number): boolean { return true }
export function canUseAI(_plan: Plan, _hourCount: number): boolean { return true }
export function canAddSensor(_plan: Plan, _currentCount: number): boolean { return true }
export function isPro(_plan: Plan): boolean { return true }
export function isPaidPlan(_plan: Plan): boolean { return true }
export function hasExport(_plan: Plan): boolean { return true }
export function nextPlan(_plan: Plan): Plan | null { return null }

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  basic: "Free",
  pro: "Free",
  enterprise: "Free",
}

export const PLAN_COLORS: Record<Plan, string> = {
  free: "bg-gradient-to-r from-ocean-500 to-teal-500 text-white",
  basic: "bg-gradient-to-r from-ocean-500 to-teal-500 text-white",
  pro: "bg-gradient-to-r from-ocean-500 to-teal-500 text-white",
  enterprise: "bg-gradient-to-r from-ocean-500 to-teal-500 text-white",
}

export const PLAN_PRICES: Record<Plan, string> = {
  free: "Free",
  basic: "Free",
  pro: "Free",
  enterprise: "Free",
}
