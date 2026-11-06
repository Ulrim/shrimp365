/** 장비가 보낸 값을 숫자로 — 숫자이거나 숫자 모양 문자열("6.8", "-2", "1e3")만 받는다.
 *  `Number()` 를 그대로 쓰면 `true` → 1, `""` → 0, `[5]` → 5, `"0x10"` → 16 이 측정값이 된다
 *  (pH true 가 pH 1 로 저장돼 위험 알림이 뜬다). 아니면 null. */
const NUMERIC_RE = /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/

export function strictNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && NUMERIC_RE.test(raw)) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}
