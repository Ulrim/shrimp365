"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import type { Alert } from "@/types"

/** 기기 알림 상태.
 *  unsupported 는 브라우저가 Notification 을 아예 모르는 경우다(구형·일부 인앱 브라우저).
 *  이때는 버튼을 보여 줘도 눌러서 될 일이 없으므로 화면에서 감춘다. */
export type AlertNotifyPermission = "unsupported" | "default" | "granted" | "denied"

/** 이미 띄운 알림 id. 새로고침해도 같은 알림이 다시 뜨지 않게 브라우저에 남긴다. */
const STORAGE_KEY = "shrimp365.notified-alerts"
/** 한 번에 최대 몇 개까지 띄울지. 밤새 쌓인 알림 20건이 한꺼번에 튀어나오면 알림이 아니라 소음이다. */
const MAX_POPUPS = 3
/** 저장 목록 상한 — 무한정 쌓이지 않게 오래된 것부터 버린다. */
const MAX_REMEMBERED = 200

// ── 권한 상태 구독 ───────────────────────────────────────────────────────
//
// Notification.permission 은 리액트 밖에 있는 값이라 useState 로 들고 있으면
// "마운트 효과에서 setState" 가 되어 렌더를 한 번 더 태운다. 외부 값은
// useSyncExternalStore 로 읽는 것이 정석이고, 서버 렌더에서는 값 자체가 없으므로
// unsupported 를 돌려줘 하이드레이션 불일치도 함께 피한다.

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

// 권한을 받고도 실제로 못 띄우는 브라우저가 있다 — 안드로이드 크롬은
// new Notification() 생성자를 막고 서비스워커의 showNotification 을 요구한다.
// 이 저장소에는 서비스워커가 없다. 조용히 실패하면 화면은 "켜짐"이라 말하는데
// 알림은 평생 한 건도 안 오므로, 한 번 실패하면 그 사실을 화면까지 올린다.
let deliveryBroken = false
function readDeliverable(): boolean { return !deliveryBroken }
function readDeliverableOnServer(): boolean { return true }

/** 알림을 띄운다. 브라우저가 생성자를 막으면 false 를 돌려주고 상태를 내린다. */
function showNotification(title: string, body: string, tag: string): boolean {
  try {
    const popup = new Notification(title, { body, tag, icon: "/icons/icon-192.png" })
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
  /** 켜기 직후 확인용으로 띄우는 알림 본문. */
  enabled: string
  /** 상한을 넘은 나머지 건수 안내. {{count}} 가 숫자로 바뀐다. */
  more: string
  /** 수조 이름이 없을 때 쓸 이름. */
  tankFallback: string
}

/**
 * 새로 들어온 위험·주의 알림을 기기 알림(브라우저 알림)으로 띄운다.
 *
 * 화면 안 알림함은 사람이 앱을 보고 있어야 눈에 띈다. 새벽에 DO 가 무너지는
 * 상황에서 그건 늦다. 이 훅은 탭이 열려 있는 동안 OS 알림으로 밀어 준다.
 *
 * 한계는 분명히 해 둔다 — **브라우저 탭이 살아 있어야 한다.** 앱을 완전히
 * 닫은 뒤에도 받으려면 서버 푸시(웹푸시 + VAPID 키)나 문자 발송이 따로 필요하다.
 *
 * @param alerts 현재 미해결 알림 목록. 부모가 주기적으로 갱신해 주면 그때마다 새것을 찾는다.
 * @param texts  알림 문구 — 4개 언어 제품이므로 화면에서 번역해 넘긴다.
 */
export function useAlertNotifications(alerts: Alert[], texts: AlertNotifyTexts) {
  const permission = useSyncExternalStore(subscribePermission, readPermission, readPermissionOnServer)
  /** 권한은 있는데 이 브라우저가 실제로는 못 띄우는 상태인지. */
  const deliverable = useSyncExternalStore(subscribePermission, readDeliverable, readDeliverableOnServer)
  // 최신 문구를 담아 둔다 — 언어를 바꿔도 효과가 다시 돌지 않게.
  // 렌더 중 ref 쓰기는 금지라 효과로 넣는다(use-auto-refresh 와 같은 방식).
  const latestTexts = useRef(texts)
  useEffect(() => { latestTexts.current = texts }, [texts])
  const seen = useRef<Set<string> | null>(null)
  // 첫 로드에 이미 떠 있던 알림까지 띄우면, 앱을 열 때마다 지난 알림이 쏟아진다.
  // 처음 한 번은 "본 것"으로만 기록하고 넘어간다.
  const primed = useRef(false)

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
    // 켜자마자 확인 알림을 한 번 띄운다. 사람에게는 "켜졌다"는 확인이고,
    // 우리에게는 이 브라우저가 정말 띄울 수 있는지 확인하는 점검이다.
    if (granted) showNotification("Shrimp365", latestTexts.current.enabled, "shrimp365-enabled")
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
  }, [alerts, permission])

  return { permission, deliverable, request }
}
