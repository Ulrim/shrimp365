"use client"

import { useEffect, useRef } from "react"
import type { Map as LeafletMap } from "leaflet"
import "leaflet/dist/leaflet.css"
import { MapPin } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Farm, Tank } from "@/types"

type Status = Tank["status"]

const STATUS_COLOR: Record<Status, string> = {
  active: "#10B981", warning: "#D97706", danger: "#DC2626", inactive: "#64748B",
}

/** 지도 카드의 문구. 새우 화면은 넘기지 않아 기본값(기존 한국어 그대로)을 쓰고,
 *  농업 화면(components/agri)은 농업 사전(4개 언어)에서 읽어 넘긴다.
 *  `{{n}}` 자리표시자는 기존 관례와 같다. */
export type FarmMapLabels = {
  /** 카드 제목. 기본 "양식장 위치". */
  title: string
  /** 팝업의 수조 수. 기본 "수조 {{n}}개". */
  tankCountN: string
  /** 팝업의 위험·주의 개수 접두. 기본 "위험" / "주의". */
  danger: string
  warning: string
  /** 좌표를 넣은 농장이 하나도 없을 때 본문. */
  noCoordsMsg: string
  /** 지도 aria-label. 기본 "양식장 위치 지도". */
  mapAria: string
  /** 우상단 개수. 기본 "{{n}}곳". */
  locatedN: string
  /** 좌표 없는 농장 안내. 기본 "좌표가 없는 양식장 {{n}}곳은 표시되지 않습니다 —". */
  missingN: string
  /** 안내 끝의 링크 글자. 기본 "좌표 넣기". */
  addCoords: string
}

const DEFAULT_LABELS: FarmMapLabels = {
  title: "양식장 위치",
  tankCountN: "수조 {{n}}개",
  danger: "위험",
  warning: "주의",
  noCoordsMsg: "좌표를 넣은 양식장이 없습니다. 양식장 수정에서 현재 위치로 를 누르면 그 자리 좌표가 들어갑니다.",
  mapAria: "양식장 위치 지도",
  locatedN: "{{n}}곳",
  missingN: "좌표가 없는 양식장 {{n}}곳은 표시되지 않습니다 —",
  addCoords: "좌표 넣기",
}

const fillN = (s: string, n: number) => s.replace("{{n}}", String(n))

/** 팝업을 DOM 으로 조립한다. 사용자 입력(이름·주소)은 textContent 로만 넣는다. */
function farmPopup(name: string, tanks: number, bad: number, warn: number, location: string, L: FarmMapLabels): HTMLElement {
  const root = document.createElement("div")
  root.style.lineHeight = "1.5"

  const b = document.createElement("b")
  b.textContent = name
  root.appendChild(b)

  const line = document.createElement("div")
  line.append(fillN(L.tankCountN, tanks))
  if (bad) {
    const s = document.createElement("span"); s.style.color = "#DC2626"
    s.textContent = ` · ${L.danger} ${bad}`; line.appendChild(s)
  }
  if (warn) {
    const s = document.createElement("span"); s.style.color = "#D97706"
    s.textContent = ` · ${L.warning} ${warn}`; line.appendChild(s)
  }
  root.appendChild(line)

  if (location) {
    const loc = document.createElement("div")
    loc.style.color = "#64748B"
    loc.textContent = location
    root.appendChild(loc)
  }
  return root
}

/** 양식장(농장)을 지도에 찍는다.
 *
 *  OpenStreetMap 타일을 쓴다 — 키가 필요 없고 무료다. 지도 제공자 계정을
 *  만들지 않아도 되므로 해외 농가까지 그대로 서비스된다.
 *
 *  Leaflet 은 브라우저 전용(window·document 를 직접 쓴다)이라 서버에서
 *  불러오면 터진다. 그래서 effect 안에서 동적으로 가져온다.
 */
export function FarmMap({ farms, tanks, labels, farmsHref = "/farms" }: {
  farms: Farm[]
  tanks: Tank[]
  /** 문구 덮어쓰기(부분). 넘기지 않은 키는 기본값(새우 문구) 그대로. */
  labels?: Partial<FarmMapLabels>
  /** "좌표 넣기" 링크 목적지. 기본 `/farms`(새우). 농업 화면은 `/daumlabs/farms`. */
  farmsHref?: string
}) {
  const L: FarmMapLabels = { ...DEFAULT_LABELS, ...labels }
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)

  const located = farms.filter(f => f.latitude !== null && f.longitude !== null)
  // 팝업 문구가 바뀌면(언어·모드) 마커를 다시 그려야 한다. 의존성 배열에 식을
  // 직접 쓰면 lint 가 걸려 이름을 붙여 둔다.
  const popupKey = `${L.tankCountN}|${L.danger}|${L.warning}`

  useEffect(() => {
    if (located.length === 0 || !holder.current) return
    let alive = true

    ;(async () => {
      const Leaflet = (await import("leaflet")).default
      if (!alive || !holder.current) return

      // Strict Mode 가 effect 를 두 번 부르면 같은 자리에 두 번 만들어 터진다.
      if (map.current) { map.current.remove(); map.current = null }

      const m = Leaflet.map(holder.current, { scrollWheelZoom: false, attributionControl: true })
      map.current = m

      Leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
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

        Leaflet.circleMarker([farm.latitude!, farm.longitude!], {
          radius: 10,
          color: STATUS_COLOR[worst],
          fillColor: STATUS_COLOR[worst],
          fillOpacity: 0.55,
          weight: 2,
        })
          .addTo(m)
          // 팝업은 DOM 으로 만든다. 이름·주소를 HTML 문자열로 이어 붙이면
          // 값에 든 태그가 실행된다. 자기 농장만 보는 화면이라 위험은 낮지만
          // 습관을 나쁘게 들이지 않는다 — 사용자 값은 textContent 로만.
          .bindPopup(farmPopup(farm.name, own.length, bad, warn, farm.location, L))
      }

      const bounds = Leaflet.latLngBounds(located.map(f => [f.latitude!, f.longitude!] as [number, number]))
      // 한 곳뿐이면 bounds 가 점이라 확대가 끝까지 들어간다. 적당히 잡아 준다.
      if (located.length === 1) m.setView(bounds.getCenter(), 13)
      else m.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 })
    })()

    return () => {
      alive = false
      if (map.current) { map.current.remove(); map.current = null }
    }
    // farms/tanks 배열은 매번 새로 만들어지므로 내용으로 비교한다. 문구는 언어가
    // 바뀔 때만 달라지므로 팝업 문구 묶음(popupKey)도 함께 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    located.map(f => `${f.id}:${f.latitude},${f.longitude}`).join("|"),
    tanks.map(tk => `${tk.farm_id}:${tk.status}`).join("|"),
    popupKey,
  ])

  if (located.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-ocean-500" /> {L.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {L.noCoordsMsg}
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
            <MapPin className="w-4 h-4 text-ocean-500" /> {L.title}
          </CardTitle>
          <span className="text-xs text-muted-foreground">{fillN(L.locatedN, located.length)}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={holder} className="w-full h-[280px] bg-muted" role="img" aria-label={L.mapAria} />
        {located.length < farms.length && (
          <p className="text-xs text-muted-foreground px-4 py-2.5 border-t border-border">
            {fillN(L.missingN, farms.length - located.length)}{" "}
            <Link href={farmsHref} className="text-ocean-500 hover:underline">{L.addCoords}</Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
