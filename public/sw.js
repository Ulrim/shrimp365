/* Shrimp365 서비스워커 — 웹푸시 전용.
 *
 * 하는 일은 두 가지뿐이다.
 *   1) 서버가 보낸 푸시를 OS 알림으로 띄운다.
 *   2) 사람이 그 알림을 누르면 해당 수조 화면을 연다.
 *
 * fetch 핸들러는 일부러 두지 않는다. 여기에 캐싱을 붙이는 순간 앱의 모든
 * 네트워크 요청이 이 파일을 거치게 되고, 로그인 세션·수질 데이터까지 오래된
 * 사본이 나갈 수 있다. 캐싱이 필요해지면 별도 워커로 분리할 것.
 *
 * 이 파일이 존재해야 하는 진짜 이유:
 *   · 탭을 닫아도 알림이 온다. 새벽에 DO 가 무너질 때 앱은 닫혀 있다.
 *   · 안드로이드 크롬은 new Notification() 생성자를 아예 막고 서비스워커의
 *     showNotification 을 요구한다. 양식장 운영자 주력 단말이 그쪽이다.
 */

const DEFAULT_TITLE = "Shrimp365"
const DEFAULT_BODY = "수질 이상 알림이 도착했습니다."
const DEFAULT_URL = "/water-quality"
const ICON = "/icons/icon-192.png"

self.addEventListener("install", () => {
  // 새 워커를 곧바로 적용한다. 알림 처리 코드를 고쳤는데 옛 워커가 남아 있으면
  // 고친 내용이 다음 방문까지 반영되지 않는다.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  // 이미 열려 있는 탭까지 이 워커가 관장하게 한다. notificationclick 에서
  // 그 탭을 찾아 이동시키려면 제어권이 있어야 한다.
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  // 페이로드는 서버가 만든 JSON 이지만, 형식이 어긋나거나 본문 없는 푸시가
  // 올 수 있다(푸시 서비스가 재전송하며 본문을 떨구는 경우도 있다).
  // 파싱 실패로 알림을 통째로 버리면 정작 급한 순간에 아무것도 안 뜬다.
  let payload = {}
  if (event.data) {
    try {
      payload = event.data.json() || {}
    } catch {
      // JSON 이 아니면 원문이라도 본문으로 살린다.
      try {
        const text = event.data.text()
        if (text) payload = { body: text }
      } catch {
        /* 원문도 못 읽으면 아래 기본 문구로 간다 */
      }
    }
  }
  if (typeof payload !== "object" || payload === null) payload = {}

  const title = typeof payload.title === "string" && payload.title ? payload.title : DEFAULT_TITLE
  const body = typeof payload.body === "string" && payload.body ? payload.body : DEFAULT_BODY
  // 열 주소는 반드시 우리 앱 안의 경로여야 한다. 푸시 본문을 그대로 믿고
  // 외부 주소나 javascript: 를 열지 않게 앞의 "/" 하나로 못 박는다("//호스트" 제외).
  const url =
    typeof payload.url === "string" && /^\/(?!\/)/.test(payload.url) ? payload.url : DEFAULT_URL
  // tag 가 같으면 새 알림이 옛 알림을 덮어쓴다. 같은 수조·같은 항목 알림이
  // 밤새 스무 개 쌓이는 것을 막는다.
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : `shrimp365-${url}`

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: ICON,
      tag,
      data: { url },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data
  const url = data && typeof data.url === "string" ? data.url : DEFAULT_URL

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      // 이미 열린 창이 있으면 그 창을 쓴다. 누를 때마다 새 탭이 열리면
      // 새벽에 알림 몇 개 확인하고 나서 탭이 열 개가 되어 있다.
      for (const client of windows) {
        if (!("focus" in client)) continue
        try {
          await client.navigate(new URL(url, self.location.origin).href)
        } catch {
          /* 제어하지 않는 창은 navigate 가 막힌다 — 포커스만 줘도 앱은 보인다 */
        }
        return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })()
  )
})
