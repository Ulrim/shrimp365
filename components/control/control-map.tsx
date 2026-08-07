"use client"

import { useEffect, useRef } from "react"
import type { Map as LeafletMap } from "leaflet"

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
      await import("leaflet/dist/leaflet.css")
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
          .bindPopup(
            `<b>${f.name}</b> <span style="color:#64748B">· ${f.owner}</span><br>` +
            `수조 ${f.tanks}개` +
            (f.danger ? ` · <span style="color:#DC2626">위험 ${f.danger}</span>` : "") +
            (f.warning ? ` · <span style="color:#D97706">주의 ${f.warning}</span>` : "") +
            `<br>기기 ${f.devices}대` +
            (f.offline ? ` · <span style="color:#DC2626">끊김 ${f.offline}</span>` : " · 모두 정상") +
            (f.location ? `<br><span style="color:#64748B">${f.location}</span>` : "")
          )
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
