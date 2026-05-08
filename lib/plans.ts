export const PLAN_LIMITS = {
  free: {
    farms: 1,
    tanksPerFarm: 5,
    aiPerDay: 5,
    sensors: 0,
    autoRefresh: false,
    csvExport: false,
    diagPerMonth: 3,
    reportPeriods: [7] as number[],
  },
  pro: {
    farms: 5,
    tanksPerFarm: 50,
    aiPerDay: 30,
    sensors: 5,
    autoRefresh: true,
    csvExport: true,
    diagPerMonth: Infinity,
    reportPeriods: [7, 30, 90] as number[],
  },
  enterprise: {
    farms: Infinity,
    tanksPerFarm: Infinity,
    aiPerDay: Infinity,
    sensors: Infinity,
    autoRefresh: true,
    csvExport: true,
    diagPerMonth: Infinity,
    reportPeriods: [7, 30, 90] as number[],
  },
} as const

export type Plan = keyof typeof PLAN_LIMITS

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

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
}

export const PLAN_COLORS: Record<Plan, string> = {
  free: "bg-slate-700 text-slate-300",
  pro: "bg-gradient-to-r from-ocean-500 to-teal-500 text-white",
  enterprise: "bg-gradient-to-r from-purple-600 to-indigo-600 text-white",
}
