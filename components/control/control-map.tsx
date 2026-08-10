"use client"

import { useEffect, useRef } from "react"
import type { Map as LeafletMap } from "leaflet"
import "leaflet/dist/leaflet.css"

export type ControlFarm = {
  id: string
  name: string
  owner: string
  location: string
  latitude: number | null
  longitude: number | null
  tanks: number
  danger: number
  warning: number
  devices: number
  offline: number
}

/** 팝업 내용을 DOM 으로 만든다. 사용자 입력(이름·주소)은 textContent 로만
 *  넣어 HTML 로 해석되지 않게 한다. 색·숫자는 코드가 만드는 값이라 그대로 쓴다. */
function buildPopup(f: ControlFarm): HTMLElement {
  const root = document.createElement("div")
  root.style.lineHeight = "1.5"

  const head = document.createElement("div")
  const name = document.createElement("b")
  name.textContent = f.name            // 사용자 입력 — 이스케이프
  head.appendChild(name)
  const owner = document.createElement("span")
  owner.style.color = "#64748B"
  owner.textContent = ` · ${f.owner}`  // 사용자 입력 — 이스케이프
  head.appendChild(owner)
  root.appendChild(head)

  const line1 = document.createElement("div")
  line1.append(`수조 ${f.tanks}개`)
  if (f.danger) {
    const s = document.createElement("span"); s.style.color = "#DC2626"
    s.textContent = ` · 위험 ${f.danger}`; line1.appendChild(s)
  }
  if (f.warning) {
    const s = document.createElement("span"); s.style.color = "#D97706"
    s.textContent = ` · 주의 ${f.warning}`; line1.appendChild(s)
  }
  root.appendChild(line1)

  const line2 = document.createElement("div")
  line2.append(`기기 ${f.devices}대`)
  if (f.offline) {
    const s = document.createElement("span"); s.style.color = "#DC2626"
    s.textContent = ` · 끊김 ${f.offline}`; line2.appendChild(s)
  } else {
    line2.append(" · 모두 정상")
  }
  root.appendChild(line2)

  if (f.location) {
    const loc = document.createElement("div")
    loc.style.color = "#64748B"
    loc.textContent = f.location        // 사용자 입력 — 이스케이프
    root.appendChild(loc)
  }
  return root
}

/** 관제센터 지도 — 플랫폼의 모든 농장을 한 판에 찍는다.
 *
 *  양식장 관리의 지도와 목적이 다르다. 저쪽은 "내 농장", 여기는 "전체 중
 *  어디가 급한가" 다. 그래서 표식이 상태를 크게 말해야 한다 — 위험 농장은
 *  크고 붉게, 기기가 끊긴 농장은 테두리를 점선으로 구분한다.
 */
export function ControlMap({ farms, height = 420 }: { farms: ControlFarm[]; height?: number }) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)

  const located = farms.filter(f => f.latitude !== null && f.longitude !== null)

  useEffect(() => {
    if (located.length === 0 || !holder.current) return
    let alive = true

    ;(async () => {
      const L = (await import("leaflet")).default
      if (!alive || !holder.current) return
      if (map.current) { map.current.remove(); map.current = null }

      const m = L.map(holder.current, { scrollWheelZoom: true, attributionControl: true })
      map.current = m

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m)

      for (const f of located) {
        const color = f.danger ? "#DC2626" : f.warning ? "#D97706" : "#10B981"
        L.circleMarker([f.latitude!, f.longitude!], {
          // 급한 곳일수록 크게 — 축소해서 봐도 위험 농장이 먼저 보인다.
          radius: f.danger ? 13 : f.warning ? 11 : 9,
          color,
          fillColor: color,
          fillOpacity: 0.5,
          weight: 2,
          // 기기가 끊긴 농장은 점선 — "지금 값이 안 오고 있다" 는 표시.
          dashArray: f.offline > 0 ? "4 4" : undefined,
        })
          .addTo(m)
          // 팝업은 DOM 노드로 조립한다. 농장명·소유자명·주소는 일반 사용자가
          // 자유 입력하는 값이라, HTML 문자열로 이어 붙이면 저장형 XSS 가 된다.
          // 관제센터는 최고 권한 사용자가 여는 화면이므로, 그 세션에서 남의
          // 스크립트가 도는 순간 권한 탈취로 이어진다. 사용자 값은 textContent
          // 로만 넣고, 숫자·색은 코드가 만드는 것이라 안전하다.
          .bindPopup(buildPopup(f))
      }

      const bounds = L.latLngBounds(located.map(f => [f.latitude!, f.longitude!] as [number, number]))
      if (located.length === 1) m.setView(bounds.getCenter(), 12)
      else m.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
    })()

    return () => {
      alive = false
      if (map.current) { map.current.remove(); map.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.map(f => `${f.id}:${f.latitude},${f.longitude}:${f.danger}:${f.warning}:${f.offline}`).join("|")])

  if (located.length === 0) {
    return (
      <div
        className="w-full rounded-xl border border-border bg-muted flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        좌표가 등록된 농장이 없습니다. 농가가 양식장 관리에서 좌표를 넣으면 여기에 표시됩니다.
      </div>
    )
  }

  return (
    <div className="relative">
      <div ref={holder} style={{ height }} className="w-full rounded-xl overflow-hidden bg-muted" role="img" aria-label="전체 농장 관제 지도" />
      {/* 범례 — 관제 화면은 교대 근무자도 본다. 색의 뜻을 화면에 적어 둔다. */}
      <div className="absolute bottom-3 left-3 z-[500] rounded-lg bg-card/95 border border-border px-3 py-2 text-[11px] leading-relaxed shadow">
        <span className="inline-flex items-center gap-1 mr-3"><i className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> 정상</span>
        <span className="inline-flex items-center gap-1 mr-3"><i className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> 주의</span>
        <span className="inline-flex items-center gap-1 mr-3"><i className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> 위험</span>
        <span className="text-muted-foreground">점선 = 기기 끊김</span>
      </div>
    </div>
  )
}
