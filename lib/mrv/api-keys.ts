/**
 * 장비 수집 키(`mrv_api_keys`)를 읽을 때의 공통 규약.
 *
 * 열 목록을 라우트 두 곳(목록·폐기)이 공유하게 따로 둔다. 한쪽이 `select("*")` 로
 * 바뀌는 날 `key_hash` 가 브라우저에 실리는데, 그건 폐기 기능을 만든 이유를 지우는 일이다
 * — 목록을 열 수 있는 사람이 장비가 될 수 있으면 끊어도 끊은 것이 아니다.
 * (원문 키는 애초에 저장되지 않고 해시만 있다. 그 해시도 내보내지 않는다 — 사전 공격의
 * 재료이고 화면이 쓸 일이 없다.)
 */

/** 응답에 싣는 열. `key_hash` 가 없는 것이 이 상수의 요점이다. */
export const API_KEY_COLUMNS =
  "id, site_id, label, revoked, created_at, last_used_at, revoked_at, revoked_by"

export type ApiKeyRow = {
  id: string
  site_id: string
  label: string | null
  revoked: boolean
  created_at: string
  /**
   * 마지막으로 인증을 통과한 시각. 매 요청이 아니라 몇 분에 한 번만 갱신된다
   * (`lib/mrv/device-auth.ts` 의 `LAST_USED_REFRESH_MS`) — 분 단위 정확도를 가정하지 말 것.
   */
  last_used_at: string | null
  /**
   * 끊은 시각. `revoked=true` 인데 비어 있으면 폐기 창구가 생기기 전에 SQL 직접 수정으로
   * 끊긴 행이며, 끊긴 시각을 아는 기록이 없다는 뜻이다(추정값으로 메우지 않는다).
   */
  revoked_at: string | null
  revoked_by: string | null
}
