export const PLAN_LIMITS = {
  free: {
    farms: 1,
    tanksPerFarm: 5,
    aiPerDay: 5,
    sensors: 0,
    autoRefreshSec: null as number | null,
    csvExport: false,
    diagPerMonth: 3,
    reportPeriods: [7] as number[],
  },
  basic: {
    farms: 2,
    tanksPerFarm: 15,
    aiPerDay: 15,
    sensors: 1,
    autoRefreshSec: 300 as number | null,
    csvExport: false,
    diagPerMonth: 10,
    reportPeriods: [7, 30] as number[],
  },
  pro: {
    farms: 5,
    tanksPerFarm: 50,
    aiPerDay: 30,
    sensors: 5,
    autoRefreshSec: 60 as number | null,
    csvExport: true,
    diagPerMonth: Infinity,
    reportPeriods: [7, 30, 90] as number[],
  },
  enterprise: {
    farms: Infinity,
    tanksPerFarm: Infinity,
    aiPerDay: Infinity,
    sensors: Infinity,
    autoRefreshSec: 60 as number | null,
    csvExport: true,
    diagPerMonth: Infinity,
    reportPeriods: [7, 30, 90] as number[],
  },
} as const

export type Plan = keyof typeof PLAN_LIMITS

const PLAN_ORDER: Plan[] = ["free", "basic", "pro", "enterprise"]

export function canCreateFarm(plan: Plan, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].farms
}

export function canAddTank(plan: Plan, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].tanksPerFarm
}

export function canUseAI(plan: Plan, todayCount: number): boolean {
  return todayCount < PLAN_LIMITS[plan].aiPerDay
}

export function canAddSensor(plan: Plan, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[plan].sensors
}

export function isPro(plan: Plan): boolean {
  return plan === "pro" || plan === "enterprise"
}

export function isPaidPlan(plan: Plan): boolean {
  return plan !== "free"
}

export function hasExport(plan: Plan): boolean {
  return PLAN_LIMITS[plan].csvExport
}

export function nextPlan(plan: Plan): Plan | null {
  const idx = PLAN_ORDER.indexOf(plan)
  return idx < PLAN_ORDER.length - 1 ? PLAN_ORDER[idx + 1] : null
}

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
}

export const PLAN_COLORS: Record<Plan, string> = {
  free: "bg-slate-700 text-slate-300",
  basic: "bg-gradient-to-r from-sky-600 to-blue-600 text-white",
  pro: "bg-gradient-to-r from-ocean-500 to-teal-500 text-white",
  enterprise: "bg-gradient-to-r from-purple-600 to-indigo-600 text-white",
}

export const PLAN_PRICES: Record<Plan, string> = {
  free: "₩0",
  basic: "₩9,900",
  pro: "₩19,900",
  enterprise: "별도 문의",
}
