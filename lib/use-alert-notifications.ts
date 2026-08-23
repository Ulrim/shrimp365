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
 */
export function useAlertNotifications(alerts: Alert[]) {
  const permission = useSyncExternalStore(subscribePermission, readPermission, readPermissionOnServer)
  const seen = useRef<Set<string> | null>(null)
  // 첫 로드에 이미 떠 있던 알림까지 띄우면, 앱을 열 때마다 지난 알림이 쏟아진다.
  // 처음 한 번은 "본 것"으로만 기록하고 넘어간다.
  const primed = useRef(false)

  const request = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    try {
      await Notification.requestPermission()
    } catch {
      /* 사용자가 창을 닫는 등으로 실패해도 화면은 그대로 둔다. */
    }
    notifyPermissionChanged()
  }, [])

  useEffect(() => {
    if (permission !== "granted") return
    if (seen.current === null) seen.current = loadSeen()
    const remembered = seen.current

    // 정보성(info)까지 띄우면 피로해진다. 조치가 필요한 것만.
    const actionable = alerts.filter(a => a.type === "danger" || a.type === "warning")
    const fresh = actionable.filter(a => !remembered.has(a.id))
    if (fresh.length === 0) return

    fresh.forEach(a => remembered.add(a.id))
    saveSeen(remembered)

    // 첫 조회분은 기록만 하고 띄우지 않는다.
    if (!primed.current) {
      primed.current = true
      return
    }

    // 위험을 먼저 띄운다 — 상한에 걸려 잘리더라도 급한 것이 남게.
    const ordered = [...fresh].sort((a, b) => (a.type === b.type ? 0 : a.type === "danger" ? -1 : 1))
    const shown = ordered.slice(0, MAX_POPUPS)

    shown.forEach(a => {
      try {
        const popup = new Notification(
          `${a.type === "danger" ? "🔴" : "🟡"} ${a.tank_name || "수조"}`,
          {
            body: a.message,
            // 같은 알림이 여러 번 쌓이지 않게 id 로 묶는다.
            tag: `shrimp365-alert-${a.id}`,
            icon: "/icons/icon-192.png",
          },
        )
        popup.onclick = () => {
          try { window.focus() } catch { /* 포커스 실패는 무시 */ }
          popup.close()
        }
      } catch {
        // 일부 브라우저는 생성자 호출 자체를 막는다(서비스워커 필수 정책 등).
        // 기기 알림이 안 될 뿐 화면 안 알림함은 그대로 동작한다.
      }
    })

    if (ordered.length > shown.length) {
      try {
        new Notification("Shrimp365", {
          body: `그 외 ${ordered.length - shown.length}건의 알림이 더 있습니다.`,
          tag: "shrimp365-alert-overflow",
          icon: "/icons/icon-192.png",
        })
      } catch { /* 위와 같음 */ }
    }
  }, [alerts, permission])

  return { permission, request }
}
