/*
 * datetime-local(<input>) ↔ ISO8601 UTC 변환 유틸.
 * 입력 폼은 로컬 시각을 보여주고, API에는 UTC ISO를 보낸다(백엔드 계약).
 * 순수 함수(부작용 없음). now() 사용은 UI 기본값 산정에 한정한다.
 */

/** 현재 로컬 시각을 <input type="datetime-local"> value(YYYY-MM-DDTHH:mm)로. */
export function nowLocalInputValue(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/** datetime-local 값(로컬 시각) → ISO8601 UTC. 유효하지 않으면 null. */
export function localInputToIsoUtc(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // datetime-local은 로컬 시간대로 파싱됨
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO 문자열 → 로컬 표시(ko-KR). 파싱 실패 시 원문 반환. */
export function formatIsoLocal(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
