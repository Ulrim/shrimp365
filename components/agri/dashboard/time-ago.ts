// "3분 전" 같은 상대 시각 — 기존 `t.time` 사전(4개 언어)을 그대로 쓴다.
// sensors/device-current-values.tsx 의 seenLabel 과 같은 규칙이되, 그쪽은 파일 내부
// 함수라 import 할 수 없어 농업 대시보드 몫을 여기 둔다.
import type { Dict } from "@/lib/i18n"

export function agoLabel(time: Dict["time"], iso: string | null | undefined): string {
  if (!iso) return ""
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return time.justNow
  if (mins < 60) return time.minutesAgo.replace("{{n}}", String(mins))
  const h = Math.floor(mins / 60)
  if (h < 24) return time.hoursAgo.replace("{{n}}", String(h))
  return time.daysAgo.replace("{{n}}", String(Math.floor(h / 24)))
}
