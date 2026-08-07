"use client"

import { useEffect, useRef } from "react"
import type { Map as LeafletMap } from "leaflet"
import { MapPin } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Farm, Tank } from "@/types"

type Status = Tank["status"]

const STATUS_COLOR: Record<Status, string> = {
  active: "#10B981", warning: "#D97706", danger: "#DC2626", inactive: "#64748B",
}

/** 양식장을 지도에 찍는다.
 *
 *  OpenStreetMap 타일을 쓴다 — 키가 필요 없고 무료다. 지도 제공자 계정을
 *  만들지 않아도 되므로 해외 농가까지 그대로 서비스된다.
 *
 *  Leaflet 은 브라우저 전용(window·document 를 직접 쓴다)이라 서버에서
 *  불러오면 터진다. 그래서 effect 안에서 동적으로 가져온다.
 */
export function FarmMap({ farms, tanks }: { farms: Farm[]; tanks: Tank[] }) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)

  const located = farms.filter(f => f.latitude !== null && f.longitude !== null)

  useEffect(() => {
    if (located.length === 0 || !holder.current) return
    let alive = true

    ;(async () => {
      const L = (await import("leaflet")).default
      // CSS 도 함께 가져온다. 없으면 타일이 어긋나 붙는다.
      await import("leaflet/dist/leaflet.css")
      if (!alive || !holder.current) return

      // Strict Mode 가 effect 를 두 번 부르면 같은 자리에 두 번 만들어 터진다.
      if (map.current) { map.current.remove(); map.current = null }

      const m = L.map(holder.current, { scrollWheelZoom: false, attributionControl: true })
      map.current = m

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m)

      for (const farm of located) {
        const own = tanks.filter(tk => tk.farm_id === farm.id)
        const bad = own.filter(tk => tk.status === "danger").length
        const warn = own.filter(tk => tk.status === "warning").length
        // 농장 단위로 가장 나쁜 수조 상태를 색으로 쓴다. 지도에서 급한 곳이
        // 먼저 눈에 들어와야 한다.
        const worst: Status = bad ? "danger" : warn ? "warning" : own.length ? "active" : "inactive"

        L.circleMarker([farm.latitude!, farm.longitude!], {
          radius: 10,
          color: STATUS_COLOR[worst],
          fillColor: STATUS_COLOR[worst],
          fillOpacity: 0.55,
          weight: 2,
        })
          .addTo(m)
          .bindPopup(
            `<b>${farm.name}</b><br>수조 ${own.length}개` +
            (bad ? ` · <span style="color:#DC2626">위험 ${bad}</span>` : "") +
            (warn ? ` · <span style="color:#D97706">주의 ${warn}</span>` : "") +
            (farm.location ? `<br><span style="color:#64748B">${farm.location}</span>` : "")
          )
      }

      const bounds = L.latLngBounds(located.map(f => [f.latitude!, f.longitude!] as [number, number]))
      // 한 곳뿐이면 bounds 가 점이라 확대가 끝까지 들어간다. 적당히 잡아 준다.
      if (located.length === 1) m.setView(bounds.getCenter(), 13)
      else m.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 })
    })()

    return () => {
      alive = false
      if (map.current) { map.current.remove(); map.current = null }
    }
    // farms/tanks 배열은 매번 새로 만들어지므로 내용으로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    located.map(f => `${f.id}:${f.latitude},${f.longitude}`).join("|"),
    tanks.map(tk => `${tk.farm_id}:${tk.status}`).join("|"),
  ])

  if (located.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-ocean-500" /> 양식장 위치
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            좌표를 넣은 양식장이 없습니다. 양식장 수정에서 <b>현재 위치로</b> 를 누르면
            그 자리 좌표가 들어갑니다.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-ocean-500" /> 양식장 위치
          </CardTitle>
          <span className="text-xs text-muted-foreground">{located.length}곳</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={holder} className="w-full h-[280px] bg-muted" role="img" aria-label="양식장 위치 지도" />
        {located.length < farms.length && (
          <p className="text-xs text-muted-foreground px-4 py-2.5 border-t border-border">
            좌표가 없는 양식장 {farms.length - located.length}곳은 표시되지 않습니다 —{" "}
            <Link href="/farms" className="text-ocean-500 hover:underline">좌표 넣기</Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
