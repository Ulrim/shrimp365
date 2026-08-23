"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import type { Alert } from "@/types"

/** 기기 알림 상태.
 *  unsupported 는 브라우저가 Notification 을 아예 모르는 경우다(구형·일부 인앱 브라우저).
 *  이때는 버튼을 보여 줘도 눌러서 될 일이 없으므로 화면에서 감춘다. */
export type AlertNotifyPermission = "unsupported" | "default" | "granted" | "denied"

/** 서버 푸시(웹푸시) 구독 상태.
 *  unknown 은 아직 확인 중이라는 뜻이다 — 이 동안에는 인탭 알림을 띄우지 않는다.
 *  띄웠다가 곧바로 서버 푸시가 같은 알림을 한 번 더 띄우면 두 번 뜬다. */
export type AlertPushState = "unknown" | "off" | "on"

/** 이미 띄운 알림 id. 새로고침해도 같은 알림이 다시 뜨지 않게 브라우저에 남긴다. */
const STORAGE_KEY = "shrimp365.notified-alerts"
/** 한 번에 최대 몇 개까지 띄울지. 밤새 쌓인 알림 20건이 한꺼번에 튀어나오면 알림이 아니라 소음이다. */
const MAX_POPUPS = 3
/** 저장 목록 상한 — 무한정 쌓이지 않게 오래된 것부터 버린다. */
const MAX_REMEMBERED = 200

/** 서버가 푸시를 서명할 때 쓰는 공개키. 없으면 서버 푸시 자체가 꺼진 배포다
 *  (VAPID 키를 아직 안 넣은 상태) — 그때는 지금까지처럼 인탭 알림으로 간다. */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""

const SW_URL = "/sw.js"
const ICON = "/icons/icon-192.png"

// ── 권한 상태 구독 ───────────────────────────────────────────────────────
//
// Notification.permission 은 리액트 밖에 있는 값이라 useState 로 들고 있으면
// "마운트 효과에서 setState" 가 되어 렌더를 한 번 더 태운다. 외부 값은
// useSyncExternalStore 로 읽는 것이 정석이고, 서버 렌더에서는 값 자체가 없으므로
// unsupported 를 돌려줘 하이드레이션 불일치도 함께 피한다.
//
// 푸시 구독 상태도 같은 성격(브라우저가 들고 있는 값)이라 같은 구독을 쓴다.

const permissionListeners = new Set<() => void>()

function subscribePermission(onChange: () => void) {
  permissionListeners.add(onChange)
  return () => { permissionListeners.delete(onChange) }
}

/** 권한이 바뀐 뒤 구독자에게 다시 읽으라고 알린다. */
function notifyPermissionChanged() {
  permissionListeners.forEach(l => l())
}

function readPermission(): AlertNotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  return Notification.permission as AlertNotifyPermission
}

function readPermissionOnServer(): AlertNotifyPermission {
  return "unsupported"
}

// ── 서버 푸시(웹푸시) ────────────────────────────────────────────────────
//
// 인탭 알림의 한계는 분명하다 — 탭이 살아 있어야 뜬다. 새벽에 DO 가 무너지는
// 그 순간에 앱은 닫혀 있다. 서비스워커 + 서버 푸시가 그 구멍을 메운다.

let pushState: AlertPushState = "unknown"
/** 확인을 한 번만 돌리기 위한 표시. 헤더 말고 다른 곳에서 훅을 또 써도 중복 안 되게. */
let pushProbeStarted = false

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    VAPID_PUBLIC_KEY !== ""
  )
}

function readPushState(): AlertPushState {
  // 지원하지 않거나 공개키가 없는 배포에서는 확인할 것도 없다.
  if (!pushSupported()) return "off"
  return pushState
}

function readPushStateOnServer(): AlertPushState {
  return "off"
}

function setPushState(next: AlertPushState) {
  if (pushState === next) return
  pushState = next
  notifyPermissionChanged()
}

/** VAPID 공개키(base64url) → subscribe 가 요구하는 바이트 배열.
 *  반환 타입을 Uint8Array<ArrayBuffer> 로 못 박는 이유: 기본 Uint8Array 는
 *  ArrayBufferLike(SharedArrayBuffer 포함)라 BufferSource 에 대입되지 않는다. */
function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** 이미 있는 구독이 지금의 VAPID 공개키로 만들어진 것인지.
 *  키를 바꾼 뒤에도 옛 구독을 그대로 쓰면 서버 발송이 매번 403 으로 실패한다. */
function matchesCurrentKey(sub: PushSubscription): boolean {
  const raw = sub.options?.applicationServerKey
  if (!raw) return false
  try {
    const bytes = new Uint8Array(raw)
    let binary = ""
    for (const b of bytes) binary += String.fromCharCode(b)
    const b64url = window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    return b64url === VAPID_PUBLIC_KEY.replace(/=+$/, "")
  } catch {
    return false
  }
}

/**
 * 서비스워커를 등록하고 푸시를 구독해 서버에 저장한다.
 * 어느 단계에서 실패하든 false 를 돌려주고, 호출한 쪽은 인탭 방식으로 폴백한다.
 */
async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const registration = await navigator.serviceWorker.register(SW_URL)
    // register() 는 곧바로 돌아오지만 pushManager 는 활성 워커가 있어야 쓸 수 있다.
    await navigator.serviceWorker.ready

    let sub = await registration.pushManager.getSubscription()
    if (sub && !matchesCurrentKey(sub)) {
      // 키가 바뀐 구독은 살려 둬도 서버가 못 보낸다. 버리고 새로 만든다.
      try { await sub.unsubscribe() } catch { /* 실패해도 아래에서 다시 시도 */ }
      sub = null
    }
    if (!sub) {
      sub = await registration.pushManager.subscribe({
        // 푸시를 받으면 반드시 눈에 보이는 알림을 띄우겠다는 약속.
        // 크롬은 이 값이 true 가 아니면 구독 자체를 거부한다.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    })
    // 서버가 저장하지 못했으면(마이그레이션 전·비로그인 등) 구독은 있어도
    // 발송할 곳을 모른다. 켜졌다고 말하면 안 된다.
    return res.ok
  } catch {
    return false
  }
}

/** 페이지가 열릴 때 이 기기가 이미 푸시를 받고 있는지 확인한다. */
async function probePush(): Promise<void> {
  if (!pushSupported()) {
    setPushState("off")
    return
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const existing = registration ? await registration.pushManager.getSubscription() : null
    if (existing && matchesCurrentKey(existing)) {
      setPushState("on")
      return
    }
    // 권한을 이미 받아 둔 기기인데 구독만 사라진 경우가 있다(브라우저가 오래된
    // 구독을 정리하거나 키가 바뀐 경우). 조용히 다시 구독한다 — 권한 창은
    // 뜨지 않으므로 사용자를 방해하지 않는다. 이걸 안 하면 화면은 "켜짐"인데
    // 앱을 닫으면 한 건도 안 오는 상태로 조용히 되돌아간다.
    if (readPermission() === "granted") {
      setPushState((await enablePush()) ? "on" : "off")
      return
    }
    setPushState("off")
  } catch {
    setPushState("off")
  }
}

// 권한을 받고도 실제로 못 띄우는 브라우저가 있다 — 안드로이드 크롬은
// new Notification() 생성자를 막고 서비스워커의 showNotification 을 요구한다.
// 서버 푸시가 붙어 있으면 그 경로로 뜨므로 이 표시는 의미가 없다.
// 조용히 실패하면 화면은 "켜짐"이라 말하는데 알림은 평생 한 건도 안 오므로,
// 푸시도 없이 한 번 실패하면 그 사실을 화면까지 올린다.
let deliveryBroken = false
function readDeliverable(): boolean { return pushState === "on" || !deliveryBroken }
function readDeliverableOnServer(): boolean { return true }

/** 알림을 띄운다. 브라우저가 생성자를 막으면 false 를 돌려주고 상태를 내린다. */
function showNotification(title: string, body: string, tag: string): boolean {
  try {
    const popup = new Notification(title, { body, tag, icon: ICON })
    popup.onclick = () => {
      try { window.focus() } catch { /* 포커스 실패는 무시 */ }
      popup.close()
    }
    return true
  } catch {
    if (!deliveryBroken) {
      deliveryBroken = true
      notifyPermissionChanged()
    }
    return false
  }
}

function loadSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set()
  } catch {
    // 시크릿 모드·저장 차단 환경에서는 읽기 자체가 throw 한다. 기억을 못 할 뿐 기능은 돈다.
    return new Set()
  }
}

function saveSeen(seen: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen].slice(-MAX_REMEMBERED)))
  } catch {
    /* 저장 실패는 조용히 넘긴다 — 다음 새로고침에 한 번 더 뜰 뿐이다. */
  }
}

export interface AlertNotifyTexts {
  /** 켜기 직후 확인용으로 띄우는 알림 본문(인탭 방식). */
  enabled: string
  /** 서버 푸시까지 붙었을 때의 확인 문구 — 앱을 닫아도 온다는 사실을 알린다. */
  pushEnabled: string
  /** 상한을 넘은 나머지 건수 안내. {{count}} 가 숫자로 바뀐다. */
  more: string
  /** 수조 이름이 없을 때 쓸 이름. */
  tankFallback: string
}

/**
 * 새로 들어온 위험·주의 알림을 기기 알림으로 띄운다.
 *
 * 화면 안 알림함은 사람이 앱을 보고 있어야 눈에 띈다. 새벽에 DO 가 무너지는
 * 상황에서 그건 늦다.
 *
 * 전달 경로는 두 가지이고, 우선순위가 있다.
 *   1. **서버 푸시**(서비스워커 + VAPID) — 앱을 완전히 닫아도 온다.
 *      안드로이드 크롬처럼 new Notification() 을 막는 단말에서도 유일하게 뜬다.
 *      VAPID 공개키가 있고 구독에 성공했을 때만 켜진다.
 *   2. **인탭 알림** — 1번이 안 될 때의 폴백. 탭이 살아 있어야 뜬다.
 *
 * 둘이 동시에 돌면 같은 알림이 두 번 뜨므로, 푸시가 살아 있으면 인탭 알림은
 * 건너뛴다(그래도 "본 것" 기록은 남긴다 — 나중에 푸시가 꺼져도 지난 알림이
 * 쏟아지지 않게).
 *
 * @param alerts 현재 미해결 알림 목록. 부모가 주기적으로 갱신해 주면 그때마다 새것을 찾는다.
 * @param texts  알림 문구 — 4개 언어 제품이므로 화면에서 번역해 넘긴다.
 */
export function useAlertNotifications(alerts: Alert[], texts: AlertNotifyTexts) {
  const permission = useSyncExternalStore(subscribePermission, readPermission, readPermissionOnServer)
  /** 권한은 있는데 이 브라우저가 실제로는 못 띄우는 상태인지. */
  const deliverable = useSyncExternalStore(subscribePermission, readDeliverable, readDeliverableOnServer)
  /** 서버 푸시 구독 상태. */
  const push = useSyncExternalStore(subscribePermission, readPushState, readPushStateOnServer)
  // 최신 문구를 담아 둔다 — 언어를 바꿔도 효과가 다시 돌지 않게.
  // 렌더 중 ref 쓰기는 금지라 효과로 넣는다(use-auto-refresh 와 같은 방식).
  const latestTexts = useRef(texts)
  useEffect(() => { latestTexts.current = texts }, [texts])
  const seen = useRef<Set<string> | null>(null)
  // 첫 로드에 이미 떠 있던 알림까지 띄우면, 앱을 열 때마다 지난 알림이 쏟아진다.
  // 처음 한 번은 "본 것"으로만 기록하고 넘어간다.
  const primed = useRef(false)

  // 이 기기가 이미 푸시를 받고 있는지 한 번 확인한다.
  // 상태 갱신은 프로미스 안에서 일어난다 — 효과 본문에서 동기 setState 를 하면
  // 렌더가 한 번 더 돈다(react-compiler 규칙도 그것을 막는다).
  useEffect(() => {
    if (pushProbeStarted) return
    pushProbeStarted = true
    void probePush()
  }, [])

  const request = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    let granted = false
    try {
      // requestPermission 은 await 이전에 동기 호출해야 사용자 제스처로 인정된다.
      granted = (await Notification.requestPermission()) === "granted"
    } catch {
      /* 사용자가 창을 닫는 등으로 실패해도 화면은 그대로 둔다. */
    }
    notifyPermissionChanged()
    if (!granted) return

    // 권한을 받았으면 먼저 서버 푸시를 시도한다. 이게 붙어야 앱을 닫은 뒤에도 온다.
    const pushed = await enablePush()
    setPushState(pushed ? "on" : "off")

    // 켜자마자 확인 알림을 한 번 띄운다. 사람에게는 "켜졌다"는 확인이고,
    // 우리에게는 이 기기가 정말 알림을 띄울 수 있는지 확인하는 점검이다.
    if (pushed) {
      // 확인 알림도 서비스워커로 띄운다. 여기서 new Notification() 을 쓰면
      // 안드로이드 크롬에서 예외가 나 deliveryBroken 이 서고, 푸시는 멀쩡한데
      // 화면에는 "이 브라우저는 알림을 못 띄운다"는 거짓말이 뜬다.
      try {
        const registration = await navigator.serviceWorker.ready
        await registration.showNotification("Shrimp365", {
          body: latestTexts.current.pushEnabled,
          tag: "shrimp365-enabled",
          icon: ICON,
          badge: ICON,
        })
      } catch { /* 확인 알림이 안 떠도 구독 자체는 살아 있다 */ }
      return
    }

    // 푸시가 안 되는 환경 — 지금까지 하던 인탭 방식 그대로.
    showNotification("Shrimp365", latestTexts.current.enabled, "shrimp365-enabled")
  }, [])

  useEffect(() => {
    if (permission !== "granted") return
    // 이 브라우저가 못 띄우는 것이 이미 드러났으면 매 주기 헛시도하지 않는다.
    // 화면에는 deliverable=false 로 사실이 표시되고 있다.
    if (!readDeliverable()) return
    if (seen.current === null) seen.current = loadSeen()
    const remembered = seen.current

    // 정보성(info)까지 띄우면 피로해진다. 조치가 필요한 것만.
    const actionable = alerts.filter(a => a.type === "danger" || a.type === "warning")
    // 첫 조회인지 먼저 확정한다. 아래 조기 반환보다 뒤에 두면, 처음 열었을 때
    // 새 알림이 없던 경우 primed 가 서지 않아 **그다음에 온 진짜 첫 알림을 삼킨다.**
    const firstPass = !primed.current
    primed.current = true

    const fresh = actionable.filter(a => !remembered.has(a.id))
    if (fresh.length === 0) return

    // 첫 조회분은 기록만 하고 띄우지 않는다 — 앱을 열 때마다 지난 알림이 쏟아지지 않게.
    if (firstPass) {
      fresh.forEach(a => remembered.add(a.id))
      saveSeen(remembered)
      return
    }

    // 푸시 구독 여부를 아직 확인하는 중이다. 여기서 띄우면 잠시 뒤 서버 푸시가
    // 같은 알림을 한 번 더 띄운다. 기록을 남기지 않으므로 확인이 끝난 다음
    // 주기에 다시 후보가 된다 — 놓치지는 않는다.
    if (push === "unknown") return

    // 서버 푸시가 살아 있으면 서버가 이미 보냈다. 인탭으로 또 띄우지 않는다.
    // "본 것" 기록은 남긴다 — 나중에 푸시가 꺼져도 지난 알림이 쏟아지지 않게.
    if (push === "on") {
      fresh.forEach(a => remembered.add(a.id))
      saveSeen(remembered)
      return
    }

    // 위험을 먼저 띄운다 — 상한에 걸려 잘리더라도 급한 것이 남게.
    const ordered = [...fresh].sort((a, b) => (a.type === b.type ? 0 : a.type === "danger" ? -1 : 1))
    const shown = ordered.slice(0, MAX_POPUPS)
    const { more, tankFallback } = latestTexts.current

    // 띄운 것만 "본 것"으로 남긴다. 상한에 걸려 못 띄운 건은 기록하지 않아야
    // 다음 주기에 다시 후보가 된다(초판은 전부 기록해 영영 안 뜨게 만들었다).
    shown.forEach(a => {
      const shownOk = showNotification(
        `${a.type === "danger" ? "🔴" : "🟡"} ${a.tank_name || tankFallback}`,
        a.message,
        `shrimp365-alert-${a.id}`,
      )
      if (shownOk) {
        remembered.add(a.id)
      }
    })
    saveSeen(remembered)

    if (ordered.length > shown.length) {
      showNotification("Shrimp365", more.replace("{{count}}", String(ordered.length - shown.length)), "shrimp365-alert-overflow")
    }
  }, [alerts, permission, push])

  return { permission, deliverable, request, pushActive: push === "on" }
}
