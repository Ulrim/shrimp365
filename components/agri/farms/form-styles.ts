// 농장·베드 폼이 함께 쓰는 클래스 — 수아 시안 5-8 "폼 공통 입력 클래스".
// 강조색은 brand 토큰만(농업 모드에서 녹색). ocean-* 는 쓰지 않는다.

export const INPUT_CLS =
  "bg-muted border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-brand-a50"

export const LABEL_CLS = "text-muted-foreground text-sm"

export const CTA_CLS = "bg-brand hover:bg-brand-hover text-white"

export const DIALOG_CLS = "bg-card border-border text-foreground max-w-[95vw] sm:max-w-md w-full"

/** 아이콘 전용 버튼(수정·삭제) — 44px 터치 영역. */
export const ICON_BTN_CLS =
  "p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center"

/** 필드 아래 검증 오류 한 줄(수아 시안 1-5). */
export const FIELD_ERROR_CLS = "text-xs text-red-600 dark:text-red-400"

/** `{{key}}` 자리표시자 치환 — 사전 관례. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
    template,
  )
}
